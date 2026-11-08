/**
 * PlayerContext.jsx — Rewritten Playback Engine (Bug-Free)
 *
 * KEY FIXES vs old version:
 *  1. handleTrackEnd uses refs (not stale closure state) for queue/index/repeat/shuffle
 *  2. loadAndPlay no longer reads full file buffer over IPC — uses fast getTrackMetadata
 *  3. skipNext/skipPrev are debounced to prevent rapid-fire double-skips
 *  4. togglePlayPause uses ref for isPlaying — never reads stale state
 *  5. replaceQueue only bumps playToken — a single effect handles all play triggers
 *  6. Audio event listeners are attached ONCE and read from refs, never re-bound
 */

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { PlayerContext, PlaybackTimeContext } from './context'
import { getArtURL } from '../utils'
import { announceOffline } from '../hooks/useOnlineStatus'
import { normalizeAppearance } from '../appearanceThemes'
import { customAccentColor } from '../customTheme'

// ─── Play-logging thresholds ──────────────────────────────────────────────────
// A "play" is counted once a track has actually been listened to, not when it
// starts loading. Without this, skipping through 20 songs logged 20 plays.
const PLAY_THRESHOLD_SEC = 30
const PLAY_THRESHOLD_RATIO = 0.5

function isRemoteURL(src) {
  if (!src || typeof src !== 'string') return false
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:') || src.startsWith('yt:')) return true
  // YouTube video IDs (11 chars or alphanumeric without slashes/backslashes/drive colons)
  if (!src.includes('/') && !src.includes('\\') && !src.includes(':') && src.length > 0) return true
  return false
}

function extractColorFromImage(imgElement) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 4; canvas.height = 4
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgElement, 0, 0, 4, 4)
    const data = ctx.getImageData(0, 0, 4, 4).data
    let r = 0, g = 0, b = 0
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2] }
    const count = data.length / 4
    return `rgb(${Math.round(r/count)},${Math.round(g/count)},${Math.round(b/count)})`
  } catch { return 'rgb(80,80,120)' }
}

function makeTrack(src, overrides = {}) {
  let actualSrc = src || overrides.src || ''
  const videoId = overrides.videoId || (actualSrc.startsWith('yt:') ? actualSrc.replace('yt:', '') : (!actualSrc.includes('/') && !actualSrc.includes('\\') && !actualSrc.includes(':') && actualSrc.length > 0 ? actualSrc : null))
  if (videoId && !actualSrc.startsWith('http') && !actualSrc.startsWith('yt:')) {
    actualSrc = `yt:${videoId}`
  }
  const isRemote = isRemoteURL(actualSrc) || overrides.source === 'online' || overrides.source === 'downloaded' || !!videoId || overrides.isLocal === false

  // Stale stream URLs expire after a short time — never reuse them from persistent storage
  const playURL = isRemote ? null : (overrides.playURL || null)

  // A local file whose tags could not be read falls back to its filename — which
  // carries the extension and the `[videoId]` our downloader appends to the name.
  // Both ended up displayed as part of the title.
  const titleFromSrc = (src) => {
    if (!src) return null
    const base = String(src).split(/[/\\]/).pop() || ''
    const cleaned = base
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, '')
      .trim()
    return cleaned || base || null
  }

  return {
    ...overrides,
    id: overrides.id || `${Date.now()}-${Math.random()}`,
    src: actualSrc,
    playURL,
    videoId: videoId || overrides.videoId || (actualSrc.startsWith('yt:') ? actualSrc.replace('yt:', '') : null),
    title: overrides.title || titleFromSrc(actualSrc),
    artist: overrides.artist ?? null,
    album: overrides.album ?? null,
    duration: overrides.duration || 0,
    albumArt: overrides.albumArt || overrides.thumbnail || overrides.art || null,
    isLocal: !isRemote,
    metadataLoaded: overrides.metadataLoaded || false,
  }
}

// getArtURL is now imported from ../utils

export const EQ_PRESETS = {
  Flat:          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Booster': [5, 4, 3, 2, 1, 0, 0, 0, 0, 0],
  Electronic:    [4, 3, 1, 0, -1, 2, 1, 2, 4, 5],
  'Vocal Booster': [-2, -1.5, -1, 1, 3, 4, 3.5, 3, 1.5, 1],
  Classical:     [3, 2, 1.5, 1, -1, -1, -0.5, 1, 2, 3],
  Jazz:          [3, 2, 1, 1.5, -1.5, -1.5, 0, 1, 2, 3],
  Rock:          [4, 2.5, -1.5, -3, -1.5, 1.5, 3, 4, 4.5, 5],
}

/**
 * Which preset the current gains correspond to, or 'Custom'.
 *
 * The EQ used to be driven by an uncontrolled `<select defaultValue="Flat">`, so
 * after a restart the control read "Flat" while the restored gains were still
 * boosting the bass — the UI and the audio disagreed, and only the audio was
 * right. Deriving the label from the gains makes that impossible.
 */
export function detectEQPreset(gains) {
  if (!Array.isArray(gains) || gains.length === 0) return 'Custom'
  for (const [name, preset] of Object.entries(EQ_PRESETS)) {
    if (preset.length !== gains.length) continue
    if (preset.every((g, i) => Math.abs(g - gains[i]) < 0.01)) return name
  }
  return 'Custom'
}

const reverbBufferCache = new Map()

function createReverbBuffer(ctx, preset) {
  if (!preset || preset === 'none') return null
  
  const cacheKey = `${preset}_${ctx.sampleRate}`
  if (reverbBufferCache.has(cacheKey)) {
    return reverbBufferCache.get(cacheKey)
  }

  let duration = 1.0
  let decay = 2.0

  switch (preset) {
    case 'studio':
      duration = 0.5
      decay = 4.0
      break
    case 'room':
      duration = 1.2
      decay = 3.0
      break
    case 'hall':
      duration = 2.5
      decay = 1.8
      break
    case 'cathedral':
      duration = 4.5
      decay = 1.1
      break
    default:
      return null
  }

  const sampleRate = ctx.sampleRate
  const length = sampleRate * duration
  const impulse = ctx.createBuffer(2, length, sampleRate)

  for (let channel = 0; channel < 2; channel++) {
    const channelData = impulse.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      const pct = i / length
      const envelope = Math.pow(1 - pct, decay)
      channelData[i] = (Math.random() * 2 - 1) * envelope
    }
  }

  reverbBufferCache.set(cacheKey, impulse)
  return impulse
}

class StreamUrlCache {
  constructor(ttlMs = 15 * 60 * 1000, maxSize = 100) { // 15 minutes TTL, max 100 entries
    this.cache = new Map()
    this.ttl = ttlMs
    this.maxSize = maxSize
  }
  
  set(key, url) {
    if (!key || !url || typeof url !== 'string') return
    if (this.cache.size >= this.maxSize) {
      // Evict oldest (Map maintains insertion order)
      const oldestKey = this.cache.keys().next().value
      this.cache.delete(oldestKey)
    }
    this.cache.set(key, { url, timestamp: Date.now() })
  }
  
  get(key) {
    if (!key) return undefined
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return undefined
    }
    return entry.url
  }
  
  has(key) {
    return this.get(key) !== undefined
  }
  
  delete(key) {
    if (key) this.cache.delete(key)
  }

  clear() {
    this.cache.clear()
  }
}

const streamUrlCache = new StreamUrlCache()

export function PlayerProvider({ children }) {
  // ── Load persisted state ────────────────────────────────────────────────
  const defaultState = { queue: [], currentIndex: -1, currentTime: 0, volume: 0.8, shuffle: false, repeat: 'none', theme: 'dynamic', eqGains: [0,0,0,0,0,0,0,0,0,0], is8D: false, panSpeed: 2500, reverbPreset: 'room', isAutoplay: true, playbackSpeed: 1.0, crossfade: 0, appearance: 'daylight', customAccent: '#8b5cf6', customMode: 'dark', ambience: true, motion: true, streamQuality: 'high' }
  
  const [isStateLoaded, setIsStateLoaded] = useState(false)
  
  // ── React state ──────────────────────────────────────────────────────────
  const [queue, setQueue]               = useState(defaultState.queue)
  const [currentIndex, setCurrentIndex] = useState(defaultState.currentIndex)
  const [isPlaying, setIsPlaying]       = useState(false)
  const [progress, setProgress]         = useState(0)
  const [currentTime, setCurrentTime]   = useState(defaultState.currentTime)
  const [duration, setDuration]         = useState(0)
  const [volume, setVolume]             = useState(defaultState.volume)
  const [isMuted, setIsMuted]           = useState(false)
  const [shuffle, setShuffle]           = useState(defaultState.shuffle)
  const [repeat, setRepeat]             = useState(defaultState.repeat)
  const [theme, setThemeState]          = useState(defaultState.theme)
  const [eqGains, setEqGains]           = useState(defaultState.eqGains)
  const [is8D, setIs8D]                 = useState(defaultState.is8D)
  const [panSpeed, setPanSpeed]         = useState(defaultState.panSpeed)
  const [reverbPreset, setReverbPreset] = useState(defaultState.reverbPreset)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [accentColor, setAccentColor]   = useState('rgb(80,80,180)')
  const [isLoadingMeta, setIsLoadingMeta] = useState(false)
  const [isAutoplay, setIsAutoplay]     = useState(defaultState.isAutoplay)
  const [playbackSpeed, setPlaybackSpeed] = useState(defaultState.playbackSpeed)
  const [playToken, setPlayToken]       = useState(0)
  const [crossfade, setCrossfade]       = useState(defaultState.crossfade)
  // 'high' | 'medium' | 'low' — which rendition to ask the main process for.
  const [streamQuality, setStreamQualityState] = useState(() => {
    try { return localStorage.getItem('glaze:stream-quality') || defaultState.streamQuality } catch { return defaultState.streamQuality }
  })
  // What the main process actually resolved for the current track (codec,
  // bitrate, itag). null until the first stream resolves.
  const [streamInfo, setStreamInfo] = useState(null)
  const [appearance, setAppearance]     = useState(() => {
    // Seeded synchronously so the first React paint already has the right
    // palette; the authoritative copy still comes from preferences below.
    // normalizeAppearance guards against a retired theme id still sitting in
    // localStorage — it would match no [data-theme] block and leave the app un-themed.
    try { return normalizeAppearance(localStorage.getItem('glaze:appearance') || defaultState.appearance) } catch { return defaultState.appearance }
  })
  // Static deadline/mode only — never a ticking countdown. Putting a ticking
  // value here would re-render every usePlayer() consumer once a second; the
  // UI derives its own countdown from `deadline`.
  const [customAccent, setCustomAccent] = useState(() => {
    try { return localStorage.getItem('glaze:custom-accent') || defaultState.customAccent } catch { return defaultState.customAccent }
  })
  const [customMode, setCustomMode]     = useState(() => {
    try { return localStorage.getItem('glaze:custom-mode') || defaultState.customMode } catch { return defaultState.customMode }
  })
  // Ambient colour bleed from the album art. On by default — it is the look
  // the app was designed around; the switch exists for people who find it busy.
  const [ambience, setAmbience]         = useState(() => {
    try { return localStorage.getItem('glaze:ambience') !== 'off' } catch { return true }
  })
  // Motion master switch. Defaults to on, but a user who has asked the OS for
  // reduced motion gets it off unless they turn it back on here.
  const [motion, setMotion]             = useState(() => {
    try {
      const saved = localStorage.getItem('glaze:motion')
      if (saved === 'off') return false
      if (saved === 'on') return true
      return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    } catch { return true }
  })
  const [sleepTimer, setSleepTimer]     = useState(null)

  const initialTimeRef = useRef(0)
  // Set while the persisted session is being restored. The first queue trigger
  // after a restart loads that track *paused* — the app opens idle and only
  // starts playback once the user presses play. Consumed on first use so a
  // fresh install (no saved queue) still plays on the first click.
  const restorePendingRef = useRef(false)
  // Consecutive stream-refresh attempts for the current video, so a genuinely
  // dead track cannot loop error → refresh → error forever. Reset on every
  // fresh load (loadAndPlay), not on each in-place refresh.
  const streamRefreshRef = useRef({ videoId: null, count: 0 })

  // Mirror the appearance into localStorage purely so index.html can apply it
  // before React mounts. Preferences remain the source of truth.
  useEffect(() => {
    try {
      localStorage.setItem('glaze:appearance', appearance)
      localStorage.setItem('glaze:custom-accent', customAccent)
      localStorage.setItem('glaze:custom-mode', customMode)
      localStorage.setItem('glaze:ambience', ambience ? 'on' : 'off')
      localStorage.setItem('glaze:motion', motion ? 'on' : 'off')
    } catch {}
  }, [appearance, customAccent, customMode, ambience, motion])

  useEffect(() => {
    let mounted = true
    async function load() {
      let p = null
      if (window.electronAPI?.loadPlaybackState) {
        p = await window.electronAPI.loadPlaybackState()
      } else {
        try {
          const saved = localStorage.getItem('glaze_playback')
          if (saved) p = JSON.parse(saved)
        } catch {}
      }

      if (mounted && p) {
        if (Array.isArray(p.queue)) setQueue(p.queue)
        if (typeof p.currentIndex === 'number') {
          setCurrentIndex(p.currentIndex)
          // Restoring a queue position must NOT start playback.
          restorePendingRef.current = p.currentIndex >= 0
        }
        if (typeof p.currentTime === 'number') {
          setCurrentTime(p.currentTime)
          initialTimeRef.current = p.currentTime
        }
        if (typeof p.volume === 'number') setVolume(p.volume)
        if (typeof p.shuffle === 'boolean') setShuffle(p.shuffle)
        if (p.repeat) setRepeat(p.repeat)
        if (p.theme) setThemeState(p.theme)
        if (Array.isArray(p.eqGains)) setEqGains(p.eqGains)
        if (typeof p.is8D === 'boolean') setIs8D(p.is8D)
        if (typeof p.panSpeed === 'number') setPanSpeed(p.panSpeed)
        if (p.reverbPreset) setReverbPreset(p.reverbPreset)
        if (typeof p.isAutoplay === 'boolean') setIsAutoplay(p.isAutoplay)
        if (typeof p.playbackSpeed === 'number') setPlaybackSpeed(p.playbackSpeed)
        if (typeof p.crossfade === 'number') setCrossfade(Math.max(0, Math.min(12, p.crossfade)))
        // A retired theme id may still be saved here; normalise so the picker
        // highlights the theme that is actually in use.
        if (p.appearance) setAppearance(normalizeAppearance(p.appearance))
        if (typeof p.customAccent === 'string') setCustomAccent(p.customAccent)
        if (p.customMode === 'light' || p.customMode === 'dark') setCustomMode(p.customMode)
        if (typeof p.ambience === 'boolean') setAmbience(p.ambience)
        if (typeof p.motion === 'boolean') setMotion(p.motion)
        if (p.streamQuality) setStreamQualityState(p.streamQuality)

        // Prefer the dedicated position file: it's written every few seconds
        // while playing, so it's a far more accurate "resume here" value than
        // the currentTime embedded in the state blob.
        if (window.electronAPI?.loadPlaybackPosition) {
          try {
            const pos = await window.electronAPI.loadPlaybackPosition()
            if (pos && typeof pos.currentTime === 'number') {
              initialTimeRef.current = pos.currentTime
              setCurrentTime(pos.currentTime)
            }
          } catch {}
        }
      }
      if (mounted) setIsStateLoaded(true)
    }
    load()
    return () => { mounted = false }
  }, [])

  // ─── WEBVIEW OVERRIDE STATE ────────────────────────────────────────────────
  // Removed Webview overrides
  // ───────────────────────────────────────────────────────────────────────────

  const audioRef       = useRef(null)
  if (!audioRef.current) {
    const a = new Audio()
    a.preload = 'auto' // Buffer chunks eagerly for smooth, gapless playback
    audioRef.current = a
  }
  const audio          = audioRef.current
  const loadIdRef      = useRef(0)
  const skipLockRef    = useRef(false)      // debounce rapid skips
  const isInitialLoad  = useRef(true)
  const isSeekingRef   = useRef(false)
  const lastSeekTimeRef= useRef(0)
  const isLoadingMetaRef = useRef(false)

  // Mirror state into refs so event listeners never capture stale closures
  const queueRef       = useRef(queue)
  const indexRef       = useRef(currentIndex)
  const repeatRef      = useRef(repeat)
  const shuffleRef     = useRef(shuffle)
  const isPlayingRef   = useRef(false)
  const isAutoplayRef  = useRef(isAutoplay)
  const crossfadeRef   = useRef(crossfade)
  const sleepTimerRef  = useRef(sleepTimer)
  const fadeGainRef    = useRef(null)
  const fadeOutForLoadRef = useRef(-1)

  useEffect(() => { queueRef.current  = queue },        [queue])
  useEffect(() => { indexRef.current  = currentIndex }, [currentIndex])
  useEffect(() => { repeatRef.current = repeat },       [repeat])
  useEffect(() => { shuffleRef.current= shuffle },      [shuffle])
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  useEffect(() => { isAutoplayRef.current = isAutoplay }, [isAutoplay])
  useEffect(() => { crossfadeRef.current = crossfade }, [crossfade])
  useEffect(() => { sleepTimerRef.current = sleepTimer }, [sleepTimer])

  const triggerAutoplayRef = useRef(null)
  const autoplayPromiseRef = useRef(null)

  // ── Play logging (threshold-based, once per track load) ───────────────────
  const loggedPlayIdsRef = useRef(new Set())
  const maybeLogPlayRef = useRef(null)

  useEffect(() => {
    maybeLogPlayRef.current = (track, loadId) => {
      if (!track || !window.electronAPI?.dbLogPlay) return
      const key = String(loadId)
      if (loggedPlayIdsRef.current.has(key)) return
      loggedPlayIdsRef.current.add(key)
      // Bound the set so it can't grow unbounded across a long session
      if (loggedPlayIdsRef.current.size > 200) {
        loggedPlayIdsRef.current = new Set(Array.from(loggedPlayIdsRef.current).slice(-100))
      }
      window.electronAPI.dbLogPlay({
        src: track.src,
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArt: track.albumArt || track.art || track.thumbnail,
        duration: track.duration
      })
    }
  }, [])

  useEffect(() => {
    triggerAutoplayRef.current = async (force = false) => {
      if (!isAutoplayRef.current && !force) return false
      
      const currentTrack = queueRef.current[indexRef.current] || queueRef.current[queueRef.current.length - 1]
      if (!currentTrack) return false

      let seedId = null
      if (currentTrack.videoId) seedId = currentTrack.videoId
      else if (currentTrack.src?.startsWith('yt:')) seedId = currentTrack.src.replace('yt:', '')
      else seedId = (currentTrack.title || '') + ' ' + (currentTrack.artist || '')

      const doFetch = async () => {
        try {
          const recs = await window.electronAPI?.youtubeGetUpNextBatch([seedId])
          if (recs && recs.length > 0) {
            const latestQ = queueRef.current
            // Filter to valid recommendations
            const validRecs = recs.filter(r => r && r.videoId && r.type !== 'Artist' && r.type !== 'Playlist')
            // Find recommendations that aren't already in the queue
            const newRecs = validRecs.filter(r => !latestQ.some(t => t.src === `yt:${r.videoId}` || t.videoId === r.videoId)).slice(0, 15)
            
            const tracksToAdd = newRecs.length > 0 ? newRecs : validRecs.slice(0, 10)
            if (tracksToAdd.length === 0) return false
            
            const newTracks = tracksToAdd.map(rec => makeTrack(`yt:${rec.videoId}`, {
              id: `yt:${rec.videoId}-${Date.now()}-${Math.random()}`,
              videoId: rec.videoId,
              title: rec.title || 'Unknown Title',
              artist: rec.artist || 'Unknown Artist',
              album: rec.album || null,
              duration: typeof rec.duration === 'object' ? rec.duration?.seconds : (rec.duration || 0),
              albumArt: rec.thumbnail || `https://i.ytimg.com/vi/${rec.videoId}/hqdefault.jpg`,
              isLocal: false
            }))
            
            const nextQ = [...latestQ, ...newTracks]
            queueRef.current = nextQ
            setQueue(nextQ)
            return true
          }
        } catch (e) {
          console.error('Autoplay fetch failed', e)
        }
        return false
      }

      // If already fetching, await existing fetch; otherwise start new fetch
      if (!autoplayPromiseRef.current) {
        autoplayPromiseRef.current = doFetch().finally(() => {
          autoplayPromiseRef.current = null
        })
      }

      const fetchSuccess = await autoplayPromiseRef.current

      // If force === true (track ended and needs immediate next play), advance to next track
      if (force) {
        const nextQ = queueRef.current
        const nextIdx = indexRef.current + 1
        if (nextIdx < nextQ.length) {
          indexRef.current = nextIdx
          setCurrentIndex(nextIdx)
          setPlayToken(t => t + 1)
          return true
        }
      }
      return fetchSuccess
    }
  }, [])

  // ── Audio Graph ──────────────────────────────────────────────────────────
  const EQ_BANDS      = useMemo(() => [32,64,125,250,500,1000,2000,4000,8000,16000], [])
  const audioCtxRef   = useRef(null)
  const filtersRef    = useRef([])
  const pannerRef     = useRef(null)
  const convolverRef  = useRef(null)
  const reverbGainRef = useRef(null)
  const analyserRef   = useRef(null)
  const intervalRef   = useRef(null)

  function initAudioGraph() {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      return
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      const source = ctx.createMediaElementSource(audio)
      let lastNode = source
      const filters = EQ_BANDS.map((freq, i) => {
        const f = ctx.createBiquadFilter()
        f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1; f.gain.value = eqGains[i]
        lastNode.connect(f); lastNode = f; return f
      })
      filtersRef.current = filters
      const panner = ctx.createStereoPanner(); pannerRef.current = panner
      
      const convolver = ctx.createConvolver(); convolverRef.current = convolver
      const initialPreset = localStorage.getItem('glaze_playback') 
        ? (JSON.parse(localStorage.getItem('glaze_playback')).reverbPreset || 'room') 
        : 'room'
      const impulse = createReverbBuffer(ctx, initialPreset)
      if (impulse) convolver.buffer = impulse

      const reverbGain = ctx.createGain()
      let initialGain = 0
      if (initialPreset === 'studio') initialGain = 0.2
      else if (initialPreset === 'room') initialGain = 0.28
      else if (initialPreset === 'hall') initialGain = 0.38
      else if (initialPreset === 'cathedral') initialGain = 0.45
      else if (is8D) initialGain = 0.35
      reverbGain.gain.value = initialGain
      reverbGainRef.current = reverbGain

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser

      // Dedicated fade stage, sitting after every effect. Fading here instead
      // of through audio.volume means crossfade and the sleep timer never
      // fight the user's volume slider.
      const fadeGain = ctx.createGain()
      fadeGain.gain.value = 1
      fadeGainRef.current = fadeGain

      lastNode.connect(convolver)
      convolver.connect(reverbGain)
      reverbGain.connect(panner)
      lastNode.connect(panner)
      panner.connect(fadeGain)
      fadeGain.connect(analyser)
      analyser.connect(ctx.destination)
    } catch(e) { console.warn('AudioGraph init failed:', e) }
  }

  // No-op until the graph exists (it is created on first user gesture), so an
  // early fade request degrades to normal playback rather than throwing.
  function resetFade() {
    const g = fadeGainRef.current
    const ctx = audioCtxRef.current
    if (!g || !ctx) return
    g.gain.cancelScheduledValues(ctx.currentTime)
    g.gain.setValueAtTime(1, ctx.currentTime)
  }

  function rampFade(target, seconds, startFromZero = false) {
    const g = fadeGainRef.current
    const ctx = audioCtxRef.current
    if (!g || !ctx) return
    const now = ctx.currentTime
    g.gain.cancelScheduledValues(now)
    g.gain.setValueAtTime(startFromZero ? 0 : g.gain.value, now)
    g.gain.linearRampToValueAtTime(target, now + Math.max(seconds, 0.05))
  }

  // Synchronously unlock and resume AudioContext on user gesture
  useEffect(() => {
    const unlockAudio = () => {
      initAudioGraph()
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
    }
    window.addEventListener('click', unlockAudio, { passive: true })
    window.addEventListener('pointerdown', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio, { passive: true })
    return () => {
      window.removeEventListener('click', unlockAudio)
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  useEffect(() => {
    filtersRef.current.forEach((f, i) => { if (f) f.gain.value = eqGains[i] })
  }, [eqGains])

  useEffect(() => {
    if (!audioCtxRef.current || !convolverRef.current || !reverbGainRef.current) return
    const ctx = audioCtxRef.current
    if (reverbPreset === 'none') {
      const targetGain = is8D ? 0.35 : 0
      if (is8D) {
        convolverRef.current.buffer = createReverbBuffer(ctx, 'room')
      } else {
        // Omitting convolverRef.current.buffer = null to prevent Chromium InvalidStateError
      }
      reverbGainRef.current.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.1)
    } else {
      const buffer = createReverbBuffer(ctx, reverbPreset)
      convolverRef.current.buffer = buffer
      
      let targetGain = 0.35
      if (reverbPreset === 'studio') targetGain = 0.2
      else if (reverbPreset === 'room') targetGain = 0.28
      else if (reverbPreset === 'hall') targetGain = 0.38
      else if (reverbPreset === 'cathedral') targetGain = 0.45

      reverbGainRef.current.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.1)
    }
  }, [reverbPreset, is8D])

  useEffect(() => {
    let animFrame
    if (is8D && isPlaying) {
      const loop = () => {
        if (pannerRef.current) pannerRef.current.pan.value = Math.sin(Date.now() / panSpeed) * 0.85
        animFrame = requestAnimationFrame(loop)
      }
      animFrame = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(animFrame)
      if (pannerRef.current && audioCtxRef.current)
        pannerRef.current.pan.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.5)
    }
    return () => cancelAnimationFrame(animFrame)
  }, [is8D, panSpeed, isPlaying])

  const updateEqualizer = useCallback((index, gain) => {
    setEqGains(prev => {
      const next = [...prev]; next[index] = gain; return next
    })
    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume()
  }, [])

  const applyEQPreset = useCallback((presetName) => {
    if (EQ_PRESETS[presetName]) {
      setEqGains([...EQ_PRESETS[presetName]])
    }
  }, [])

  const resetEqualizer = useCallback(() => { setEqGains(EQ_BANDS.map(() => 0)) }, [EQ_BANDS])

  const getAnalyserNode = useCallback(() => analyserRef.current, [])

  // ── Streaming quality ────────────────────────────────────────────────────
  // Format selection lives in the main process; it only needs the preset.
  useEffect(() => {
    try { localStorage.setItem('glaze:stream-quality', streamQuality) } catch {}
    window.electronAPI?.audioSetQuality?.(streamQuality)
  }, [streamQuality])

  // The codec/bitrate that was actually resolved, for the UI to display.
  useEffect(() => {
    const off = window.electronAPI?.onStreamInfo?.((info) => setStreamInfo(info))
    return () => { if (typeof off === 'function') off() }
  }, [])

  // Switching preset re-resolves the current track at the new bitrate rather
  // than waiting for the next one, keeping position and play state intact.
  const applyStreamQuality = useCallback(async (quality) => {
    const next = ['high', 'medium', 'low'].includes(quality) ? quality : 'high'
    if (next === streamQuality) return
    setStreamQualityState(next)
    streamUrlCache.clear()

    const track = queueRef.current?.[indexRef.current]
    if (!track || track.isLocal) return // local files always play at native quality
    const rawSrc = track.src || ''
    const videoId = track.videoId || (rawSrc.startsWith('yt:') ? rawSrc.slice(3) : null)
    if (!videoId) return

    const savedTime = audio.currentTime || 0
    const wasPlaying = !audio.paused
    try {
      const url = await window.electronAPI.youtubeGetStreamUrl(videoId)
      if (url && typeof url === 'string') {
        streamUrlCache.set(videoId, url)
        audio.src = url
        if (savedTime > 0) audio.currentTime = savedTime
        if (wasPlaying) audio.play().catch(() => {})
      }
    } catch (_) {
      // Leaving the previous stream playing beats stopping on a failed swap.
    }
  }, [audio, streamQuality])

  // ── Persist queue & settings ─────────────────────────────────────────────
  // Deliberately does NOT depend on `currentTime`. Position has its own tiny,
  // slow-tick writer below — otherwise every volume nudge re-serialised the
  // entire queue to disk.
  useEffect(() => {
    if (!isStateLoaded) return // GUARD: Do not save until initial playback state is loaded!

    const id = setTimeout(() => {
      // Preserve track metadata so queue artwork and titles are preserved on reload
      const safeQueue = queue.map(t => ({
        id: t.id,
        src: t.src,
        title: t.title,
        artist: t.artist,
        album: t.album,
        albumArt: t.albumArt || t.art || t.thumbnail || null,
        duration: t.duration,
        isLocal: t.isLocal
      }))
      const stateObj = {
        queue: safeQueue, currentIndex,
        volume, shuffle, repeat, theme, eqGains, is8D, panSpeed, reverbPreset, isAutoplay, playbackSpeed, crossfade, appearance, customAccent, customMode, ambience, motion, streamQuality,
      }
      try {
        localStorage.setItem('glaze_playback', JSON.stringify(stateObj))
      } catch (e) {}
      if (window.electronAPI?.savePlaybackState) {
        window.electronAPI.savePlaybackState(stateObj)
      }
    }, 500)
    return () => clearTimeout(id)
  }, [isStateLoaded, queue, currentIndex, volume, shuffle, repeat, theme, eqGains, is8D, panSpeed, reverbPreset, isAutoplay, playbackSpeed, crossfade, appearance, customAccent, customMode, ambience, motion, streamQuality])

  // ── Persist playback position (small, frequent, cheap) ───────────────────
  useEffect(() => {
    if (!isStateLoaded) return

    const writePosition = () => {
      if (!audio.src) return
      const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
      if (window.electronAPI?.savePlaybackPosition) {
        window.electronAPI.savePlaybackPosition(t)
      }
    }

    // Slow tick while playing, so "resume where you left off" is actually accurate.
    const id = setInterval(() => { if (!audio.paused) writePosition() }, 5000)

    // Capture precisely on pause / track change / unmount.
    audio.addEventListener('pause', writePosition)
    window.addEventListener('beforeunload', writePosition)

    return () => {
      clearInterval(id)
      audio.removeEventListener('pause', writePosition)
      window.removeEventListener('beforeunload', writePosition)
      writePosition()
    }
  }, [isStateLoaded, currentIndex])

  const setTheme = useCallback((t) => setThemeState(t), [])
  const currentTrack = queue[currentIndex] ?? null

  // ── Volume sync ──────────────────────────────────────────────────────────
  useEffect(() => { audio.volume = isMuted ? 0 : volume }, [volume, isMuted])
  useEffect(() => { audio.playbackRate = playbackSpeed }, [playbackSpeed])

  // ── Sleep timer ──────────────────────────────────────────────────────────
  const SLEEP_FADE_SEC = 5

  const setSleepTimerMinutes = useCallback((minutes) => {
    if (!minutes || minutes <= 0) { setSleepTimer(null); return }
    setSleepTimer({ mode: 'timed', deadline: Date.now() + minutes * 60000, minutes })
  }, [])

  const setSleepTimerEndOfTrack = useCallback(() => {
    setSleepTimer(prev => (prev?.mode === 'endOfTrack' ? null : { mode: 'endOfTrack' }))
  }, [])

  const clearSleepTimer = useCallback(() => setSleepTimer(null), [])

  useEffect(() => {
    if (sleepTimer?.mode !== 'timed') return
    const id = setInterval(() => {
      if (Date.now() < sleepTimer.deadline) return
      setSleepTimer(null)
      // Fade out over a few seconds instead of cutting the track off dead.
      const loadAtExpiry = loadIdRef.current
      rampFade(0, SLEEP_FADE_SEC)
      setTimeout(() => {
        // The user skipped to another track during the fade — leave it alone.
        if (loadIdRef.current !== loadAtExpiry) return
        // Via the ref: `audio` is stable but referencing it directly here makes
        // exhaustive-deps ask for it, and this effect must not re-subscribe.
        audioRef.current.pause()
        resetFade()
      }, SLEEP_FADE_SEC * 1000)
    }, 1000)
    return () => clearInterval(id)
  }, [sleepTimer])

  // ── Audio events — attached ONCE, reads from refs to avoid stale state ───
  useEffect(() => {
    let lastUpdateTime = 0

    const onTimeUpdate = () => {
      // Ignore stale time updates if audio is actively seeking or within 450ms of a seek command
      if (audio.seeking || isSeekingRef.current || (Date.now() - lastSeekTimeRef.current < 450)) {
        return
      }
      const now = Date.now()
      if (now - lastUpdateTime < 250) return  // throttle to 4fps
      lastUpdateTime = now
      setCurrentTime(audio.currentTime)
      if (audio.duration > 0) setProgress((audio.currentTime / audio.duration) * 100)

      // Count the play only once the listener has actually heard it.
      const activeTrack = queueRef.current[indexRef.current]
      if (activeTrack) {
        const dur = audio.duration || activeTrack.duration || 0
        const threshold = dur > 0
          ? Math.min(PLAY_THRESHOLD_SEC, dur * PLAY_THRESHOLD_RATIO)
          : PLAY_THRESHOLD_SEC
        if (audio.currentTime >= threshold) {
          maybeLogPlayRef.current?.(activeTrack, loadIdRef.current)
        }
      }

      // Crossfade: begin fading out once we enter the last N seconds. Guarded
      // per load so the 4fps timeupdate tick cannot restart the ramp.
      const xf = crossfadeRef.current
      if (xf > 0 && audio.duration > 0 && !audio.paused) {
        const remaining = audio.duration - audio.currentTime
        if (remaining > 0 && remaining <= xf && fadeOutForLoadRef.current !== loadIdRef.current) {
          fadeOutForLoadRef.current = loadIdRef.current
          rampFade(0, remaining)
        }
      }
    }

    const onSeeking = () => {
      isSeekingRef.current = true
    }

    const onSeeked = () => {
      isSeekingRef.current = false
      lastSeekTimeRef.current = 0
      setCurrentTime(audio.currentTime)
      if (audio.duration > 0) setProgress((audio.currentTime / audio.duration) * 100)
      // Seeking back out of the crossfade window must restore full volume —
      // otherwise the track stays silent for the rest of its run.
      const xf = crossfadeRef.current
      if (xf > 0 && audio.duration > 0 && audio.duration - audio.currentTime > xf) {
        fadeOutForLoadRef.current = -1
        resetFade()
      }
    }

    const onLoadedMetadata = () => setDuration(audio.duration)
    const onPlay  = () => { setIsPlaying(true);  isPlayingRef.current = true }
    const onPause = () => {
      // Ignore pause events triggered while loading/switching tracks
      if (isLoadingMetaRef.current) return
      setIsPlaying(false)
      isPlayingRef.current = false
    }

    // FIXED: reads from refs, never stale closures
    const onEnded = () => {
      const q = queueRef.current
      const idx = indexRef.current
      const rep = repeatRef.current
      const shuf = shuffleRef.current

      // "Stop after this track" beats repeat and shuffle — the user explicitly
      // asked for playback to end here.
      if (sleepTimerRef.current?.mode === 'endOfTrack') {
        setSleepTimer(null)
        setIsPlaying(false)
        isPlayingRef.current = false
        return
      }

      if (rep === 'one') {
        audio.currentTime = 0
        setCurrentTime(0)
        audio.play().catch(() => {})
        return 
      }

      if (shuf) {
        // Exclude current index so the same song doesn't repeat
        if (q.length <= 1) { 
          if (triggerAutoplayRef.current) triggerAutoplayRef.current(true)
          return 
        }
        let nextIdx = Math.floor(Math.random() * (q.length - 1))
        if (nextIdx >= idx) nextIdx++
        indexRef.current = nextIdx
        setCurrentIndex(nextIdx)
        setPlayToken(t => t + 1)
        return
      }

      const next = idx + 1
      if (next < q.length) { 
        indexRef.current = next
        setCurrentIndex(next) 
        setPlayToken(t => t + 1)
      } else if (rep === 'all') { 
        indexRef.current = 0
        setCurrentIndex(0) 
        setPlayToken(t => t + 1)
      } else { 
        if (triggerAutoplayRef.current) {
          triggerAutoplayRef.current(true).then(success => {
            if (!success) { 
              setIsPlaying(false)
              isPlayingRef.current = false 
            }
          })
        } else {
          setIsPlaying(false)
          isPlayingRef.current = false 
        }
      }
    }

    const onError = async (e) => {
      // Ignore if no valid src is assigned or during intentional track transitions
      if (!audio.src || audio.src === window.location.href || audio.src === 'about:blank') return
      // Ignore errors while we're already loading a new track
      if (isLoadingMetaRef.current) return

      console.warn('Audio playback error:', audio.error?.message || `Code: ${audio.error?.code}`, 'src:', audio.src)

      const currentTrackObj = queueRef.current[indexRef.current]
      const videoId = currentTrackObj?.videoId || (currentTrackObj?.src?.startsWith('yt:') ? currentTrackObj.src.replace('yt:', '') : null)
      const wasPlaying = !audio.paused || isPlayingRef.current

      // A restored-but-paused track can fail the moment the app opens: the queue
      // is persisted as metadata only, so its stream URL is re-resolved on boot
      // and that resolution can fail (dead video, expired session, offline).
      // Refreshing it here accomplishes nothing the user asked for — and because
      // the refresh swaps `audio.src`, a URL that fails again re-enters this
      // handler, so the dock's play/pause button flickers on a loop while the app
      // sits idle. Leave it alone; togglePlayPause() already reloads the track
      // from scratch when the user actually presses play.
      if (!wasPlaying) {
        isLoadingMetaRef.current = false
        setIsLoadingMeta(false)
        return
      }

      // Auto-recover expired or stalled YouTube streams by requesting a fresh stream URL.
      // Offline there is nothing to refresh — the URL cannot be re-minted, so stop
      // cleanly instead of burning a timeout on every error event.
      if (videoId && window.electronAPI?.youtubeGetStreamUrl && navigator.onLine !== false) {
        // Give up after a few tries instead of looping forever on a dead video.
        const refresh = streamRefreshRef.current
        if (refresh.videoId !== videoId) {
          refresh.videoId = videoId
          refresh.count = 0
        }
        refresh.count += 1
        if (refresh.count > 2) {
          console.warn('[Audio] Giving up on', videoId, 'after', refresh.count, 'failed refreshes')
          announceOffline('This track could not be played — it may be unavailable or region-locked.')
          isLoadingMetaRef.current = false
          setIsLoadingMeta(false)
          setIsPlaying(false)
          isPlayingRef.current = false
          return
        }

        console.log('[Audio] Stream error or expired URL detected. Refreshing stream for:', videoId)
        // Guard: prevent pause flicker while we swap the src
        isLoadingMetaRef.current = true
        setIsLoadingMeta(true)
        streamUrlCache.delete(videoId)
        const savedTime = audio.currentTime || 0

        try {
          const freshUrl = await window.electronAPI.youtubeGetStreamUrl(videoId)
          if (freshUrl && typeof freshUrl === 'string') {
            streamUrlCache.set(videoId, freshUrl)
            audio.src = freshUrl
            if (savedTime > 0) {
              audio.currentTime = savedTime
            }
            initAudioGraph()
            if (audioCtxRef.current?.state === 'suspended') {
              audioCtxRef.current.resume().catch(() => {})
            }
            if (wasPlaying) {
              audio.play().catch(err => {
                if (err.name !== 'AbortError') {
                  console.warn('Auto-retry after stream refresh failed:', err?.message)
                  setIsPlaying(false)
                  isPlayingRef.current = false
                }
              })
            }
            isLoadingMetaRef.current = false
            setIsLoadingMeta(false)
            return
          }
        } catch (refreshErr) {
          console.warn('Stream refresh exception:', refreshErr?.message)
        }
      }

      isLoadingMetaRef.current = false
      setIsLoadingMeta(false)
      setIsPlaying(false)
      isPlayingRef.current = false
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('seeking', onSeeking)
    audio.addEventListener('seeked', onSeeked)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('seeking', onSeeking)
      audio.removeEventListener('seeked', onSeeked)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
    }
  }, []) // ← attached ONCE, refs handle fresh state

  // ── Media Keys & Tray ────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return
    const u1 = window.electronAPI.onMediaKey('playpause', () => togglePlayPause())
    const u2 = window.electronAPI.onMediaKey('next',      () => skipNext())
    const u3 = window.electronAPI.onMediaKey('prev',      () => skipPrev())
    const u4 = window.electronAPI.onMediaKey('stop',      () => { audio.pause() })
    const u5 = window.electronAPI.onTrayAction('playpause', () => togglePlayPause())
    const u6 = window.electronAPI.onTrayAction('next',      () => skipNext())
    const u7 = window.electronAPI.onTrayAction('prev',      () => skipPrev())
    let u8 = () => {}
    if (window.electronAPI.onFullScreenChange)
      u8 = window.electronAPI.onFullScreenChange((isFS) => setIsFullScreen(isFS))
    return () => { u1();u2();u3();u4();u5();u6();u7();u8() }
  }, []) // ← attached once; controls use refs internally

  // ── Full Screen ──────────────────────────────────────────────────────────
  const toggleFullScreen = useCallback(async () => {
    if (window.electronAPI?.toggleFullScreen) {
      const fs = await window.electronAPI.toggleFullScreen()
      setIsFullScreen(fs)
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => setIsFullScreen(true)).catch(console.warn)
      } else {
        document.exitFullscreen().then(() => setIsFullScreen(false)).catch(console.warn)
      }
    }
  }, [])

  // ── Discord Rich Presence & Thumbnail Toolbar ────────────────────────────
  // Declared here, above the effect: a dependency array is evaluated during render,
  // so a `const` further down the component would be a ReferenceError.
  // Bumped on every seek — `currentTime` ticks ~4x/sec and cannot be a dependency,
  // so a seek needs its own discrete signal or Discord keeps the old position.
  const [presenceEpoch, setPresenceEpoch] = useState(0)

  useEffect(() => {
    if (window.electronAPI?.updateThumbnailToolbar) {
      window.electronAPI.updateThumbnailToolbar(isPlaying)
    }

    if (!window.electronAPI?.updateDiscordPresence) return
    if (currentTrack && isPlaying) {
      window.electronAPI.updateDiscordPresence({ title: currentTrack.title || 'Unknown', artist: currentTrack.artist || '', album: currentTrack.album || '', art: currentTrack.albumArt || '', isPlaying: true, duration: duration || 0, currentTime: currentTime || 0 })
    } else {
      // Paused, stopped, or nothing loaded — no presence at all. The card is only
      // supposed to exist while music is actually playing; a "paused at 1:23" card
      // is still an activity sitting on the profile, which is exactly what was
      // asked not to happen.
      window.electronAPI.clearDiscordPresence?.()
    }
    // `duration` is a dependency on purpose. It is 0 at the instant a track starts
    // (metadata is still loading), so the presence went out without timestamps and
    // Discord showed 0:00 for the whole song — nothing ever re-pushed once the
    // duration arrived. `currentTime` deliberately stays out: it ticks ~4x/sec.
  }, [currentTrack?.src, isPlaying, duration, presenceEpoch])

  // ── OS Media Controls (System Media Transport Controls / SMTC via MediaSession) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return

    if (currentTrack) {
      try {
        const art = getArtURL(currentTrack.src)
        const artworkList = []
        if (art && typeof art === 'string') {
          if (art.startsWith('http://') || art.startsWith('https://') || art.startsWith('data:') || art.startsWith('blob:')) {
            artworkList.push(
              { src: art, sizes: '96x96',   type: 'image/jpeg' },
              { src: art, sizes: '128x128', type: 'image/jpeg' },
              { src: art, sizes: '192x192', type: 'image/jpeg' },
              { src: art, sizes: '256x256', type: 'image/jpeg' },
              { src: art, sizes: '512x512', type: 'image/jpeg' }
            )
          }
        }

        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: currentTrack.title || currentTrack.name || 'Unknown Track',
          artist: currentTrack.artist || 'Unknown Artist',
          album: currentTrack.album || 'Glaze Music',
          artwork: artworkList
        })
      } catch (err) {
        console.warn('[MediaSession] Failed to set metadata:', err)
      }

      try {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
      } catch (e) {}

      try {
        navigator.mediaSession.setActionHandler('play', () => togglePlayPause())
        navigator.mediaSession.setActionHandler('pause', () => togglePlayPause())
        navigator.mediaSession.setActionHandler('previoustrack', () => skipPrev())
        navigator.mediaSession.setActionHandler('nexttrack', () => skipNext())
        navigator.mediaSession.setActionHandler('stop', () => audio.pause())
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (typeof details.seekTime === 'number' && audio.duration > 0) {
            seekTo((details.seekTime / audio.duration) * 100)
          }
        })
      } catch (err) {
        console.warn('[MediaSession] Failed to bind handlers:', err)
      }
    } else {
      try {
        navigator.mediaSession.metadata = null
        navigator.mediaSession.playbackState = 'none'
      } catch (e) {}
    }
  }, [currentTrack?.src, currentTrack?.title, currentTrack?.artist, isPlaying])

  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return
    if (duration > 0 && Number.isFinite(duration) && Number.isFinite(currentTime)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: Math.max(0, duration),
          playbackRate: 1.0,
          position: Math.min(Math.max(0, currentTime), duration)
        })
      } catch (e) {}
    }
  }, [currentTime, duration])


  // ── Accent color from artwork ──────────────────────────────────────────
  useEffect(() => {
    if (!currentTrack?.src) { setAccentColor('rgb(80,80,180)'); return }
    const artUrl = currentTrack.albumArt || currentTrack.art || currentTrack.thumbnail || getArtURL(currentTrack.src)
    if (!artUrl) { setAccentColor('rgb(80,80,180)'); return }
    const img = new Image(); img.crossOrigin = 'Anonymous'
    img.onload = () => setAccentColor(extractColorFromImage(img))
    img.onerror = () => setAccentColor('rgb(80,80,180)')
    img.src = artUrl
  }, [currentTrack?.src, currentTrack?.albumArt, currentTrack?.art, currentTrack?.thumbnail])

  // ── Autoplay Extend ──────────────────────────────────────────────────────
  // Trigger early autoplay append if we are near the end of the queue
  useEffect(() => {
    if (isAutoplay && queue.length > 0 && currentIndex >= queue.length - 2) {
      if (triggerAutoplayRef.current) triggerAutoplayRef.current(false)
    }
  }, [currentIndex, isAutoplay, queue.length])

  // ── Prefetch the next track's stream URL ────────────────────────────────
  // Resolving a YouTube stream URL is a network round-trip that used to happen
  // only once the previous track had already ended. Doing it while the current
  // track is still playing means loadAndPlay finds a warm cache entry instead.
  const prefetchInFlightRef = useRef(new Set())
  const prefetchTimerRef = useRef(null)
  useEffect(() => {
    if (!window.electronAPI?.youtubeGetStreamUrl) return
    if (shuffle) return // the next track is not predictable under shuffle

    const nextIdx = currentIndex + 1 < queue.length
      ? currentIndex + 1
      : (repeat === 'all' && queue.length > 0 ? 0 : -1)
    if (nextIdx < 0) return

    const t = queue[nextIdx]
    if (!t || t.isLocal) return // local files need no stream resolution

    const rawSrc = t.src || ''
    const vid = t.videoId || (rawSrc.startsWith('yt:') ? rawSrc.slice(3) : null)
    if (!vid) return
    if (streamUrlCache.has(vid)) return // already warm (has() honours the TTL)
    if (prefetchInFlightRef.current.has(vid)) return

    prefetchInFlightRef.current.add(vid)
    window.electronAPI.youtubeGetStreamUrl(vid)
      .then(url => {
        if (url && typeof url === 'string') streamUrlCache.set(vid, url)
      })
      .catch(() => {}) // best-effort: loadAndPlay will resolve it on demand
      .finally(() => prefetchInFlightRef.current.delete(vid))
  }, [currentIndex, queue, shuffle, repeat])

  // ── Prefetch on intent ───────────────────────────────────────────────────
  // The effect below only warms the *next* track, so the first play of a session
  // and any click out of order still paid the full cold resolve — measured 3.4 s
  // through yt-dlp against 27 ms once cached. Rows call this on hover, so by the
  // time the pointer lands and clicks, the URL is already there.
  const prefetchStreamUrl = useCallback((track) => {
    if (!window.electronAPI?.youtubeGetStreamUrl || !track || track.isLocal) return
    const rawSrc = track.src || ''
    const vid = track.videoId || (rawSrc.startsWith('yt:') ? rawSrc.slice(3) : null)
    if (!vid) return
    if (streamUrlCache.has(vid)) return
    if (prefetchInFlightRef.current.has(vid)) return

    // Debounced: dragging the pointer across a 300-card grid would otherwise
    // spawn a yt-dlp process per card. Only the row the pointer actually rests
    // on is worth resolving, and never more than two at a time.
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null
      if (streamUrlCache.has(vid)) return
      if (prefetchInFlightRef.current.has(vid)) return
      if (prefetchInFlightRef.current.size >= 2) return

      prefetchInFlightRef.current.add(vid)
      window.electronAPI.youtubeGetStreamUrl(vid)
        .then(url => {
          if (url && typeof url === 'string') streamUrlCache.set(vid, url)
        })
        .catch(() => {})
        .finally(() => prefetchInFlightRef.current.delete(vid))
    }, 250)
  }, [])

  // ── Load & Play ──────────────────────────────────────────────────────────
  const loadAndPlay = useCallback(async (track, shouldPlay) => {
    if (!track) return

    const thisId = ++loadIdRef.current
    // A fresh load gets a fresh retry budget.
    streamRefreshRef.current = { videoId: null, count: 0 }

    if (shouldPlay) {
      setIsPlaying(true)
      isPlayingRef.current = true
    }

    setIsLoadingMeta(true)
    isLoadingMetaRef.current = true

    // Step 1: Resolve playable URL
    let playURL = track.playURL
    const rawSrc = track.src || ''
    const isYt = rawSrc.startsWith('yt:') || !!track.videoId || (!rawSrc.includes('/') && !rawSrc.includes('\\') && !rawSrc.includes(':') && rawSrc.length > 0)
    let videoId = isYt ? (track.videoId || rawSrc.replace('yt:', '')) : null
    const isLocal = track.isLocal && !isYt && !rawSrc.startsWith('http://') && !rawSrc.startsWith('https://')

    if (isLocal && !playURL) {
      playURL = window.electronAPI
        ? await window.electronAPI.filePathToURL(rawSrc)
        : rawSrc
    } else if (!playURL || isYt) {
      if (isYt && videoId) {
        if (window.electronAPI?.findDownloadedTrack) {
          try {
            const localPath = await window.electronAPI.findDownloadedTrack(videoId)
            if (localPath) {
              playURL = await window.electronAPI.filePathToURL(localPath)
            }
          } catch (e) {}
        }
        
        if (!playURL && window.electronAPI?.youtubeGetStreamUrl) {
          // Offline with nothing on disk: every remaining step is a network call
          // that would spend ~30 s timing out and then stop the transport with no
          // explanation. Refuse immediately and say why.
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            announceOffline(`"${track.title || 'That track'}" isn't downloaded — connect to play it.`)
            setIsLoadingMeta(false)
            isLoadingMetaRef.current = false
            setIsPlaying(false)
            isPlayingRef.current = false
            return
          }
          let rawUrl = streamUrlCache.get(videoId)
          if (!rawUrl) {
            try {
              rawUrl = await window.electronAPI.youtubeGetStreamUrl(videoId)
              if (rawUrl && typeof rawUrl === 'string') {
                streamUrlCache.set(videoId, rawUrl)
              }
            } catch (e) {
              console.warn('[Stream] Initial getStreamUrl error:', e?.message)
            }
          }
          
          if (!rawUrl || typeof rawUrl !== 'string') {
            streamUrlCache.delete(videoId)
            try {
              rawUrl = await window.electronAPI.youtubeGetStreamUrl(videoId)
              if (rawUrl && typeof rawUrl === 'string') {
                streamUrlCache.set(videoId, rawUrl)
              }
            } catch (e) {}
          }
          
          if (!rawUrl || typeof rawUrl !== 'string') {
            // Search fallback using title and artist
            if (track.title && track.title !== track.src && window.electronAPI?.youtubeSearch) {
              try {
                const searchQ = `${track.title} ${track.artist || ''}`.trim()
                const sRes = await window.electronAPI.youtubeSearch(searchQ, 'songs')
                const found = sRes?.songs?.[0] || null
                if (found?.videoId) {
                  rawUrl = await window.electronAPI.youtubeGetStreamUrl(found.videoId)
                  if (rawUrl) {
                    videoId = found.videoId
                    // Note: 'enriched' is created later; we update track directly here
                    track = { ...track, videoId: found.videoId, src: `yt:${found.videoId}` }
                    streamUrlCache.set(found.videoId, rawUrl)
                  }
                }
              } catch (_) {}
            }
          }
          
          if (!rawUrl || typeof rawUrl !== 'string') {
            console.error('Failed to get stream URL for youtube track:', videoId)
            setIsLoadingMeta(false)
            isLoadingMetaRef.current = false
            setIsPlaying(false)
            isPlayingRef.current = false
            return
          }
          // NOTE: never log `rawUrl` — it carries signed auth tokens.
          playURL = rawUrl
        } else if (!playURL) {
          playURL = rawSrc
        }
      } else if (rawSrc.startsWith('http://') || rawSrc.startsWith('https://') || rawSrc.startsWith('blob:')) {
        playURL = rawSrc
      } else {
        playURL = rawSrc
      }
    }
    if (thisId !== loadIdRef.current) return

    audio.crossOrigin = 'anonymous'

    // Step 2: Enrich metadata (non-blocking for fast playback start)
    let enriched = { ...track, playURL, videoId: videoId || track.videoId }

    if (track.isLocal && !track.metadataLoaded && window.electronAPI?.getTrackMetadata) {
      window.electronAPI.getTrackMetadata(track.src).then(meta => {
        if (meta && thisId === loadIdRef.current) {
          setQueue(prev => prev.map(t => t.id === track.id ? {
            ...t,
            title: meta.title || t.title,
            artist: meta.artist || t.artist,
            album: meta.album || t.album,
            duration: meta.duration || t.duration,
            metadataLoaded: true,
          } : t))
        }
      }).catch(err => console.warn('Metadata load failed:', err?.message))
    } else if (!track.isLocal && (track.src?.startsWith('yt:') || videoId)) {
      const vid = videoId || (track.src?.startsWith('yt:') ? track.src.replace('yt:', '') : null)
      const isRawTitle = !track.title || track.title === track.src || track.title.startsWith('yt:')
      const isMissingArt = !track.albumArt && !track.art && !track.thumbnail
      const isMissingArtist = !track.artist || track.artist === 'Unknown Artist' || track.artist === 'Unknown'

      if (vid && (isRawTitle || isMissingArt || isMissingArtist) && window.electronAPI?.youtubeGetUpNextBatch) {
        window.electronAPI.youtubeGetUpNextBatch([vid]).then(recs => {
          if (recs && recs.length > 0 && thisId === loadIdRef.current) {
            const ytInfo = recs.find(r => r.videoId === vid) || recs[0]
            if (ytInfo) {
              setQueue(prev => prev.map(t => t.id === track.id ? {
                ...t,
                title: isRawTitle && ytInfo.title ? ytInfo.title : t.title,
                artist: (!t.artist || t.artist === 'Unknown Artist' || t.artist === 'Unknown') && ytInfo.artist ? ytInfo.artist : t.artist,
                albumArt: t.albumArt || t.art || t.thumbnail || ytInfo.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
                metadataLoaded: true,
              } : t))
            }
          }
        }).catch(err => console.warn('YouTube metadata enrichment failed:', err?.message))
      }
    }

    // Update queue entry with enriched playURL
    setQueue(prev => prev.map(t => t.id === track.id ? enriched : t))

    // NOTE: history/analytics logging is intentionally NOT here. It fires from
    // onTimeUpdate once the play threshold is reached (see PLAY_THRESHOLD_SEC).

    if (thisId !== loadIdRef.current) return

    // Step 3: Assign src and play
    if (audio.src !== enriched.playURL) {
      audio.src = enriched.playURL
    }

    initAudioGraph()
    if (audioCtxRef.current?.state === 'suspended') {
      await audioCtxRef.current.resume().catch(e => console.warn('Failed to resume AudioContext:', e))
    }

    // On very first boot, restore the saved time but don't auto-play
    if (isInitialLoad.current && !shouldPlay) {
      audio.currentTime = initialTimeRef.current || 0
      setCurrentTime(audio.currentTime)
      isInitialLoad.current = false
      setIsLoadingMeta(false)
      isLoadingMetaRef.current = false
      return
    }
    isInitialLoad.current = false

    if (thisId !== loadIdRef.current) return

    if (!shouldPlay) {
      setIsLoadingMeta(false)
      isLoadingMetaRef.current = false
      return
    }

    // One retry, only when the element itself refuses the source. See below.
    let retriedDirect = false
    try {
      if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume().catch(() => {})
      }
      try {
        await audio.play()
      } catch (playErr) {
        // MEDIA_ERR_SRC_NOT_SUPPORTED: the URL we were handed cannot be decoded.
        // YouTube's IOS client currently hands out URLs that answer 206 with no
        // CORS header, and the element rejects them even though the resolver
        // thought they were fine — a check in the main process cannot see what
        // the renderer's network stack sees. The element is the only reliable
        // judge, so ask for a direct (yt-dlp) URL and try exactly once.
        if (playErr.name !== 'NotSupportedError' || retriedDirect || !videoId) throw playErr
        retriedDirect = true
        const direct = await window.electronAPI
          ?.youtubeGetStreamUrl(videoId, { forceDirect: true })
          .catch(() => null)
        if (!direct || typeof direct !== 'string') throw playErr
        audio.src = direct
        await audio.play()
      }
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
      // Fade the incoming track up to match the outgoing track's fade-out.
      if (crossfadeRef.current > 0) rampFade(1, crossfadeRef.current, true)
      else resetFade()
      setIsPlaying(true)
      isPlayingRef.current = true
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Playback failed:', err.name, err.message)
        if (audio.paused) {
          setIsPlaying(false)
          isPlayingRef.current = false
        }
      }
    } finally {
      if (thisId === loadIdRef.current) {
        setIsLoadingMeta(false)
        isLoadingMetaRef.current = false
      }
    }
  }, []) // stable — reads all live data via refs or params

  // ── Single effect that triggers playback ─────────────────────────────────
  // playToken distinguishes replaceQueue(same index) from a no-op
  const prevTriggerRef = useRef({ index: -1, token: 0 })

  useEffect(() => {
    const { index: prevIdx, token: prevToken } = prevTriggerRef.current
    const isNewToken = playToken !== prevToken
    const isNewIndex = currentIndex !== prevIdx

    if (!isNewToken && !isNewIndex) return
    prevTriggerRef.current = { index: currentIndex, token: playToken }

    // Consume the restore flag here (not inside the `if` below) so it can never
    // leak onto a later, user-initiated trigger if the restored track was gone.
    const isRestoredSession = restorePendingRef.current
    restorePendingRef.current = false

    const trackToPlay = queueRef.current[currentIndex] || queue[currentIndex]
    if (currentIndex >= 0 && trackToPlay) {
      initAudioGraph()
      // A restored session loads the track so the player bar has artwork and a
      // position to resume from, but stays paused until the user hits play.
      loadAndPlay(trackToPlay, !isRestoredSession)
    }
  }, [currentIndex, playToken])

  // ── Controls ─────────────────────────────────────────────────────────────
  // Every function below is wrapped in useCallback with a stable dependency list.
  // They read live state through refs (that's the design of this file), so their
  // identity must not change on every render — otherwise the memoized context
  // value below is invalidated 4x/sec by the position tick.
  const addToQueue = useCallback((sources, playImmediately = false) => {
    initAudioGraph()
    const newTracks = sources.map(src => typeof src === 'string' ? makeTrack(src) : makeTrack(src.src, src))
    const startIndex = queueRef.current.length
    setQueue(prev => [...prev, ...newTracks])
    if (playImmediately) setCurrentIndex(startIndex)
  }, [])

  const playNext = useCallback((sources) => {
    initAudioGraph()
    const newTracks = sources.map(src => typeof src === 'string' ? makeTrack(src) : makeTrack(src.src, src))
    const insertAt = indexRef.current + 1
    setQueue(prev => {
      const next = [...prev]
      next.splice(insertAt, 0, ...newTracks)
      queueRef.current = next
      return next
    })
  }, [])

  const replaceQueue = useCallback((sources, startIndex = 0) => {
    initAudioGraph()
    const newTracks = sources.map(src => typeof src === 'string' ? makeTrack(src) : makeTrack(src.src, src))
    setQueue(newTracks)
    queueRef.current = newTracks

    // Handle empty queue: reset to idle state without triggering playback
    if (newTracks.length === 0) {
      audio.pause()
      audio.src = ''
      setCurrentIndex(-1)
      indexRef.current = -1
      setIsPlaying(false)
      isPlayingRef.current = false
      setProgress(0)
      setCurrentTime(0)
      setDuration(0)
      return
    }

    setCurrentIndex(startIndex)
    indexRef.current = startIndex
    setPlayToken(t => t + 1)
  }, [])

  const playTrackAt = useCallback((index) => {
    initAudioGraph()
    setCurrentIndex(index)
  }, [])

  const removeFromQueue = useCallback((trackId) => {
    const removedIdx = queueRef.current.findIndex(t => t.id === trackId)
    if (removedIdx === -1) return
    const newQueue = queueRef.current.filter(t => t.id !== trackId)
    setQueue(newQueue)
    queueRef.current = newQueue

    if (newQueue.length === 0) {
      // Queue is now empty — stop playback
      audio.pause()
      audio.src = ''
      setCurrentIndex(-1)
      indexRef.current = -1
      setIsPlaying(false)
      isPlayingRef.current = false
      return
    }

    if (removedIdx < indexRef.current) {
      // Removed a track before the current one — shift index back
      const newIdx = indexRef.current - 1
      setCurrentIndex(newIdx)
      indexRef.current = newIdx
    } else if (removedIdx === indexRef.current) {
      // Removed the currently playing track — advance to the next one
      const nextIdx = removedIdx < newQueue.length ? removedIdx : newQueue.length - 1
      setCurrentIndex(nextIdx)
      indexRef.current = nextIdx
      setPlayToken(t => t + 1) // trigger playback of the new track
    }
    // If removedIdx > indexRef.current, no index change needed
  }, [])

  const reorderQueue = useCallback((fromIndex, toIndex) => {
    if (fromIndex < 0 || fromIndex >= queueRef.current.length || toIndex < 0 || toIndex >= queueRef.current.length) return
    const nextQueue = [...queueRef.current]
    const [removed] = nextQueue.splice(fromIndex, 1)
    nextQueue.splice(toIndex, 0, removed)

    // Adjust active track index dynamically
    let nextIndex = indexRef.current
    if (indexRef.current === fromIndex) {
      nextIndex = toIndex
    } else if (indexRef.current > fromIndex && indexRef.current <= toIndex) {
      nextIndex--
    } else if (indexRef.current < fromIndex && indexRef.current >= toIndex) {
      nextIndex++
    }

    setQueue(nextQueue)
    queueRef.current = nextQueue
    setCurrentIndex(nextIndex)
    indexRef.current = nextIndex
  }, [])

  // FIXED: reads isPlayingRef (not stale isPlaying state), resumes context asynchronously
  const togglePlayPause = useCallback(async () => {
    const track = queueRef.current[indexRef.current]
    if (!audio.src || audio.error) {
      if (track) {
        loadAndPlay(track, true)
      }
      return
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(e => console.warn('Failed to resume AudioContext:', e))
    }

    if (isPlayingRef.current) {
      audio.pause()
    } else {
      audio.play().catch(err => {
        if (err.name !== 'AbortError') {
          console.warn('Play failed, retrying fresh load:', err.message)
          if (track) {
            const vid = track.videoId || (track.src?.startsWith('yt:') ? track.src.replace('yt:', '') : null)
            if (vid) streamUrlCache.delete(vid)
            loadAndPlay(track, true)
          } else {
            setIsPlaying(false)
          }
        }
      })
    }
  }, [loadAndPlay])

  // FIXED: debounced — 300ms lock prevents rapid-fire double skips
  const skipNext = useCallback(() => {
    if (skipLockRef.current) return
    skipLockRef.current = true
    setTimeout(() => { skipLockRef.current = false }, 300)

    const q = queueRef.current
    const idx = indexRef.current
    if (q.length === 0) return

    if (shuffleRef.current) {
      if (q.length <= 1) {
        if (triggerAutoplayRef.current) triggerAutoplayRef.current(true)
        return
      }
      let nextIdx = Math.floor(Math.random() * (q.length - 1))
      if (nextIdx >= idx) nextIdx++
      indexRef.current = nextIdx
      setCurrentIndex(nextIdx)
      setPlayToken(t => t + 1)
      return
    }

    const next = idx + 1
    if (next < q.length) {
      indexRef.current = next
      setCurrentIndex(next)
      setPlayToken(t => t + 1)
    } else if (repeatRef.current === 'all') {
      indexRef.current = 0
      setCurrentIndex(0)
      setPlayToken(t => t + 1)
    } else {
      if (triggerAutoplayRef.current) {
        triggerAutoplayRef.current(true).then(success => {
          if (!success) {
            setCurrentTime(0)
            audio.currentTime = 0
            audio.pause()
            setIsPlaying(false)
            isPlayingRef.current = false
          }
        })
      }
    }
  }, [])

  const skipPrev = useCallback(() => {
    if (skipLockRef.current || queueRef.current.length === 0) return
    skipLockRef.current = true
    setTimeout(() => { skipLockRef.current = false }, 300)

    if (audio.currentTime > 3) { 
      audio.currentTime = 0
      setCurrentTime(0)
      return 
    }
    const prev = indexRef.current - 1
    if (prev >= 0) {
      indexRef.current = prev
      setCurrentIndex(prev)
      setPlayToken(t => t + 1)
    } else if (repeatRef.current === 'all') {
      const lastIdx = queueRef.current.length - 1
      indexRef.current = lastIdx
      setCurrentIndex(lastIdx)
      setPlayToken(t => t + 1)
    }
  }, [])

  const seekTo = useCallback((percent) => {
    if (!audio.duration || isNaN(audio.duration)) return
    const clampedPercent = Math.min(100, Math.max(0, percent))
    const targetTime = (clampedPercent / 100) * audio.duration
    isSeekingRef.current = true
    lastSeekTimeRef.current = Date.now()
    audio.currentTime = targetTime
    setCurrentTime(targetTime)
    setProgress(clampedPercent)
    setPresenceEpoch((e) => e + 1)
  }, [])

  const cycleRepeat = useCallback(() => {
    setRepeat(r => r === 'none' ? 'all' : r === 'all' ? 'one' : 'none')
  }, [])

  const startRadio = useCallback((track) => {
    setIsAutoplay(true)
    replaceQueue([track], 0)
    setTimeout(() => {
      if (triggerAutoplayRef.current) triggerAutoplayRef.current(true)
    }, 500)
  }, [replaceQueue])

  // ── Context values ────────────────────────────────────────────────────────
  // `currentTime` and `progress` are deliberately NOT in this object: they tick
  // ~4x/sec, and every one of the 18 usePlayer() consumers would re-render with
  // them. Components that need a ticking clock use usePlaybackTime() instead.
  // In the custom theme the picked colour is the user's explicit choice, so it
  // wins over the colour extracted from the current album art. It must be the
  // mode-adjusted accent, not the raw pick: the clamp is what keeps a pale
  // colour legible on a light canvas (and a near-black one on a dark canvas).
  const effectiveAccent =
    appearance === 'custom' ? customAccentColor(customAccent, customMode) : accentColor

  const value = useMemo(() => ({
    queue, currentIndex, currentTrack,
    isPlaying, duration,
    volume, isMuted, shuffle, repeat,
    accentColor: effectiveAccent, isLoadingMeta,
    theme, eqGains, EQ_BANDS,
    appearance, setAppearance,
    customAccent, setCustomAccent, customMode, setCustomMode, ambience, setAmbience,
    motion, setMotion,
    isFullScreen, is8D, setIs8D, panSpeed, setPanSpeed,
    reverbPreset, setReverbPreset,
    isAutoplay, setIsAutoplay, playbackSpeed, setPlaybackSpeed,
    crossfade, setCrossfade,
    sleepTimer, setSleepTimerMinutes, setSleepTimerEndOfTrack, clearSleepTimer,
    audioElement: audioRef.current, // Exposed for FullScreenPlayer direct time reads
    addToQueue, playNext, replaceQueue, playTrackAt, removeFromQueue, reorderQueue,
    togglePlayPause, skipNext, skipPrev, seekTo,
    setVolume, setIsMuted, setShuffle, cycleRepeat, startRadio,
    setTheme, updateEqualizer, resetEqualizer, applyEQPreset,
    toggleFullScreen, getAnalyserNode,
    streamQuality, applyStreamQuality, streamInfo,
    prefetchStreamUrl,
  }), [
    queue, currentIndex, currentTrack, isPlaying, duration,
    volume, isMuted, shuffle, repeat, effectiveAccent, isLoadingMeta,
    theme, eqGains, EQ_BANDS, appearance, customAccent, customMode, ambience, motion, isFullScreen, is8D, panSpeed, reverbPreset,
    isAutoplay, playbackSpeed, crossfade, sleepTimer,
    setSleepTimerMinutes, setSleepTimerEndOfTrack, clearSleepTimer,
    addToQueue, playNext, replaceQueue, playTrackAt, removeFromQueue, reorderQueue,
    togglePlayPause, skipNext, skipPrev, seekTo, cycleRepeat, startRadio,
    setTheme, updateEqualizer, resetEqualizer, applyEQPreset,
    toggleFullScreen, getAnalyserNode,
    streamQuality, applyStreamQuality, streamInfo,
    prefetchStreamUrl,
  ])

  const timeValue = useMemo(
    () => ({ currentTime, progress, seekTo }),
    [currentTime, progress, seekTo]
  )

  if (!isStateLoaded) return null
  return (
    <PlayerContext.Provider value={value}>
      <PlaybackTimeContext.Provider value={timeValue}>
        {children}
      </PlaybackTimeContext.Provider>
    </PlayerContext.Provider>
  )
}


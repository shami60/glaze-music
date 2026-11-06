import React, { useState, useEffect, useRef, useMemo } from 'react'
import { usePlayer, usePlaybackTime } from '../context/usePlayer'
import { getArtURL, getHighQualityArtURL, formatTime } from '../utils'
import { isRTL, parseLRC, buildTimedLines, vividAccent } from '../lyricsUtils'

// ── Playback Icons ────────────────────────────────────────────────────────────
function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
}

function PrevIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M6 6h2v12H6zm2 6 8.5 6V6L8 12z"/></svg>
}

function NextIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
}

function ShuffleIcon({ active, accentColor }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="currentColor" 
      className="w-4 h-4 sm:w-5 sm:h-5 transition-all"
      style={{ color: active ? (accentColor || '#10b981') : 'rgba(var(--ink-rgb),0.45)' }}
    >
      <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
    </svg>
  )
}

function RepeatIcon({ mode, accentColor }) {
  const active = mode !== 'none'
  const color = active ? (accentColor || '#10b981') : 'rgba(var(--ink-rgb),0.45)'
  if (mode === 'one') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 transition-all" style={{ color }}>
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 transition-all" style={{ color }}>
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
    </svg>
  )
}

function VolumeIcon({ muted }) {
  return muted ? (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/40"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17 19.73l2 2L20.73 20 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/60 hover:text-white transition-colors"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
  )
}

export default function LyricsView({ onClose, embedded = false }) {
  const { 
    currentTrack, 
    duration, 
    seekTo, 
    accentColor,
    isPlaying,
    isLoadingMeta,
    togglePlayPause,
    skipNext,
    skipPrev,
    shuffle,
    setShuffle,
    repeat,
    cycleRepeat,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    audioElement
  } = usePlayer()
  // Position lives in its own context so the 4x/sec time updates don't re-render the app.
  const { currentTime: ctxCurrentTime, progress: ctxProgress } = usePlaybackTime()

  const [lyrics, setLyrics] = useState({ type: null, data: null })
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [seekPercent, setSeekPercent] = useState(0)
  const containerRef = useRef(null)
  const activeLineRef = useRef(null)
  const [mouseMoved, setMouseMoved] = useState(true)

  const currentPercent = isDragging ? seekPercent : ctxProgress
  const currentTime = isDragging ? ((seekPercent / 100) * (duration || 0)) : ctxCurrentTime

  // Global mouse release while dragging seekbar
  useEffect(() => {
    if (!isDragging) return
    const handleGlobalRelease = () => {
      seekTo(seekPercent)
      setIsDragging(false)
    }
    window.addEventListener('mouseup', handleGlobalRelease)
    window.addEventListener('touchend', handleGlobalRelease)
    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease)
      window.removeEventListener('touchend', handleGlobalRelease)
    }
  }, [isDragging, seekPercent, seekTo])

  const handleSeekStart = (e) => {
    setIsDragging(true)
    setSeekPercent(parseFloat(e.target.value))
  }

  const handleSeekChange = (e) => {
    setSeekPercent(parseFloat(e.target.value))
    if (!isDragging) setIsDragging(true)
  }

  const handleSeekCommit = (e) => {
    const val = parseFloat(e.target.value)
    if (!isNaN(val)) {
      setSeekPercent(val)
      seekTo(val)
    }
    setIsDragging(false)
  }

  // Escape closes this view. Space/transport keys are handled globally in
  // App.jsx — a second Space listener here cancelled out AudioPlayer's one.
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Hide the "Press Esc" text after 3 seconds of no mouse movement
  useEffect(() => {
    let timeout
    function handleMouseMove() {
      setMouseMoved(true)
      clearTimeout(timeout)
      timeout = setTimeout(() => setMouseMoved(false), 3000)
    }
    window.addEventListener('mousemove', handleMouseMove)
    handleMouseMove() // init
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      clearTimeout(timeout)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function fetchLyrics() {
      if (!currentTrack) return
      setIsLoading(true)
      setLyrics({ type: null, data: null })
      let videoId = null
      if (currentTrack.src?.startsWith('yt:')) {
        videoId = currentTrack.src.replace('yt:', '')
      } else if (currentTrack.src) {
        // Extract videoId from offline downloaded tracks (format: Title [videoId].mp3)
        const match = currentTrack.src.match(/\[([a-zA-Z0-9_-]{11})\]\.[^.]+$/)
        if (match) videoId = match[1]
      }
      const title = currentTrack.title
      const artist = currentTrack.artist
      
      try {
        if (window.electronAPI?.youtubeGetLyrics) {
          const result = await window.electronAPI.youtubeGetLyrics(videoId, title, artist)
          if (!active) return
          if (result) {
            if (result.type === 'synced') {
              setLyrics({ type: 'synced', data: parseLRC(result.text) })
            } else {
              setLyrics({ type: 'plain', data: result.text })
            }
          } else {
            setLyrics({ type: 'none', data: 'Lyrics not available' })
          }
        }
      } catch (e) {
        if (active) setLyrics({ type: 'none', data: 'Error loading lyrics' })
      }
      if (active) setIsLoading(false)
    }
    fetchLyrics()
    return () => { active = false }
  }, [currentTrack])

  const displayLyrics = lyrics
  const timedLines = useMemo(() => buildTimedLines(displayLyrics.data), [displayLyrics])

  // Which word is being sung. The position context only ticks ~4x/sec, which is
  // far too coarse for word-level highlighting — a word can be lit a quarter of a
  // second late. Reading the audio element on rAF gives the exact time, and the
  // state only changes when the word changes, so this costs a handful of renders
  // per line rather than sixty per second.
  const [activeWord, setActiveWord] = useState({ line: -1, word: -1 })
  useEffect(() => {
    // Not gated on isPlaying: this is also the source of truth for the active
    // line, so it has to keep up while paused (seeking, scrubbing).
    if (!audioElement || timedLines.length === 0) return
    let raf = 0
    const tick = () => {
      const t = audioElement.currentTime
      let li = -1
      for (let i = 0; i < timedLines.length; i++) {
        if (t >= timedLines[i].time) li = i
        else break
      }
      let wi = -1
      if (li >= 0) {
        const ws = timedLines[li].words
        for (let w = 0; w < ws.length; w++) {
          if (t >= ws[w].start) wi = w
          else break
        }
      }
      setActiveWord(prev => (prev.line === li && prev.word === wi ? prev : { line: li, word: wi }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [audioElement, timedLines])

  // Line index. Computed before the early return so the scroll effect below can
  // depend on it — hooks cannot sit after a conditional return.
  // Single source of truth for the active line. This used to come from the
  // 4x/sec position context while the word index came from the rAF clock, so the
  // two disagreed for up to 250ms after every line change — during that window
  // `activeWord.line !== activeIndex`, which blanked the highlight and made the
  // lyrics look out of sync and flickery. Both now read the same audio time.
  let activeIndex = -1
  if (displayLyrics.type === 'synced' && displayLyrics.data) {
    if (activeWord.line >= 0) {
      activeIndex = activeWord.line
    } else {
      for (let i = 0; i < displayLyrics.data.length; i++) {
        if (currentTime >= displayLyrics.data[i].time) activeIndex = i
        else break
      }
    }
  }

  // Scroll only when the active line actually changes. This used to run on every
  // position tick, so a new smooth-scroll started four times a second and each
  // one interrupted the last — the list crept and stuttered instead of gliding.
  useEffect(() => {
    if (displayLyrics.type !== 'synced' || activeIndex < 0) return
    const container = containerRef.current
    const line = activeLineRef.current
    if (!container || !line) return
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex, displayLyrics])

  if (!currentTrack) return <div className="h-full flex items-center justify-center text-white/50">No track playing</div>

  // Generate an accent color background if possible, or just a dark gradient
  const rawArtUrl = currentTrack.albumArt || getArtURL(currentTrack.src)
  const artUrl = getHighQualityArtURL(rawArtUrl)

  const lyricsContent = (
    <div 
      ref={containerRef}
      className="w-full h-full overflow-y-auto no-scrollbar mask-image-vertical relative flex flex-col items-stretch"
    >
      <div className="min-h-[40vh] shrink-0" /> {/* Top padding */}
      
      {isLoading && (
        <div className="flex flex-col items-center justify-center h-full text-white/50 w-full py-12">
          <svg className="animate-spin w-8 h-8 mb-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm font-medium">Loading synchronized lyrics...</p>
        </div>
      )}

      {/* Plain Text Lyrics (RTL or LTR script-aware) */}
      {displayLyrics.type === 'plain' && (
        <div 
          dir={isRTL(displayLyrics.data) ? 'rtl' : 'ltr'}
          className={`${
            isRTL(displayLyrics.data) ? 'text-right' : 'text-left'
          } text-[clamp(17px,2vw,27px)] font-bold leading-relaxed whitespace-pre-wrap text-white/90 pb-[40vh] w-full`}
          style={{
            fontFamily: isRTL(displayLyrics.data)
              ? "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', 'Segoe UI', Tahoma, system-ui, sans-serif"
              : 'inherit'
          }}
        >
          {displayLyrics.data}
        </div>
      )}

      {/* Synced lyrics. Each word fills in as it is sung; the active line sits at
          full strength and the rest recede by distance. The old version applied a
          blur filter to *every* line, which made the text fuzzy and cost a filter
          transition per line on each change. */}
      {displayLyrics.type === 'synced' && timedLines.map((line, i) => {
        const isActive = i === activeIndex
        const distance = activeIndex < 0 ? 99 : Math.abs(i - activeIndex)
        const isEmptyLine = line.words.length === 0
        const isLineRTL = isRTL(line.content)
        // Normally the rAF clock has this line's word index. If it has not caught
        // up yet (fresh lyrics, a re-render), derive it from the position instead
        // of blanking the highlight for a frame — that blank read as a glitch.
        let litWord = -1
        if (isActive) {
          if (activeWord.line === i) {
            litWord = activeWord.word
          } else {
            for (let k = 0; k < line.words.length; k++) {
              if (currentTime >= line.words[k].start) litWord = k
              else break
            }
            // `currentTime` is the 4x/sec clock, so right after a line change it
            // can still be behind that line's first word. The line is active, so
            // its first word is being sung — never render it fully blank.
            if (litWord < 0 && line.words.length > 0) litWord = 0
          }
        }

        return (
          <div
            key={i}
            ref={isActive ? activeLineRef : null}
            dir={isLineRTL ? 'rtl' : 'ltr'}
            onClick={() => { if (duration) seekTo((line.time / duration) * 100) }}
            className={`py-2.5 cursor-pointer transform-gpu w-full ${isLineRTL ? 'text-right origin-right' : 'text-left origin-left'}`}
            style={{
              color: 'var(--color-white)',
              opacity: isActive ? 1 : distance === 1 ? 0.45 : distance === 2 ? 0.24 : 0.12,
              transform: `scale(${isActive ? 1 : 0.97})`,
              transition: 'opacity 550ms cubic-bezier(0.22,1,0.36,1), transform 550ms cubic-bezier(0.22,1,0.36,1)',
              fontFamily: isLineRTL
                ? "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', 'Segoe UI', Tahoma, system-ui, sans-serif"
                : 'inherit'
            }}
          >
            <div className="text-[clamp(18px,2.15vw,31px)] leading-[1.34] font-bold">
              {isEmptyLine && isActive ? (
                <div className={`flex gap-2 items-center h-[50px] opacity-70 ${isLineRTL ? 'justify-end' : 'justify-start'}`}>
                  <div className="w-3 h-3 rounded-full bg-white animate-pulse" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/60 animate-pulse delay-75" />
                  <div className="w-2 h-2 rounded-full bg-white/40 animate-pulse delay-150" />
                </div>
              ) : (
                line.words.map((w, wIdx) => {
                  const sung = isActive && wIdx <= litWord
                  return (
                    <span
                      key={wIdx}
                      className={`inline-block ${isLineRTL ? 'ml-[0.25em]' : 'mr-[0.25em]'}`}
                      style={{
                        // Sung words go pure white with a soft bloom; the rest of
                        // the line stays readable rather than nearly invisible.
                        // Deliberately no scale or weight change — measured off the
                        // reference, the word never changes size or position, only
                        // brightness, so the line cannot reflow as it fills.
                        color: isActive
                          ? (sung ? 'var(--color-white)' : 'color-mix(in srgb, var(--color-white) 64%, transparent)')
                          : 'inherit',
                        textShadow: sung
                          ? '0 0 18px color-mix(in srgb, var(--color-white) 42%, transparent), 0 0 44px color-mix(in srgb, var(--color-white) 18%, transparent)'
                          : 'none',
                        transition: 'color 260ms ease-out, text-shadow 260ms ease-out'
                      }}
                    >
                      {w.text}
                    </span>
                  )
                })
              )}
            </div>
          </div>
        )
      })}

      {displayLyrics.type === 'none' && !isLoading && (
        <div className="flex items-center justify-center h-full text-2xl text-white/40 font-bold pb-[40vh] text-center px-4">
          {displayLyrics.data}
        </div>
      )}
      
      <div className="min-h-[50vh] shrink-0" /> {/* Bottom padding */}
    </div>
  )

  const styles = (
    <style dangerouslySetInnerHTML={{__html: `
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      .mask-image-vertical { mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%); }
      .lyrics-seek-bar::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; background: white; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.5); }
    `}} />
  )

  if (embedded) {
    return (
      <div className="flex-1 h-full relative z-10 w-full min-w-0 flex flex-col pt-4 pr-4">
        <div className="flex-1 min-h-0 relative">
          {lyricsContent}
        </div>
        {styles}
      </div>
    )
  }

  // Apple shows time remaining rather than total, so the countdown is what you read.
  const remaining = Math.max(0, (duration || 0) - currentTime)
  // Covers are often near-black; used raw they tinted the backdrop to nothing.
  const glowColor = vividAccent(accentColor)

  return (
    <div className="on-media h-full w-full flex flex-row items-center overflow-hidden relative" style={{ background: '#0b0b0d' }}>

      {/* Animated backdrop: three slow colour fields tinted by the cover art.
          Radial gradients rather than blurred elements — visually the same wash,
          but no 70px blur to rasterise and only `transform` animates. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <span
          className="lyric-blob lyric-blob-1"
          style={{ background: `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${glowColor} 55%, transparent) 0%, color-mix(in srgb, ${glowColor} 22%, transparent) 42%, transparent 72%)` }}
        />
        <span
          className="lyric-blob lyric-blob-2"
          style={{ background: `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${glowColor} 40%, transparent) 0%, color-mix(in srgb, ${glowColor} 16%, transparent) 45%, transparent 74%)` }}
        />
        <span
          className="lyric-blob lyric-blob-3"
          style={{ background: `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${glowColor} 30%, transparent) 0%, transparent 70%)` }}
        />
      </div>
      {/* Scrim: keeps the lyrics legible whatever the cover looks like. */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(10,10,12,0.46)' }} />

      <button
        onClick={onClose}
        className="absolute top-6 right-8 z-50 p-2.5 rounded-full text-white/45 hover:text-white hover:bg-white/10 transition-colors duration-200 cursor-pointer"
        title="Close"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>
      </button>

      {/* ── Left half: artwork, seek, title, artist ─────────────────────────── */}
      <div className="group/player flex-[0.5] h-full flex flex-col justify-center items-center px-10 xl:px-16 relative z-10">
        <div className="w-full max-w-[min(44vh,380px)] flex flex-col items-center">

          {/* Resting state is just the cover — nothing sits on top of the art. */}
          <img
            src={artUrl}
            alt=""
            className="w-full aspect-square object-cover rounded-xl"
            style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,0.8)' }}
          />

          {/* Seek — elapsed left, remaining right. */}
          <div className="w-full flex items-center gap-3 mt-5">
            <span className="text-[11px] font-medium text-white/45 tabular-nums w-9 text-right">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={currentPercent}
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              onChange={handleSeekChange}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              onKeyUp={handleSeekCommit}
              style={{
                background: `linear-gradient(to right, rgba(255,255,255,0.9) ${currentPercent}%, rgba(255,255,255,0.16) ${currentPercent}%)`
              }}
              className="flex-1 min-w-0 h-[3px] rounded-full cursor-pointer appearance-none outline-none lyrics-seek-bar"
            />
            <span className="text-[11px] font-medium text-white/45 tabular-nums w-9">-{formatTime(remaining)}</span>
          </div>

          <div className="w-full text-center mt-4">
            <h2 className="text-lg font-semibold text-white leading-tight truncate">{currentTrack.title}</h2>
            <p className="text-[13px] text-white/45 truncate mt-1">{currentTrack.artist}</p>
          </div>

          {/* Transport sits *below* the meta. Its space is reserved in the flow, so
              revealing it never shifts the artwork or the lyrics; it eases up from a
              small offset instead of popping in. */}
          <div
            className="mt-5 w-full flex justify-center opacity-0 translate-y-2 pointer-events-none
                       group-hover/player:opacity-100 group-hover/player:translate-y-0 group-hover:pointer-events-auto
                       group-hover/player:pointer-events-auto
                       transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
          >
            <div
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}
            >
              <button
                onClick={() => setShuffle(s => !s)}
                className="p-2 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title={shuffle ? 'Shuffle: ON' : 'Shuffle: OFF'}
              >
                <ShuffleIcon active={shuffle} accentColor={accentColor} />
              </button>
              <button
                onClick={skipPrev}
                className="p-2 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Previous Track"
              >
                <PrevIcon />
              </button>
              <button
                onClick={togglePlayPause}
                className="relative w-11 h-11 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform duration-200 cursor-pointer shrink-0"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
                {isLoadingMeta && (
                  <span className="absolute inset-0 rounded-full border-2 border-black/25 border-t-black animate-spin pointer-events-none" />
                )}
              </button>
              <button
                onClick={skipNext}
                className="p-2 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Next Track"
              >
                <NextIcon />
              </button>
              <button
                onClick={cycleRepeat}
                className="p-2 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title={`Repeat: ${repeat}`}
              >
                <RepeatIcon mode={repeat} accentColor={accentColor} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Volume: edge drawer, revealed on hover ───────────────────────────── */}
      <div className="group/vol absolute left-0 top-1/2 -translate-y-1/2 z-40 flex items-center">
        <div className="w-4 h-64" />
        <div
          className="vol-drawer ml-0.5 flex flex-col items-center gap-2.5 px-2.5 py-3 rounded-2xl border border-white/10 shadow-2xl
                     opacity-0 -translate-x-3 pointer-events-none delay-150
                     group-hover/vol:opacity-100 group-hover/vol:translate-x-0 group-hover/vol:pointer-events-auto group-hover/vol:delay-0"
          style={{ background: 'rgba(0,0,0,0.38)', backdropFilter: 'blur(16px)' }}
        >
          <button
            onClick={() => setIsMuted(m => !m)}
            className="cursor-pointer text-white/70 hover:text-white transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            <VolumeIcon muted={isMuted || volume === 0} />
          </button>
          <div className="h-32 w-6 flex items-center justify-center">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                setVolume(val)
                if (isMuted && val > 0) setIsMuted(false)
              }}
              style={{
                background: `linear-gradient(to right, white ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,0.18) ${(isMuted ? 0 : volume) * 100}%)`,
                transform: 'rotate(-90deg)'
              }}
              className="vol-fader w-32 h-1 rounded-full cursor-pointer appearance-none outline-none lyrics-seek-bar"
              title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
            />
          </div>
          <span className="text-[9px] font-bold tabular-nums text-white/40">
            {Math.round((isMuted ? 0 : volume) * 100)}
          </span>
        </div>
      </div>

      {/* ── Right half: lyrics ───────────────────────────────────────────────── */}
      <div className="flex-[0.5] h-full relative z-10 pl-6 pr-14 xl:pr-20 flex flex-col pt-10 pb-6">
        <div className="flex-1 min-h-0 relative">
          {lyricsContent}
        </div>
      </div>

      {styles}
    </div>
  )
}

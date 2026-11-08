/**
 * MiniPlayerView.jsx — Unified Straight-Flow Dynamic Liquid Glass PiP Player
 *
 * Designed to user's specification:
 * - Single continuous straight layout (Header -> Track Info -> Scrubber -> Controls -> Lyrics)
 * - Dynamically adapts Cover Art, Track Typography, Controls, and Lyrics as window is resized/stretched
 * - Lyrics smoothly expand and auto-scroll underneath with dynamic text scaling & glowing active line
 * - Window dragging (-webkit-app-region: drag) with explicit .no-drag on controls
 * - Double-click background to restore full player
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { usePlayer, usePlaybackTime } from '../context/usePlayer'
import { getArtURL, getHighQualityArtURL, formatTime } from '../utils'

import { isRTL, translateLyrics } from '../lyricsUtils'
import { useLyrics } from '../hooks/useLyrics'

// Fast binary search to find the active lyric timestamp
function findActiveLyricIndex(lyricsArray, currentTime) {
  if (!lyricsArray || lyricsArray.length === 0) return -1
  let low = 0
  let high = lyricsArray.length - 1
  let result = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    if (lyricsArray[mid].time <= currentTime) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

export default function MiniPlayerView({
  favourites,
  streamingFavourites = [],
  onAddToFavourites,
  onRemoveFromFavourites
}) {
  const {
    currentTrack,
    isPlaying,
    togglePlayPause,
    skipNext,
    skipPrev,
    duration,
    seekTo,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    shuffle,
    setShuffle,
    accentColor = '#ef4444'
  } = usePlayer()
  // Position lives in its own context so the 4x/sec time updates don't re-render the app.
  const { currentTime, progress } = usePlaybackTime()

  const [isPinned, setIsPinned] = useState(true)
  const [showLyrics, setShowLyrics] = useState(false)

  // Lyrics live in their own strip below the artwork, so the window grows to make
  // room for them instead of squeezing the card. The artwork keeps the height it
  // had before the growth, which is why `artHeight` is tracked separately.
  const LYRICS_PANEL_H = 200
  const baseHeightRef = useRef(0)
  const [artHeight, setArtHeight] = useState(null) // null = fill the card
  const skippedFirstLyricsRun = useRef(false)

  useEffect(() => {
    // This component mounts inside the full window, where innerHeight is ~1000.
    // Resizing on that first pass would blow the mini window up to its clamp, so
    // the baseline is only captured when lyrics are actually toggled.
    if (!skippedFirstLyricsRun.current) {
      skippedFirstLyricsRun.current = true
      return
    }
    const api = window.electronAPI
    if (!api?.setMiniPlayerHeight) return
    if (showLyrics) {
      // Capture the resting height once. Re-reading it on every open let rounding
      // in the IPC round-trip accumulate, so repeated toggles shrank the window.
      if (!baseHeightRef.current) baseHeightRef.current = window.innerHeight
      setArtHeight(baseHeightRef.current)
      api.setMiniPlayerHeight(baseHeightRef.current + LYRICS_PANEL_H)
    } else if (baseHeightRef.current) {
      api.setMiniPlayerHeight(baseHeightRef.current)
      setArtHeight(null)
    }
  }, [showLyrics])
  // One shared lyrics policy, same as the panel and the home card.
  // Gated on showLyrics: the mini player is often open without the panel.
  const { lyrics: lyricsData, isLoading: isLoadingLyrics } = useLyrics(showLyrics ? currentTrack : null)
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekVal, setSeekVal] = useState(0)

  // ── MiniPlayer Translation State ──
  const [isTranslationActive] = useState(() => localStorage.getItem('glaze_lyrics_translate_enabled') === 'true')
  const [targetLang, setTargetLang] = useState(() => localStorage.getItem('glaze_lyrics_lang') || 'ur')
  const [isTranslating, setIsTranslating] = useState(false)
  const [translatedLyrics, setTranslatedLyrics] = useState(null)

  // Real-time window dimensions tracking for dynamic fluid scaling
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 360,
    height: typeof window !== 'undefined' ? window.innerHeight : 165
  })

  useEffect(() => {
    const onResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { width, height } = dimensions
  const isWider = width >= 460
  const isTaller = height >= 300
  const isVeryTall = height >= 420
  const isUltraTall = height >= 540

  const activeLyricRef = useRef(null)
  const lyricsContainerRef = useRef(null)
  const lastScrolledIndexRef = useRef(-1)

  // Favorite state calculation
  const isFav = useMemo(() => {
    if (!currentTrack) return false
    if (currentTrack.isLocal || !currentTrack.src?.startsWith('yt:')) {
      return favourites?.has(currentTrack.src) || false
    }
    const vid = currentTrack.src.replace('yt:', '')
    return streamingFavourites?.some(f => f.id === vid || f.src === currentTrack.src) || false
  }, [currentTrack, favourites, streamingFavourites])

  // Sync initial Always-On-Top
  useEffect(() => {
    if (window.electronAPI?.getAlwaysOnTop) {
      window.electronAPI.getAlwaysOnTop().then(pinned => setIsPinned(pinned))
    }
  }, [])

  const handleTogglePin = useCallback(async () => {
    if (window.electronAPI?.toggleAlwaysOnTop) {
      const newState = await window.electronAPI.toggleAlwaysOnTop()
      setIsPinned(newState)
    }
  }, [])

  const handleRestore = useCallback(() => {
    if (window.electronAPI?.toggleMiniPlayer) {
      window.electronAPI.toggleMiniPlayer(false)
    }
  }, [])

  // Toggle lyrics with smooth height expansion if currently too small
  const handleToggleLyrics = useCallback(() => {
    setShowLyrics(prev => {
      const nextState = !prev
      if (nextState && window.innerHeight < 280 && window.electronAPI?.setMiniPlayerHeight) {
        window.electronAPI.setMiniPlayerHeight(360)
      }
      return nextState
    })
  }, [])


  // Translation effect for MiniPlayer
  useEffect(() => {
    if (!showLyrics || !isTranslationActive || !lyricsData.data || lyricsData.type === 'none') {
      setTranslatedLyrics(null)
      return
    }

    let active = true
    async function doTranslate() {
      setIsTranslating(true)
      try {
        const res = await translateLyrics(lyricsData.data, targetLang)
        if (active && res) {
          setTranslatedLyrics(res)
        }
      } catch (err) {
        console.error('MiniPlayer translation error:', err)
      } finally {
        if (active) setIsTranslating(false)
      }
    }

    doTranslate()
    return () => { active = false }
  }, [showLyrics, isTranslationActive, targetLang, lyricsData])

  const displayLyrics = (isTranslationActive && translatedLyrics?.data) ? translatedLyrics : lyricsData

  // Efficient active lyric index calculation
  const activeLyricIndex = useMemo(() => {
    if (displayLyrics.type !== 'synced' || !Array.isArray(displayLyrics.data)) return -1
    const t = isSeeking ? (seekVal / 100) * (duration || 0) : currentTime
    return findActiveLyricIndex(displayLyrics.data, t)
  }, [displayLyrics, currentTime, isSeeking, seekVal, duration])

  // Isolated container scroll: ONLY executes when active line index actually changes
  useEffect(() => {
    if (activeLyricIndex === lastScrolledIndexRef.current) return
    lastScrolledIndexRef.current = activeLyricIndex

    const container = lyricsContainerRef.current
    const activeEl = activeLyricRef.current
    if (container && activeEl) {
      const topPos = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2)
      container.scrollTo({
        top: Math.max(0, topPos),
        behavior: 'smooth'
      })
    }
  }, [activeLyricIndex])

  const handleSeekChange = useCallback((e) => {
    setSeekVal(parseFloat(e.target.value))
    if (!isSeeking) setIsSeeking(true)
  }, [isSeeking])

  const handleSeekCommit = useCallback((e) => {
    const val = parseFloat(e.target.value)
    if (!isNaN(val)) {
      setSeekVal(val)
      seekTo(val)
    }
    setIsSeeking(false)
  }, [seekTo])

  const rawArt = currentTrack?.albumArt || (currentTrack?.src ? getArtURL(currentTrack.src) : null)
  const albumArt = rawArt ? getHighQualityArtURL(rawArt) : null
  const displayProgress = isSeeking ? seekVal : progress

  // Dynamic Play Button Size
  const playButtonClass = isVeryTall
    ? 'w-9 h-9 sm:w-10 sm:h-10'
    : isTaller || isWider
      ? 'w-8 h-8'
      : 'w-7 h-7'

  const playIconClass = isVeryTall
    ? 'w-4.5 h-4.5'
    : isTaller || isWider
      ? 'w-4 h-4'
      : 'w-3.5 h-3.5'

  // Dynamic Lyrics Line Sizing
  const lyricLineClass = isUltraTall
    ? 'text-base sm:text-lg py-2'
    : isVeryTall
      ? 'text-sm sm:text-base py-1.5'
      : isTaller
        ? 'text-xs sm:text-sm py-1'
        : 'text-xs py-0.5'

  return (
    <div 
      onDoubleClick={(e) => {
        // Double clicking anywhere on background restores full player
        if (!e.target.closest('.no-drag')) handleRestore()
      }}
      className="drag-region w-screen h-screen flex flex-col select-none overflow-hidden bg-[var(--surface-0)]/95 text-white rounded-2xl shadow-2xl relative font-sans cursor-move"
      // The card sits on artwork, so its ink must be literal white. `--color-white`
      // is the theme's ink colour (dark on light themes), which made every label
      // here invisible against the cover. Re-declaring it locally flips the whole
      // subtree — every `text-white/xx` and the contrast overrides follow it.
      style={{ contain: 'strict', '--color-white': '#ffffff', '--ink-rgb': '255, 255, 255' }}
    >
      {/* The cover IS the card. Full-bleed artwork, then a scrim that keeps the
          text legible at the bottom where the controls live. */}
      {albumArt && (
        <div
          className="absolute left-0 right-0 top-0 z-0 transition-[height] duration-300 ease-out"
          style={{
            height: artHeight || '100%',
            backgroundImage: `url("${albumArt}")`,
            backgroundPosition: 'center',
            backgroundSize: 'cover'
          }}
        />
      )}
      <div
        className="absolute inset-0 z-0 pointer-events-none"
        style={{
          // Scrim only, no blur: the cover is the point of this card, so it stays
          // sharp edge to edge and the gradient just buys contrast for the text.
          background: albumArt
            ? 'linear-gradient(180deg, rgba(0,0,0,0) 28%, rgba(0,0,0,0.35) 58%, rgba(0,0,0,0.72) 82%, rgba(0,0,0,0.86) 100%)'
            : 'linear-gradient(180deg, rgba(0,0,0,0.30), rgba(0,0,0,0.80))'
        }}
      />


      {/* ── Top Header: Always Fixed & Non-scrollable ── */}
      <div className="sticky top-0 z-30 flex items-center justify-between h-8 px-3.5 pt-2 pb-1 shrink-0">
        
        {/* Left: Drag Grip & App Title */}
        <div className="h-6" />

        {/* Right: Window Controls (no-drag) */}
        <div className="no-drag flex items-center gap-1.5">
          
          {/* Mute (wheel over it adjusts volume) */}
          <button
            onClick={() => setIsMuted(m => !m)}
            onWheel={(e) => {
              const delta = e.deltaY < 0 ? 0.05 : -0.05
              const nextVol = Math.min(1, Math.max(0, parseFloat(((isMuted ? 0 : volume) + delta).toFixed(2))))
              setVolume(nextVol)
              if (nextVol > 0) setIsMuted(false)
            }}
            className="no-drag p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            )}
          </button>

          {/* Always On Top Toggle */}
          <button
            onClick={handleTogglePin}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              isPinned ? 'text-white bg-white/20 shadow-sm' : 'text-white/40 hover:text-white hover:bg-white/10'
            }`}
            title={isPinned ? 'Always on Top (Active)' : 'Always on Top (Disabled)'}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
            </svg>
          </button>

          {/* Prominent Full Player Restore Button */}
          <button
            onClick={handleRestore}
            className="no-drag p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-all cursor-pointer border border-white/10 active:scale-95"
            title="Restore to Full App (Ctrl+Shift+M)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
          </button>

          {/* Close */}
          <button
            onClick={() => window.electronAPI?.closeWindow?.()}
            className="p-1 rounded-md text-white/40 hover:text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
            title="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.8"><line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" /></svg>
          </button>

        </div>
      </div>

      {/* ── UNIFIED STRAIGHT VERTICAL FLOW (Deck -> Scrubber -> Controls -> Lyrics) ── */}
      <div className="relative z-20 flex-1 min-h-0 overflow-hidden flex flex-col justify-end gap-2 px-3.5 pt-1 pb-3">
        

        {/* ── 1. Track Info — plain, sitting straight on the artwork ── */}
        <div className="flex items-end gap-2 min-w-0 shrink-0 px-1 pb-0.5">

          {/* Title & Artist */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h4 
              className="text-[15px] font-bold text-white leading-tight tracking-tight line-clamp-2"
              title={currentTrack?.title || 'No Track Playing'}
            >
              {currentTrack?.title || 'No Track Playing'}
            </h4>
            <p 
              className="text-[11px] text-white/75 truncate mt-0.5"
              title={currentTrack?.artist || 'Glaze Music'}
            >
              {currentTrack?.artist || 'Glaze Music'}
            </p>
          </div>

          {/* Like / Heart Button */}
          {currentTrack && (
            <button
              onClick={() => isFav ? onRemoveFromFavourites?.(currentTrack.src) : onAddToFavourites?.(currentTrack)}
              className="no-drag p-1.5 rounded-full hover:bg-white/10 active:scale-90 transition-all cursor-pointer shrink-0"
              style={{ color: isFav ? '#ef4444' : 'rgba(var(--ink-rgb),0.4)' }}
              title={isFav ? 'Remove from Favourites' : 'Add to Favourites'}
            >
              <svg viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isFav ? 0 : 2} className="w-4 h-4">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </button>
          )}

        </div>


        {/* ── Glass bar: timeline + transport only, not the title ── */}
        <div className="mini-glass-bar px-2.5 py-2 flex flex-col gap-1.5 shrink-0">

        {/* ── 2. Full-Width Scrubber & Timestamps ── */}
        <div className="flex flex-col gap-0.5 mt-1.5 w-full shrink-0">
          <div className="no-drag relative flex items-center h-3">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={isNaN(displayProgress) ? 0 : displayProgress}
              onChange={handleSeekChange}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              disabled={!currentTrack || !duration}
              style={{
                // Capsule-width correction, same as the dock and full-screen bars.
                background: `linear-gradient(to right, var(--color-white) calc((100% - 20px) * ${Math.min(1, Math.max(0, (isNaN(displayProgress) ? 0 : displayProgress) / 100))} + 10px), color-mix(in srgb, var(--color-white) 28%, transparent) 0)`
              }}
              className="lg-seek w-full cursor-pointer appearance-none outline-none"
            />
          </div>
          
          <div className="flex justify-between text-[9px] font-mono text-white/40 px-0.5 h-3 items-center">
            <span>{formatTime(isSeeking ? (seekVal / 100) * (duration || 0) : currentTime)}</span>
            <span>{duration ? `-${formatTime(Math.max(0, duration - (isSeeking ? (seekVal / 100) * duration : currentTime)))}` : formatTime(duration)}</span>
          </div>
        </div>

        {/* ── 3. Playback Controls — play is pinned dead centre; the two halves
            are equal-width flex so the surrounding buttons can never push it
            off-centre. ── */}
        <div className="flex items-center w-full pt-1 shrink-0">

          {/* Left half: shuffle, previous */}
          <div className="flex items-center justify-end gap-0.5 flex-1 min-w-0 pr-1">
            <button
              onClick={() => setShuffle(s => !s)}
              className={`no-drag p-1.5 rounded-full active:scale-90 transition-all cursor-pointer ${shuffle ? 'text-white' : 'text-white/55 hover:text-white/80'}`}
              title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 sm:w-4 sm:h-4">
                <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
              </svg>
            </button>
            <button
              onClick={skipPrev}
              className="no-drag p-1.5 rounded-full text-white/70 hover:text-white active:scale-90 transition-all cursor-pointer"
              title="Previous Track"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 sm:w-4 sm:h-4"><path d="M6 6h2v12H6zm2 6 8.5 6V6L8 12z"/></svg>
            </button>
          </div>

          {/* Centre: play / pause */}
          <button
            onClick={togglePlayPause}
            className={`no-drag ${playButtonClass} rounded-full bg-[#ffffff] text-[#111111] flex items-center justify-center shadow-lg shadow-black/25 hover:scale-105 active:scale-95 transition-all cursor-pointer shrink-0`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className={playIconClass}><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className={`${playIconClass} ml-0.5`}><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>

          {/* Right half: next, volume */}
          <div className="flex items-center justify-start gap-0.5 flex-1 min-w-0 pl-0.5">
            <button
              onClick={skipNext}
              className="no-drag p-1.5 rounded-full text-white/70 hover:text-white active:scale-90 transition-all cursor-pointer"
              title="Next Track"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 sm:w-4 sm:h-4"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>

            <button
              onClick={handleToggleLyrics}
              className={`no-drag px-1.5 py-0.5 rounded-full font-black text-[8px] tracking-wider uppercase border transition-all cursor-pointer active:scale-95 shrink-0 ${
                showLyrics
                  ? 'bg-white/30 text-white border-white/50'
                  : 'text-white/60 hover:text-white border-white/20 hover:bg-white/10'
              }`}
              title={showLyrics ? 'Close Lyrics' : 'Show Synced Lyrics'}
            >
              Lyrics
            </button>

          </div>
        </div>

        </div>

        {/* ── 4. Lyrics — its own rounded panel BELOW the transport row. ── */}
        {showLyrics && (
          <div 
            className="lyrics-rise relative z-10 shrink-0 flex flex-col justify-center overflow-hidden h-[200px] mt-2 mx-0.5 rounded-2xl px-4"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12%, black 88%, transparent 100%)'
            }}
          >
            {/* Blur lives here and only here: the lyrics panel gets a frosted
                copy of the cover behind it, exactly like Apple Music's mini
                player. With lyrics closed nothing is blurred and the cover stays
                sharp. */}
            <div
              className="absolute inset-0 pointer-events-none overflow-hidden"
              style={{
                maskImage: 'radial-gradient(115% 100% at 50% 50%, black 58%, transparent 100%)',
                WebkitMaskImage: 'radial-gradient(115% 100% at 50% 50%, black 58%, transparent 100%)'
              }}
            >
              <div
                className="absolute -inset-10"
                style={{
                  backgroundImage: albumArt ? `url("${albumArt}")` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(30px) saturate(140%)'
                }}
              />
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0.52) 100%)' }}
              />
            </div>

            <div 
              ref={lyricsContainerRef}
              className="no-drag relative z-10 flex-1 overflow-y-auto hide-scrollbar py-3 space-y-2 text-center"
            >
              {isLoadingLyrics ? (
                <div className="h-full flex items-center justify-center text-xs text-white/40">
                  Finding lyrics...
                </div>
              ) : isTranslating ? (
                <div className="h-full flex items-center justify-center text-xs text-white/50 gap-2">
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span>Translating lyrics...</span>
                </div>
              ) : displayLyrics.type === 'synced' && Array.isArray(displayLyrics.data) && displayLyrics.data.length > 0 ? (
                displayLyrics.data.map((line, idx) => {
                  const isActive = idx === activeLyricIndex
                  const isNear = Math.abs(idx - activeLyricIndex) <= 1
                  const isLineRTL = isRTL(line.content)
                  return (
                    <p
                      key={idx}
                      ref={isActive ? activeLyricRef : null}
                      dir={isLineRTL ? 'rtl' : 'ltr'}
                      onClick={() => {
                        const pct = (line.time / (duration || 1)) * 100
                        seekTo(pct)
                      }}
                      style={{
                        color: isActive ? '#ffffff' : isNear ? 'rgba(var(--ink-rgb),0.5)' : 'rgba(var(--ink-rgb),0.22)',
                        transform: isActive ? 'scale(1.08)' : 'scale(0.96)',
                        fontWeight: isActive ? '800' : '500',
                        textShadow: isActive ? `0 0 20px color-mix(in srgb, ${accentColor} 93.3%, transparent), 0 0 35px color-mix(in srgb, ${accentColor} 53.3%, transparent)` : 'none',
                        fontFamily: isLineRTL ? "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', Tahoma, sans-serif" : undefined
                      }}
                      className={`${lyricLineClass} px-3 rounded cursor-pointer transition-all duration-300 hover:text-white font-medium ${
                        isLineRTL ? 'text-right' : 'text-center'
                      }`}
                    >
                      {line.content || '♪'}
                    </p>
                  )
                })
              ) : displayLyrics.type === 'plain' ? (
                <div 
                  dir={isRTL(displayLyrics.data) ? 'rtl' : 'ltr'}
                  style={{
                    fontFamily: isRTL(displayLyrics.data) ? "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', Tahoma, sans-serif" : undefined
                  }}
                  className={`${isTaller ? 'text-sm' : 'text-xs'} text-white/70 whitespace-pre-wrap leading-relaxed px-4 ${
                    isRTL(displayLyrics.data) ? 'text-right' : 'text-center'
                  }`}
                >
                  {displayLyrics.data}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-white/30 font-medium">
                  No synchronized lyrics found
                </div>
              )}
            </div>
          </div>
        )}

      </div>

    </div>
  )
}

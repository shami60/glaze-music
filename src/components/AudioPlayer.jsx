/**
 * AudioPlayer.jsx — Floating Liquid Glass Now Playing Capsule Bar
 *
 * Implements the expanded floating capsule dock design with:
 * - Left: Shuffle, Previous, Play/Pause, Next, Repeat (responsive collapse on narrow screens)
 * - Center: Thumbnail, Track Info (Title & Artist) + Integrated Inline Scrubber (flexible width & ellipsis)
 * - Right: Adaptive Utility Controls + Sleek Compact Volume Slider + Dynamic Overflow More (•••) Menu
 */

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { usePlayer, usePlaybackTime } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getArtURL, getSizedArtURL, onArtLoad, formatTime } from '../utils'
import ClickableArtists from './ClickableArtists'

// ── Icons ──────────────────────────────────────────────────────────────────
function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 sm:w-6 sm:h-6"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
}

function PrevIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5"><path d="M6 6h2v12H6zm2 6 8.5 6V6L8 12z"/></svg>
}

function NextIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
}

function ShuffleIcon({ active, accentColor }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="currentColor" 
      className="w-4 h-4 sm:w-5 sm:h-5 transition-all"
      style={{ color: active ? accentColor : 'rgba(var(--ink-rgb),0.45)' }}
    >
      <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
    </svg>
  )
}

function RepeatIcon({ mode, accentColor }) {
  const active = mode !== 'none'
  const color = active ? accentColor : 'rgba(var(--ink-rgb),0.45)'
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
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 text-white/40"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-3-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17 19.73l2 2L20.73 20 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 text-white/70 group-hover:text-white transition-colors"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
  )
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
      <path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
    </svg>
  )
}

export default function AudioPlayer({ 
  favourites, 
  streamingFavourites, 
  playlists, 
  onAddToFavourites, 
  onRemoveFromFavourites, 
  onAddToPlaylist, 
  onCreateAndAddToPlaylist,
  onOpenPlaylistModal, 
  downloadFolder, 
  onShowDownloadNotification, 
  onToggleLyrics, 
  isLyricsActive,
  activeView,
  setActiveView
}) {
  const {
    currentTrack, isPlaying, duration,
    volume, isMuted, shuffle, repeat,
    togglePlayPause, skipNext, skipPrev, seekTo,
    setVolume, setIsMuted, setShuffle, cycleRepeat,
    toggleFullScreen,
    isLoadingMeta, isAutoplay, setIsAutoplay,
    playbackSpeed, setPlaybackSpeed,
    streamInfo,
    accentColor = '#ef4444'
  } = usePlayer()
  // Position lives in its own context so it doesn't re-render the whole app 4x/sec.
  const { currentTime, progress } = usePlaybackTime()

  // What is actually playing. For streams this is the codec/bitrate the main
  // process resolved; for library files it is the container itself, so a FLAC
  // shows "FLAC" and is honest about being the only lossless path in the app.
  // How much black the dock should take on. A bright cover adds almost nothing;
  // a dark or black cover darkens the pane so the bar still belongs to the art.
  const dockShade = useMemo(() => {
    const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(accentColor || '')
    if (!m) return 0.075
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return Number((0.055 + (1 - luminance) * 0.20).toFixed(3))
  }, [accentColor])

  const qualityBadge = useMemo(() => {
    const src = currentTrack?.src || ''
    const looksLocal = currentTrack?.isLocal || (!src.startsWith('yt:') && !src.startsWith('http') && !src.startsWith('blob:'))
    if (looksLocal) {
      const ext = (src.split('.').pop() || '').toLowerCase()
      if (['flac', 'wav', 'aiff', 'ape', 'dsf'].includes(ext)) return { label: ext.toUpperCase(), lossless: true }
      if (['mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(ext)) return { label: ext.toUpperCase(), lossless: false }
      return null
    }
    if (!streamInfo || !streamInfo.bitrate) return null
    const currentVid = currentTrack?.videoId || (src.startsWith('yt:') ? src.slice(3) : null)
    // Ignore info left over from the previous track.
    if (currentVid && streamInfo.videoId && currentVid !== streamInfo.videoId) return null
    return { label: `${streamInfo.codec} ${Math.round(streamInfo.bitrate / 1000)}k`, lossless: false }
  }, [currentTrack, streamInfo])

  const { isDownloaded = () => false, refreshDownloads = () => {} } = useLibrary() || {}
  const isCurrentDownloaded = isDownloaded(currentTrack)

  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  // 0-100 while a download is running, null otherwise. Driven by yt-dlp's own
  // byte-level progress, so the ring reflects real transfer, not a guess.
  const [downloadPercent, setDownloadPercent] = useState(null)

  // Smooth Scrubbing & Seeking Local State
  const [isDragging, setIsDragging] = useState(false)
  const [seekPercent, setSeekPercent] = useState(0)
  const wheelTimeoutRef = useRef(null)
  const wheelPercentRef = useRef(null)
  const scrubberContainerRef = useRef(null)

  const playlistMenuRef = useRef(null)
  const moreMenuRef = useRef(null)

  const isFav = currentTrack?.src && (
    favourites?.has(currentTrack.src) || 
    streamingFavourites?.some(t => t.src === currentTrack.src)
  )

  function toggleFav() {
    if (!currentTrack?.src) return
    const itemToPass = currentTrack.src.startsWith('yt:') ? currentTrack : currentTrack.src
    if (isFav) onRemoveFromFavourites(itemToPass)
    else onAddToFavourites(itemToPass)
  }

  function cycleSpeed() {
    const speeds = [1, 1.25, 1.5, 2, 0.75]
    const idx = speeds.indexOf(playbackSpeed)
    setPlaybackSpeed(speeds[(idx + 1) % speeds.length] || 1)
  }

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (playlistMenuRef.current && !playlistMenuRef.current.contains(e.target)) {
        setShowPlaylistMenu(false)
        setIsCreatingPlaylist(false)
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false)
      }
    }
    if (showPlaylistMenu || showMoreMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showPlaylistMenu, showMoreMenu])

  // Spacebar play/pause is handled globally in App.jsx — registering a second
  // window-level listener here made Space a no-op whenever LyricsView was also
  // mounted (both handlers fired, the two toggles cancelled each other out).

  // Effective percentage and display time (optimistic local state for buttery smooth scrubbing)
  const currentPercent = isDragging 
    ? seekPercent 
    : (wheelPercentRef.current !== null ? wheelPercentRef.current : progress)

  const displayCurrentTime = isDragging || wheelPercentRef.current !== null
    ? ((currentPercent / 100) * (duration || 0))
    : currentTime

  // Same thumb-travel problem as the volume slider, but this track has no fixed
  // width, so the fill stop is a calc() against the capsule width:
  //   (100% - capsule) * progress + capsule/2
  const seekProgressStyle = useMemo(() => {
    const p = Math.min(1, Math.max(0, currentPercent / 100))
    return {
      background: `linear-gradient(to right, ${accentColor} calc((100% - 26px) * ${p} + 13px), rgba(var(--ink-rgb),0.18) 0)`,
    }
  }, [currentPercent, accentColor])

  // Handle global mouse/touch release while dragging seekbar
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

  // Scrubbing & seeking handlers
  const handleSeekStart = (e) => {
    setIsDragging(true)
    const val = parseFloat(e.target.value)
    setSeekPercent(val)
  }

  const handleSeekChange = (e) => {
    const val = parseFloat(e.target.value)
    setSeekPercent(val)
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

  // Smooth normalized mouse wheel seeking
  const handleWheel = (e) => {
    e.preventDefault()
    if (!duration) return
    const deltaFactor = Math.abs(e.deltaY) < 20 ? 0.25 : (Math.abs(e.deltaY) < 50 ? 0.6 : 1.2)
    const stepPercent = (3 / (duration || 180)) * 100 * deltaFactor
    const delta = (e.deltaY < 0 ? 1 : -1) * stepPercent

    const basePercent = wheelPercentRef.current !== null ? wheelPercentRef.current : progress
    const targetPercent = Math.min(100, Math.max(0, basePercent + delta))

    wheelPercentRef.current = targetPercent
    setSeekPercent(targetPercent)

    if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
    wheelTimeoutRef.current = setTimeout(() => {
      seekTo(targetPercent)
      wheelPercentRef.current = null
    }, 90)
  }

  const volPercent = isMuted ? 0 : volume * 100
  // A native range thumb travels from 0 to (width - thumbWidth), not the full
  // width, so a percentage gradient ends up at the thumb's LEFT edge instead of
  // its centre — the fill visibly stops short of the capsule. Compute in px.
  const volProgressStyle = useMemo(() => {
    const W = 96
    const THUMB = 30
    const fillPx = THUMB / 2 + (W - THUMB) * (volPercent / 100)
    return {
      background: `linear-gradient(to right, ${accentColor} ${fillPx}px, rgba(var(--ink-rgb),0.18) ${fillPx}px)`,
    }
  }, [volPercent, accentColor])

  useEffect(() => {
    const off = window.electronAPI?.onDownloadProgress?.((data) => {
      if (!data) return
      const vid = currentTrack?.src?.startsWith('yt:') ? currentTrack.src.slice(3) : null
      if (vid && data.videoId !== vid) return
      setDownloadPercent(data.percent)
    })
    return () => { if (typeof off === 'function') off() }
  }, [currentTrack])

  const handleDownload = async () => {
    if (isDownloading || isCurrentDownloaded || !window.electronAPI?.youtubeDownloadTrack || !currentTrack?.src?.startsWith('yt:')) return
    setIsDownloading(true)
    setDownloadPercent(0)
    const videoId = currentTrack.src.replace('yt:', '')
    try {
      const res = await window.electronAPI.youtubeDownloadTrack(videoId, downloadFolder)
      const ok = !!res?.success
      onShowDownloadNotification?.(currentTrack, ok)
      if (ok) refreshDownloads?.()
    } catch {
      onShowDownloadNotification?.(currentTrack, false)
    } finally {
      setIsDownloading(false)
      setDownloadPercent(null)
    }
  }

  return (
    <div className="fixed bottom-2 left-[var(--sidebar-w)] right-0 z-40 flex justify-center pointer-events-none px-3 sm:px-6 md:px-8">
      {/* ── Main Responsive Liquid Glass Floating Capsule ── */}
      <div
        className="liquid-glass-dock pointer-events-auto h-[62px] sm:h-[68px] w-full max-w-[1080px] flex items-center justify-between gap-1.5 sm:gap-2.5 md:gap-4 select-none px-3 sm:px-4 md:px-5"
        // Dark themes tint the pane with the cover's colour; light themes ignore it.
        style={{ '--dock-tint': accentColor, '--dock-shade': dockShade }}
      >
        
        {/* ── LEFT: Playback Controls (Shuffle, Prev, Play/Pause, Next, Repeat) ── */}
        <div className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 shrink-0">
          {/* Shuffle (Hidden on small viewports, accessible in More menu) */}
          <button
            onClick={() => setShuffle(s => !s)}
            className="hidden sm:inline-flex p-1.5 sm:p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            <ShuffleIcon active={shuffle} accentColor={accentColor} />
          </button>

          {/* Previous */}
          <button
            onClick={skipPrev}
            className="p-1.5 sm:p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            <PrevIcon />
          </button>

          {/* Play / Pause */}
          <button
            onClick={togglePlayPause}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#ffffff] text-[#111111] hover:scale-105 active:scale-95 transition-transform duration-150 flex items-center justify-center shadow-lg shadow-black/20 cursor-pointer mx-0.5 shrink-0 relative overflow-hidden"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <PauseIcon />
            ) : (
              <PlayIcon />
            )}
            {isLoadingMeta && (
              <span className="absolute inset-0 rounded-full border-2 border-black/30 border-t-black animate-spin pointer-events-none" />
            )}
          </button>

          {/* Next */}
          <button
            onClick={skipNext}
            className="p-1.5 sm:p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            <NextIcon />
          </button>

          {/* Repeat (Hidden on small viewports, accessible in More menu) */}
          <button
            onClick={cycleRepeat}
            className="hidden sm:inline-flex p-1.5 sm:p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            <RepeatIcon mode={repeat} accentColor={accentColor} />
          </button>
        </div>

        {/* ── CENTER: Adaptive Track Info + Integrated Inline Scrubber (Anti-Shake & Fixed Layout) ── */}
        <div className="flex flex-col justify-center flex-1 min-w-0 max-w-[460px] px-1 sm:px-2 h-full overflow-visible">
          {/* Top Row: Thumbnail + Track Title & Artist */}
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 h-8 sm:h-9 shrink-0">
            {/* Thumbnail */}
            <div 
              onClick={toggleFullScreen}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg sm:rounded-xl overflow-hidden shrink-0 bg-white/5 border border-white/20 relative shadow-md cursor-pointer group transform-gpu"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
              title="Click for Fullscreen View"
            >
              <img
                src={getSizedArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src), 'thumb')}
                alt=""
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                onError={e => e.target.style.opacity = '0'}
                onLoad={e => { e.target.style.opacity = '1'; onArtLoad(e) }}
              />
            </div>

            {/* Track Info (Ellipsis with flex-1 min-w-0) */}
            <div className="flex-1 min-w-0 pr-1 flex flex-col justify-center">
              <div 
                onClick={toggleFullScreen}
                className="text-xs sm:text-[13px] md:text-sm font-bold text-white truncate cursor-pointer hover:underline leading-tight"
                title={currentTrack?.title || 'No track playing'}
              >
                {currentTrack?.title || 'No track playing'}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 leading-tight min-w-0">
                <div className="text-[10px] sm:text-[11px] text-white/60 truncate">
                  <ClickableArtists artistString={currentTrack?.artist || 'Glaze Music'} />
                </div>
                {qualityBadge && (
                  <span
                    title={qualityBadge.lossless ? 'Lossless — native file quality' : 'Streaming bitrate'}
                    className={`shrink-0 rounded px-1 py-px text-[8px] sm:text-[9px] font-bold uppercase tracking-wider border ${
                      qualityBadge.lossless
                        ? 'border-emerald-400/40 text-emerald-300/90'
                        : 'border-white/15 text-white/40'
                    }`}
                  >
                    {qualityBadge.label}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Integrated Inline Progress Scrubber with Permanent Timestamps (Zero layout shift) */}
          <div 
            ref={scrubberContainerRef}
            className="relative flex items-center gap-1.5 sm:gap-2 w-full h-4 sm:h-4.5 mt-0.5 sm:mt-1 group/scrub select-none"
            onWheel={handleWheel}
          >
            {/* Current Timestamp */}
            <span className="text-[9px] sm:text-[10px] font-mono text-white/65 font-medium tabular-nums shrink-0 select-none">
              {formatTime(displayCurrentTime)}
            </span>

            {/* Scrubber Track Container */}
            <div className="relative flex-1 flex items-center h-full">
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={currentPercent}
                onMouseDown={handleSeekStart}
                onTouchStart={handleSeekStart}
                onPointerDown={handleSeekStart}
                onChange={handleSeekChange}
                onInput={handleSeekChange}
                onMouseUp={handleSeekCommit}
                onTouchEnd={handleSeekCommit}
                onPointerUp={handleSeekCommit}
                onKeyUp={handleSeekCommit}
                style={seekProgressStyle}
                className="lg-seek w-full cursor-pointer transition-none focus:outline-none"
              />
            </div>

            {/* Total Duration Timestamp */}
            <span className="text-[9px] sm:text-[10px] font-mono text-white/40 font-medium tabular-nums shrink-0 select-none">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* ── RIGHT: Adaptive Utility Buttons + Compact Volume ── */}
        <div className="flex items-center gap-0.5 sm:gap-1 md:gap-1.5 shrink-0">
          
          {/* 1. Favourite (❤️) — Always visible when playing */}
          {currentTrack?.src && (
            <button
              onClick={toggleFav}
              className={`p-1.5 sm:p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
                isFav ? 'text-red-500 hover:text-red-400' : 'text-white/50 hover:text-white'
              }`}
              style={{ color: isFav ? accentColor : undefined }}
            >
              <svg viewBox="0 0 24 24" fill={isFav ? (accentColor || '#ef4444') : 'none'} stroke={isFav ? (accentColor || '#ef4444') : 'currentColor'} strokeWidth={isFav ? 0 : 2} className="w-4 h-4 sm:w-5 sm:h-5">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </button>
          )}

          {/* 2. Add to Playlist (➕) — Direct on XL, otherwise in More menu */}
          {currentTrack?.src && (
            <div className="relative block" ref={playlistMenuRef}>
              <button
                onClick={() => {
                  if (onOpenPlaylistModal) onOpenPlaylistModal(currentTrack)
                  else setShowPlaylistMenu(s => !s)
                }}
                className="p-1.5 sm:p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                  <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/>
                </svg>
              </button>

              {/* Playlist Selection Popup */}
              {showPlaylistMenu && (
                <div 
                  className="menu-surface absolute bottom-full mb-3 right-0 w-52 rounded-2xl p-2 border backdrop-blur-3xl z-50 animate-in fade-in zoom-in-95 duration-150"
                >
                  <p className="text-[10px] uppercase tracking-wider text-white/40 px-2 py-1 font-bold">Add to Playlist</p>
                  <div className="max-h-40 overflow-y-auto py-1 custom-scrollbar">
                    {playlists?.length > 0 ? playlists.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { onAddToPlaylist(currentTrack.src, p.id); setShowPlaylistMenu(false) }}
                        className="w-full text-left px-2.5 py-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors truncate cursor-pointer"
                      >
                        {p.name}
                      </button>
                    )) : (
                      <p className="px-2.5 py-2 text-xs text-white/40">No playlists yet</p>
                    )}
                  </div>
                  <div className="pt-1 mt-1 border-t border-white/10">
                    {isCreatingPlaylist ? (
                      <div className="p-1">
                        <input
                          type="text"
                          autoFocus
                          placeholder="Playlist name..."
                          value={newPlaylistName}
                          onChange={e => setNewPlaylistName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newPlaylistName.trim()) {
                              onCreateAndAddToPlaylist(currentTrack.src, newPlaylistName.trim())
                              setShowPlaylistMenu(false)
                              setIsCreatingPlaylist(false)
                              setNewPlaylistName('')
                            }
                          }}
                          className="w-full bg-white/10 text-white text-xs px-2.5 py-1.5 rounded-lg border border-white/20 outline-none"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsCreatingPlaylist(true)}
                        className="w-full text-left px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                        style={{ color: accentColor }}
                      >
                        + Create Playlist
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. Download Button (⬇️ for online tracks, ✓ if downloaded) — Direct on XL */}
          {currentTrack?.src?.startsWith('yt:') && (
            <button
              onClick={handleDownload}
              disabled={isCurrentDownloaded || isDownloading}
              /* No `title`: a native tooltip is drawn by the OS outside the app
                 window, so the progress percentage appeared as a grey box hanging
                 under the dock instead of on the control. */
              aria-label={
                isCurrentDownloaded
                  ? 'Downloaded'
                  : isDownloading
                  ? `Downloading ${downloadPercent ?? 0} percent`
                  : 'Download track'
              }
              className={`relative hidden xl:inline-flex items-center justify-center w-8 h-8 rounded-full transition-all overflow-hidden ${
                isCurrentDownloaded
                  ? 'text-emerald-400 cursor-default'
                  : isDownloading
                  ? 'text-emerald-400 cursor-default'
                  : 'text-white/50 hover:text-white hover:bg-white/10 active:scale-95 cursor-pointer'
              }`}
            >
              {isDownloading && (
                <svg
                  className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
                  viewBox="0 0 36 36"
                  aria-hidden="true"
                >
                  <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(52,211,153,0.22)" strokeWidth="2.5" />
                  <circle
                    cx="18"
                    cy="18"
                    r="16"
                    fill="none"
                    stroke="#34d399"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    // circumference of r=16 is ~100.5
                    strokeDasharray={`${((downloadPercent ?? 0) / 100) * 100.53} 100.53`}
                    style={{ transition: 'stroke-dasharray 250ms linear' }}
                  />
                </svg>
              )}
              {isCurrentDownloaded ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              ) : isDownloading ? (
                <span className="relative z-10 text-[9px] font-bold tabular-nums leading-none text-emerald-300">
                  {Math.round(downloadPercent ?? 0)}
                </span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 sm:w-5 sm:h-5 relative z-10">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              )}
            </button>
          )}

          {/* 4. Lyrics (LYRICS) */}
          <button
            onClick={onToggleLyrics}
            className={`px-3 py-1.5 rounded-full active:scale-95 transition-all cursor-pointer font-black text-[11px] tracking-widest uppercase border ${
              isLyricsActive 
                ? 'bg-white/20 text-white border-white/40 shadow-[0_0_15px_rgba(var(--ink-rgb),0.2)]' 
                : 'text-white/60 hover:text-white border-white/10 hover:bg-white/10 hover:border-white/20'
            }`}
            style={{ color: isLyricsActive ? accentColor : undefined }}
          >
            LYRICS
          </button>

          {/* 5. Queue (☰) */}
          <button
            onClick={() => setActiveView?.(activeView === 'queue' ? 'home' : 'queue')}
            className={`p-1.5 sm:p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${
              activeView === 'queue' ? 'bg-white/20' : 'text-white/50 hover:text-white'
            }`}
            style={{ color: activeView === 'queue' ? accentColor : undefined }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
              <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
            </svg>
          </button>

          {/* 6. Speed Toggle (⚡) — Direct on LG+ */}
          <button
            onClick={cycleSpeed}
            className="hidden lg:inline-flex px-2 py-0.5 rounded-full text-xs font-bold font-mono text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer border border-white/5 hover:border-white/15"
          >
            {playbackSpeed}x
          </button>

          {/* 7. Autoplay Toggle (🔄) — Direct on XL */}
          <button
            onClick={() => setIsAutoplay(a => !a)}
            className="hidden xl:inline-flex p-1.5 sm:p-2 rounded-full hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            style={{ color: isAutoplay ? accentColor : 'rgba(var(--ink-rgb),0.45)' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
          </button>

          {/* 8. Fullscreen (⛶ F11) — Direct on MD+ */}
          <button
            onClick={toggleFullScreen}
            className="hidden md:inline-flex p-1.5 sm:p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5"><path d="M5 5h5v2H7v3H5V5zm9 0h5v5h-2V7h-3V5zm5 14h-5v-2h3v-3h2v5zm-14 0v-5h2v3h3v2H5z"/></svg>
          </button>

          {/* 9. Mini Player / PiP (⧉) */}
          <button
            onClick={() => window.electronAPI?.toggleMiniPlayer?.(true)}
            className="hidden sm:inline-flex p-1.5 sm:p-2 rounded-full text-white/50 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 sm:w-5 sm:h-5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <rect x="11" y="9" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.3" />
            </svg>
          </button>

          {/* 10. Dynamic More (•••) Popover Button (Appears on narrower screens to house hidden controls) */}
          <div className="relative xl:hidden" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(s => !s)}
              className={`p-1.5 sm:p-2 rounded-full transition-all cursor-pointer ${
                showMoreMenu ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white hover:bg-white/10 active:scale-95'
              }`}
            >
              <MoreIcon />
            </button>

            {/* Frosted Glass More Popover Menu */}
            {showMoreMenu && (
              <div 
                className="menu-surface absolute bottom-full mb-3 right-0 w-56 rounded-2xl p-2 border backdrop-blur-3xl z-50 animate-in fade-in zoom-in-95 duration-150 text-xs"
              >
                <div className="flex items-center justify-between px-2.5 py-1 mb-1 border-b border-white/10 text-white/40 text-[10px] font-bold uppercase tracking-wider">
                  <span>Playback Options</span>
                  <button 
                    onClick={() => setShowMoreMenu(false)}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex flex-col gap-0.5">
                  {/* Mini Player (<SM) */}
                  <button
                    onClick={() => {
                      window.electronAPI?.toggleMiniPlayer?.(true)
                      setShowMoreMenu(false)
                    }}
                    className="flex sm:hidden items-center gap-2.5 w-full text-left px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-white/80 hover:text-white cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-white/60">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <rect x="11" y="9" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.3" />
                    </svg>
                    <span>Mini Player (PiP)</span>
                  </button>

                  {/* Shuffle (Small screens only) */}
                  <div className="flex sm:hidden items-center justify-between px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors">
                    <span className="text-white/80 font-medium">Shuffle</span>
                    <button
                      onClick={() => setShuffle(s => !s)}
                      className="px-2 py-0.5 rounded-md font-semibold text-[11px] cursor-pointer"
                      style={{ 
                        backgroundColor: shuffle ? `color-mix(in srgb, ${accentColor} 20%, transparent)` : 'rgba(var(--ink-rgb),0.08)',
                        color: shuffle ? accentColor : 'rgba(var(--ink-rgb),0.6)'
                      }}
                    >
                      {shuffle ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Repeat (Small screens only) */}
                  <div className="flex sm:hidden items-center justify-between px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors">
                    <span className="text-white/80 font-medium">Repeat</span>
                    <button
                      onClick={cycleRepeat}
                      className="px-2 py-0.5 rounded-md font-semibold text-[11px] capitalize cursor-pointer"
                      style={{ 
                        backgroundColor: repeat !== 'none' ? `color-mix(in srgb, ${accentColor} 20%, transparent)` : 'rgba(var(--ink-rgb),0.08)',
                        color: repeat !== 'none' ? accentColor : 'rgba(var(--ink-rgb),0.6)'
                      }}
                    >
                      {repeat}
                    </button>
                  </div>

                  {/* Playback Speed (<LG) */}
                  <div className="flex lg:hidden items-center justify-between px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors">
                    <span className="text-white/80 font-medium">Speed</span>
                    <button
                      onClick={cycleSpeed}
                      className="px-2 py-0.5 rounded-md font-mono font-bold text-[11px] bg-white/10 text-white hover:bg-white/20 transition-all cursor-pointer"
                    >
                      {playbackSpeed}x
                    </button>
                  </div>

                  {/* Autoplay Toggle (<XL) */}
                  <div className="flex xl:hidden items-center justify-between px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors">
                    <span className="text-white/80 font-medium">Autoplay</span>
                    <button
                      onClick={() => setIsAutoplay(a => !a)}
                      className="px-2 py-0.5 rounded-md font-semibold text-[11px] cursor-pointer"
                      style={{ 
                        backgroundColor: isAutoplay ? `color-mix(in srgb, ${accentColor} 20%, transparent)` : 'rgba(var(--ink-rgb),0.08)',
                        color: isAutoplay ? accentColor : 'rgba(var(--ink-rgb),0.6)'
                      }}
                    >
                      {isAutoplay ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Fullscreen (<MD) */}
                  <button
                    onClick={() => { toggleFullScreen(); setShowMoreMenu(false) }}
                    className="flex md:hidden items-center gap-2.5 w-full text-left px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-white/80 hover:text-white cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/60"><path d="M5 5h5v2H7v3H5V5zm9 0h5v5h-2V7h-3V5zm5 14h-5v-2h3v-3h2v5zm-14 0v-5h2v3h3v2H5z"/></svg>
                    <span>Fullscreen (F11)</span>
                  </button>

                  {/* Add to Playlist (<XL) */}
                  {currentTrack?.src && (
                    <button
                      onClick={() => {
                        setShowMoreMenu(false)
                        setShowPlaylistMenu(true)
                      }}
                      className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-white/80 hover:text-white cursor-pointer"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/60"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                      <span>Add to Playlist...</span>
                    </button>
                  )}

                  {/* Download Track (<XL) */}
                  {currentTrack?.src?.startsWith('yt:') && (
                    <button
                      disabled={isCurrentDownloaded || isDownloading}
                      onClick={() => {
                        if (!isCurrentDownloaded) {
                          handleDownload()
                          setShowMoreMenu(false)
                        }
                      }}
                      className={`flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-xl transition-colors ${
                        isCurrentDownloaded
                          ? 'text-emerald-400 font-semibold cursor-default'
                          : 'hover:bg-white/10 text-white/80 hover:text-white cursor-pointer disabled:opacity-50'
                      }`}
                    >
                      {isCurrentDownloaded ? (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-400"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-white/60">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                      <span>
                        {isCurrentDownloaded
                          ? 'Downloaded'
                          : isDownloading
                          ? `Downloading ${downloadPercent ?? 0}%`
                          : 'Download Track'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 10. Volume Control (🔊 + Sleek Compact Slider) */}
          <div 
            className="flex items-center gap-1 sm:gap-1.5 shrink-0 pl-0.5"
            onWheel={e => {
              const next = Math.min(1, Math.max(0, volume + (e.deltaY < 0 ? 0.05 : -0.05)))
              setVolume(parseFloat(next.toFixed(2)))
              if (next > 0) setIsMuted(false)
            }}
          >
            <button
              onClick={() => setIsMuted(m => !m)}
              className="p-1.5 sm:p-2 rounded-full text-white/60 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            >
              <VolumeIcon muted={isMuted} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={e => {
                const val = parseFloat(e.target.value)
                setVolume(val)
                if (val > 0) setIsMuted(false)
              }}
              style={{ ...volProgressStyle, width: '96px' }}
              className="lg-volume w-[96px] max-w-[96px] cursor-pointer transition-all shrink-0"
            />
          </div>

        </div>

      </div>
    </div>
  )
}

/**
 * Queue.jsx — Liquid Glass Play Queue Management Panel
 *
 * Implements a high-end, interactive queue manager featuring:
 * - Dedicated "Now Playing" hero spotlight card with live visualizer
 * - "Next in Queue" section with track counts and total runtime
 * - One-click actions: Play Now (▶), Move to Next (⤒), Remove (✕)
 * - Fluid drag-and-drop reordering with glowing insertion line
 * - "Clear Up Next" and "Clear All" actions
 * - Collapsible "Previously Played" history section
 */

import React, { useState, useMemo, useEffect } from 'react'
import { usePlayer } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getArtURL, getSizedArtURL, formatTime } from '../utils'
import ClickableArtists from './ClickableArtists'

// A queue can hold thousands of tracks (1,308 in the reported case) and every
// row is ~30 DOM nodes with three hover buttons and a drag handler. Rendering
// all of them in one pass cost 541 ms of blocking main thread on open — one
// 390 ms long task plus ~200 ms of style recalc — and left ~39k nodes behind.
// Render a window instead and extend it as the user actually scrolls, so the
// cost tracks what is on screen rather than what is in the queue.
const QUEUE_INITIAL_ROWS = 80
const QUEUE_ROW_CHUNK = 100
const QUEUE_EXTEND_PX = 600

function EqualizerBars({ color = '#ef4444' }) {
  return (
    <div className="flex items-end gap-0.5 h-4 w-4 shrink-0 justify-center">
      <span className="w-0.5 rounded-full animate-bounce" style={{ height: '55%', background: color, animationDelay: '0ms', animationDuration: '600ms' }} />
      <span className="w-0.5 rounded-full animate-bounce" style={{ height: '95%', background: color, animationDelay: '200ms', animationDuration: '750ms' }} />
      <span className="w-0.5 rounded-full animate-bounce" style={{ height: '70%', background: color, animationDelay: '400ms', animationDuration: '650ms' }} />
      <span className="w-0.5 rounded-full animate-bounce" style={{ height: '40%', background: color, animationDelay: '150ms', animationDuration: '800ms' }} />
    </div>
  )
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/30 group-hover:text-white/70 transition-colors">
      <path d="M9 3H7v2h2V3zm0 4H7v2h2V7zm0 4H7v2h2v-2zm0 4H7v2h2v-2zm0 4H7v2h2v-2zm6-16h-2v2h2V3zm0 4h-2v2h2V7zm0 4h-2v2h2v-2zm0 4h-2v2h2v-2zm0 4h-2v2h2v-2z"/>
    </svg>
  )
}

export default function Queue() {
  const { 
    queue = [], 
    currentIndex = 0, 
    currentTrack, 
    isPlaying, 
    togglePlayPause, 
    playTrackAt, 
    removeFromQueue, 
    replaceQueue, 
    reorderQueue,
    accentColor = '#ef4444' 
  } = usePlayer()

  const { favourites, streamingFavourites = [], addToFavourites, removeFromFavourites } = useLibrary()

  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [search, setSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [renderLimit, setRenderLimit] = useState(QUEUE_INITIAL_ROWS)

  // A new search narrows the list, so the window should start small again.
  useEffect(() => { setRenderLimit(QUEUE_INITIAL_ROWS) }, [search])

  // Split queue into: History, Now Playing, and Up Next
  const { historyTracks, activeTrack, upNextTracks, totalUpNextDuration } = useMemo(() => {
    if (!queue || queue.length === 0) {
      return { historyTracks: [], activeTrack: null, upNextTracks: [], totalUpNextDuration: 0 }
    }

    const validIdx = Math.max(0, Math.min(currentIndex, queue.length - 1))
    const history = queue.slice(0, validIdx).map((t, i) => ({ ...t, originalIndex: i }))
    const active = queue[validIdx] ? { ...queue[validIdx], originalIndex: validIdx } : null
    const upNext = queue.slice(validIdx + 1).map((t, i) => ({ ...t, originalIndex: validIdx + 1 + i }))

    let durationSum = 0
    for (const t of upNext) {
      durationSum += (typeof t.duration === 'object' ? t.duration?.seconds : t.duration) || 0
    }

    return {
      historyTracks: history,
      activeTrack: active,
      upNextTracks: upNext,
      totalUpNextDuration: durationSum
    }
  }, [queue, currentIndex])

  // Filtered Up Next list if user searches within queue
  const filteredUpNext = useMemo(() => {
    if (!search.trim()) return upNextTracks
    const q = search.toLowerCase()
    return upNextTracks.filter(t => 
      t.title?.toLowerCase().includes(q) || 
      t.artist?.toLowerCase().includes(q)
    )
  }, [upNextTracks, search])

  // Clear up next while preserving current track
  const handleClearUpNext = () => {
    if (activeTrack) {
      const preserved = queue.slice(0, currentIndex + 1)
      replaceQueue(preserved, currentIndex)
    } else {
      replaceQueue([])
    }
  }

  // Move a track right below currently playing track (Play Next)
  const handleMoveToTop = (originalIndex) => {
    if (originalIndex === currentIndex + 1) return
    reorderQueue(originalIndex, currentIndex + 1)
  }

  // Favorite helper
  const isTrackFav = (track) => {
    if (!track) return false
    if (track.isLocal || !track.src?.startsWith('yt:')) {
      return favourites?.has(track.src) || false
    }
    const vid = track.src.replace('yt:', '')
    return streamingFavourites?.some(f => f.id === vid || f.src === track.src) || false
  }

  const toggleFav = (track) => {
    if (isTrackFav(track)) {
      removeFromFavourites?.(track.src || track)
    } else {
      addToFavourites?.(track)
    }
  }

  const formatTotalTime = (seconds) => {
    if (!seconds) return '0 min'
    const mins = Math.floor(seconds / 60)
    const hrs = Math.floor(mins / 60)
    if (hrs > 0) {
      return `${hrs} hr ${mins % 60} min`
    }
    return `${mins} min`
  }

  // Extend the rendered window as the user approaches the bottom, so scrolling
  // through a long queue still works without paying for it up front.
  const handleQueueScroll = (e) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > QUEUE_EXTEND_PX) return
    setRenderLimit(prev => (prev >= filteredUpNext.length ? prev : prev + QUEUE_ROW_CHUNK))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden select-none animate-in fade-in">
      
      {/* ── Top Header with Queue Stats & Quick Actions ── */}
      <div className="px-8 pt-6 pb-4 shrink-0 border-b border-white/[0.06] bg-white/[0.01] backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          
          <div>
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accentColor, boxShadow: `0 0 10px ${accentColor}` }}></span>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Playing Queue</h1>
            </div>
            <p className="text-xs text-white/50 mt-1 font-medium">
              {queue.length} track{queue.length !== 1 ? 's' : ''} in total · {upNextTracks.length} upcoming ({formatTotalTime(totalUpNextDuration)})
            </p>
          </div>

          {/* Search in Queue & Clear Actions */}
          <div className="flex items-center gap-2.5">
            
            {/* Search filter input */}
            {upNextTracks.length > 3 && (
              <div className="relative w-44 sm:w-52">
                <svg viewBox="0 0 24 24" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <input
                  type="text"
                  placeholder="Filter queue..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs text-white placeholder-white/30 bg-white/5 border border-white/10 focus:border-white/25 focus:outline-none transition-colors"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs">
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Clear Up Next */}
            {upNextTracks.length > 0 && (
              <button
                onClick={handleClearUpNext}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 transition-all cursor-pointer"
                title="Clear upcoming songs"
              >
                Clear Up Next
              </button>
            )}

            {/* Clear All */}
            {queue.length > 0 && (
              <button
                onClick={() => replaceQueue([])}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-all cursor-pointer"
                title="Clear entire queue"
              >
                Clear All
              </button>
            )}

          </div>

        </div>
      </div>

      {/* ── Scrollable Queue Content ── */}
      <div
        className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar space-y-8 pb-36"
        onScroll={handleQueueScroll}
      >
        
        {/* Empty State */}
        {queue.length === 0 && (
          <div className="flex flex-col items-center justify-center h-80 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-white/20 border border-white/10">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-white/80">Your Queue is Empty</p>
              <p className="text-xs text-white/40 mt-1 max-w-sm">
                Add songs to your queue from your Library, Streaming search, or artist pages to keep the music playing.
              </p>
            </div>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-online-playlist', { detail: { query: 'Top Hits' } }))
              }}
              style={{ backgroundColor: accentColor }}
              className="px-5 py-2.5 rounded-full text-xs font-bold text-white shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer mt-2"
            >
              Explore Music
            </button>
          </div>
        )}

        {/* ── 1. NOW PLAYING HERO SPOTLIGHT ── */}
        {activeTrack && (
          <section className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-white/50">Now Playing</span>
            </div>

            <div 
              className="group relative flex items-center justify-between p-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-white/20 shadow-xl transition-all backdrop-blur-md"
              style={{
                background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 9.4%, transparent) 0%, rgba(var(--ink-rgb),0.03) 100%)`
              }}
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                
                {/* Large Album Art + Live Visualizer / Play Button */}
                <div 
                  onClick={togglePlayPause}
                  className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-lg border border-white/10 group/cover cursor-pointer"
                >
                  <img 
                    src={getSizedArtURL(activeTrack.albumArt || getArtURL(activeTrack.src), 'thumb')} 
                    alt="" 
                    className="w-full h-full object-cover group-hover/cover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    {isPlaying ? (
                      <EqualizerBars color="#ffffff" />
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                    )}
                  </div>
                </div>

                {/* Track Details */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white truncate" title={activeTrack.title}>
                      {activeTrack.title}
                    </h3>
                    <span 
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white shrink-0"
                      style={{ backgroundColor: accentColor }}
                    >
                      Playing
                    </span>
                  </div>
                  <div className="text-xs text-white/60 truncate mt-1">
                    <ClickableArtists artistString={activeTrack.artist || 'Unknown Artist'} />
                  </div>
                </div>

              </div>

              {/* Right: Actions (Heart / Favorite + Duration) */}
              <div className="flex items-center gap-3 shrink-0 pl-4">
                
                {/* Heart Button */}
                <button
                  onClick={() => toggleFav(activeTrack)}
                  className="p-2 rounded-full hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                  style={{ color: isTrackFav(activeTrack) ? '#ef4444' : 'rgba(var(--ink-rgb),0.4)' }}
                  title={isTrackFav(activeTrack) ? 'Remove from Favourites' : 'Add to Favourites'}
                >
                  <svg viewBox="0 0 24 24" fill={isTrackFav(activeTrack) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isTrackFav(activeTrack) ? 0 : 2} className="w-5 h-5">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                </button>

                {/* Duration */}
                {activeTrack.duration > 0 && (
                  <span className="text-xs font-mono font-medium text-white/60 tabular-nums">
                    {formatTime(typeof activeTrack.duration === 'object' ? activeTrack.duration?.seconds : activeTrack.duration)}
                  </span>
                )}

              </div>
            </div>
          </section>
        )}

        {/* ── 2. UP NEXT QUEUE LIST ── */}
        {upNextTracks.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between pb-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-white/50">Next in Queue</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-white/10 text-white/70">
                  {upNextTracks.length}
                </span>
              </div>
              <span className="text-xs text-white/30">Drag to reorder · Double-click to play</span>
            </div>

            <div className="space-y-1">
              {filteredUpNext.slice(0, renderLimit).map((track, relativeIdx) => {
                const originalIndex = track.originalIndex
                const isDragging = originalIndex === draggedIndex
                const isDragOver = originalIndex === dragOverIndex && draggedIndex !== originalIndex

                return (
                  <div
                    key={track.id || `${originalIndex}-${track.src}`}
                    draggable
                    onDragStart={(e) => {
                      setDraggedIndex(originalIndex)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', originalIndex.toString())
                    }}
                    onDragEnd={() => {
                      setDraggedIndex(null)
                      setDragOverIndex(null)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOverIndex(originalIndex)
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === originalIndex) setDragOverIndex(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10)
                      if (!isNaN(fromIdx) && fromIdx !== originalIndex) {
                        reorderQueue(fromIdx, originalIndex)
                      }
                      setDraggedIndex(null)
                      setDragOverIndex(null)
                    }}
                    onDoubleClick={() => playTrackAt(originalIndex)}
                    className={`group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all duration-150 cursor-pointer border ${
                      isDragOver
                        ? 'border-white/40 bg-white/10 shadow-lg'
                        : 'border-white/[0.03] hover:border-white/10 bg-white/[0.015] hover:bg-white/[0.06]'
                    } ${isDragging ? 'opacity-30' : 'opacity-100'}`}
                  >
                    
                    {/* Left: Drag handle + Index + Artwork + Info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      
                      {/* Drag Grip Handle */}
                      <div className="cursor-grab active:cursor-grabbing p-1 shrink-0">
                        <DragHandleIcon />
                      </div>

                      {/* Rank / Index Badge */}
                      <span className="text-xs font-mono text-white/30 w-5 shrink-0 text-center font-bold">
                        {relativeIdx + 1}
                      </span>

                      {/* Thumbnail Artwork */}
                      <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 shadow-sm border border-white/5 bg-white/5">
                        <img 
                          src={getSizedArtURL(track.albumArt || getArtURL(track.src), 'thumb')} 
                          alt="" 
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div 
                          onClick={(e) => { e.stopPropagation(); playTrackAt(originalIndex) }}
                          className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>

                      {/* Title & Artist */}
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-sm font-semibold text-white/90 group-hover:text-white truncate" title={track.title}>
                          {track.title}
                        </p>
                        <p className="text-xs text-white/40 group-hover:text-white/60 truncate mt-0.5 font-medium">
                          {track.artist || 'Unknown Artist'}
                        </p>
                      </div>

                    </div>

                    {/* Right: Hover Quick Actions & Duration */}
                    <div className="flex items-center gap-2 shrink-0">
                      
                      {/* Quick Action: Move to Top / Play Next (⤒) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMoveToTop(originalIndex)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                        title="Move to top / Play next"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <path d="M4 4h16v2H4V4zm8 3 6 6h-4v7h-4v-7H6l6-6z"/>
                        </svg>
                      </button>

                      {/* Quick Action: Heart / Like */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFav(track)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all cursor-pointer"
                        style={{ color: isTrackFav(track) ? '#ef4444' : 'rgba(var(--ink-rgb),0.4)' }}
                        title={isTrackFav(track) ? 'Remove from Favourites' : 'Add to Favourites'}
                      >
                        <svg viewBox="0 0 24 24" fill={isTrackFav(track) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={isTrackFav(track) ? 0 : 2} className="w-4 h-4">
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                      </button>

                      {/* Quick Action: Remove from Queue (✕) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFromQueue(track.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                        title="Remove from queue"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                      </button>

                      {/* Track Duration */}
                      {track.duration > 0 && (
                        <span className="text-xs font-mono text-white/30 w-12 text-right tabular-nums">
                          {formatTime(typeof track.duration === 'object' ? track.duration?.seconds : track.duration)}
                        </span>
                      )}

                    </div>

                  </div>
                )
              })}
            </div>

            {/* Only shown when the window is shorter than the queue; scrolling
                near the bottom also extends it, so this is a manual shortcut. */}
            {filteredUpNext.length > renderLimit && (
              <button
                onClick={() => setRenderLimit(prev => prev + QUEUE_ROW_CHUNK)}
                className="w-full py-2.5 rounded-xl text-xs font-semibold text-white/50 hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] transition-colors cursor-pointer"
              >
                Show {Math.min(QUEUE_ROW_CHUNK, filteredUpNext.length - renderLimit)} more
                <span className="text-white/30 font-normal"> · {filteredUpNext.length - renderLimit} hidden</span>
              </button>
            )}
          </section>
        )}

        {/* ── 3. PREVIOUSLY PLAYED HISTORY (COLLAPSIBLE) ── */}
        {historyTracks.length > 0 && (
          <section className="space-y-3 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-white/40 hover:text-white transition-colors cursor-pointer"
              >
                <span>Previously Played ({historyTracks.length})</span>
                <svg viewBox="0 0 24 24" fill="currentColor" className={`w-3.5 h-3.5 transition-transform duration-200 ${showHistory ? 'rotate-180' : ''}`}>
                  <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                </svg>
              </button>
            </div>

            {showHistory && (
              <div className="space-y-1 animate-in fade-in">
                {historyTracks.slice(0, renderLimit).map((track) => (
                  <div
                    key={`hist-${track.originalIndex}-${track.id}`}
                    onDoubleClick={() => playTrackAt(track.originalIndex)}
                    className="group flex items-center justify-between px-3.5 py-2 rounded-xl opacity-60 hover:opacity-100 bg-white/[0.01] hover:bg-white/[0.05] transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="relative w-8 h-8 rounded-md overflow-hidden shrink-0 shadow-sm bg-white/5">
                        <img src={getSizedArtURL(track.albumArt || getArtURL(track.src), 'thumb')} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white/80 group-hover:text-white truncate">{track.title}</p>
                        <p className="text-[11px] text-white/40 truncate">{track.artist || 'Unknown'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); playTrackAt(track.originalIndex) }}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-semibold text-white/60 hover:text-white bg-white/5 hover:bg-white/15 transition-all"
                      >
                        Replay
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromQueue(track.id) }}
                        className="p-1 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from history"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  )
}

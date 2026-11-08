/**
 * HomeDashboard.jsx — Remastered Next-Gen Home Experience
 *
 * Inspired by: Apple Music, Spotify & YouTube Music
 * Art Style: Pure Floating Liquid Frosted Glass
 *
 * Layout:
 * 1. Top Header: Time-aware Greeting & Liquid Search Bar
 * 2. Quick Picks (Quick Play) on Top (Multi-Column Liquid Glass Grid with Play All & Shuffle)
 * 3. Trending Top 10 Today (Apple Music-style Ranked #1–#10 Shelf with Gradient Numerals)
 * 4. Heavy Rotation (Your Most Played Tracks on Glaze)
 * 5. Artists You Love (Spotify-style Circular Glowing Avatars + 1-Click Radio)
 * 6. Recommended For You (Algorithmic Online Discoveries)
 * 7. Your Playlists & Collections
 */

import { displayTitle } from '../utils/displayTitle'
import React, { useEffect, useState, useMemo, useRef } from 'react'
import { usePlayer, usePlaybackTime } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getArtURL, formatTime, getHighQualityArtURL, getSizedArtURL, onArtLoad } from '../utils'
import { isRTL, translateLyrics, buildTimedLines } from '../lyricsUtils'
import { useLyrics } from '../hooks/useLyrics'
import ClickableArtists from './ClickableArtists'
import ContextMenu from './ContextMenu'
import QuickAudioControls from './QuickAudioControls'
import FancyUsername from './FancyUsername'
import { generateDynamicPersonalizedMixes, getArtistArt, GLOBAL_ARTIST_AVATARS } from '../constants/curatedMixes'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

// ── Horizontal Carousel with smooth chevrons ──────────────────────────────────
function ShelfCarousel({ children, className = "" }) {
  const containerRef = useRef(null)
  const [showLeft, setShowLeft] = useState(false)
  const [showRight, setShowRight] = useState(true)

  const checkScroll = React.useCallback(() => {
    if (!containerRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = containerRef.current
    setShowLeft(scrollLeft > 10)
    setShowRight(scrollLeft < scrollWidth - clientWidth - 10)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    checkScroll()

    const timers = [50, 200, 500, 1200].map(d => setTimeout(checkScroll, d))

    // Same debounce as StreamingView's ShelfCarousel: a resize burst used to run
    // one forced layout + state write per observer callback, per shelf, per frame.
    let settle = 0
    const schedule = () => {
      clearTimeout(settle)
      settle = setTimeout(checkScroll, 120)
    }

    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(schedule)
      ro.observe(el)
    }

    el.addEventListener('scroll', checkScroll, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(settle)
      if (ro) ro.disconnect()
      el.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', schedule)
    }
  }, [children, checkScroll])

  const scroll = (direction) => {
    if (!containerRef.current) return
    const scrollAmount = containerRef.current.clientWidth * 0.75
    containerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth'
    })
    setTimeout(checkScroll, 350)
  }

  return (
    <div 
      className="relative group/carousel"
      onMouseEnter={checkScroll}
    >
      {/* Left Chevron */}
      {showLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-1 sm:left-2 inset-y-0 my-auto z-30 w-11 h-11 rounded-full lg-glass-btn text-white flex items-center justify-center cursor-pointer"
          title="Previous"
        >
          <svg className="w-5 h-5 -ml-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Right Chevron */}
      {showRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-1 sm:right-2 inset-y-0 my-auto z-30 w-11 h-11 rounded-full lg-glass-btn text-white flex items-center justify-center cursor-pointer"
          title="Next"
        >
          <svg className="w-5 h-5 ml-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Scroll Container */}
      <div ref={containerRef} className={`no-scrollbar ${className}`}>
        {children}
      </div>
    </div>
  )
}

// ── Helper to parse synced LRC lyrics ─────────────────────────────────────────
// ── TileLyrics Component for Embedded Cozy Lyrics on Hero Banner ───────────────
function TileLyrics({ track, accentColor, onClose }) {
  const { duration, seekTo, currentTrack, replaceQueue, isPlaying, audioElement } = usePlayer()
  // Position lives in its own context so the 4x/sec time updates don't re-render the app.
  const { currentTime } = usePlaybackTime()
  // Same hook the lyrics panel uses — one policy for every surface.
  const { lyrics, isLoading } = useLyrics(track)

  const containerRef = useRef(null)
  const activeLineRef = useRef(null)

  // ── Translation State ──
  const [isTranslationActive, setIsTranslationActive] = useState(() => localStorage.getItem('glaze_lyrics_translate_enabled') === 'true')
  const [targetLang, setTargetLang] = useState(() => localStorage.getItem('glaze_lyrics_lang') || 'ur')
  const [isTranslating, setIsTranslating] = useState(false)
  const [translatedLyrics, setTranslatedLyrics] = useState(null)

  const isCurrentTrackPlaying = currentTrack?.src === track?.src

  // Translation effect
  useEffect(() => {
    if (!isTranslationActive || !lyrics.data || lyrics.type === 'none') {
      setTranslatedLyrics(null)
      return
    }

    let active = true
    async function doTranslate() {
      setIsTranslating(true)
      try {
        const res = await translateLyrics(lyrics.data, targetLang)
        if (active && res) {
          setTranslatedLyrics(res)
        }
      } catch (err) {
        console.error('TileLyrics translation error:', err)
      } finally {
        if (active) setIsTranslating(false)
      }
    }

    doTranslate()
    return () => { active = false }
  }, [isTranslationActive, targetLang, lyrics])

  const displayLyrics = (isTranslationActive && translatedLyrics?.data) ? translatedLyrics : lyrics

  const timedLines = useMemo(() => buildTimedLines(displayLyrics.data), [displayLyrics])

  // Word-level clock. Same approach as the full lyrics page: the position context
  // ticks ~4x/sec, which is too coarse for a word to land on the beat, so read the
  // audio element on rAF and only commit state when the word actually changes.
  const [activeWord, setActiveWord] = useState({ line: -1, word: -1 })
  useEffect(() => {
    if (!isPlaying || !isCurrentTrackPlaying || !audioElement || timedLines.length === 0) return
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
  }, [isPlaying, isCurrentTrackPlaying, audioElement, timedLines])

  let activeIndex = -1
  if (displayLyrics.type === 'synced' && displayLyrics.data && isCurrentTrackPlaying) {
    for (let i = 0; i < displayLyrics.data.length; i++) {
      if (currentTime >= displayLyrics.data[i].time) {
        activeIndex = i
      } else {
        break
      }
    }
  }

  // Scroll on line change only — firing a smooth scroll on every position tick
  // made each one interrupt the last.
  useEffect(() => {
    if (displayLyrics.type !== 'synced' || !isCurrentTrackPlaying || activeIndex < 0) return
    const container = containerRef.current
    const line = activeLineRef.current
    if (!container || !line) return
    const target = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex, displayLyrics, isCurrentTrackPlaying])

  const handleLineClick = (time) => {
    if (isCurrentTrackPlaying && duration > 0) {
      const pct = (time / duration) * 100
      seekTo(pct)
    } else {
      replaceQueue([track], 0)
      setTimeout(() => {
        if (duration > 0) seekTo((time / duration) * 100)
      }, 400)
    }
  }

  return (
    <div className="flex-1 w-full max-w-full md:max-w-[480px] lg:max-w-[560px] h-[210px] sm:h-[230px] flex flex-col relative select-text">
      {/* Top Header: Badge & Translation Toggle */}
      <div className="flex items-center justify-between px-2 pt-1 pb-1.5 z-20">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[10.5px] font-extrabold uppercase tracking-widest text-white/50">Karaoke Lyrics</span>
        </div>
        {lyrics.data && lyrics.type !== 'none' && (
          <button
            onClick={() => {
              setIsTranslationActive(prev => {
                const next = !prev
                localStorage.setItem('glaze_lyrics_translate_enabled', String(next))
                return next
              })
            }}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
              isTranslationActive 
                ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]' 
                : 'text-white/40 hover:text-white border-white/10 hover:bg-white/10'
            }`}
            title={isTranslationActive ? 'Turn off translation' : 'Translate lyrics to Urdu'}
          >
            <span className="text-xs">🌐</span>
            <span>{isTranslating ? 'Translating...' : (isTranslationActive ? 'Urdu' : 'Translate')}</span>
          </button>
        )}
      </div>

      {/* Lyrics content with smooth gradient fade */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-y-auto no-scrollbar py-4 relative z-10"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)'
        }}
      >
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-white/40">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-xs font-medium">Loading lyrics...</p>
          </div>
        )}

        {!isLoading && displayLyrics.type === 'none' && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <p className="text-sm font-semibold text-white/50">{displayLyrics.data || 'Lyrics not available'}</p>
          </div>
        )}

        {!isLoading && displayLyrics.type === 'plain' && (
          <div 
            dir={isRTL(displayLyrics.data) ? 'rtl' : 'ltr'}
            style={{
              fontFamily: isRTL(displayLyrics.data) ? "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', Tahoma, sans-serif" : undefined
            }}
            className={`whitespace-pre-line text-sm sm:text-base font-semibold text-white/60 leading-relaxed px-2 py-1 ${
              isRTL(displayLyrics.data) ? 'text-right' : 'text-left'
            }`}
          >
            {displayLyrics.data}
          </div>
        )}

        {!isLoading && displayLyrics.type === 'synced' && timedLines.length > 0 && (
          <div className="flex flex-col gap-3.5 px-2 py-6">
            {timedLines.map((line, idx) => {
              const isActive = idx === activeIndex
              const isLineRTL = isRTL(line.content)
              const distance = activeIndex < 0 ? 99 : Math.abs(idx - activeIndex)
              const litWord = isActive && activeWord.line === idx ? activeWord.word : -1

              return (
                <div
                  key={idx}
                  ref={isActive ? activeLineRef : null}
                  dir={isLineRTL ? 'rtl' : 'ltr'}
                  onClick={() => handleLineClick(line.time)}
                  style={{
                    color: 'var(--color-white)',
                    fontFamily: isLineRTL ? "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', 'Urdu Typesetting', Tahoma, sans-serif" : undefined,
                    // Distance-based dimming instead of a binary passed/future
                    // split, so the eye follows the line that is actually being sung.
                    opacity: isActive ? 1 : distance === 1 ? 0.5 : 0.28,
                    transform: `scale(${isActive ? 1.03 : 1})`,
                    transition: 'opacity 450ms cubic-bezier(0.22,1,0.36,1), transform 450ms cubic-bezier(0.22,1,0.36,1)'
                  }}
                  className={`text-base sm:text-lg md:text-xl font-bold leading-snug py-1 cursor-pointer select-none transform-gpu ${
                    isLineRTL ? 'text-right origin-right' : 'text-left origin-left'
                  }`}
                >
                  {isActive && line.words.length > 0 ? (
                    line.words.map((w, wIdx) => {
                      const sung = wIdx <= litWord
                      return (
                        <span
                          key={wIdx}
                          className={`inline-block ${isLineRTL ? 'ml-[0.28em]' : 'mr-[0.28em]'}`}
                          style={{
                            // Brightness-only ramp, same as the lyrics page: the
                            // reference never resizes or reweights a word, so the
                            // line cannot reflow while it fills in.
                            color: sung ? 'var(--color-white)' : 'color-mix(in srgb, var(--color-white) 55%, transparent)',
                            textShadow: sung
                              ? '0 0 18px color-mix(in srgb, var(--color-white) 42%, transparent)'
                              : 'none',
                            transition: 'color 240ms ease-out, text-shadow 240ms ease-out'
                          }}
                        >
                          {w.text}
                        </span>
                      )
                    })
                  ) : (
                    <span>{line.content || '♪'}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// Memoised for the same reason as StreamingView — App re-renders on every
// sidebar toggle and transport change, and this view owns ~6 500 nodes.
function HomeDashboard({
  userProfile,
  libraryFiles = [],
  artCache = {},
  playlists = [],
  favourites,
  streamingFavourites,
  downloadFolder,
  onShowDownloadNotification,
  refreshDownloads,
  onAddToFavourites,
  onRemoveFromFavourites,
  onAddToPlaylist,
  onCreateAndAddToPlaylist,
  onOpenPlaylistModal,
  onOnlineSearch,
  onlineRecommendations = [],
  setOnlineRecommendations,
  quickPicks = [],
  setQuickPicks
}) {
  const safeOnlineRecs = Array.isArray(onlineRecommendations) ? onlineRecommendations : []
  const safeQuickPicks = Array.isArray(quickPicks) ? quickPicks : []
  const safeLibraryFiles = Array.isArray(libraryFiles) ? libraryFiles : []
  const safePlaylists = Array.isArray(playlists) ? playlists : []
  const online = useOnlineStatus()

  const [data, setData] = useState({ history: [], stats: {} })
  const [searchQuery, setSearchQuery] = useState('')
  const [trendingTracks, setTrendingTracks] = useState([])
  const [loadingMixId, setLoadingMixId] = useState(null)
  const [tileLyricsOpen, setTileLyricsOpen] = useState(() => {
    try {
      return localStorage.getItem('glaze_hero_tile_lyrics_open') === 'true'
    } catch {
      return false
    }
  })

  const {
    replaceQueue, addToQueue, playNext, currentTrack, isPlaying, togglePlayPause,
    accentColor = '#ef4444', startRadio
  } = usePlayer()

  const { followedArtists = [], isDownloaded = () => false } = useLibrary() || {}

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, track: null })

  const [artistArtMap, setArtistArtMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('glaze_artist_art_cache') || '{}')
    } catch { return {} }
  })

  // Load persistent SQLite artist art cache on mount
  useEffect(() => {
    if (window.electronAPI?.dbGetArtistArtCache) {
      window.electronAPI.dbGetArtistArtCache().then(dbMap => {
        if (dbMap && Object.keys(dbMap).length > 0) {
          setArtistArtMap(prev => {
            const merged = { ...prev, ...dbMap }
            try { localStorage.setItem('glaze_artist_art_cache', JSON.stringify(merged)) } catch (e) {}
            return merged
          })
        }
      }).catch(() => {})
    }
  }, [])

  // Dynamically generate personalized Daily Mixes, Hero Mixes, and Recommended Stations
  const { dailyMixes = [], heroMixes = [], recommendedStations = [], topArtists: mixArtists = [] } = useMemo(() => {
    return generateDynamicPersonalizedMixes(data.history, data.stats, safeLibraryFiles, favourites, artistArtMap, artCache) || {}
  }, [data.history, data.stats, safeLibraryFiles, favourites, artistArtMap, artCache])

  const handlePlayMixDirectly = async (mix, e) => {
    e?.stopPropagation()
    setLoadingMixId(mix.id)
    try {
      let tracks = []
      if (window.electronAPI?.youtubeGetExtendedCategory) {
        tracks = await window.electronAPI.youtubeGetExtendedCategory(mix.seedQuery || mix.title, 'song')
      }
      if (!tracks || tracks.length === 0) {
        if (window.electronAPI?.youtubeSearch) {
          const searchRes = await window.electronAPI.youtubeSearch(mix.seedQuery || mix.title, 'songs')
          tracks = searchRes.songs || []
        }
      }
      if (tracks && tracks.length > 0) {
        const mapped = tracks.map(song => ({
          id: song.videoId,
          title: song.title,
          artist: song.artist || song.author || 'Unknown',
          album: song.album || 'Glaze Music',
          duration: typeof song.duration === 'object' ? (song.duration?.seconds || 0) : (typeof song.duration === 'number' ? song.duration : 0),
          src: `yt:${song.videoId}`,
          albumArt: song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
          type: 'Song'
        }))
        replaceQueue(mapped, 0)
      }
    } catch (err) {
      console.error('Failed to play mix:', err)
    } finally {
      setLoadingMixId(null)
    }
  }

  const handleOpenMixDetails = (mix) => {
    window.dispatchEvent(new CustomEvent('open-online-playlist', {
      detail: {
        id: mix.id,
        videoId: mix.seedQuery || mix.title,
        title: mix.title,
        artist: mix.desc || mix.supportingArtists || mix.artist || 'Glaze Music',
        thumbnail: mix.coverArt,
        type: 'Playlist',
        isMix: true
      }
    }))
  }

  const renderDailyMixCard = (mix) => {
    const isLoading = loadingMixId === mix.id
    return (
      <div 
        key={mix.id}
        className="w-44 sm:w-48 shrink-0 group relative flex flex-col p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] hover:border-white/10 transition-all duration-300 cursor-pointer shadow-md"
        onClick={() => handleOpenMixDetails(mix)}
      >
        <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2.5 bg-neutral-900 shadow-lg border border-white/10">
          <img 
            src={mix.coverArt} 
            alt={mix.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.onerror = null
              e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80'
            }}
          />

          {/* Bottom-left Daily Mix Badge */}
          <div 
            className="absolute bottom-2 left-2 z-10 flex items-stretch rounded overflow-hidden shadow-xl"
            style={{ backgroundColor: mix.badgeBg }}
          >
            <span className="text-[11px] font-black uppercase tracking-tight text-black px-2 py-0.5 flex items-center">
              Daily Mix
            </span>
            <span className="bg-black text-[11px] font-black px-1.5 py-0.5 flex items-center" style={{ color: mix.badgeBg }}>
              {mix.mixNumber}
            </span>
          </div>

          {/* Hover Play Button */}
          <button
            onClick={(e) => handlePlayMixDirectly(mix, e)}
            className="absolute bottom-2 right-2 z-20 w-10 h-10 rounded-full bg-white text-black shadow-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer"
            title={`Play ${mix.title}`}
          >
            {isLoading ? (
              <svg className="animate-spin w-5 h-5 text-black" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
        </div>

        <div className="w-full min-w-0 px-0.5">
          <p className="text-xs text-white/50 line-clamp-2 leading-relaxed font-medium group-hover:text-white/80 transition-colors">
            {mix.desc}
          </p>
        </div>
      </div>
    )
  }

  const renderHeroMixCard = (mix) => {
    const isLoading = loadingMixId === mix.id
    return (
      <div 
        key={mix.id}
        className="on-media group relative aspect-[16/10] sm:aspect-[16/9] md:aspect-[4/3] lg:aspect-[16/10] rounded-2xl overflow-hidden cursor-pointer shadow-xl border border-white/10 hover:border-white/20 transition-all duration-300"
        onClick={() => handleOpenMixDetails(mix)}
      >
        <img 
          src={mix.coverArt} 
          alt={mix.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
            decoding="async"
          onError={(e) => {
            e.currentTarget.onerror = null
            e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=900&auto=format&fit=crop&q=80'
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20" />

        {/* Top-left Badge */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-black/60 backdrop-blur-md p-2 pr-4 rounded-xl border border-white/15 shadow-xl">
          <img 
            src={mix.miniArt} 
            alt="" 
            className="w-10 h-10 rounded-lg object-cover" 
            onError={(e) => {
              e.currentTarget.onerror = null
              e.currentTarget.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80'
            }}
          />
          <div>
            <h4 className="text-sm font-bold text-white leading-tight">{mix.badgeTitle}</h4>
            <p className="text-[11px] text-white/50">{mix.subtitle}</p>
          </div>
        </div>

        {/* Bottom Text */}
        <div className="absolute bottom-4 left-4 right-16 z-10">
          <p className="text-sm sm:text-base font-bold text-white drop-shadow-md">
            {mix.supportingArtists}
          </p>
        </div>

        {/* Hover Play Button */}
        <button
          onClick={(e) => handlePlayMixDirectly(mix, e)}
          className="absolute bottom-4 right-4 z-20 w-12 h-12 rounded-full bg-white text-black shadow-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer"
          title={`Play ${mix.title}`}
        >
          {isLoading ? (
            <svg className="animate-spin w-6 h-6 text-black" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          ) : (
            <svg className="w-6 h-6 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
      </div>
    )
  }

  const renderStationCard = (station) => {
    const isLoading = loadingMixId === station.id
    return (
      <div 
        key={station.id}
        className="w-44 sm:w-48 shrink-0 group relative flex flex-col p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] hover:border-white/10 transition-all duration-300 cursor-pointer shadow-md"
        onClick={() => handleOpenMixDetails(station)}
      >
        <div 
          className="relative w-full aspect-[4/3] rounded-xl overflow-hidden p-3 flex flex-col justify-between shadow-md mb-2 border border-white/10"
          style={{ backgroundColor: station.bg }}
        >
          {/* Top Header */}
          <div className="flex items-center justify-between z-10">
            <span className="text-[10px] font-black tracking-widest text-black/80 uppercase">
              GLAZE RADIO
            </span>
          </div>

          {/* Overlapping Artist Bubbles */}
          <div className="flex items-center justify-center my-auto py-1">
            <img 
              src={station.bubbles[0]} 
              alt="" 
              className="w-10 h-10 rounded-full object-cover border-2 border-white/60 shadow-md -mr-3 transform -rotate-6 group-hover:-translate-x-1 transition-transform" 
              onError={(e) => {
                e.currentTarget.onerror = null
                e.currentTarget.src = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80'
              }}
            />
            <img 
              src={station.bubbles[1]} 
              alt="" 
              className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-xl z-10 transform group-hover:scale-105 transition-transform" 
              onError={(e) => {
                e.currentTarget.onerror = null
                e.currentTarget.src = 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=300&auto=format&fit=crop&q=80'
              }}
            />
            <img 
              src={station.bubbles[2]} 
              alt="" 
              className="w-10 h-10 rounded-full object-cover border-2 border-white/60 shadow-md -ml-3 transform rotate-6 group-hover:translate-x-1 transition-transform" 
              onError={(e) => {
                e.currentTarget.onerror = null
                e.currentTarget.src = 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&auto=format&fit=crop&q=80'
              }}
            />
          </div>

          {/* Bottom Title on Card */}
          <div className="z-10 flex items-end justify-between">
            <h4 className="text-sm font-black text-black tracking-tight truncate leading-tight flex-1 mr-1">
              {station.title}
            </h4>
          </div>

          {/* Hover Play Button */}
          <button
            onClick={(e) => handlePlayMixDirectly(station, e)}
            className="absolute bottom-2.5 right-2.5 z-20 w-9 h-9 rounded-full bg-black text-white shadow-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer"
            title={`Play ${station.title} Radio`}
          >
            {isLoading ? (
              <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
        </div>

        <div className="w-full min-w-0 px-0.5">
          <p className="text-xs text-white/50 line-clamp-2 leading-relaxed font-medium group-hover:text-white/80 transition-colors">
            {station.desc}
          </p>
        </div>
      </div>
    )
  }

  // Header summary. A "Good evening, Shami" line said nothing the user did not
  // already know; these numbers come straight from the play stats and change as
  // they listen. `daily` is keyed by UTC date (db.cjs writes toISOString), so the
  // window is walked in UTC too or it drifts by a day near midnight.
  const [greeting, setGreeting] = useState('Welcome back')
  useEffect(() => {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) setGreeting('Good morning')
    else if (hour >= 12 && hour < 17) setGreeting('Good afternoon')
    else if (hour >= 17 && hour < 22) setGreeting('Good evening')
    else setGreeting('Good night')
  }, [])

  // Only the subline is data-driven now — the headline is the greeting again.
  const listeningSummary = useMemo(() => {
    const topArtist = data?.stats?.artists?.[0]?.artist || null
    const last = data?.history?.[0]
    return { topArtist, lastTitle: last?.title || null }
  }, [data])

  // Load listening history / stats from SQLite
  useEffect(() => {
    if (window.electronAPI?.dbGetAllStats) {
      window.electronAPI.dbGetAllStats().then(s => {
        if (s) setData(s)
      }).catch(() => {})
    }
  }, [currentTrack])

  const hasFetchedRef = useRef(false)

  // Fetch online recommendations & quick picks & trending (ONCE ONLY to prevent jumping/shuffling)
  useEffect(() => {
    if (hasFetchedRef.current) return
    // Offline: the shelves that need the network are skipped rather than left to
    // time out for 30 s, and the guard stays unset so a reconnect retries. The
    // local sections (history, heavy rotation, artists, playlists) render anyway.
    if (online === false) return
    if (onlineRecommendations?.length > 0 && quickPicks?.length > 0) {
      hasFetchedRef.current = true
      return
    }

    const fetchRecs = async () => {
      hasFetchedRef.current = true
      try {
        let historyIds = (data.history || [])
          .filter(t => t && t.src && t.src.startsWith('yt:'))
          .map(t => t.src.replace('yt:', ''))
          
        if (historyIds.length === 0) {
          historyIds = ['kJQP7kiw5Fk', 'JGwWNGJdvx8', 'fJ9rUzIMcZQ', 'OPf0YbXqDm0', 'k2qgadSvNyU', '3nQNiWdeH2Q']
        }

        if (window.electronAPI?.youtubeGetUpNextBatch) {
          const uniqueHistory = [...new Set(historyIds)]
          const seeds1 = uniqueHistory.slice(0, 3)
          const seeds2 = uniqueHistory.slice(3, 6).length > 0 ? uniqueHistory.slice(3, 6) : uniqueHistory.slice(0, 3)
          
          const [recs1, recs2] = await Promise.all([
            window.electronAPI.youtubeGetUpNextBatch(seeds1).catch(() => []),
            window.electronAPI.youtubeGetUpNextBatch(seeds2).catch(() => [])
          ])
          
          if (recs1 && recs1.length > 0) {
            const unique = recs1.filter((v, i, a) => a.findIndex(t => t.videoId === v.videoId) === i).slice(0, 20)
            setOnlineRecommendations(unique)
          }
          if (recs2 && recs2.length > 0) {
            const qp = recs2.filter((v, i, a) => a.findIndex(t => t.videoId === v.videoId) === i).slice(0, 16)
            setQuickPicks(qp)
          }
        }

        // Fetch Trending Hits once
        if (window.electronAPI?.youtubeSearch) {
          const res = await window.electronAPI.youtubeSearch('Top Global Hits 2026', 'songs').catch(() => null)
          if (res?.songs?.length > 0) {
            setTrendingTracks(res.songs.slice(0, 10))
          }
        }
      } catch (e) {
        console.error('Failed to load online recommendations', e)
      }
    }
    fetchRecs()
    // Re-runs only when connectivity changes — `online` is the one input that can
    // turn a skipped (offline) run into a real one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // ── Quick Picks Tracks (Liquid Glass Grid) ──────────────────────────────────
  const quickPicksTracks = useMemo(() => {
    if (quickPicks && quickPicks.length > 0) {
      return quickPicks
        .filter(qp => qp && (qp.videoId || qp.src) && qp.type !== 'Artist' && qp.type !== 'Playlist')
        .map(qp => {
          const vId = qp.videoId || (qp.src?.startsWith('yt:') ? qp.src.replace('yt:', '') : qp.id)
          return {
            src: `yt:${vId}`,
            videoId: vId,
            title: qp.title || 'Unknown Title',
            artist: qp.artist || 'Artist',
            art: qp.thumbnail || qp.albumArt,
            albumArt: qp.thumbnail || qp.albumArt,
            duration: typeof qp.duration === 'object' ? qp.duration?.seconds : (qp.duration || 0)
          }
        })
    }

    const historyArray = Array.isArray(data.history) ? data.history : []
    const seen = new Set()
    const list = []

    for (const h of historyArray) {
      if (!h || !h.src || seen.has(h.src)) continue
      seen.add(h.src)
      const meta = artCache?.[h.src] || h
      let art = meta.albumArt || h.albumArt
      if (!art && !h.src.startsWith('yt:')) art = getArtURL(h.src)
      
      let title = meta.title || h.title
      if (!title || title === h.src) {
        if (!h.src.startsWith('yt:')) title = h.src.split(/[/\\]/).pop()
      }
      if (title && !title.startsWith('yt:')) {
        list.push({
          src: h.src,
          title,
          artist: meta.artist || h.artist || 'Unknown Artist',
          art: art || null,
          albumArt: art || null,
          duration: h.duration || 0
        })
      }
      if (list.length >= 12) break
    }

    if (list.length < 12 && libraryFiles.length > 0) {
      for (const f of libraryFiles) {
        if (seen.has(f)) continue
        seen.add(f)
        const meta = artCache?.[f] || {}
        const art = meta.albumArt || getArtURL(f)
        list.push({
          src: f,
          title: meta.title || f.split(/[/\\]/).pop(),
          artist: meta.artist || 'Local Artist',
          art: art || null,
          albumArt: art || null,
          duration: 0
        })
        if (list.length >= 12) break
      }
    }

    return list
  }, [quickPicks, data.history, artCache, libraryFiles])

  // ── Hero Section Data: Continue Listening (or Welcome / Featured Starter for First-Time Users) ──
  const heroData = useMemo(() => {
    const historyArray = Array.isArray(data.history) ? data.history : []
    
    // 1. If there's an active or loaded track in player
    if (currentTrack?.src) {
      return {
        track: currentTrack,
        isFirstTime: false,
        type: 'current',
        title: currentTrack.title || 'Current Track',
        artist: currentTrack.artist || 'Unknown Artist',
        art: currentTrack.albumArt || getArtURL(currentTrack.src),
        src: currentTrack.src
      }
    }

    // 2. Most recent track from listening history
    if (historyArray.length > 0) {
      const h = historyArray[0]
      const meta = artCache?.[h.src] || h
      let art = meta.albumArt || h.albumArt
      if (!art && !h.src.startsWith('yt:')) art = getArtURL(h.src)
      let title = meta.title || h.title || (!h.src.startsWith('yt:') ? h.src.split(/[/\\]/).pop() : 'Previous Track')
      return {
        track: {
          src: h.src,
          title,
          artist: meta.artist || h.artist || 'Unknown Artist',
          albumArt: art,
          duration: h.duration || 0
        },
        isFirstTime: false,
        type: 'history',
        title,
        artist: meta.artist || h.artist || 'Unknown Artist',
        art: art,
        src: h.src
      }
    }

    // 3. Fallback to first track from local library if available
    if (libraryFiles.length > 0) {
      const f = libraryFiles[0]
      const meta = artCache?.[f] || {}
      const art = meta.albumArt || getArtURL(f)
      const title = meta.title || f.split(/[/\\]/).pop()
      return {
        track: {
          src: f,
          title,
          artist: meta.artist || 'Local Artist',
          albumArt: art,
          duration: 0
        },
        isFirstTime: false,
        type: 'library',
        title,
        artist: meta.artist || 'Local Artist',
        art: art,
        src: f
      }
    }

    // 4. First-time user: Featured trending hit or fresh recommendation
    const featured = (trendingTracks && trendingTracks.length > 0) 
      ? trendingTracks[0] 
      : ((onlineRecommendations && onlineRecommendations.length > 0) ? onlineRecommendations[0] : null)

    if (featured) {
      const videoId = featured.videoId || (featured.src?.startsWith('yt:') ? featured.src.replace('yt:', '') : null)
      return {
        track: {
          src: `yt:${videoId}`,
          title: featured.title || 'Top Global Hits 2026',
          artist: featured.artist || 'Curated by Glaze',
          albumArt: featured.thumbnail || featured.art || featured.albumArt,
          duration: featured.duration || 0
        },
        isFirstTime: true,
        type: 'featured',
        title: featured.title || 'Top Global Hits 2026',
        artist: featured.artist || 'Curated by Glaze',
        art: featured.thumbnail || featured.art || featured.albumArt,
        src: `yt:${videoId}`
      }
    }

    // 5. Default curated fallback starter
    return {
      track: {
        src: 'yt:kJQP7kiw5Fk',
        title: 'Despacito & Global Pop Hits',
        artist: 'Glaze Featured Mix',
        albumArt: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hq720.jpg',
        duration: 230
      },
      isFirstTime: true,
      type: 'featured',
      title: 'Welcome to Glaze Music',
      artist: 'Discover Millions of Songs',
      art: 'https://i.ytimg.com/vi/kJQP7kiw5Fk/hq720.jpg',
      src: 'yt:kJQP7kiw5Fk'
    }
  }, [currentTrack, data.history, artCache, libraryFiles, trendingTracks, onlineRecommendations])

  // Mini companion list for recent tracks
  const recentCompanionTracks = useMemo(() => {
    const historyArray = Array.isArray(data.history) ? data.history : []
    const seen = new Set()
    if (heroData?.src) seen.add(heroData.src)
    const list = []

    for (const h of historyArray) {
      if (!h || !h.src || seen.has(h.src)) continue
      seen.add(h.src)
      const meta = artCache?.[h.src] || h
      let art = meta.albumArt || h.albumArt || h.thumbnail
      if (!art) {
        if (h.src.startsWith('yt:')) {
          const vid = h.src.replace('yt:', '')
          art = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
        } else {
          art = getArtURL(h.src)
        }
      }
      let title = meta.title || h.title || (!h.src.startsWith('yt:') ? h.src.split(/[/\\]/).pop() : null)
      if (title && !title.startsWith('yt:')) {
        list.push({
          src: h.src,
          title,
          artist: meta.artist || h.artist || 'Unknown Artist',
          art: art || null,
          albumArt: art || null,
          duration: h.duration || 0
        })
      }
      if (list.length >= 3) break
    }
    return list
  }, [data.history, heroData, artCache])

  // ── Heavy Rotation ────────────────────────────────────────────────────────
  const heavyRotation = useMemo(() => {
    const historyArray = Array.isArray(data.history) ? data.history : []
    const sortedSrcs = Object.entries(data.stats || {}).sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0])
    
    return sortedSrcs
      .map(src => {
        const inHistory = historyArray.find(h => h.src === src)
        let art = artCache?.[src]?.albumArt || inHistory?.albumArt || inHistory?.thumbnail
        if (!art || art.includes('i.scdn.co')) {
          if (src.startsWith('yt:')) {
            const vid = src.replace('yt:', '')
            art = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
          } else {
            art = getArtURL(src)
          }
        }
        
        let title = artCache?.[src]?.title || inHistory?.title
        let artist = artCache?.[src]?.artist || inHistory?.artist
        
        if (!title || title === src || title.startsWith('yt:')) {
          title = inHistory?.title || (src.startsWith('yt:') ? null : src.split(/[/\\]/).pop())
        }
        if (!artist || artist === 'Unknown Artist') {
          artist = inHistory?.artist || (title ? 'Glaze Music' : null)
        }
        const plays = data.stats[src] || 0
        return { src, title, artist, art, plays, albumArt: art }
      })
      .filter(item => item.title && !item.title.startsWith('yt:') && item.title !== 'Online Stream' && item.artist && item.artist !== 'Unknown Artist')
      .slice(0, 12)
  }, [data.stats, artCache, data.history])

  // ── Top Artists (With real artwork & new user fallback) ─────────────────────
  const topArtists = useMemo(() => {
    const artistMap = new Map()
    const historyArray = Array.isArray(data.history) ? data.history : []

    // 0. Prioritize followed artists
    for (const f of (followedArtists || [])) {
      if (f?.name && f.name.trim()) {
        const name = f.name.trim()
        let img = artistArtMap[name] || artistArtMap[name.toLowerCase()] || GLOBAL_ARTIST_AVATARS[name.toLowerCase()]
        if (!img) {
          if (f.thumbnail && !f.thumbnail.includes('i.scdn.co') && !f.thumbnail.includes('default.jpg')) {
            img = f.thumbnail
          } else if (f.headerImage && !f.headerImage.includes('i.scdn.co') && !f.headerImage.includes('default.jpg')) {
            img = f.headerImage
          }
        }
        if (!img) {
          img = getArtistArt(name, historyArray, artCache, artistArtMap)
        }
        artistMap.set(name, {
          name,
          count: 1000,
          image: img || null,
          isFollowed: true
        })
      }
    }

    // 1. Collect artist and their track thumbnail from history
    for (const h of historyArray) {
      if (h.artist && h.artist !== 'Unknown Artist' && h.artist !== 'Local Artist') {
        const primaryArtist = h.artist.split(/[,&/]/)[0].trim()
        if (!artistMap.has(primaryArtist)) {
          let art = getArtistArt(primaryArtist, historyArray, artCache, artistArtMap)
          if (!art) {
            let candidate = artCache?.[h.src]?.albumArt || h.albumArt || h.thumbnail
            if (candidate && !candidate.includes('i.scdn.co')) art = candidate
            else if (!art && !h.src.startsWith('yt:')) art = getArtURL(h.src)
            else if (!art && h.src.startsWith('yt:')) art = `https://i.ytimg.com/vi/${h.src.replace('yt:', '')}/hqdefault.jpg`
          }
          artistMap.set(primaryArtist, {
            name: primaryArtist,
            count: 1,
            image: art || null,
            isFollowed: false
          })
        } else {
          const prev = artistMap.get(primaryArtist)
          prev.count += 1
          if (!prev.image || prev.image.includes('i.scdn.co')) {
            let art = getArtistArt(primaryArtist, historyArray, artCache, artistArtMap)
            if (art) prev.image = art
          }
        }
      }
    }

    // 2. Enrich missing images from online recommendations
    for (const rec of onlineRecommendations || []) {
      if (rec.artist) {
        const primary = rec.artist.split(/[,&/]/)[0].trim()
        if (artistMap.has(primary) && (!artistMap.get(primary).image || artistMap.get(primary).image.includes('i.scdn.co'))) {
          artistMap.get(primary).image = rec.thumbnail || rec.albumArt || rec.art || getArtistArt(primary, historyArray, artCache, artistArtMap)
        }
      }
    }

    const sorted = Array.from(artistMap.values())
      .map(a => {
        if (!a.image || a.image.includes('i.scdn.co')) {
          a.image = getArtistArt(a.name, historyArray, artCache, artistArtMap)
        }
        return a
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 14)

    // 3. Fallback for new users (0 history and 0 followed) with verified global artist artwork
    if (sorted.length === 0) {
      return [
        { name: 'The Weeknd', image: 'https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg' },
        { name: 'Taylor Swift', image: 'https://i.ytimg.com/vi/e-ORhEE9VVg/hqdefault.jpg' },
        { name: 'Ed Sheeran', image: 'https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg' },
        { name: 'Dua Lipa', image: 'https://i.ytimg.com/vi/TUVcZfQe-Kw/hqdefault.jpg' },
        { name: 'Drake', image: 'https://i.ytimg.com/vi/uxpDa-c-4Mc/hqdefault.jpg' },
        { name: 'Travis Scott', image: 'https://i.ytimg.com/vi/6ONRf7h3Mdk/hqdefault.jpg' },
        { name: 'Billie Eilish', image: 'https://i.ytimg.com/vi/HUHC9tYz8ik/hqdefault.jpg' },
        { name: 'Eminem', image: 'https://i.ytimg.com/vi/_Yhyp-_hX2s/hqdefault.jpg' },
        { name: 'Coldplay', image: 'https://i.ytimg.com/vi/1G4isv_Fylg/hqdefault.jpg' },
        { name: 'Post Malone', image: 'https://i.ytimg.com/vi/UYwF-jdcVjY/hqdefault.jpg' },
        { name: 'Bruno Mars', image: 'https://i.ytimg.com/vi/OPf0YbXqDm0/hqdefault.jpg' },
        { name: 'Shakira', image: 'https://i.ytimg.com/vi/pRpeEdMmmQ0/hqdefault.jpg' }
      ]
    }

    return sorted
  }, [followedArtists, data.history, artCache, onlineRecommendations, artistArtMap])

  // Non-blocking background fetcher for real artist photos from YouTube Music
  useEffect(() => {
    if (!window.electronAPI?.youtubeSearch) return

    // Collect all artist names that need real Google/YouTube CDN avatars
    const allArtists = new Set()
    for (const a of (topArtists || [])) {
      const name = typeof a === 'string' ? a : a?.name
      if (name) allArtists.add(name)
    }
    for (const f of (followedArtists || [])) {
      const name = typeof f === 'string' ? f : f?.name
      if (name) allArtists.add(name)
    }
    for (const m of (mixArtists || [])) {
      if (m) allArtists.add(m)
    }

    const missing = Array.from(allArtists).filter(name => {
      const cached = artistArtMap[name] || artistArtMap[name.toLowerCase()]
      return !cached
    })

    if (missing.length === 0) return

    let isMounted = true
    const fetchMissingArtists = async () => {
      const updates = {}
      for (const artistName of missing.slice(0, 20)) {
        try {
          // 1. Try artist search
          const res = await window.electronAPI.youtubeSearch(artistName, 'artists')
          let thumb = res?.artists?.[0]?.thumbnail || (res?.topResult?.type === 'Artist' ? res.topResult.thumbnail : null)
          
          // 2. If no artist thumbnail, search for artist's top official song to get real artwork
          if (!thumb) {
            const songRes = await window.electronAPI.youtubeSearch(artistName + ' official', 'songs')
            thumb = songRes?.songs?.[0]?.thumbnail || songRes?.topResult?.thumbnail
          }

          if (thumb && !thumb.includes('i.scdn.co')) {
            updates[artistName] = thumb
            updates[artistName.toLowerCase()] = thumb
          }
        } catch (e) {}
      }

      if (isMounted && Object.keys(updates).length > 0) {
        setArtistArtMap(prev => {
          const merged = { ...prev, ...updates }
          try { localStorage.setItem('glaze_artist_art_cache', JSON.stringify(merged)) } catch (e) {}
          return merged
        })
        // Save to SQLite database persistently so it never has to be fetched again
        if (window.electronAPI?.dbSaveBulkArtistArtCache) {
          window.electronAPI.dbSaveBulkArtistArtCache(updates)
        }
      }
    }

    fetchMissingArtists()
    return () => { isMounted = false }
  }, [mixArtists, topArtists, followedArtists])

  // ── Quick Local Search Filter ──────────────────────────────────────────────
  const filteredLocalResults = useMemo(() => {
    if (!searchQuery.trim() || !libraryFiles.length) return []
    const q = searchQuery.toLowerCase()
    return libraryFiles
      .filter(src => {
        const meta = artCache?.[src] || {}
        const title = (meta.title || src.split(/[/\\]/).pop() || '').toLowerCase()
        const artist = (meta.artist || '').toLowerCase()
        return title.includes(q) || artist.includes(q)
      })
      .slice(0, 6)
      .map(src => {
        const meta = artCache?.[src] || {}
        return {
          src,
          title: meta.title || src.split(/[/\\]/).pop(),
          artist: meta.artist || 'Local Artist',
          art: meta.albumArt || getArtURL(src)
        }
      })
  }, [searchQuery, libraryFiles, artCache])

  // ── Play Handler ───────────────────────────────────────────────────────────
  const playTrackItem = (itemOrSrc) => {
    if (!itemOrSrc) return
    const videoId = typeof itemOrSrc === 'object' ? (itemOrSrc.videoId || (itemOrSrc.src?.startsWith('yt:') ? itemOrSrc.src.replace('yt:', '') : null)) : null
    const src = typeof itemOrSrc === 'string' ? itemOrSrc : (itemOrSrc.src || (videoId ? `yt:${videoId}` : ''))
    if (!src) return

    const fileIndex = libraryFiles.findIndex(f => f === src)
    if (fileIndex !== -1) {
      replaceQueue(libraryFiles, fileIndex)
    } else {
      const track = {
        id: src,
        src: src,
        videoId: videoId,
        title: itemOrSrc.title || (typeof itemOrSrc === 'string' ? itemOrSrc.split(/[/\\]/).pop() : 'Unknown'),
        artist: itemOrSrc.artist || 'Unknown Artist',
        album: itemOrSrc.album || null,
        duration: typeof itemOrSrc.duration === 'number' ? itemOrSrc.duration : (parseInt(itemOrSrc.duration, 10) || 0),
        albumArt: itemOrSrc.art || itemOrSrc.albumArt || itemOrSrc.thumbnail || null,
        isLocal: !src.startsWith('yt:') && !src.startsWith('http')
      }
      replaceQueue([track], 0)
    }
  }

  const playAllQuickPicks = (shuffle = false) => {
    if (!quickPicksTracks || quickPicksTracks.length === 0) return
    const formatted = quickPicksTracks.map(t => {
      const videoId = t.videoId || (t.src?.startsWith('yt:') ? t.src.replace('yt:', '') : null)
      const src = t.src || (videoId ? `yt:${videoId}` : '')
      return {
        id: src || `${Date.now()}-${Math.random()}`,
        src: src,
        videoId: videoId,
        title: t.title || 'Unknown Title',
        artist: t.artist || 'Unknown Artist',
        albumArt: t.art || t.albumArt || t.thumbnail,
        duration: t.duration || 0,
        isLocal: !src.startsWith('yt:') && !src.startsWith('http')
      }
    })
    let queueToPlay = [...formatted]
    if (shuffle) {
      queueToPlay.sort(() => 0.5 - Math.random())
    }
    replaceQueue(queueToPlay, 0)
  }

  const [isRefreshingQuickPicks, setIsRefreshingQuickPicks] = useState(false)

  const handleRefreshQuickPicks = async () => {
    if (isRefreshingQuickPicks) return
    setIsRefreshingQuickPicks(true)
    try {
      let historyIds = (data.history || [])
        .filter(t => t && t.src && t.src.startsWith('yt:'))
        .map(t => t.src.replace('yt:', ''))
      
      const fallbackSeeds = [
        'kJQP7kiw5Fk', 'JGwWNGJdvx8', 'fJ9rUzIMcZQ', 'OPf0YbXqDm0',
        'k2qgadSvNyU', '3nQNiWdeH2Q', '4NRXx6U8ABQ', 'kXYiU_JCYtU',
        '9bZkp7q19f0', 'L_XJ_s5IsQc', 'YQHsXMglC9A', '0VwhorQ44ak',
        'fRh_vgS2dFE', '7wtfhZwyrcc', 'RgKAFK5djSk', 'hT_nvWreIhg'
      ]

      // Pick random seeds from history + trending fallback
      const allPossible = historyIds.length > 0 ? [...new Set([...historyIds, ...fallbackSeeds])] : fallbackSeeds
      const shuffledSeeds = [...allPossible].sort(() => 0.5 - Math.random()).slice(0, 3)

      if (window.electronAPI?.youtubeGetUpNextBatch) {
        const freshRecs = await window.electronAPI.youtubeGetUpNextBatch(shuffledSeeds).catch(() => [])
        if (freshRecs && freshRecs.length > 0) {
          const unique = freshRecs
            .filter((v, i, a) => a.findIndex(t => t.videoId === v.videoId) === i)
            .sort(() => 0.5 - Math.random())
            .slice(0, 16)
          setQuickPicks?.(unique)
        }
      }
    } catch (err) {
      console.error('Failed to refresh quick picks', err)
    } finally {
      setTimeout(() => setIsRefreshingQuickPicks(false), 500)
    }
  }

  // Handle Context Menu
  const openContextMenu = (e, track) => {
    e.preventDefault()
    e.stopPropagation()
    let x = e.clientX
    let y = e.clientY
    if (x + 220 > window.innerWidth) x = window.innerWidth - 230
    if (y + 180 > window.innerHeight) y = window.innerHeight - 190
    setContextMenu({ visible: true, x, y, track })
  }

  return (
    <div className="h-full w-full overflow-y-auto px-4 md:px-8 pt-2 pb-32 text-white custom-scrollbar relative z-10 select-none">
      
      {/* ── 1. Top Bar: Greeting, 8D Audio & EQ, & Search ──────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pt-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
            {greeting}
          </h1>
          <p className="text-xs text-white/40 mt-0.5 truncate">
            {listeningSummary.topArtist ? (
              <>Top artist <span className="font-semibold text-white/70">{listeningSummary.topArtist}</span></>
            ) : listeningSummary.lastTitle ? (
              <>Last played <span className="font-semibold text-white/70">{displayTitle(listeningSummary.lastTitle)}</span></>
            ) : (
              'Start a session from Quick Picks below'
            )}
            {listeningSummary.topArtist && listeningSummary.lastTitle ? (
              <> · Last played <span className="text-white/70">{displayTitle(listeningSummary.lastTitle)}</span></>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto flex-wrap sm:flex-nowrap justify-between md:justify-end">
          {/* Quick 8D Audio & Equalizer Controls */}
          <QuickAudioControls />

          {/* Liquid Frosted Search Input */}
          <div className="relative w-full sm:w-72 lg:w-80">
            <div className="flex items-center px-3.5 py-2 rounded-full bg-white/[0.04] border border-white/[0.08] backdrop-blur-2xl focus-within:bg-white/[0.08] focus-within:border-white/20 transition-all shadow-lg">
              <svg className="w-4 h-4 text-white/40 shrink-0 mr-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    onOnlineSearch?.(searchQuery.trim())
                  }
                }}
                placeholder="Search your library…"
                title="Type to search your library. Press Enter to search online."
                className="w-full bg-transparent border-none outline-none text-xs text-white placeholder-white/30"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Search Dropdown Results */}
            {filteredLocalResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 p-2 rounded-2xl bg-[var(--surface-1)]/95 border border-white/10 shadow-2xl backdrop-blur-3xl z-50 animate-in fade-in zoom-in-95 duration-150">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 px-2 py-1">Local Matches</p>
              <div className="space-y-1">
                {filteredLocalResults.map((res, i) => (
                  <div
                    key={i}
                    onClick={() => { playTrackItem(res); setSearchQuery('') }}
                    className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/10 cursor-pointer transition-colors"
                  >
                    <img src={getSizedArtURL(res.art || getArtURL(res.src), 'card')} alt="" className="w-8 h-8 rounded-lg object-cover bg-white/5 shrink-0" loading="lazy" decoding="async" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{res.title}</p>
                      <p className="text-[10px] text-white/50 truncate">{res.artist}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { onOnlineSearch?.(searchQuery.trim()); setSearchQuery('') }}
                className="w-full mt-1.5 py-1.5 text-center text-xs font-bold rounded-xl transition-colors cursor-pointer"
                style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 14.5%, transparent)`, color: accentColor }}
              >
                Search online for "{searchQuery}" →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>

      {/* ── 2. HERO: Continue Listening / Jump Back In (Hero Showcase) ── */}
      {heroData && (
        <section className="mb-9">
          <div 
            className="relative overflow-hidden rounded-3xl p-5 sm:p-7 md:p-8 border border-white/12 shadow-2xl transition-all duration-300 group/hero backdrop-blur-3xl"
            style={{
              background: 'linear-gradient(135deg, rgba(var(--ink-rgb),0.06) 0%, color-mix(in srgb, var(--app-bg) 62%, transparent) 100%)',
              boxShadow: '0 20px 50px -15px rgba(0,0,0,0.5), inset 0 1px 1px rgba(var(--ink-rgb),0.15)'
            }}
          >
            {/* Ambient Blurred Glow from Album Cover */}
            <div 
              className="absolute -top-1/2 -left-1/4 w-[150%] h-[200%] pointer-events-none filter blur-[90px] saturate-200 transition-all duration-1000"
              style={{
                opacity: 'calc(var(--backdrop-opacity) * 0.9)',
                backgroundImage: `url(${getHighQualityArtURL(heroData.art)})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--app-bg) 55%, transparent), transparent)' }}
            />

            {/* Content Container */}
            <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-8">
              
              {/* Left Side: Large Album Art + Info + Play Controls */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6 min-w-0 flex-1">
                
                {/* Prominent Large Album Art */}
                <div 
                  onClick={() => playTrackItem(heroData.track)}
                  className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 rounded-2xl sm:rounded-3xl overflow-hidden shrink-0 relative shadow-2xl border border-white/20 group/art cursor-pointer"
                  style={{
                    boxShadow: `0 20px 40px -10px rgba(0,0,0,0.8), 0 0 35px color-mix(in srgb, ${accentColor} 18.8%, transparent)`
                  }}
                  title="Click to Play"
                >
                  <img 
                    src={getHighQualityArtURL(heroData.art)} 
                    onLoad={onArtLoad}
                    alt="" 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover/art:scale-105"
                    onError={(e) => { e.target.style.opacity = '0.6' }}
                  />
                  
                  {/* Hover Play Button Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/art:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-2xl transform scale-90 group-hover/art:scale-100 transition-transform">
                      {currentTrack?.src === heroData.src && isPlaying ? (
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                      ) : (
                        <svg className="w-6 h-6 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                      )}
                    </div>
                  </div>
                </div>

                {/* Track Details & Actions */}
                <div className="flex-1 min-w-0 pr-2">
                  
                  {/* Badge */}
                  <div className="mb-2.5">
                    {heroData.isFirstTime ? (
                      <span 
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10.5px] font-extrabold uppercase tracking-widest border border-white/20 text-white shadow-sm"
                        style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 20.8%, transparent)` }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accentColor, boxShadow: `0 0 6px ${accentColor}` }} />
                        FEATURED DISCOVERY • WELCOME
                      </span>
                    ) : (
                      <span 
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10.5px] font-extrabold uppercase tracking-widest border border-white/20 text-white/90 shadow-sm"
                        style={{ backgroundColor: 'rgba(var(--ink-rgb),0.1)' }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accentColor, boxShadow: `0 0 6px ${accentColor}` }} />
                        {currentTrack?.src === heroData.src && isPlaying ? 'NOW PLAYING' : 'CONTINUE LISTENING'}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h2 
                    onClick={() => playTrackItem(heroData.track)}
                    className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight truncate leading-tight cursor-pointer hover:underline"
                    title={heroData.title}
                  >
                    {displayTitle(heroData.title)}
                  </h2>

                  {/* Artist */}
                  <p className="text-sm sm:text-base md:text-lg text-white/70 font-medium mt-1 truncate">
                    <ClickableArtists artistString={heroData.artist} />
                  </p>

                  {/* Description / First-time quick starter tags */}
                  {heroData.isFirstTime ? (
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <span className="text-xs text-white/50">Start exploring:</span>
                      <button 
                        onClick={() => onOnlineSearch?.('Top Trending Hits 2026')}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer border border-white/10"
                      >
                        🔥 Top Trending
                      </button>
                      <button 
                        onClick={() => onOnlineSearch?.('Chill Lofi Beats')}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer border border-white/10"
                      >
                        🎧 Lo-Fi Chill
                      </button>
                      <button 
                        onClick={() => onOnlineSearch?.('Synthwave Cyberpunk')}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer border border-white/10"
                      >
                        ⚡ Synthwave
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-white/40 mt-1.5">
                      Pick up right where you left off with your favorite tracks and queue.
                    </p>
                  )}

                  {/* Controls Row */}
                  <div className="flex flex-wrap items-center gap-3 mt-5">
                    
                    {/* Large Primary Play / Resume Button */}
                    <button
                      onClick={() => {
                        if (currentTrack?.src === heroData.src && isPlaying) {
                          togglePlayPause()
                        } else {
                          playTrackItem(heroData.track)
                        }
                      }}
                      className="h-12 sm:h-13 px-6 sm:px-7 rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2.5 shadow-2xl font-bold text-sm sm:text-base cursor-pointer"
                      style={{
                        boxShadow: `0 10px 25px -5px rgba(var(--ink-rgb),0.4), 0 0 20px color-mix(in srgb, ${accentColor} 25.1%, transparent)`
                      }}
                    >
                      {currentTrack?.src === heroData.src && isPlaying ? (
                        <>
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                          <span>{currentTrack?.src === heroData.src ? 'Resume' : 'Play Now'}</span>
                        </>
                      )}
                    </button>

                    {/* Favourite / Heart Button */}
                    <button
                      onClick={() => {
                        const isFav = favourites?.has(heroData.src) || streamingFavourites?.some(t => t.src === heroData.src)
                        if (isFav) onRemoveFromFavourites?.(heroData.src)
                        else onAddToFavourites?.(heroData.src)
                      }}
                      className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex items-center justify-center border border-white/15 backdrop-blur-xl cursor-pointer active:scale-95 hover:scale-105"
                    >
                      <svg 
                        viewBox="0 0 24 24" 
                        fill={favourites?.has(heroData.src) || streamingFavourites?.some(t => t.src === heroData.src) ? accentColor : 'none'} 
                        stroke={favourites?.has(heroData.src) || streamingFavourites?.some(t => t.src === heroData.src) ? accentColor : 'currentColor'} 
                        strokeWidth={2} 
                        className="w-5 h-5"
                      >
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                    </button>

                    {/* Add to Playlist Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (onOpenPlaylistModal) onOpenPlaylistModal(heroData.track)
                        else openContextMenu(e, heroData.track)
                      }}
                      className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex items-center justify-center border border-white/15 backdrop-blur-xl cursor-pointer active:scale-95 hover:scale-105"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/>
                      </svg>
                    </button>

                    {/* LYRICS Button (Written text toggle) */}
                    <button
                      onClick={() => {
                        setTileLyricsOpen(prev => {
                          const next = !prev
                          try { localStorage.setItem('glaze_hero_tile_lyrics_open', next.toString()) } catch {}
                          return next
                        })
                      }}
                      className={`h-12 px-5 rounded-full font-black text-xs tracking-widest uppercase transition-all duration-300 flex items-center justify-center gap-2 border cursor-pointer active:scale-95 hover:scale-105 ${
                        tileLyricsOpen
                          ? 'bg-white text-black border-white shadow-[0_0_25px_rgba(var(--ink-rgb),0.4)]'
                          : 'bg-white/10 hover:bg-white/20 text-white/90 hover:text-white border-white/15 backdrop-blur-xl'
                      }`}
                    >
                      <span>LYRICS</span>
                    </button>

                  </div>

                </div>

              </div>

              {/* Middle / Right: Embedded Cozy Lyrics on Tile OR Recent Sessions */}
              {tileLyricsOpen ? (
                <div className="w-full lg:flex-1 shrink-0 flex items-center justify-center lg:justify-end pl-0 lg:pl-6">
                  <TileLyrics
                    track={currentTrack?.src ? currentTrack : heroData.track}
                    accentColor={accentColor}
                    onClose={() => {
                      setTileLyricsOpen(false)
                      try { localStorage.setItem('glaze_hero_tile_lyrics_open', 'false') } catch {}
                    }}
                  />
                </div>
              ) : (
                /* Right Side: Recent Session Quick Mini-List (Desktop XL) */
                recentCompanionTracks.length > 0 && !heroData.isFirstTime && (
                  <div className="hidden xl:flex flex-col gap-2 w-72 shrink-0 border-l border-white/10 pl-6">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">Recent Sessions</p>
                    {recentCompanionTracks.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => playTrackItem(item)}
                        className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer group/mini"
                      >
                        <img 
                          src={getSizedArtURL(item.art || getArtURL(item.src), 'card')} 
                          alt="" 
                          className="w-10 h-10 rounded-lg object-cover bg-white/5 shrink-0 group-hover/mini:scale-105 transition-transform" loading="lazy" decoding="async" 
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate group-hover/mini:text-white leading-tight">
                            {item.title}
                          </p>
                          <p className="text-[10.5px] text-white/50 truncate mt-0.5">
                            {item.artist}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

            </div>
          </div>
        </section>
      )}

      {/* ── 3. Quick Picks (Liquid Glass Grid) ──────── */}
      {quickPicksTracks.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                Quick Picks
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Start a session based on your recent tastes</p>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefreshQuickPicks}
                disabled={isRefreshingQuickPicks}
                className="px-3 py-1.5 rounded-full text-xs font-bold text-white lg-glass-btn flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <svg className={`w-3.5 h-3.5 ${isRefreshingQuickPicks ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
                <span>Refresh</span>
              </button>
              <button
                onClick={() => playAllQuickPicks(false)}
                className="px-3.5 py-1.5 rounded-full text-xs font-bold text-white lg-glass-btn is-strong flex items-center gap-1.5 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>Play All</span>
              </button>
              <button
                onClick={() => playAllQuickPicks(true)}
                className="px-3.5 py-1.5 rounded-full text-xs font-bold text-white lg-glass-btn flex items-center gap-1.5 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
                <span>Shuffle</span>
              </button>
            </div>
          </div>

          {/* Multi-Column Seamless Track List (Apple / YouTube Music Style) */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-2">
            {quickPicksTracks.slice(0, 12).map((item, idx) => {
              const isItemPlaying = currentTrack?.src === item.src && isPlaying
              const sharpArt = getSizedArtURL(item.art || item.albumArt || getArtURL(item.src), 'card')
              return (
                <div
                  key={idx}
                  onClick={() => playTrackItem(item)}
                  onContextMenu={(e) => openContextMenu(e, item)}
                  className="relative flex items-center justify-between p-2 rounded-2xl cursor-pointer group transition-all duration-200 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* High-Res Thumbnail */}
                    <div className="w-13 h-13 md:w-14 md:h-14 rounded-xl overflow-hidden shrink-0 relative shadow-md">
                      <img src={sharpArt} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      
                      {/* No overlay on the artwork — the playing state is carried by
                          the tiny equaliser beside the title, so the cover stays clean. */}
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0 pr-2">
                      <p className={`flex items-center gap-1.5 text-sm font-semibold leading-snug ${isItemPlaying ? 'text-white font-bold' : 'text-white/90 group-hover:text-white'}`}>
                        {isItemPlaying && (
                          <span className="flex items-end gap-[2px] h-3 shrink-0" aria-hidden="true">
                            <span className="eq-bar" style={{ backgroundColor: accentColor }} />
                            <span className="eq-bar" style={{ backgroundColor: accentColor, animationDelay: '150ms' }} />
                            <span className="eq-bar" style={{ backgroundColor: accentColor, animationDelay: '300ms' }} />
                          </span>
                        )}
                        <span className="truncate">{displayTitle(item.title)}</span>
                      </p>
                      <p className="text-xs text-white/50 truncate mt-0.5 leading-tight font-medium">
                        {item.artist}
                      </p>
                    </div>
                  </div>

                  {/* Context menu button */}
                  <button
                    onClick={(e) => openContextMenu(e, item)}
                    className="p-2 rounded-full hover:bg-white/10 text-white/30 hover:text-white transition-colors cursor-pointer shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <circle cx="12" cy="6" r="2"/>
                      <circle cx="12" cy="12" r="2"/>
                      <circle cx="12" cy="18" r="2"/>
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 4. Made For {User} (Daily Mixes) ── */}
      {dailyMixes?.length > 0 && (
        <section className="mb-9">
          <div className="flex items-end justify-between mb-3.5">
            <div>
              <p className="text-[11px] font-bold text-white/40 uppercase tracking-wider mb-0.5">Made For</p>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                <FancyUsername userProfile={userProfile} fallback="You" />
              </h2>
            </div>
          </div>

          <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2">
            {dailyMixes.map(mix => renderDailyMixCard(mix))}
          </ShelfCarousel>
        </section>
      )}

      {/* ── 5. Made for you (Hero Artist Mixes) ── */}
      {heroMixes?.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
              Made for you
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {heroMixes.map(mix => renderHeroMixCard(mix))}
          </div>
        </section>
      )}

      {/* ── 6. Recommended Stations (Glaze Radio) ── */}
      {recommendedStations?.length > 0 && (
        <section className="mb-9">
          <div className="flex items-end justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                Recommended Stations
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Non-stop music based on your favorite songs and artists</p>
            </div>
          </div>

          <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2">
            {recommendedStations.map(station => renderStationCard(station))}
          </ShelfCarousel>
        </section>
      )}

      {/* ── 7. Trending Top 10 Today (Apple Music-Style Ranked Carousel) ── */}
      {trendingTracks?.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
                <span>Top Trending Hits</span>
                <span className="text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-white/60">
                  Global Top 10
                </span>
              </h2>
              <p className="text-xs text-white/40 mt-0.5">The most streamed songs right now</p>
            </div>
          </div>

          <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2">
            {trendingTracks.map((item, i) => (
              <div
                key={i}
                onClick={() => playTrackItem(item)}
                onContextMenu={(e) => openContextMenu(e, item)}
                className="w-48 md:w-52 shrink-0 rounded-2xl p-2.5 hover:bg-white/[0.07] transition-all duration-200 cursor-pointer group relative overflow-hidden"
              >
                {/* Large Stylized Rank Numeral */}
                <div className="absolute top-1 left-3 text-5xl font-black italic tracking-tighter opacity-15 pointer-events-none select-none text-white">
                  #{i + 1}
                </div>

                <div className="w-full aspect-square rounded-2xl overflow-hidden relative shadow-lg mb-3 mt-1">
                  <img src={getSizedArtURL(item.thumbnail || item.art || item.albumArt, 'card')} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-white/40 font-mono">0{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate leading-tight">{item.title}</p>
                    <p className="text-[11px] text-white/50 truncate mt-0.5 leading-tight">{item.artist}</p>
                  </div>
                </div>
              </div>
            ))}
          </ShelfCarousel>
        </section>
      )}

      {/* ── 4. Heavy Rotation Shelf ─────────────────────────────────────── */}
      {heavyRotation?.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                Heavy Rotation
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Your most played tracks on Glaze</p>
            </div>
          </div>

          <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2">
            {heavyRotation.map((item, i) => (
              <div
                key={i}
                onClick={() => playTrackItem(item)}
                onContextMenu={(e) => openContextMenu(e, item)}
                className="w-40 md:w-44 shrink-0 rounded-2xl p-2.5 hover:bg-white/[0.07] transition-all duration-200 cursor-pointer group relative"
              >
                <div className="w-full aspect-square rounded-2xl overflow-hidden relative shadow-lg mb-3">
                  <img src={getSizedArtURL(item.art || item.albumArt || getArtURL(item.src), 'card')} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                </div>

                <p className="text-xs font-bold text-white truncate leading-tight">{item.title}</p>
                <p className="text-[11px] text-white/50 truncate mt-0.5 leading-tight">{item.artist}</p>
                <span className="inline-block text-[9.5px] font-mono text-white/40 mt-1.5 px-2 py-0.5 rounded-full bg-white/[0.04]">
                  {item.plays} plays
                </span>
              </div>
            ))}
          </ShelfCarousel>
        </section>
      )}

      {/* ── 5. Spotify-Style "Artists You Love / Featured Artists" Shelf ── */}
      {topArtists?.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                {followedArtists?.length > 0 ? 'Followed & Favorite Artists' : (data?.history?.length > 0 ? 'Artists You Love' : 'Featured Artists')}
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Explore full profiles, discographies, and top hits</p>
            </div>
          </div>

          <ShelfCarousel className="flex items-center gap-5 overflow-x-auto pb-2">
            {topArtists.map((artist, i) => {
              const artistName = typeof artist === 'string' ? artist : artist.name
              const artistImg = typeof artist === 'object' ? artist.image : null
              const isFollowed = typeof artist === 'object' ? artist.isFollowed : false
              return (
                <div
                  key={i}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('open-artist', { detail: artistName }))
                  }}
                  className="flex flex-col items-center shrink-0 w-28 text-center cursor-pointer group p-1.5 rounded-2xl hover:bg-white/[0.06] transition-colors"
                >
                  <div 
                    className="w-24 h-24 rounded-full p-1 border border-white/10 group-hover:border-white/30 transition-all duration-200 group-hover:scale-105 shadow-xl relative overflow-hidden flex items-center justify-center bg-white/[0.06] group-hover:bg-white/[0.12]"
                  >
                    <div className="w-full h-full rounded-full overflow-hidden bg-white/5 flex items-center justify-center relative shadow-inner">
                      {artistImg ? (
                        <img 
                          src={getSizedArtURL(artistImg, 'card')} 
                          alt={artistName} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" 
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                            if (e.currentTarget.nextElementSibling) {
                              e.currentTarget.nextElementSibling.style.display = 'flex'
                            }
                          }}
                        />
                      ) : null}
                      <div 
                        className={`w-full h-full items-center justify-center font-bold text-xl text-white bg-gradient-to-tr from-purple-800 to-indigo-600 ${artistImg ? 'hidden' : 'flex'}`}
                      >
                        {artistName.charAt(0).toUpperCase()}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs font-bold text-white mt-2.5 truncate max-w-full group-hover:text-white leading-tight">
                    {artistName}
                  </p>
                  <span className="text-[10px] text-white/40 mt-0.5 font-medium flex items-center gap-1">
                    {isFollowed && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>}
                    <span>{isFollowed ? 'Following' : 'Artist'}</span>
                  </span>
                </div>
              )
            })}
          </ShelfCarousel>
        </section>
      )}

      {/* ── 6. Made For You / Online Recommendations Shelf ──────────────── */}
      {safeOnlineRecs.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                Recommended For You
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Fresh algorithmic discoveries</p>
            </div>
            <button
              onClick={() => onOnlineSearch?.('Top Trending Hits')}
              className="text-xs font-bold hover:underline cursor-pointer"
              style={{ color: accentColor }}
            >
              Explore More →
            </button>
          </div>

          <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2">
            {safeOnlineRecs.map((item, i) => (
              <div
                key={i}
                onClick={() => playTrackItem(item)}
                onContextMenu={(e) => openContextMenu(e, item)}
                className="w-40 md:w-44 shrink-0 rounded-2xl p-2.5 hover:bg-white/[0.07] transition-all duration-200 cursor-pointer group relative"
              >
                <div className="w-full aspect-square rounded-2xl overflow-hidden relative shadow-lg mb-3">
                  <img src={getSizedArtURL(item.thumbnail || item.art || item.albumArt, 'card')} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                </div>

                <p className="text-xs font-bold text-white truncate leading-tight">{item.title}</p>
                <p className="text-[11px] text-white/50 truncate mt-0.5 leading-tight">{item.artist}</p>
              </div>
            ))}
          </ShelfCarousel>
        </section>
      )}

      {/* ── 7. Your Playlists Shelf ─────────────────────────────────────── */}
      {safePlaylists.length > 0 && (
        <section className="mb-9">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                Your Playlists
              </h2>
              <p className="text-xs text-white/40 mt-0.5">Your personal curated collections</p>
            </div>
          </div>

          <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2">
            {safePlaylists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => {
                  if (pl.files?.length > 0) replaceQueue(pl.files, 0)
                }}
                className="w-40 md:w-44 shrink-0 rounded-2xl p-2.5 hover:bg-white/[0.07] transition-all duration-200 cursor-pointer group relative"
              >
                <div className="w-full aspect-square rounded-2xl overflow-hidden bg-gradient-to-tr from-purple-900/40 to-indigo-900/40 border border-white/10 relative shadow-lg mb-3 flex items-center justify-center">
                  <svg className="w-12 h-12 text-white/40 group-hover:scale-110 transition-transform duration-300" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
                  </svg>
                </div>

                <p className="text-xs font-bold text-white truncate leading-tight">{pl.name}</p>
                <p className="text-[11px] text-white/50 truncate mt-0.5 leading-tight">{pl.files?.length || 0} tracks</p>
              </div>
            ))}
          </ShelfCarousel>
        </section>
      )}

      {/* ── Custom Context Menu ── */}
      {contextMenu.visible && contextMenu.track && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={contextMenu.track}
          isFavourite={favourites?.has(contextMenu.track.src) || streamingFavourites?.some(t => t.src === contextMenu.track.src)}
          playlists={playlists}
          onClose={() => setContextMenu(prev => ({ ...prev, visible: false }))}
          onPlay={() => playTrackItem(contextMenu.track)}
          onPlayNext={() => playNext([contextMenu.track])}
          onAddToQueue={() => addToQueue([contextMenu.track])}
          onAddToFavourites={() => onAddToFavourites?.(contextMenu.track.src || contextMenu.track)}
          onRemoveFromFavourites={() => onRemoveFromFavourites?.(contextMenu.track.src || contextMenu.track)}
          onAddToPlaylist={(plId) => onAddToPlaylist?.(contextMenu.track, plId)}
          onCreateAndAddToPlaylist={(name) => onCreateAndAddToPlaylist?.(contextMenu.track, name)}
          onOpenPlaylistModal={() => onOpenPlaylistModal?.(contextMenu.track)}
          onStartRadio={() => startRadio?.(contextMenu.track)}
        />
      )}
    </div>
  )
}

export default React.memo(HomeDashboard)

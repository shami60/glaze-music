import React, { useState, useMemo, useEffect } from 'react'
import { usePlayer } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getArtURL, getSizedArtURL, formatTime } from '../utils'
import ClickableArtists from './ClickableArtists'
import ContextMenu from './ContextMenu'
import FancyUsername from './FancyUsername'

export default function FavouritesView({
  libraryFiles = [],
  artCache = {},
  favourites,
  streamingFavourites = [],
  playlists = [],
  downloadFolder,
  onShowDownloadNotification,
  refreshDownloads: propRefreshDownloads,
  onAddToFavourites,
  onRemoveFromFavourites,
  onAddToPlaylist,
  onCreateAndAddToPlaylist,
  onOpenPlaylistModal,
  userProfile
}) {
  const { replaceQueue, addToQueue, playNext, currentTrack, isPlaying, togglePlayPause, startRadio, accentColor = '#ef4444' } = usePlayer()
  const { downloadedIds = new Set(), isDownloaded = () => false, refreshDownloads: libRefreshDownloads } = useLibrary() || {}

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'downloaded' | 'local'
  const [sortMode, setSortMode] = useState(() => {
    return localStorage.getItem('glaze_favourites_sort') || 'default'
  })
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, track: null })

  const handleSetSortMode = (e) => {
    const mode = e.target.value
    setSortMode(mode)
    localStorage.setItem('glaze_favourites_sort', mode)
  }
  const [downloadingIds, setDownloadingIds] = useState(new Set())
  const [localMeta, setLocalMeta] = useState({})

  const safeLib = Array.isArray(libraryFiles) ? libraryFiles : []
  const favStreaming = Array.isArray(streamingFavourites) ? streamingFavourites : []

  // ── Unified Liked Songs List (Both Local and Online) ──────────────────────────
  const unifiedTracks = useMemo(() => {
    const list = []
    const seenSrcs = new Set()

    // 1. Process Local Library favourites
    for (const fp of safeLib) {
      if (favourites?.has(fp)) {
        seenSrcs.add(fp)
        const meta = artCache?.[fp] || localMeta[fp] || {}
        const filename = fp.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')
        const isDown = isDownloaded(fp)
        list.push({
          src: fp,
          id: fp,
          title: meta.title || filename,
          artist: meta.artist || 'Unknown Artist',
          album: isDown ? 'Downloaded' : (meta.album || ''),
          albumArt: meta.albumArt || null,
          duration: typeof meta.duration === 'object' ? (meta.duration?.seconds || 0) : (meta.duration || 0),
          source: isDown ? 'downloaded' : 'local',
          isDownloaded: isDown
        })
      }
    }

    // 2. Process Online Streaming favourites
    for (const st of favStreaming) {
      if (!st) continue
      const rawSrc = st.src || st.id || ''
      const videoId = st.videoId || (rawSrc.startsWith('yt:') ? rawSrc.replace('yt:', '') : (!rawSrc.includes('/') && !rawSrc.includes('\\') && !rawSrc.includes(':') && rawSrc.length > 0 ? rawSrc : null))
      const src = videoId ? `yt:${videoId}` : rawSrc
      if (!src || seenSrcs.has(src)) continue
      seenSrcs.add(src)

      const isDown = isDownloaded(src)
      const meta = artCache?.[src] || localMeta[src] || {}
      const dur = typeof (meta.duration ?? st.duration) === 'object' 
        ? (meta.duration?.seconds ?? st.duration?.seconds ?? 0) 
        : (meta.duration ?? st.duration ?? 0)

      list.push({
        ...st,
        src,
        id: st.id || src,
        videoId: videoId || (src.startsWith('yt:') ? src.replace('yt:', '') : null),
        isLocal: false,
        source: isDown ? 'downloaded' : 'online',
        title: meta.title || st.title || 'Online Track',
        artist: meta.artist || st.artist || st.author || 'Unknown Artist',
        album: isDown ? 'Downloaded' : (meta.album || st.album || 'Single'),
        albumArt: meta.albumArt || st.albumArt || st.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
        duration: dur,
        isDownloaded: isDown
      })
    }

    // 3. Fallback for any other src in favourites Set not covered above
    if (favourites) {
      for (const rawSrc of favourites) {
        if (!rawSrc || seenSrcs.has(rawSrc)) continue
        const isYt = rawSrc.startsWith('yt:') || (!rawSrc.includes('/') && !rawSrc.includes('\\') && !rawSrc.includes(':') && rawSrc.length > 0)
        const videoId = isYt ? (rawSrc.startsWith('yt:') ? rawSrc.replace('yt:', '') : rawSrc) : null
        const src = videoId ? `yt:${videoId}` : rawSrc
        if (seenSrcs.has(src)) continue
        seenSrcs.add(src)

        const isDown = isDownloaded(src)
        const meta = artCache?.[src] || localMeta[src] || {}
        const filename = src.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')
        const dur = typeof meta.duration === 'object' ? (meta.duration?.seconds || 0) : (meta.duration || 0)

        list.push({
          src,
          id: src,
          videoId,
          isLocal: !isYt,
          source: isDown ? 'downloaded' : (isYt ? 'online' : 'local'),
          title: meta.title || (isYt ? 'Online Track' : filename),
          artist: meta.artist || 'Unknown Artist',
          album: isDown ? 'Downloaded' : (meta.album || (isYt ? 'Single' : '')),
          albumArt: meta.albumArt || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
          duration: dur,
          isDownloaded: isDown
        })
      }
    }

    return list
  }, [safeLib, favourites, artCache, favStreaming, localMeta, isDownloaded])

  // ── Auto-fetch missing cached metadata & duration for all liked tracks ───────
  useEffect(() => {
    if (!unifiedTracks || unifiedTracks.length === 0) return

    // 1. Missing local file metadata / duration
    const missingLocal = unifiedTracks
      .filter(t => !t.src?.startsWith('yt:') && (!t.duration || t.duration === 0 || !localMeta[t.src]))
      .map(t => t.src)

    if (missingLocal.length > 0 && window.electronAPI?.getTrackMetadata) {
      Promise.all(
        missingLocal.slice(0, 20).map(fp => window.electronAPI.getTrackMetadata(fp).then(m => m ? [fp, m] : null))
      ).then(results => {
        const updates = {}
        for (const res of results) {
          if (res && res[1]) {
            updates[res[0]] = res[1]
            if (window.electronAPI?.dbCacheMetadata) {
              window.electronAPI.dbCacheMetadata(res[0], res[1])
            }
          }
        }
        if (Object.keys(updates).length > 0) {
          setLocalMeta(prev => ({ ...prev, ...updates }))
        }
      }).catch(() => {})
    }

    // 2. Missing online streaming metadata / duration
    const missingOnline = unifiedTracks
      .filter(t => t.src?.startsWith('yt:') && (!t.duration || t.duration === 0 || !t.title || t.title === 'Streaming Track' || t.title === 'Online Track' || !t.artist || t.artist === 'Unknown Artist'))
      .map(t => t.src)

    if (missingOnline.length > 0) {
      if (window.electronAPI?.dbGetBulkMetadata) {
        window.electronAPI.dbGetBulkMetadata(missingOnline).then(async data => {
          let merged = { ...(data || {}) }
          const stillMissing = missingOnline.filter(src => !merged[src] || !merged[src].title || !merged[src].duration)

          const videoIds = stillMissing.slice(0, 10).map(src => src.replace('yt:', ''))
          if (videoIds.length > 0 && window.electronAPI?.youtubeGetUpNextBatch) {
            try {
              const recs = await window.electronAPI.youtubeGetUpNextBatch(videoIds)
              if (recs && recs.length > 0) {
                for (const r of recs) {
                  const s = `yt:${r.videoId}`
                  const meta = {
                    title: r.title,
                    artist: r.artist || 'Unknown Artist',
                    album: r.album || 'Single',
                    albumArt: r.thumbnail,
                    duration: typeof r.duration === 'object' ? (r.duration?.seconds || 0) : (r.duration || 0)
                  }
                  merged[s] = meta
                  if (window.electronAPI?.dbCacheMetadata) {
                    window.electronAPI.dbCacheMetadata(s, meta)
                  }
                }
              }
            } catch (e) {}
          }

          if (Object.keys(merged).length > 0) {
            setLocalMeta(prev => ({ ...prev, ...merged }))
          }
        }).catch(() => {})
      }
    }
  }, [unifiedTracks])

  // Counts
  const downloadedCount = useMemo(() => unifiedTracks.filter(t => t.isDownloaded || t.source === 'downloaded').length, [unifiedTracks])
  const localCount = useMemo(() => unifiedTracks.filter(t => t.source === 'local').length, [unifiedTracks])

  // Filtered and Searched tracks
  const filteredTracks = useMemo(() => {
    let res = unifiedTracks
    if (filter === 'downloaded') res = res.filter(t => t.isDownloaded || t.source === 'downloaded')
    if (filter === 'local') res = res.filter(t => t.source === 'local' || t.isDownloaded)

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      res = res.filter(t => 
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      )
    }

    if (sortMode !== 'default') {
      res = [...res]
      res.sort((a, b) => {
        if (sortMode === 'title_asc') {
          return (a.title || '').localeCompare(b.title || '')
        }
        if (sortMode === 'artist_asc') {
          return (a.artist || 'Unknown Artist').localeCompare(b.artist || 'Unknown Artist')
        }
        if (sortMode === 'duration_desc') {
          const durA = a.duration || 0
          const durB = b.duration || 0
          return durB - durA
        }
        return 0
      })
    }
    return res
  }, [unifiedTracks, filter, search, sortMode])

  // Total duration formatted
  const totalDurationStr = useMemo(() => {
    const totalSec = filteredTracks.reduce((acc, t) => acc + (typeof t.duration === 'number' ? t.duration : 0), 0)
    if (!totalSec) return `${filteredTracks.length} tracks`
    const hours = Math.floor(totalSec / 3600)
    const mins = Math.floor((totalSec % 3600) / 60)
    if (hours > 0) return `${hours} hr ${mins} min`
    return `${mins} min`
  }, [filteredTracks])

  // Handlers
  const handlePlayAll = () => {
    if (filteredTracks.length === 0) return
    const isCurrentInList = currentTrack && filteredTracks.some(t => t.src === currentTrack.src)
    if (isCurrentInList) {
      togglePlayPause()
    } else {
      replaceQueue(filteredTracks, 0)
    }
  }

  const handleShuffleAll = () => {
    if (filteredTracks.length === 0) return
    const shuffled = [...filteredTracks].sort(() => Math.random() - 0.5)
    replaceQueue(shuffled, 0)
  }

  const handleDownloadTrack = async (track) => {
    if (!track.src?.startsWith('yt:') || isDownloaded(track.src)) return
    const videoId = track.src.replace('yt:', '')
    setDownloadingIds(prev => new Set([...prev, track.src]))
    try {
      const res = await window.electronAPI?.youtubeDownloadTrack(videoId, downloadFolder)
      const ok = !!res?.success
      onShowDownloadNotification?.(track, ok)
      if (ok) {
        await libRefreshDownloads?.()
        await propRefreshDownloads?.()
      }
    } catch {
      onShowDownloadNotification?.(track, false)
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev)
        next.delete(track.src)
        return next
      })
    }
  }

  const openContextMenu = (e, track) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      track
    })
  }

  if (unifiedTracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center animate-in fade-in duration-300">
        <div 
          className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-rose-600/30 to-pink-500/20 border border-white/10 flex items-center justify-center mb-6 shadow-2xl backdrop-blur-xl"
          style={{ boxShadow: `0 20px 50px -10px color-mix(in srgb, ${accentColor} 14.5%, transparent)` }}
        >
          <svg viewBox="0 0 24 24" fill={accentColor} className="w-12 h-12">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </div>
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Songs you like will appear here</h2>
        <p className="text-sm text-white/50 max-w-md mt-2">
          Save songs by tapping the heart icon on any local song, streaming discovery, or album track.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      
      {/* ── Top Hero Header ─────────────────────────────────────────────────── */}
      <div className="px-6 md:px-8 pt-7 pb-5 shrink-0 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
          
          {/* Left: Big Liked Songs Icon & Info */}
          <div className="flex items-center gap-5">
            <div 
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl bg-gradient-to-br from-rose-500 via-pink-600 to-purple-600 flex items-center justify-center shadow-2xl shrink-0 border border-white/20"
              style={{ boxShadow: '0 15px 40px -10px rgba(244,63,94,0.45)' }}
            >
              <svg viewBox="0 0 24 24" fill="white" className="w-10 h-10 sm:w-12 sm:h-12 drop-shadow-md">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>

            <div>
              <span className="text-[10.5px] font-black uppercase tracking-widest text-white/60">Playlist</span>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mt-0.5">
                Liked Songs
              </h1>
              <p className="text-xs sm:text-sm text-white/50 mt-1 flex items-center gap-2">
                <span className="font-semibold text-white/80">
                  <FancyUsername userProfile={userProfile} fallback="You" />
                </span>
                <span>•</span>
                <span>{filteredTracks.length} songs</span>
                <span>•</span>
                <span>{totalDurationStr}</span>
              </p>
            </div>
          </div>

          {/* Right: Search & Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative flex items-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/40 absolute left-3 pointer-events-none">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                placeholder="Search liked songs..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-44 sm:w-56 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 focus:border-white/25 rounded-full pl-9 pr-7 py-1.5 text-xs text-white placeholder-white/30 outline-none transition-all"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 text-white/40 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Play All Button */}
            <button
              onClick={handlePlayAll}
              className="h-10 px-5 rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold text-xs shadow-xl cursor-pointer"
            >
              {isPlaying && currentTrack && filteredTracks.some(t => t.src === currentTrack.src) ? (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>
                  <span>{currentTrack && filteredTracks.some(t => t.src === currentTrack.src) ? 'Resume' : 'Play All'}</span>
                </>
              )}
            </button>

            {/* Shuffle Button */}
            <button
              onClick={handleShuffleAll}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex items-center justify-center border border-white/10 cursor-pointer active:scale-95"
              title="Shuffle Liked Songs"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
              </svg>
            </button>
          </div>

        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => setFilter('all')}
            className={`px-3.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-white text-black shadow-md'
                : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5'
            }`}
          >
            All ({unifiedTracks.length})
          </button>
          
          {downloadedCount > 0 && (
            <button
              onClick={() => setFilter('downloaded')}
              className={`px-3.5 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                filter === 'downloaded'
                  ? 'bg-emerald-400 text-black shadow-md'
                  : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span>Downloaded ({downloadedCount})</span>
            </button>
          )}

          {localCount > 0 && (
            <button
              onClick={() => setFilter('local')}
              className={`px-3.5 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                filter === 'local'
                  ? 'bg-white/30 text-white shadow-md'
                  : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5'
              }`}
            >
              <span>Local Files ({localCount})</span>
            </button>
          )}

          {/* Sort Dropdown */}
          <div className="ml-auto shrink-0">
            <select
              value={sortMode}
              onChange={handleSetSortMode}
              className="bg-white/5 border border-white/10 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-white/20 transition-colors cursor-pointer appearance-none"
              style={{ paddingRight: '24px', backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%23ffffff\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'%3E%3C/path%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '12px' }}
            >
              <option value="default" className="bg-[var(--surface-2)] text-white">Date Added (Default)</option>
              <option value="title_asc" className="bg-[var(--surface-2)] text-white">Title (A-Z)</option>
              <option value="artist_asc" className="bg-[var(--surface-2)] text-white">Artist (A-Z)</option>
              <option value="duration_desc" className="bg-[var(--surface-2)] text-white">Duration (Longest)</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Table / Unified Liked Track Rows ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-8 py-3 pb-24">
        
        {/* Table Header Row */}
        <div className="grid grid-cols-[2.5rem_minmax(0,3.5fr)_minmax(0,2fr)_5.5rem_7rem] items-center px-4 py-2 text-[11px] font-bold text-white/40 uppercase tracking-wider border-b border-white/5 mb-1">
          <span>#</span>
          <span>Title</span>
          <span>Album</span>
          <span className="text-right pr-2">Duration</span>
          <span className="text-right pr-2">Actions</span>
        </div>

        {/* Track Rows */}
        {filteredTracks.length > 0 ? (
          filteredTracks.map((track, idx) => {
            const isCurrent = currentTrack?.src === track.src
            const isTrackPlaying = isCurrent && isPlaying
            const art = track.albumArt || getArtURL(track.src)
            const isDownloading = downloadingIds.has(track.src)
            const isTrackDown = track.isDownloaded || track.source === 'downloaded' || isDownloaded(track.src)

            return (
              <div
                key={track.src || idx}
                onClick={() => {
                  if (isCurrent) {
                    togglePlayPause()
                  } else {
                    replaceQueue(filteredTracks, idx)
                  }
                }}
                onContextMenu={e => openContextMenu(e, track)}
                className={`grid grid-cols-[2.5rem_minmax(0,3.5fr)_minmax(0,2fr)_5.5rem_7rem] items-center px-4 py-2.5 rounded-2xl group transition-all duration-150 cursor-pointer ${
                  isCurrent 
                    ? 'bg-white/[0.08] border border-white/10' 
                    : 'hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {/* 1. Track Index / Play Indicator */}
                <div className="flex items-center text-xs font-semibold text-white/40">
                  {isTrackPlaying ? (
                    <div className="flex items-end gap-0.5 h-3.5">
                      <span className="w-1 bg-emerald-400 animate-pulse h-full rounded-full"></span>
                      <span className="w-1 bg-emerald-400 animate-pulse h-2 rounded-full delay-75"></span>
                      <span className="w-1 bg-emerald-400 animate-pulse h-3 rounded-full delay-150"></span>
                    </div>
                  ) : (
                    <>
                      <span className="group-hover:hidden">{idx + 1}</span>
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white hidden group-hover:block">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </>
                  )}
                </div>

                {/* 2. Title, Artist, & Album Cover */}
                <div className="flex items-center gap-3.5 min-w-0 pr-4">
                  <img
                    src={getSizedArtURL(art, 'thumb')}
                    alt=""
                    className="w-11 h-11 rounded-xl object-cover bg-white/5 shadow-md shrink-0"
                    onError={e => { e.target.style.opacity = '0.5' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate leading-tight ${isCurrent ? 'text-emerald-400' : 'text-white group-hover:text-white'}`}>
                      {track.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1 truncate">
                      <p className="text-xs text-white/50 truncate">
                        <ClickableArtists artistString={track.artist} />
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3. Album & Downloaded Badge */}
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  {isTrackDown ? (
                    <span 
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0 shadow-sm"
                      title="Downloaded on disk"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                      <span>Downloaded</span>
                    </span>
                  ) : (
                    <span className="text-xs text-white/40 truncate">
                      {track.album && track.album !== 'Local Track' && track.album !== 'Downloaded' ? track.album : ''}
                    </span>
                  )}
                </div>

                {/* 4. Duration */}
                <div className="text-right text-xs text-white/50 font-mono pr-2">
                  {formatTime(track.duration)}
                </div>

                {/* 5. Clean Action Icons (Hover only, no overlapping heart) */}
                <div className="flex items-center justify-end gap-1">
                  {/* Remove from Liked Songs button (Hover only) */}
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      onRemoveFromFavourites?.(track.src || track)
                    }}
                    className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    title="Remove from Liked Songs"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                  </button>

                  {/* Add to Playlist button */}
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      if (onOpenPlaylistModal) onOpenPlaylistModal(track)
                      else openContextMenu(e, track)
                    }}
                    className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    title="Add to Playlist"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/>
                    </svg>
                  </button>

                  {/* Download button for online/stream tracks */}
                  {track.src?.startsWith('yt:') && (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (!isTrackDown && !downloadingIds.has(track.src)) {
                          handleDownloadTrack(track)
                        }
                      }}
                      disabled={isTrackDown || downloadingIds.has(track.src)}
                      className={`p-1.5 rounded-full transition-all ${
                        isTrackDown
                          ? 'text-emerald-400 opacity-70 group-hover:opacity-100 cursor-default'
                          : 'hover:bg-white/10 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 cursor-pointer'
                      }`}
                      title={isTrackDown ? "Downloaded" : "Download Track"}
                    >
                      {isTrackDown ? (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-400">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                      ) : downloadingIds.has(track.src) ? (
                        <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                    </button>
                  )}

                  {/* 3-dots Context Menu Button */}
                  <button
                    onClick={e => openContextMenu(e, track)}
                    className="p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    title="More Options"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                    </svg>
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <div className="py-12 text-center text-white/40">
            <p className="text-sm font-semibold">No liked songs match "{search}"</p>
          </div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {contextMenu.visible && contextMenu.track && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={contextMenu.track}
          playlists={playlists}
          isFavourite={true}
          isDownloaded={isDownloaded(contextMenu.track)}
          onClose={() => setContextMenu(prev => ({ ...prev, visible: false }))}
          onPlay={() => replaceQueue([contextMenu.track])}
          onPlayNext={() => playNext([contextMenu.track])}
          onAddToQueue={() => addToQueue([contextMenu.track])}
          onAddToFavourites={() => onAddToFavourites?.(contextMenu.track)}
          onRemoveFromFavourites={() => onRemoveFromFavourites?.(contextMenu.track.src || contextMenu.track)}
          onAddToPlaylist={(plId) => onAddToPlaylist?.(contextMenu.track, plId)}
          onCreateAndAddToPlaylist={(name) => onCreateAndAddToPlaylist?.(contextMenu.track, name)}
          onOpenPlaylistModal={() => onOpenPlaylistModal?.(contextMenu.track)}
          onStartRadio={() => startRadio?.(contextMenu.track)}
          onDownload={contextMenu.track?.src?.startsWith('yt:') ? () => handleDownloadTrack(contextMenu.track) : undefined}
        />
      )}

    </div>
  )
}

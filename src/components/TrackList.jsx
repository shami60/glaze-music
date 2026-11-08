import React, { useState, useCallback, useRef, useEffect } from 'react'
import { usePlayer } from '../context/usePlayer'
import { getArtURL, getSizedArtURL, formatTime, basename } from '../utils'
import ContextMenu from './ContextMenu'
import ClickableArtists from './ClickableArtists'

const AUDIO_EXT = /\.(mp3|flac|wav|ogg|aac|m4a|opus|webm)$/i
const OVERSCAN = 8   // extra rows above/below visible area

function cleanTitle(rawTitle, filePath) {
  if (!rawTitle) {
    if (typeof filePath === 'string' && filePath.startsWith('yt:')) {
      return filePath.replace(/^yt:/, '')
    }
    return basename(filePath)
  }
  if (AUDIO_EXT.test(rawTitle)) return rawTitle.replace(AUDIO_EXT, '')
  return rawTitle
}

function PlayingBars() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color: 'rgb(248,113,113)' }}>
      <path d="M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z"/>
    </svg>
  )
}

function ListViewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M4 14h4v-4H4v4zm0 5h4v-4H4v4zM4 9h4V5H4v4zm5 5h12v-4H9v4zm0 5h12v-4H9v4zM9 5v4h12V5H9z"/>
    </svg>
  )
}

function GridViewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M4 11h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1zm10 0h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1zM4 21h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1zm10 0h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1z"/>
    </svg>
  )
}

function CompactViewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-5h18V6H3v2z"/>
    </svg>
  )
}

const COL = 'grid-cols-[2.5rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_3.5rem]'

export default function TrackList({
  files = [], isScanning = false, artCache = {},
  favourites, playlists,
  onAddToFavourites, onRemoveFromFavourites,
  onAddToPlaylist, onCreateAndAddToPlaylist,
  onOpenPlaylistModal,
  onRemoveFromLibrary,
  onAddFolder, onOpenFiles
}) {
  const safeFiles = Array.isArray(files) ? files : []
  const { queue, currentTrack, isPlaying, replaceQueue, addToQueue, playNext, startRadio, prefetchStreamUrl } = usePlayer()
  const [search, setSearch] = useState('')
  const [ctxMenu, setCtxMenu] = useState(null)
  const [downloadedIds, setDownloadedIds] = useState(new Set())
  const [localMeta, setLocalMeta] = useState({})
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('glaze_local_songs_view_mode') || 'list'
  })
  const [sortMode, setSortMode] = useState(() => {
    return localStorage.getItem('glaze_tracklist_sort') || 'default'
  })

  // Auto-fetch missing cached metadata for yt: tracks
  useEffect(() => {
    if (!safeFiles || safeFiles.length === 0) return
    const missing = safeFiles.filter(f => typeof f === 'string' && f.startsWith('yt:') && !artCache[f] && !localMeta[f])
    if (missing.length === 0) return
    if (window.electronAPI?.dbGetBulkMetadata) {
      window.electronAPI.dbGetBulkMetadata(missing).then(data => {
        if (data && Object.keys(data).length > 0) {
          setLocalMeta(prev => ({ ...prev, ...data }))
        }
      }).catch(() => {})
    }
  }, [safeFiles, artCache])

  const handleSetViewMode = (mode) => {
    setViewMode(mode)
    localStorage.setItem('glaze_local_songs_view_mode', mode)
  }

  const handleSetSortMode = (e) => {
    const mode = e.target.value
    setSortMode(mode)
    localStorage.setItem('glaze_tracklist_sort', mode)
  }

  // Fetch downloaded IDs (cached on mount, zero background polling)
  useEffect(() => {
    let isMounted = true
    if (window.electronAPI?.getDownloadedVideoIds) {
      const fetchIds = async () => {
        try {
          const ids = await window.electronAPI.getDownloadedVideoIds()
          if (isMounted) setDownloadedIds(new Set(ids))
        } catch (e) {}
      }
      fetchIds()
    }
    return () => { isMounted = false }
  }, [safeFiles.length])

  const openCtxMenu = useCallback((e, filePath) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, filePath })
  }, [])
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  let filtered = search.trim()
    ? safeFiles.filter(f => {
        const query = search.toLowerCase()
        const cached = artCache[f] || localMeta[f]
        const title = (cached?.title || f).toLowerCase()
        const artist = (cached?.artist || '').toLowerCase()
        const album = (cached?.album || '').toLowerCase()
        return title.includes(query) || artist.includes(query) || album.includes(query) || f.toLowerCase().includes(query)
      })
    : [...safeFiles]

  if (sortMode !== 'default') {
    filtered.sort((a, b) => {
      const metaA = artCache[a] || localMeta[a]
      const metaB = artCache[b] || localMeta[b]
      
      if (sortMode === 'title_asc') {
        const titleA = cleanTitle(metaA?.title, a).toLowerCase()
        const titleB = cleanTitle(metaB?.title, b).toLowerCase()
        return titleA.localeCompare(titleB)
      }
      if (sortMode === 'artist_asc') {
        const artistA = (metaA?.artist || 'Unknown Artist').toLowerCase()
        const artistB = (metaB?.artist || 'Unknown Artist').toLowerCase()
        return artistA.localeCompare(artistB)
      }
      if (sortMode === 'duration_desc') {
        const durA = metaA?.duration || 0
        const durB = metaB?.duration || 0
        return durB - durA
      }
      return 0
    })
  }

  function playAt(index) { replaceQueue(filtered, index) }
  function addFile(fp)   { addToQueue([fp]) }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-3 shrink-0" style={{ borderBottom: '1px solid rgba(var(--ink-rgb),0.05)' }}>
        <div className="flex-1 relative">
          <svg viewBox="0 0 24 24" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'rgba(var(--ink-rgb),0.25)' }}>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
          </svg>
          <input
            type="text"
            placeholder="Search songs, artists, albums..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm text-white placeholder-white/25 focus:outline-none transition-colors"
            style={{ background: 'rgba(var(--ink-rgb),0.05)', border: '1px solid rgba(var(--ink-rgb),0.09)' }}
            onFocus={e => e.target.style.borderColor = 'rgba(var(--ink-rgb),0.2)'}
            onBlur={e => e.target.style.borderColor = 'rgba(var(--ink-rgb),0.09)'}
          />
        </div>

        {/* Sort Dropdown */}
        <div className="shrink-0">
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

        {/* View Mode Switcher */}
        <div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => handleSetViewMode('list')}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              viewMode === 'list' 
                ? 'bg-white/20 text-white shadow-sm' 
                : 'text-white/40 hover:text-white/80 hover:bg-white/5'
            }`}
            title="List View"
          >
            <ListViewIcon />
          </button>
          <button
            onClick={() => handleSetViewMode('grid')}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              viewMode === 'grid' 
                ? 'bg-white/20 text-white shadow-sm' 
                : 'text-white/40 hover:text-white/80 hover:bg-white/5'
            }`}
            title="Tile / Grid View"
          >
            <GridViewIcon />
          </button>
          <button
            onClick={() => handleSetViewMode('compact')}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              viewMode === 'compact' 
                ? 'bg-white/20 text-white shadow-sm' 
                : 'text-white/40 hover:text-white/80 hover:bg-white/5'
            }`}
            title="Compact View"
          >
            <CompactViewIcon />
          </button>
        </div>

        {/* Add Folder & Add Files Action Buttons */}
        {onAddFolder && (
          <button
            onClick={onAddFolder}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-all shadow-md shrink-0 cursor-pointer"
            title="Add a folder to library"
          >
            <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            Add Folder
          </button>
        )}
        {onOpenFiles && (
          <button
            onClick={onOpenFiles}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-white text-xs font-medium transition-all shadow-md shrink-0 cursor-pointer"
            title="Open individual song files"
          >
            <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Add Songs
          </button>
        )}

        <span className="text-sm shrink-0" style={{ color: 'rgba(var(--ink-rgb),0.3)' }}>{filtered.length} songs</span>
      </div>

      {/* Empty / scanning */}
      {safeFiles.length === 0 && !isScanning && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ color: 'rgba(var(--ink-rgb),0.15)' }}>
          <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shadow-xl">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white/40"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
          </div>
          <p className="text-sm text-center leading-relaxed" style={{ color: 'rgba(var(--ink-rgb),0.4)' }}>No local songs found.<br />Add a music folder or select audio files to build your library.</p>
          <div className="flex gap-3 mt-2">
            {onAddFolder && (
              <button
                onClick={onAddFolder}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all border border-white/10 cursor-pointer shadow-lg hover:scale-105"
              >
                📁 Add Music Folder
              </button>
            )}
            {onOpenFiles && (
              <button
                onClick={onOpenFiles}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-white text-xs font-semibold transition-all border border-red-500/40 cursor-pointer shadow-lg hover:scale-105"
              >
                🎵 Add Local Song Files
              </button>
            )}
          </div>
        </div>
      )}
      {isScanning && !safeFiles.length && (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'rgba(var(--ink-rgb),0.35)' }}>Scanning library…</div>
      )}

      {/* Grid View */}
      {filtered.length > 0 && viewMode === 'grid' && (
        <GridRows
          prefetchStreamUrl={prefetchStreamUrl}
          filtered={filtered}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
          queue={queue}
          artCache={artCache}
          localMeta={localMeta}
          favourites={favourites}
          downloadedIds={downloadedIds}
          onPlay={playAt}
          onAdd={addFile}
          onContextMenu={openCtxMenu}
        />
      )}

      {/* Table (List / Compact) with virtual scroll */}
      {filtered.length > 0 && viewMode !== 'grid' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Column headers — fixed, not inside scroll */}
          <div className={`grid ${COL} gap-x-4 px-6 py-2 shrink-0 text-xs font-medium uppercase tracking-wider border-b border-white/5`} style={{ color: 'rgba(var(--ink-rgb),0.28)' }}>
            <span className="text-center">#</span>
            <span>Title</span>
            <span>Artist</span>
            <span>Album</span>
            <span className="text-right pr-1" style={{ color: 'rgba(var(--ink-rgb),0.2)' }}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 ml-auto inline"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z"/></svg>
            </span>
          </div>

          {/* Virtual rows */}
          <VirtualRows
            prefetchStreamUrl={prefetchStreamUrl}
            filtered={filtered}
            currentTrack={currentTrack}
            isPlaying={isPlaying}
            queue={queue}
            artCache={artCache}
            localMeta={localMeta}
            favourites={favourites}
            downloadedIds={downloadedIds}
            viewMode={viewMode}
            onPlay={playAt}
            onAdd={addFile}
            onContextMenu={openCtxMenu}
          />
        </div>
      )}

      {/* Context Menu */}
      {ctxMenu && (() => {
        const fp = ctxMenu.filePath
        const enriched = queue.find(t => t.src === fp)
        const cached   = artCache[fp]
        const track = {
          filePath: fp,
          title:  enriched?.title  || cached?.title  || basename(fp),
          artist: enriched?.artist || cached?.artist || '',
          album:  enriched?.album  || cached?.album  || '',
          albumArt: enriched?.albumArt || cached?.albumArt || null,
        }
        return (
          <ContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            track={track}
            isFavourite={favourites?.has(fp)}
            playlists={playlists || []}
            onClose={closeCtxMenu}
            onPlay={() => replaceQueue([track])}
            onPlayNext={() => playNext([track])}
            onAddToQueue={() => addToQueue([track])}
            onAddToFavourites={() => onAddToFavourites?.(fp)}
            onRemoveFromFavourites={() => onRemoveFromFavourites?.(fp)}
            onAddToPlaylist={id => onAddToPlaylist?.(track, id)}
            onCreateAndAddToPlaylist={name => onCreateAndAddToPlaylist?.(track, name)}
            onOpenPlaylistModal={() => onOpenPlaylistModal?.(track)}
            onRemoveFromLibrary={() => onRemoveFromLibrary?.(fp)}
            onStartRadio={() => startRadio(track)}
          />
        )
      })()}
    </div>
  )
}

// ── Tile / Grid View Component ─────────────────────────────────────────────
function GridRows({ filtered, currentTrack, isPlaying, queue, artCache, localMeta = {}, favourites, downloadedIds, onPlay, onAdd, onContextMenu, prefetchStreamUrl }) {
  const queueMap = React.useMemo(() => {
    const map = new Map()
    for (const t of queue) map.set(t.src, t)
    return map
  }, [queue])

  return (
    <div className="flex-1 overflow-y-auto p-5 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-9 gap-3 auto-rows-max content-start">
      {filtered.map((filePath, index) => {
        const isActive = currentTrack?.src === filePath
        const enriched = queueMap.get(filePath)
        const cached   = artCache[filePath] || localMeta[filePath]
        const title    = cleanTitle(enriched?.title || cached?.title, filePath)
        const artist   = enriched?.artist || cached?.artist || 'Unknown Artist'
        const isFav    = favourites?.has(filePath)
        const isDown   = filePath.startsWith('yt:') && downloadedIds.has(filePath.replace('yt:', ''))

        return (
          <div
            key={filePath}
            onDoubleClick={() => onPlay(index)}
            onMouseEnter={() => prefetchStreamUrl?.({ src: filePath })}
            onContextMenu={e => onContextMenu(e, filePath)}
            className="group relative flex flex-col p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] hover:border-white/10 transition-all duration-300 cursor-pointer shadow-lg hover:-translate-y-1"
          >
            {/* Cover art container */}
            <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-white/5 mb-2.5 shadow-md">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 absolute inset-0 m-auto text-white/20"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
              <img
                src={getSizedArtURL(getArtURL(filePath), 'card')}
                alt={title}
                loading="lazy"
                className="w-full h-full object-cover absolute inset-0 z-10 transition-all duration-300 group-hover:scale-105"
                onError={e => e.target.style.opacity = '0'}
                onLoad={e => e.target.style.opacity = '1'}
                style={{ opacity: 0 }}
              />
              
              {/* Play Overlay */}
              <div className="absolute inset-0 z-20 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                <button
                  onClick={e => { e.stopPropagation(); onPlay(index) }}
                  className="on-accent w-11 h-11 rounded-full bg-red-500 hover:bg-red-400 text-white flex items-center justify-center shadow-xl transform scale-90 group-hover:scale-100 transition-all duration-300"
                  title="Play"
                >
                  {isActive && isPlaying ? (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                  )}
                </button>
              </div>

              {/* Badges */}
              {isFav && (
                <span className="absolute top-2 right-2 z-30 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-yellow-400 text-xs font-bold shadow">★</span>
              )}
              {isDown && (
                <span className="absolute top-2 left-2 z-30 p-1 rounded-full bg-black/60 backdrop-blur-md text-green-400 shadow">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                </span>
              )}
            </div>

            {/* Title & Artist */}
            <h4 className={`text-xs font-semibold truncate ${isActive ? 'text-red-400' : 'text-white/90'}`} title={title}>
              {title}
            </h4>
            <p className="text-[11px] text-white/40 truncate mt-0.5" title={artist}>
              {artist}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Virtual scroll — only renders visible rows ─────────────────────────────
function VirtualRows({ filtered, currentTrack, isPlaying, queue, artCache, localMeta = {}, favourites, downloadedIds, viewMode, onPlay, onAdd, onContextMenu, prefetchStreamUrl }) {
  const containerRef = useRef(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)

  const queueMap = React.useMemo(() => {
    const map = new Map()
    for (const t of queue) map.set(t.src, t)
    return map
  }, [queue])

  const rowHeight = viewMode === 'compact' ? 40 : 56

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const endIdx   = Math.min(filtered.length, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN)
  const totalHeight = filtered.length * rowHeight
  const offsetY = startIdx * rowHeight

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto"
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
          {filtered.slice(startIdx, endIdx).map((filePath, i) => {
            const absIdx   = startIdx + i
            const isActive = currentTrack?.src === filePath
            const enriched = queueMap.get(filePath)
            const cached   = artCache[filePath] || localMeta[filePath]
            return (
              <TrackRow
                key={filePath}
                filePath={filePath}
                index={absIdx}
                isActive={isActive}
                isPlaying={isActive && isPlaying}
                enriched={enriched}
                cached={cached}
                isFavourite={favourites?.has(filePath)}
                isDownloaded={filePath.startsWith('yt:') && downloadedIds.has(filePath.replace('yt:', ''))}
                viewMode={viewMode}
                rowHeight={rowHeight}
                onPlay={() => onPlay(absIdx)}
                onAdd={() => onAdd(filePath)}
                onContextMenu={e => onContextMenu(e, filePath)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TrackRow({ filePath, index, isActive, isPlaying, enriched, cached, isFavourite, isDownloaded, viewMode, rowHeight, onPlay, onAdd, onContextMenu }) {
  const [hovered, setHovered] = useState(false)

  const title  = cleanTitle(enriched?.title || cached?.title, filePath)
  const artist = enriched?.artist || cached?.artist || ''
  const album  = enriched?.album  || cached?.album  || ''
  const dur    = enriched?.duration || cached?.duration

  const isCompact = viewMode === 'compact'

  const rowStyle = {
    height: rowHeight,
    background: isActive ? 'rgba(var(--ink-rgb),0.07)' : hovered ? 'rgba(var(--ink-rgb),0.04)' : 'transparent',
    transition: 'background 0.1s',
  }

  return (
    <div
      className={`grid ${COL} gap-x-4 px-6 items-center cursor-pointer`}
      style={rowStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={onPlay}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center justify-center text-xs">
        {isPlaying ? (
          <PlayingBars />
        ) : hovered ? (
          <button onClick={e => { e.stopPropagation(); onPlay() }} style={{ color: 'rgba(var(--ink-rgb),0.7)' }}>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>
          </button>
        ) : (
          <span style={{ color: isActive ? 'rgb(252,165,165)' : 'rgba(var(--ink-rgb),0.28)' }}>{index + 1}</span>
        )}
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <div className={`${isCompact ? 'w-7 h-7' : 'w-10 h-10'} rounded shrink-0 flex items-center justify-center overflow-hidden relative`} style={{ background: 'rgba(var(--ink-rgb),0.07)' }}>
          <svg viewBox="0 0 24 24" fill="currentColor" className={`${isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} absolute inset-0 m-auto`} style={{ color: 'rgba(var(--ink-rgb),0.18)' }}>
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
          </svg>
          <img
            src={getSizedArtURL(getArtURL(filePath), 'thumb')}
            alt=""
            className="w-full h-full object-cover absolute inset-0 z-10 transition-opacity"
            onError={e => e.target.style.opacity = '0'}
            onLoad={e => e.target.style.opacity = '1'}
            style={{ opacity: 0 }}
          />
        </div>
        <div className="min-w-0 flex items-center gap-2">
          <p className={`${isCompact ? 'text-xs' : 'text-sm'} font-medium truncate`} style={{ color: isActive ? 'rgb(252,165,165)' : 'rgba(var(--ink-rgb),0.9)' }}>{title}</p>
          {isFavourite && <span className="text-xs shrink-0" style={{ color: 'rgb(250,204,21)' }}>★</span>}
          {isDownloaded && <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0 text-green-400" title="Downloaded"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>}
        </div>
      </div>

      <div className={`${isCompact ? 'text-xs' : 'text-sm'} truncate`} style={{ color: 'rgba(var(--ink-rgb),0.48)' }}>
        <ClickableArtists artistString={artist} />
      </div>
      <span className={`${isCompact ? 'text-xs' : 'text-sm'} truncate`} style={{ color: 'rgba(var(--ink-rgb),0.32)' }}>{album}</span>

      <div className="flex items-center justify-end gap-2">
        {hovered && (
          <button onClick={e => { e.stopPropagation(); onAdd() }} className="text-xs rounded px-1.5 py-0.5 shrink-0" style={{ color: 'rgba(var(--ink-rgb),0.4)', background: 'rgba(var(--ink-rgb),0.08)' }} title="Add to queue">+</button>
        )}
        <span className="text-xs tabular-nums shrink-0" style={{ color: 'rgba(var(--ink-rgb),0.22)' }}>{dur ? formatTime(dur) : ''}</span>
      </div>
    </div>
  )
}

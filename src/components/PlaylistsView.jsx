import React, { useState, useMemo, useEffect, useRef } from 'react'
import { usePlayer } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getArtURL, getSizedArtURL, formatTime } from '../utils'
import ClickableArtists from './ClickableArtists'
import ContextMenu from './ContextMenu'
import FancyUsername from './FancyUsername'

// ── Mosaic Cover Art Component ────────────────────────────────────────────────
function PlaylistCover({ files = [], size = 'md', className = '' }) {
  const safeFiles = Array.isArray(files) ? files : []
  const uniqueArts = useMemo(() => {
    const arts = []
    const seen = new Set()
    for (const f of safeFiles) {
      const art = typeof f === 'object' ? (f.albumArt || f.thumbnail || getArtURL(f.src || f.id)) : getArtURL(f)
      if (art && !seen.has(art)) {
        seen.add(art)
        arts.push(art)
        if (arts.length >= 4) break
      }
    }
    return arts
  }, [safeFiles])

  const sizeClasses = {
    sm: 'w-12 h-12 rounded-xl text-xs',
    md: 'w-full aspect-square rounded-2xl text-sm',
    lg: 'w-44 h-44 sm:w-52 sm:h-52 rounded-3xl text-base shadow-2xl shrink-0',
  }[size] || 'w-full aspect-square rounded-2xl'

  if (uniqueArts.length >= 4) {
    return (
      <div className={`grid grid-cols-2 grid-rows-2 overflow-hidden bg-white/5 border border-white/10 ${sizeClasses} ${className}`}>
        {uniqueArts.slice(0, 4).map((art, i) => (
          <img key={i} src={getSizedArtURL(art, 'card')} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.opacity = '0.3' }} />
        ))}
      </div>
    )
  }

  if (uniqueArts.length > 0) {
    return (
      <div className={`overflow-hidden bg-white/5 border border-white/10 relative ${sizeClasses} ${className}`}>
        <img src={getSizedArtURL(uniqueArts[0], 'card')} alt="" className="w-full h-full object-cover" onError={e => { e.target.style.opacity = '0.3' }} />
      </div>
    )
  }

  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5 border border-white/10 text-white/40 ${sizeClasses} ${className}`}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-1/3 h-1/3">
        <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
      </svg>
    </div>
  )
}

export default function PlaylistsView({
  playlists = [],
  artCache = {},
  onDeletePlaylist,
  onRenamePlaylist,
  onRemoveFromPlaylist,
  onAddToFavourites,
  onRemoveFromFavourites,
  onAddToPlaylist,
  onCreateAndAddToPlaylist,
  onOpenPlaylistModal,
  downloadFolder,
  onShowDownloadNotification,
  refreshDownloads: propRefreshDownloads,
  userProfile
}) {
  const { replaceQueue, addToQueue, playNext, currentTrack, isPlaying, togglePlayPause, startRadio, accentColor = '#ef4444' } = usePlayer()
  const { downloadedIds = new Set(), isDownloaded = () => false, refreshDownloads: libRefreshDownloads } = useLibrary() || {}

  const [selectedId, setSelectedId] = useState(null)
  const [playlistSearch, setPlaylistSearch] = useState('')
  const [trackSearch, setTrackSearch] = useState('')
  
  // Modals & Forms
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  // Set when a Spotify playlist is longer than the public 100-track embed.
  const [importNotice, setImportNotice] = useState(null)
  const [renameTarget, setRenameTarget] = useState(null) // { id, name }
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, name }
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  
  // Inline editing for playlist detail
  const [isInlineEditing, setIsInlineEditing] = useState(false)
  const [inlineName, setInlineName] = useState('')
  const inlineInputRef = useRef(null)

  // Track actions & downloading
  const [downloadingIds, setDownloadingIds] = useState(new Set())
  // src -> 0-100, fed by the main process's yt-dlp progress events.
  const [downloadPercentBySrc, setDownloadPercentBySrc] = useState({})
  const [isDownloadingAll, setIsDownloadingAll] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(null)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, track: null })
  const [localMeta, setLocalMeta] = useState({})

  const safePlaylists = Array.isArray(playlists) ? playlists : []
  const currentPlaylist = selectedId ? safePlaylists.find(p => p.id === selectedId) : null

  // Mapped tracks inside selected playlist
  const playlistTracks = useMemo(() => {
    if (!currentPlaylist) return []
    const filesList = currentPlaylist.files || currentPlaylist.tracks || []
    return filesList.map((f, idx) => {
      const src = typeof f === 'string' ? f : (f.src || f.id)
      const isYt = src.startsWith('yt:')
      const videoId = isYt ? src.replace('yt:', '') : null
      const meta = artCache?.[src] || localMeta[src] || (typeof f === 'object' ? f : {})
      const filename = src.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')
      const isDown = isDownloaded(src)

      return {
        src,
        id: src || `pl-track-${idx}`,
        videoId,
        title: meta.title || (isYt ? 'Online Track' : filename),
        artist: meta.artist || meta.author || 'Unknown Artist',
        album: isDown ? 'Downloaded' : (meta.album || (isYt ? 'Single' : '')),
        albumArt: meta.albumArt || meta.thumbnail || (isYt ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
        duration: typeof meta.duration === 'object' ? (meta.duration?.seconds || 0) : (meta.duration || 0),
        source: isDown ? 'downloaded' : (isYt ? 'online' : 'local'),
        isDownloaded: isDown
      }
    })
  }, [currentPlaylist, artCache, localMeta, isDownloaded])

  // Auto-fetch missing duration & metadata for tracks in the active playlist
  useEffect(() => {
    if (!playlistTracks || playlistTracks.length === 0) return

    // 1. Missing local tracks
    const missingLocal = playlistTracks
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

    // 2. Missing online streaming tracks
    const missingOnline = playlistTracks
      .filter(t => t.src?.startsWith('yt:') && (!t.duration || t.duration === 0 || !t.title || t.title === 'Streaming Track' || t.title === 'Online Track' || !t.artist || t.artist === 'Unknown Artist'))
      .map(t => t.src)

    if (missingOnline.length > 0 && window.electronAPI?.dbGetBulkMetadata) {
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
  }, [playlistTracks])

  // Filtered tracks in current playlist
  const filteredPlaylistTracks = useMemo(() => {
    if (!trackSearch.trim()) return playlistTracks
    const q = trackSearch.toLowerCase().trim()
    return playlistTracks.filter(t => 
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.artist && t.artist.toLowerCase().includes(q)) ||
      (t.album && t.album.toLowerCase().includes(q))
    )
  }, [playlistTracks, trackSearch])

  // Total duration of current playlist
  const playlistDurationStr = useMemo(() => {
    const totalSec = playlistTracks.reduce((acc, t) => acc + (typeof t.duration === 'number' ? t.duration : 0), 0)
    if (!totalSec) return `${playlistTracks.length} song${playlistTracks.length !== 1 ? 's' : ''}`
    const hours = Math.floor(totalSec / 3600)
    const mins = Math.floor((totalSec % 3600) / 60)
    if (hours > 0) return `${hours} hr ${mins} min`
    return `${mins} min`
  }, [playlistTracks])

  // Filtered playlists in main view
  const filteredPlaylists = useMemo(() => {
    if (!playlistSearch.trim()) return safePlaylists
    const q = playlistSearch.toLowerCase().trim()
    return safePlaylists.filter(p => p.name && p.name.toLowerCase().includes(q))
  }, [safePlaylists, playlistSearch])

  // Handlers for Playlist actions
  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim()
    if (!name) return
    onCreateAndAddToPlaylist?.(null, name)
    setNewPlaylistName('')
    setShowCreateModal(false)
  }

  const finishImport = (tracks, name, extra) => {
    onCreateAndAddToPlaylist?.(tracks, name || 'Imported Playlist', extra || {})
    setImportUrl('')
    setImportNotice(null)
    setShowImportModal(false)
  }

  const handleImportPlaylist = async () => {
    const url = importUrl.trim()
    if (!url) return
    setIsImporting(true)
    try {
      if (window.electronAPI?.importPlaylist) {
        const res = await window.electronAPI.importPlaylist(url)
        if (res && res.success && res.tracks && res.tracks.length > 0) {
          // Main process walks the whole playlist via Spotify's partner API. This
          // only trips when that path was blocked and it fell back to the embed's
          // 100-track list — ask instead of silently handing over a partial one.
          if (res.truncated && res.total > res.tracks.length) {
            setImportNotice({
              url,
              name: res.name,
              tracks: res.tracks,
              got: res.tracks.length,
              total: res.total,
              cover: res.cover,
              externalId: res.externalId
            })
          } else {
            finishImport(res.tracks, res.name, { thumbnail: res.cover, externalId: res.externalId })
          }
        } else {
          alert(res?.error || 'Failed to import playlist. Please verify the URL is public and supported.')
        }
      }
    } catch (e) {
      console.error(e)
      alert('Error importing playlist')
    }
    setIsImporting(false)
  }

  // Sign in to Spotify, then re-run the import — the authenticated Web API
  // paginates past the 100-track cap.
  const handleConnectAndImport = async () => {
    if (!importNotice) return
    setIsImporting(true)
    try {
      const auth = await window.electronAPI?.authSpotify?.()
      if (auth?.success) {
        const res = await window.electronAPI.importPlaylist(importNotice.url)
        if (res?.success && res.tracks?.length) {
          finishImport(res.tracks, res.name, { thumbnail: res.cover, externalId: res.externalId })
          setIsImporting(false)
          return
        }
      }
      alert('Could not connect to Spotify. You can still import the first ' + importNotice.got + ' tracks.')
    } catch (e) {
      console.error(e)
      alert('Could not connect to Spotify.')
    }
    setIsImporting(false)
  }

  const handleSaveRename = (id, newName) => {
    const name = newName.trim()
    if (!name || !id) return
    onRenamePlaylist?.(id, name)
    setRenameTarget(null)
    setIsInlineEditing(false)
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    onDeletePlaylist?.(deleteTarget.id)
    if (selectedId === deleteTarget.id) setSelectedId(null)
    setDeleteTarget(null)
  }

  useEffect(() => {
    const off = window.electronAPI?.onDownloadProgress?.((data) => {
      if (!data || !data.videoId) return
      const src = `yt:${data.videoId}`
      setDownloadPercentBySrc(prev => (prev[src] === data.percent ? prev : { ...prev, [src]: data.percent }))
    })
    return () => { if (typeof off === 'function') off() }
  }, [])

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
      setDownloadPercentBySrc(prev => {
        if (!(track.src in prev)) return prev
        const next = { ...prev }
        delete next[track.src]
        return next
      })
    }
  }

  const handleDownloadPlaylist = async () => {
    if (!currentPlaylist || isDownloadingAll) return
    const ytTracks = playlistTracks.filter(t => t.src?.startsWith('yt:') && !isDownloaded(t.src))
    if (ytTracks.length === 0) return

    setIsDownloadingAll(true)
    let done = 0

    for (let i = 0; i < ytTracks.length; i++) {
      const track = ytTracks[i]
      const videoId = track.videoId || track.src.replace('yt:', '')
      setDownloadProgress({ current: i + 1, total: ytTracks.length, title: track.title })

      try {
        const res = await window.electronAPI?.youtubeDownloadTrack(videoId, downloadFolder)
        if (res?.success) done++
        onShowDownloadNotification?.(track, !!res?.success)
      } catch (e) {
        console.error('Download failed for track:', track.title, e)
      }
    }

    await libRefreshDownloads?.()
    await propRefreshDownloads?.()
    setDownloadProgress(null)
    setIsDownloadingAll(false)
  }

  const openTrackContextMenu = (e, track) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      track
    })
  }

  // Create / import / rename / delete dialogs. These used to live only in the
  // list view, so deleting from inside a playlist set the state and rendered
  // nothing until you navigated back to the list. Both views now render them.
  const playlistOverlays = (
    <>
      {/* ── MODAL: CREATE PLAYLIST ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="bg-[var(--surface-2)] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">Create Playlist</h2>
            <p className="text-xs text-white/50 mb-4">Give your new playlist a descriptive name.</p>
            
            <input
              autoFocus
              type="text"
              placeholder="e.g. Late Night Vibes"
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreatePlaylist()
                if (e.key === 'Escape') setShowCreateModal(false)
              }}
              className="w-full bg-white/5 border border-white/15 focus:border-white/40 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none mb-5"
            />

            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => { setShowCreateModal(false); setNewPlaylistName('') }}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePlaylist}
                disabled={!newPlaylistName.trim()}
                className="px-6 py-2 rounded-full text-xs font-bold bg-white text-black hover:scale-105 active:scale-95 transition-all disabled:opacity-40 shadow-lg cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: IMPORT PLAYLIST ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="bg-[var(--surface-2)] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">Import Playlist URL</h2>
            <p className="text-xs text-white/50 mb-4">Paste any public YouTube or Spotify playlist link.</p>
            
            {importNotice ? (
              <div className="rounded-2xl border border-white/12 bg-white/5 p-4 mb-5">
                <p className="text-sm font-semibold text-white mb-1">
                  {importNotice.name || 'This playlist'} — {importNotice.got} of {importNotice.total} tracks
                </p>
                <p className="text-xs text-white/55 leading-relaxed">
                  Spotify sent only part of this playlist. That is usually a temporary limit, so
                  trying again often returns all {importNotice.total}.
                </p>
                <button
                  onClick={handleConnectAndImport}
                  disabled={isImporting}
                  className="mt-2 text-xs font-semibold text-white/80 underline underline-offset-2 hover:text-white disabled:opacity-40 cursor-pointer"
                >
                  Or connect your Spotify account
                </button>
              </div>
            ) : (
            <input
              autoFocus
              type="text"
              placeholder="https://open.spotify.com/playlist/... or https://youtube.com/playlist?list=..."
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleImportPlaylist()
                if (e.key === 'Escape') setShowImportModal(false)
              }}
              disabled={isImporting}
              className="w-full bg-white/5 border border-white/15 focus:border-white/40 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none mb-5 disabled:opacity-50"
            />
            )}

            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => { setShowImportModal(false); setImportUrl(''); setImportNotice(null) }}
                disabled={isImporting}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              {importNotice ? (
                <>
                  <button
                    onClick={() => {
                      finishImport(importNotice.tracks, importNotice.name, {
                        thumbnail: importNotice.cover,
                        externalId: importNotice.externalId
                      })
                      setIsImporting(false)
                    }}
                    disabled={isImporting}
                    className="px-4 py-2 rounded-full text-xs font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-all disabled:opacity-40 cursor-pointer"
                  >
                    Import {importNotice.got}
                  </button>
                  <button
                    onClick={handleImportPlaylist}
                    disabled={isImporting}
                    className="px-5 py-2 rounded-full text-xs font-bold bg-white text-black hover:scale-105 active:scale-95 transition-all disabled:opacity-40 shadow-lg cursor-pointer flex items-center gap-2"
                  >
                    {isImporting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        <span>Retrying...</span>
                      </>
                    ) : (
                      <span>Try again</span>
                    )}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleImportPlaylist}
                  disabled={!importUrl.trim() || isImporting}
                  className="px-6 py-2 rounded-full text-xs font-bold bg-white text-black hover:scale-105 active:scale-95 transition-all disabled:opacity-40 shadow-lg cursor-pointer flex items-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Importing...</span>
                    </>
                  ) : (
                    <span>Import</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RENAME PLAYLIST ── */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="bg-[var(--surface-2)] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">Rename Playlist</h2>
            <p className="text-xs text-white/50 mb-4">Choose a new name for "{renameTarget.name}".</p>
            
            <input
              autoFocus
              type="text"
              defaultValue={renameTarget.name}
              id="rename-input"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleSaveRename(renameTarget.id, e.target.value)
                }
                if (e.key === 'Escape') setRenameTarget(null)
              }}
              className="w-full bg-white/5 border border-white/15 focus:border-white/40 rounded-2xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none mb-5"
            />

            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => setRenameTarget(null)}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val = document.getElementById('rename-input')?.value
                  handleSaveRename(renameTarget.id, val)
                }}
                className="px-6 py-2 rounded-full text-xs font-bold bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-lg cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CONFIRM DELETE PLAYLIST ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-150">
          <div className="bg-[var(--surface-2)] border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-1">Delete Playlist</h2>
            <p className="text-xs text-white/60 mb-5">
              Are you sure you want to delete <span className="font-bold text-white">"{deleteTarget.name}"</span>? This will remove the playlist from your library, but will not delete your downloaded audio files.
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-full text-xs font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="on-accent px-6 py-2 rounded-full text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white hover:scale-105 active:scale-95 transition-all shadow-lg cursor-pointer"
              >
                Delete Playlist
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 1: PLAYLIST DETAIL VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (currentPlaylist) {
    return (
      <div className="flex flex-col h-full overflow-hidden select-none animate-in fade-in duration-200">
        
        {/* ── Top Bar & Breadcrumbs ── */}
        <div className="px-6 sm:px-8 pt-5 pb-3 shrink-0 flex items-center justify-between border-b border-white/5 bg-white/[0.02]">
          <button
            onClick={() => { setSelectedId(null); setTrackSearch('') }}
            className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-white/50 hover:text-white transition-colors cursor-pointer group"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            <span>Playlists</span>
            <span className="text-white/20">/</span>
            <span className="text-white/80 truncate max-w-[200px]">{currentPlaylist.name}</span>
          </button>

          {/* Quick Actions in Top Bar */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setInlineName(currentPlaylist.name)
                setIsInlineEditing(true)
                setTimeout(() => inlineInputRef.current?.focus(), 50)
              }}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/5 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Rename playlist"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <span>Rename</span>
            </button>

            <button
              onClick={() => setDeleteTarget(currentPlaylist)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Delete playlist"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
              <span>Delete</span>
            </button>
          </div>
        </div>

        {/* ── Hero Header ── */}
        <div className="px-6 sm:px-8 py-6 shrink-0 bg-gradient-to-b from-white/[0.05] via-transparent to-transparent border-b border-white/5">
          <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6">
            
            {/* Playlist Mosaic Cover */}
            <PlaylistCover files={playlistTracks} size="lg" className="shadow-2xl shadow-black/60 border border-white/10" />

            {/* Info & Title */}
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <span className="text-[10px] font-black uppercase tracking-widest text-white/50 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/10 inline-block mb-2">
                Playlist
              </span>

              {isInlineEditing ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSaveRename(currentPlaylist.id, inlineName) }}
                  className="flex items-center gap-2 max-w-lg mt-1"
                >
                  <input
                    ref={inlineInputRef}
                    type="text"
                    value={inlineName}
                    onChange={e => setInlineName(e.target.value)}
                    className="flex-1 text-2xl sm:text-3xl font-black bg-white/10 text-white rounded-xl px-3 py-1 border border-white/30 focus:outline-none focus:border-white"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:scale-105 transition-all cursor-pointer shadow-lg"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsInlineEditing(false)}
                    className="px-3 py-2 rounded-xl bg-white/10 text-white/70 hover:text-white text-xs font-semibold transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <h1 
                  onClick={() => {
                    setInlineName(currentPlaylist.name)
                    setIsInlineEditing(true)
                    setTimeout(() => inlineInputRef.current?.focus(), 50)
                  }}
                  className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight hover:text-white/90 cursor-pointer group transition-colors"
                  title="Click to rename"
                >
                  <span>{currentPlaylist.name}</span>
                  <span className="inline-block ml-2.5 opacity-0 group-hover:opacity-60 transition-opacity text-sm">✎</span>
                </h1>
              )}

              <p className="text-xs sm:text-sm text-white/50 mt-2 flex items-center justify-center sm:justify-start gap-2">
                <span className="font-semibold text-white/80">
                  <FancyUsername userProfile={userProfile} fallback="You" />
                </span>
                <span>•</span>
                <span>{playlistTracks.length} song{playlistTracks.length !== 1 ? 's' : ''}</span>
                <span>•</span>
                <span>{playlistDurationStr}</span>
              </p>
            </div>

          </div>

          {/* Action Bar (Play All, Shuffle, Download All, Search) */}
          <div className="flex flex-wrap items-center justify-between gap-4 mt-6 pt-5 border-t border-white/5">
            
            <div className="flex items-center gap-3">
              {/* Play All Button */}
              <button
                onClick={() => {
                  if (playlistTracks.length === 0) return
                  const isCurrentInList = currentTrack && playlistTracks.some(t => t.src === currentTrack.src)
                  if (isCurrentInList) {
                    togglePlayPause()
                  } else {
                    replaceQueue(playlistTracks, 0)
                  }
                }}
                disabled={playlistTracks.length === 0}
                className="h-11 px-6 rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold text-xs shadow-xl cursor-pointer disabled:opacity-40 disabled:hover:scale-100"
              >
                {isPlaying && currentTrack && playlistTracks.some(t => t.src === currentTrack.src) ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>
                    <span>{currentTrack && playlistTracks.some(t => t.src === currentTrack.src) ? 'Resume' : 'Play All'}</span>
                  </>
                )}
              </button>

              {/* Shuffle Button */}
              <button
                onClick={() => {
                  if (playlistTracks.length > 0) {
                    const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5)
                    replaceQueue(shuffled, 0)
                  }
                }}
                disabled={playlistTracks.length === 0}
                className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all flex items-center justify-center border border-white/10 cursor-pointer active:scale-95 disabled:opacity-40"
                title="Shuffle Playlist"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                </svg>
              </button>

              {/* Download Playlist Button */}
              {isDownloadingAll ? (
                <div className="h-11 px-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-2.5 shadow-sm">
                  <div className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <span>Downloading {downloadProgress?.current} / {downloadProgress?.total}...</span>
                </div>
              ) : (
                <button
                  onClick={handleDownloadPlaylist}
                  disabled={playlistTracks.length === 0}
                  className="h-11 px-4 rounded-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer disabled:opacity-40"
                  title="Download all stream tracks in this playlist"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download Playlist</span>
                </button>
              )}
            </div>

            {/* Track Search */}
            <div className="relative flex items-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white/40 absolute left-3 pointer-events-none">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                placeholder="Search in playlist..."
                value={trackSearch}
                onChange={e => setTrackSearch(e.target.value)}
                className="w-44 sm:w-56 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 focus:border-white/25 rounded-full pl-8 pr-7 py-1.5 text-xs text-white placeholder-white/30 outline-none transition-all"
              />
              {trackSearch && (
                <button
                  onClick={() => setTrackSearch('')}
                  className="absolute right-2.5 text-white/40 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

          </div>
        </div>

        {/* ── Track List Rows ── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-8 py-3 pb-24">
          {playlistTracks.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-center text-white/40 gap-3">
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/20">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                  <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
                </svg>
              </div>
              <p className="text-base font-bold text-white/70">This playlist is empty</p>
              <p className="text-xs text-white/40 max-w-sm">
                Right-click any track in your library or streaming search and select "Add to Playlist" → "{currentPlaylist.name}".
              </p>
            </div>
          ) : (
            <>
              {/* Header Row */}
              <div className="grid grid-cols-[2.5rem_minmax(0,3.5fr)_minmax(0,2fr)_5.5rem_7rem] items-center px-4 py-2 text-[11px] font-bold text-white/40 uppercase tracking-wider border-b border-white/5 mb-1">
                <span>#</span>
                <span>Title</span>
                <span>Album</span>
                <span className="text-right pr-2">Duration</span>
                <span className="text-right pr-2">Actions</span>
              </div>

              {/* Rows */}
              {filteredPlaylistTracks.length > 0 ? (
                filteredPlaylistTracks.map((track, idx) => {
                  const isCurrent = currentTrack?.src === track.src
                  const isTrackPlaying = isCurrent && isPlaying
                  const art = track.albumArt || getArtURL(track.src)
                  const isTrackDown = track.isDownloaded || isDownloaded(track.src)

                  return (
                    <div
                      key={track.src || idx}
                      onClick={() => {
                        if (isCurrent) {
                          togglePlayPause()
                        } else {
                          replaceQueue(filteredPlaylistTracks, idx)
                        }
                      }}
                      onContextMenu={e => openTrackContextMenu(e, track)}
                      className={`grid grid-cols-[2.5rem_minmax(0,3.5fr)_minmax(0,2fr)_5.5rem_7rem] items-center px-4 py-2.5 rounded-2xl group transition-all duration-150 cursor-pointer ${
                        isCurrent 
                          ? 'bg-white/[0.08] border border-white/10' 
                          : 'hover:bg-white/[0.04] border border-transparent'
                      }`}
                    >
                      {/* Index / Play animation */}
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

                      {/* Title & Artist */}
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

                      {/* Album & Downloaded Badge */}
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

                      {/* Duration */}
                      <div className="text-right text-xs text-white/50 font-mono pr-2">
                        {formatTime(track.duration)}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1">
                        {/* Remove from Playlist Button */}
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            onRemoveFromPlaylist?.(currentPlaylist.id, track.src)
                          }}
                          className="p-1.5 rounded-full hover:bg-rose-500/20 text-white/40 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          title="Remove from this playlist"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                          </svg>
                        </button>

                        {/* Download button */}
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
                            title={
                              isTrackDown
                                ? 'Downloaded'
                                : downloadingIds.has(track.src)
                                ? `Downloading ${downloadPercentBySrc[track.src] ?? 0}%`
                                : 'Download in highest quality'
                            }
                          >
                            {isTrackDown ? (
                              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-400">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                              </svg>
                            ) : downloadingIds.has(track.src) ? (
                              <svg viewBox="0 0 36 36" className="w-4 h-4 -rotate-90" aria-hidden="true">
                                <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(52,211,153,0.25)" strokeWidth="4" />
                                <circle
                                  cx="18"
                                  cy="18"
                                  r="15"
                                  fill="none"
                                  stroke="#34d399"
                                  strokeWidth="4"
                                  strokeLinecap="round"
                                  strokeDasharray={`${((downloadPercentBySrc[track.src] ?? 0) / 100) * 94.25} 94.25`}
                                  style={{ transition: 'stroke-dasharray 250ms linear' }}
                                />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            )}
                          </button>
                        )}

                        {/* 3-dots Context Menu Button */}
                        <button
                          onClick={e => openTrackContextMenu(e, track)}
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
                  <p className="text-sm font-semibold">No tracks match "{trackSearch}"</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Context Menu ── */}
        {contextMenu.visible && contextMenu.track && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            track={contextMenu.track}
            playlists={safePlaylists}
            isFavourite={false}
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

        {/* Rename / delete dialogs work from inside a playlist too. */}
        {playlistOverlays}

      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VIEW 2: PLAYLISTS GRID OVERVIEW
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full overflow-hidden select-none animate-in fade-in duration-200">
      
      {/* ── Main Header ── */}
      <div className="px-6 sm:px-8 pt-7 pb-5 shrink-0 border-b border-white/5 bg-gradient-to-b from-white/[0.04] to-transparent">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
          
          <div>
            <span className="text-[10.5px] font-black uppercase tracking-widest text-white/50">Library</span>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mt-0.5">
              Playlists
            </h1>
            <p className="text-xs sm:text-sm text-white/50 mt-1">
              {safePlaylists.length} playlist{safePlaylists.length !== 1 ? 's' : ''} in your collection
            </p>
          </div>

          {/* Action Buttons & Search */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative flex items-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/40 absolute left-3 pointer-events-none">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                placeholder="Search playlists..."
                value={playlistSearch}
                onChange={e => setPlaylistSearch(e.target.value)}
                className="w-44 sm:w-56 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 focus:border-white/25 rounded-full pl-9 pr-7 py-1.5 text-xs text-white placeholder-white/30 outline-none transition-all"
              />
              {playlistSearch && (
                <button
                  onClick={() => setPlaylistSearch('')}
                  className="absolute right-2.5 text-white/40 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Import Playlist URL Button */}
            <button
              onClick={() => setShowImportModal(true)}
              className="h-10 px-4 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white border border-white/10 transition-all flex items-center gap-2 font-bold text-xs cursor-pointer active:scale-95"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span>Import URL</span>
            </button>

            {/* New Playlist Button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="h-10 px-5 rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-all flex items-center gap-2 font-bold text-xs shadow-xl cursor-pointer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>New Playlist</span>
            </button>
          </div>

        </div>
      </div>

      {/* ── Playlists Cards Grid ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 sm:px-8 py-6 pb-24">
        {safePlaylists.length === 0 ? (
          <div className="py-24 flex flex-col items-center justify-center text-center text-white/40 gap-4">
            <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-white/20 shadow-2xl">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10">
                <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white/80">No playlists created yet</h2>
            <p className="text-xs text-white/40 max-w-sm">
              Organize your favourite tracks by creating custom playlists or importing public playlists from YouTube and Spotify.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-2 h-10 px-6 rounded-full bg-white text-black font-bold text-xs hover:scale-105 transition-all shadow-xl cursor-pointer"
            >
              Create Your First Playlist
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
            {filteredPlaylists.map(pl => {
              const tracks = pl.files || pl.tracks || []
              return (
                <div
                  key={pl.id}
                  onClick={() => setSelectedId(pl.id)}
                  className="group bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-white/15 rounded-2xl p-3.5 transition-all duration-200 cursor-pointer flex flex-col relative shadow-lg hover:shadow-2xl hover:-translate-y-1"
                >
                  {/* Card Cover & Floating Play Button */}
                  <div className="relative mb-3.5">
                    <PlaylistCover files={tracks} size="md" className="shadow-md group-hover:shadow-xl transition-all" />
                    
                    {/* Hover Play Button */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (tracks.length > 0) {
                          const mapped = tracks.map(f => typeof f === 'string' ? { src: f, id: f, title: f } : f)
                          replaceQueue(mapped, 0)
                        }
                      }}
                      className="absolute bottom-2.5 right-2.5 w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-2xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer z-10"
                      title="Play Playlist"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                  </div>

                  {/* Info */}
                  <div className="flex items-start justify-between gap-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-white truncate group-hover:text-emerald-400 transition-colors">
                        {pl.name}
                      </h3>
                      <p className="text-xs text-white/40 mt-0.5 truncate">
                        {tracks.length} song{tracks.length !== 1 ? 's' : ''}
                      </p>
                    </div>

                    {/* Quick Menu Button */}
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setRenameTarget(pl)
                      }}
                      className="p-1 rounded-lg text-white/30 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                      title="Rename Playlist"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>

                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setDeleteTarget(pl)
                      }}
                      className="p-1 rounded-lg text-white/30 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                      title="Delete Playlist"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Shared overlays — the detail view renders these too. */}
      {playlistOverlays}

    </div>
  )
}


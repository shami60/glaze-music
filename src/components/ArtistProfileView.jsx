import React, { useState, useEffect } from 'react'
import { usePlayer } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getHighQualityArtURL, getSizedArtURL, onArtLoad, formatTime } from '../utils'
import ContextMenu from './ContextMenu'
import ClickableArtists from './ClickableArtists'
import { GLOBAL_ARTIST_AVATARS } from '../constants/curatedMixes'
import { togglePin, isPinned, pinIdFor } from '../pinnedPlaylists'

// Artist payloads carry a bio, header image and every section's items — tens of
// KB each. Capped so browsing many artists does not accumulate for the session.
const ARTIST_CACHE_MAX = 25
const clientArtistCache = new Map()
function cacheArtist(key, value) {
  clientArtistCache.delete(key)
  clientArtistCache.set(key, value)
  while (clientArtistCache.size > ARTIST_CACHE_MAX) {
    clientArtistCache.delete(clientArtistCache.keys().next().value)
  }
}

export default function ArtistProfileView({ 
  artistName, 
  onBack,
  playlists = [],
  favourites,
  streamingFavourites,
  onAddToFavourites,
  onRemoveFromFavourites,
  onAddToPlaylist,
  onCreateAndAddToPlaylist,
  onOpenPlaylistModal,
  onShowDownloadNotification,
  downloadFolder,
  refreshDownloads,
  onDeletePlaylist
}) {
  const { replaceQueue, addToQueue, playNext, startRadio, accentColor, theme } = usePlayer()
  const { isFollowingArtist, toggleFollowArtist } = useLibrary()

  const cacheKey = String(artistName || '').trim().toLowerCase()
  const initialCached = clientArtistCache.get(cacheKey)

  // ── All Component State Hooks (Must be at the very top) ─────────────────
  const [artistData, setArtistData] = useState(initialCached || null)
  const [isLoading, setIsLoading] = useState(!initialCached)
  const [error, setError] = useState(null)
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  const [albumTracks, setAlbumTracks] = useState([])
  const [isLoadingAlbum, setIsLoadingAlbum] = useState(false)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, track: null, rawItem: null })
  const [isBioExpanded, setIsBioExpanded] = useState(false)
  const [showAllTopSongs, setShowAllTopSongs] = useState(false)

  const artistDisplayName = artistData?.name || artistData?.header?.title || artistName || 'Unknown Artist'

  // ── Effect: Fetch Artist Data ───────────────────────────────────────────
  useEffect(() => {
    if (!artistName) return

    let isMounted = true
    const key = String(artistName).trim().toLowerCase()
    const cached = clientArtistCache.get(key)
    if (cached) {
      setArtistData(cached)
      setIsLoading(false)
      setError(null)
    } else {
      setIsLoading(true)
      setError(null)
    }

    async function fetchArtist() {
      try {
        if (window.electronAPI?.youtubeGetArtistInfo) {
          const data = await window.electronAPI.youtubeGetArtistInfo(artistName)
          if (isMounted) {
            if (data) {
              cacheArtist(key, data)
              setArtistData(data)
              const art = data.headerImage || data.header?.thumbnail || data.thumbnail || data.sections?.[0]?.items?.[0]?.thumbnail || GLOBAL_ARTIST_AVATARS[artistName?.toLowerCase()]
              if (art && window.electronAPI?.dbSaveArtistArtCache) {
                window.electronAPI.dbSaveArtistArtCache(artistName, art)
              }
            } else if (!cached) {
              setError("Artist not found.")
            }
            setIsLoading(false)
          }
        } else {
          if (isMounted && !cached) {
            setError("API not available.")
            setIsLoading(false)
          }
        }
      } catch (err) {
        if (isMounted && !cached) {
          setError("Failed to fetch artist.")
          setIsLoading(false)
        }
      }
    }

    fetchArtist()
    return () => { isMounted = false }
  }, [artistName])

  // ── Effect: Fetch Album Tracks When Selected ────────────────────────────
  useEffect(() => {
    if (!selectedAlbum) {
      setAlbumTracks([])
      return
    }

    let isMounted = true
    setIsLoadingAlbum(true)
    const albumId = selectedAlbum.videoId || selectedAlbum.id
    const fallbackArtist = (selectedAlbum.artist && selectedAlbum.artist !== 'Unknown Artist' && selectedAlbum.artist !== 'Unknown')
      ? selectedAlbum.artist
      : (artistDisplayName || artistName || 'Unknown Artist')

    async function loadTracks() {
      try {
        if (window.electronAPI?.youtubeGetPlaylist && albumId) {
          const data = await window.electronAPI.youtubeGetPlaylist(albumId)
          if (isMounted) {
            if (data && data.length > 0) {
              const mapped = data.map(i => ({
                id: i.videoId,
                videoId: i.videoId,
                src: `yt:${i.videoId}`,
                title: i.title,
                artist: (i.artist && i.artist !== 'Unknown Artist' && i.artist !== 'Unknown') ? i.artist : fallbackArtist,
                album: i.album || selectedAlbum.title || null,
                duration: typeof i.duration === 'object' ? i.duration?.seconds : (i.duration || 0),
                thumbnail: i.thumbnail || selectedAlbum.thumbnail || `https://i.ytimg.com/vi/${i.videoId}/hqdefault.jpg`,
                fromStreaming: true
              }))
              setAlbumTracks(mapped)
            } else {
              // Fallback: search for top tracks matching this release title and artist
              const searchRes = await window.electronAPI?.youtubeSearch?.(`${selectedAlbum.title} ${fallbackArtist}`, 'songs')
              const songList = searchRes?.songs || []
              if (songList.length > 0) {
                const mapped = songList.map(i => ({
                  id: i.videoId,
                  videoId: i.videoId,
                  src: `yt:${i.videoId}`,
                  title: i.title,
                  artist: (i.artist && i.artist !== 'Unknown Artist' && i.artist !== 'Unknown') ? i.artist : fallbackArtist,
                  album: selectedAlbum.title,
                  duration: i.duration || 0,
                  thumbnail: i.thumbnail || selectedAlbum.thumbnail,
                  fromStreaming: true
                }))
                setAlbumTracks(mapped)
              }
            }
            setIsLoadingAlbum(false)
          }
        }
      } catch (err) {
        if (isMounted) {
          console.error('Failed to load album tracks:', err)
          setIsLoadingAlbum(false)
        }
      }
    }

    loadTracks()
    return () => { isMounted = false }
  }, [selectedAlbum, artistDisplayName, artistName])

  // ── Context Menu & Handlers ─────────────────────────────────────────────
  const handleContextMenu = (e, item) => {
    e.preventDefault()
    e.stopPropagation()
    let x = e.clientX
    let y = e.clientY
    if (x + 220 > window.innerWidth) x = window.innerWidth - 230
    if (y + 200 > window.innerHeight) y = window.innerHeight - 210

    const videoId = item.videoId || item.id
    const itemArtist = (item.artist && item.artist !== 'Unknown Artist' && item.artist !== 'Unknown')
      ? item.artist
      : (artistDisplayName || artistName || 'Unknown Artist')
    const mappedTrack = {
      id: videoId,
      src: item.src || `yt:${videoId}`,
      title: item.title,
      artist: itemArtist,
      album: item.album || (item.type === 'Album' ? item.title : null),
      albumArt: getSizedArtURL(item.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null), 'card'),
      duration: typeof item.duration === 'object' ? item.duration?.seconds : (parseInt(item.duration, 10) || 0),
      type: item.type || 'Song'
    }
    setContextMenu({ visible: true, x, y, track: mappedTrack, rawItem: item })
  }

  const handleDownload = (track) => {
    if (track.src?.startsWith('yt:')) {
      const videoId = track.src.replace('yt:', '')
      window.electronAPI?.youtubeDownloadTrack(videoId, downloadFolder).then(res => {
        const ok = !!res?.success
        onShowDownloadNotification?.(track, ok)
        if (ok) refreshDownloads?.()
      }).catch(e => {
        onShowDownloadNotification?.(track, false)
      })
    }
  }

  const handlePlaySong = async (song, sectionItems = []) => {
    const isPl = song.type === 'Playlist' || song.type === 'Album' || song.type === 'Single' || song.type === 'EP' || song.videoId?.startsWith('MPREb_') || song.videoId?.startsWith('VL') || song.videoId?.startsWith('PL') || song.videoId?.startsWith('RDCLAK') || song.videoId?.startsWith('FEmusic_')
    if (isPl) {
      return handlePlayPlaylist(song)
    }

    const fallbackArtist = (artistDisplayName && artistDisplayName !== 'Unknown Artist' && artistDisplayName !== 'Unknown')
      ? artistDisplayName
      : (artistName || 'Unknown Artist')

    // Filter sectionItems to only actual playable songs
    const playableItems = (sectionItems || []).filter(i => {
      const iIsPl = i.type === 'Playlist' || i.type === 'Album' || i.type === 'Single' || i.type === 'EP' || i.videoId?.startsWith('MPREb_') || i.videoId?.startsWith('VL') || i.videoId?.startsWith('PL') || i.videoId?.startsWith('RDCLAK') || i.videoId?.startsWith('FEmusic_') || i.type === 'Artist'
      return !iIsPl && i.videoId
    })

    const queue = playableItems.map(i => ({
      id: i.videoId,
      src: `yt:${i.videoId}`,
      title: i.title,
      artist: (i.artist && i.artist !== 'Unknown Artist' && i.artist !== 'Unknown') ? i.artist : fallbackArtist,
      album: i.album || null,
      duration: typeof i.duration === 'object' ? i.duration?.seconds : (i.duration || 0),
      albumArt: i.thumbnail || `https://i.ytimg.com/vi/${i.videoId}/hqdefault.jpg`,
      fromStreaming: true
    }))
    
    const trackIndex = queue.findIndex(q => q.id === song.videoId)
    if (trackIndex !== -1) {
      replaceQueue(queue, trackIndex)
    } else {
      replaceQueue([{
        id: song.videoId,
        src: `yt:${song.videoId}`,
        title: song.title,
        artist: (song.artist && song.artist !== 'Unknown Artist' && song.artist !== 'Unknown') ? song.artist : fallbackArtist,
        album: song.album || null,
        duration: typeof song.duration === 'object' ? song.duration?.seconds : (song.duration || 0),
        albumArt: song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
        fromStreaming: true
      }])
    }
  }

  const handlePlayPlaylist = async (playlist) => {
    const playlistId = playlist.videoId || playlist.id
    if (!playlistId || !window.electronAPI?.youtubeGetPlaylist) return
    const fallbackArtist = (playlist.artist && playlist.artist !== 'Unknown Artist' && playlist.artist !== 'Unknown')
      ? playlist.artist
      : ((artistDisplayName && artistDisplayName !== 'Unknown Artist' && artistDisplayName !== 'Unknown') ? artistDisplayName : (artistName || 'Unknown Artist'))
    try {
      const data = await window.electronAPI.youtubeGetPlaylist(playlistId)
      if (data && data.length > 0) {
        const queue = data.map(i => ({
          id: i.videoId,
          src: `yt:${i.videoId}`,
          title: i.title,
          artist: (i.artist && i.artist !== 'Unknown Artist' && i.artist !== 'Unknown') ? i.artist : fallbackArtist,
          album: i.album || playlist.title || null,
          duration: typeof i.duration === 'object' ? i.duration?.seconds : (i.duration || 0),
          albumArt: i.thumbnail || playlist.thumbnail || `https://i.ytimg.com/vi/${i.videoId}/hqdefault.jpg`,
          fromStreaming: true
        }))
        replaceQueue(queue, 0)
      } else {
        // Fallback: search for top tracks by this release
        const searchRes = await window.electronAPI?.youtubeSearch?.(`${playlist.title} ${fallbackArtist}`, 'songs')
        const songList = searchRes?.songs || []
        if (songList.length > 0) {
          replaceQueue(songList.map(i => ({
            id: i.videoId,
            src: `yt:${i.videoId}`,
            title: i.title,
            artist: (i.artist && i.artist !== 'Unknown Artist' && i.artist !== 'Unknown') ? i.artist : fallbackArtist,
            album: playlist.title || null,
            duration: typeof i.duration === 'object' ? i.duration?.seconds : (i.duration || 0),
            albumArt: i.thumbnail || playlist.thumbnail || `https://i.ytimg.com/vi/${i.videoId}/hqdefault.jpg`,
            fromStreaming: true
          })), 0)
        }
      }
    } catch(e) {
      console.error('Error playing playlist/album:', e)
    }
  }

  const renderCard = (item, sectionItems) => {
    const isPlaylist = item.type === 'Playlist' || item.type === 'Album' || item.type === 'Single' || item.type === 'EP' || item.videoId?.startsWith('MPREb_') || item.videoId?.startsWith('VL') || item.videoId?.startsWith('PL') || item.videoId?.startsWith('RDCLAK') || item.videoId?.startsWith('FEmusic_')
    const isArtist = item.type === 'Artist' || item.videoId?.startsWith('UC')

    // Clean display type
    let displayType = item.type || 'Song'
    if (displayType.startsWith('Music')) {
      displayType = isPlaylist ? 'Album' : (isArtist ? 'Artist' : 'Song')
    }

    const itemArtist = (item.artist && item.artist !== 'Unknown Artist' && item.artist !== 'Unknown')
      ? item.artist
      : (artistDisplayName || artistName || 'Unknown Artist')

    return (
      <div 
        key={item.videoId || item.id}
        className="group relative flex flex-col p-2 rounded-2xl bg-transparent hover:bg-white/[0.07] transition-all duration-300 cursor-pointer"
        onClick={() => {
          if (isArtist) window.dispatchEvent(new CustomEvent('open-artist', { detail: item.title }))
          else if (isPlaylist) setSelectedAlbum({ ...item, artist: itemArtist })
          else handlePlaySong(item, sectionItems)
        }}
        onContextMenu={(e) => handleContextMenu(e, item)}
      >
        <div className={`relative w-full aspect-square mb-2.5 overflow-hidden bg-white/5 border border-white/10 shadow-lg ${isArtist ? 'rounded-full' : 'rounded-xl'}`}>
          {item.thumbnail ? (
            <img 
              src={getSizedArtURL(item.thumbnail || (item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` : null), 'card')} 
              alt={item.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={(e) => { e.target.style.opacity = '0.5' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
            </div>
          )}
          
          {/* Pin to sidebar. Artist pages are YouTube Music data, so a pin from
              here reopens through `yt_streaming`. */}
          {isPlaylist && (() => {
            const pinned = isPinned(pinIdFor(item))
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(item, 'yt')
                }}
                className={`absolute top-2 right-12 w-8 h-8 rounded-full border flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer z-10 ${
                  pinned
                    ? 'opacity-100 bg-white text-black border-white'
                    : 'opacity-0 group-hover:opacity-100 bg-[var(--surface-1)] hover:bg-black text-white border-white/20'
                }`}
                title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                aria-label={pinned ? `Unpin ${item.title} from sidebar` : `Pin ${item.title} to sidebar`}
                aria-pressed={pinned}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
                </svg>
              </button>
            )
          })()}

          {/* Quick Context Menu Button (3 dots) */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleContextMenu(e, item)
            }}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer z-10"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>

          {(!isArtist) && (
            <div 
              onClick={(e) => { 
                e.stopPropagation(); 
                if (isPlaylist) handlePlayPlaylist(item)
                else handlePlaySong(item, sectionItems); 
              }}
              className="absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-2xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-110 active:scale-95 transition-all duration-300"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><path d="M8 5v14l11-7z"/></svg>
            </div>
          )}
        </div>
        <div className="w-full min-w-0 px-0.5">
          <h4 className="text-[13px] font-semibold text-white/90 truncate group-hover:text-white transition-colors">
            {item.title}
          </h4>
          <p className="text-[11px] text-white/50 truncate mt-0.5">
            {displayType} • {itemArtist}
          </p>
        </div>
      </div>
    )
  }

  // ── Render: Loading State ───────────────────────────────────────────────
  // Mounted without an artist to show (e.g. a restored view whose selection is
  // gone). The fetch effect returns early in that case, so `isLoading` would stay
  // true forever — render nothing and let the app navigate away instead.
  if (!artistName && !selectedAlbum) {
    return <div className="flex-1 w-full h-full" />
  }

  if (isLoading) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center h-full text-white/50 animate-in fade-in">
        <svg className="animate-spin mb-4 w-10 h-10" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="font-medium">Loading {artistName}...</p>
      </div>
    )
  }

  // ── Render: Error State ─────────────────────────────────────────────────
  if (error || !artistData) {
    return (
      <div className="flex-1 w-full flex flex-col items-center justify-center h-full text-white/50 p-8">
        <p className="text-xl mb-4 text-red-400">{error || "Could not load artist profile."}</p>
        <button onClick={onBack} className="px-6 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors cursor-pointer">
          Go Back
        </button>
      </div>
    )
  }

  if (selectedAlbum) {
    const albumThumb = getSizedArtURL(selectedAlbum.thumbnail || (selectedAlbum.videoId ? `https://i.ytimg.com/vi/${selectedAlbum.videoId}/hqdefault.jpg` : null), 'card')
    const releaseType = selectedAlbum.type || 'Album'
    const releaseArtist = selectedAlbum.artist || artistDisplayName || artistName || 'Unknown Artist'

    return (
      <div className="flex-1 w-full h-full overflow-y-auto pb-32 animate-in fade-in relative custom-scrollbar">
        {/* Back to the artist, pinned in the empty strip above the cover. */}
        <div className="sticky top-0 z-30 h-0">
          <button
            onClick={() => setSelectedAlbum(null)}
            className="absolute top-2 left-2 sm:left-3 w-9 h-9 rounded-full lg-glass-btn flex items-center justify-center text-white cursor-pointer"
            title="Back to Artist"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
        </div>

        {/* Header — no banner photograph, the same flat treatment as the artist page.
            A blurred full-bleed copy of the cover behind the title only fought the
            theme; the cover itself carries the identity. */}
        {/* Left padding clears the pinned back button above — a square cover has
            no transparent corner, so unlike the round artist portrait it visibly
            collided with the chevron. */}
        <div className="pl-12 sm:pl-16 pr-6 sm:pr-10 pt-2">
          <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-7">
            {/* Cover Art */}
            <div
              className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden shrink-0 border relative bg-white/5"
              style={{ borderColor: 'var(--hairline-strong)', boxShadow: `0 16px 40px -16px ${accentColor || '#ef4444'}80` }}
            >
              {albumThumb ? (
                <img
                  src={albumThumb}
                  alt={selectedAlbum.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/30">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 text-center sm:text-left">
              <span className="inline-flex items-center text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/10 text-white/80 border border-white/15 mb-2">
                {releaseType}
              </span>

              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-none mb-2 line-clamp-2">
                {selectedAlbum.title}
              </h1>

              <div className="flex items-center justify-center sm:justify-start gap-2 text-sm text-white/70">
                <span className="font-semibold text-white hover:underline cursor-pointer" onClick={() => setSelectedAlbum(null)}>
                  {releaseArtist}
                </span>
                <span>•</span>
                <span>{isLoadingAlbum ? 'Loading tracks...' : `${albumTracks.length} song${albumTracks.length !== 1 ? 's' : ''}`}</span>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-4">
                <button 
                  onClick={() => {
                    if (albumTracks.length > 0) replaceQueue(albumTracks, 0)
                  }}
                  disabled={albumTracks.length === 0}
                  style={{ backgroundColor: accentColor || '#ef4444' }}
                  className="px-7 py-3 rounded-full text-white font-bold text-sm shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <span>Play All</span>
                </button>

                <button 
                  onClick={() => {
                    if (albumTracks.length > 0) {
                      const shuffled = [...albumTracks].sort(() => Math.random() - 0.5)
                      replaceQueue(shuffled, 0)
                    }
                  }}
                  disabled={albumTracks.length === 0}
                  className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-sm shadow-lg border border-white/15 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                  </svg>
                  <span>Shuffle</span>
                </button>

                <button 
                  onClick={() => {
                    if (albumTracks.length > 0) addToQueue(albumTracks)
                  }}
                  disabled={albumTracks.length === 0}
                  className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center border border-white/15 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Add all to queue"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tracklist Table */}
        <div className="px-6 sm:px-10 mt-6">
          {isLoadingAlbum ? (
            <div className="py-16 flex flex-col items-center justify-center text-white/40">
              <svg className="animate-spin mb-3 w-8 h-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm font-medium">Loading album tracks...</span>
            </div>
          ) : albumTracks.length === 0 ? (
            <div className="py-16 text-center text-white/40">
              <p className="text-base font-semibold">No tracks found for this release.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {albumTracks.map((track, idx) => (
                <div 
                  key={track.id || track.videoId || idx}
                  onClick={() => replaceQueue(albumTracks, idx)}
                  onContextMenu={(e) => handleContextMenu(e, track)}
                  className="group flex items-center justify-between p-3 rounded-xl hover:bg-white/[0.07] transition-all duration-200 cursor-pointer border border-transparent hover:border-white/5"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="w-6 text-center text-xs font-semibold text-white/40 group-hover:text-white flex items-center justify-center">
                      <span className="group-hover:hidden">{idx + 1}</span>
                      <svg className="w-4 h-4 hidden group-hover:block ml-0.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>

                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/10">
                      <img 
                        src={getSizedArtURL(track.thumbnail || albumThumb, 'card')} 
                        alt="" 
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.opacity = '0.5' }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-white/90 truncate group-hover:text-white">
                        {track.title}
                      </h4>
                      <p className="text-xs text-white/50 truncate mt-0.5">
                        {track.artist}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs text-white/40">
                    <span>{formatTime(track.duration)}</span>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleContextMenu(e, track)
                      }}
                      className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
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
            isFavourite={favourites?.has(contextMenu.track.src) || streamingFavourites?.some(t => t.src === contextMenu.track.src)}
            onClose={() => setContextMenu(prev => ({ ...prev, visible: false }))}
            onPlay={() => replaceQueue([contextMenu.track])}
            onPlayNext={() => playNext([contextMenu.track])}
            onAddToQueue={() => addToQueue([contextMenu.track])}
            onAddToFavourites={() => onAddToFavourites?.(contextMenu.track)}
            onRemoveFromFavourites={() => onRemoveFromFavourites?.(contextMenu.track)}
            onAddToPlaylist={(plId) => onAddToPlaylist?.(contextMenu.track, plId)}
            onCreateAndAddToPlaylist={(name) => onCreateAndAddToPlaylist?.(contextMenu.track, name)}
            onOpenPlaylistModal={() => onOpenPlaylistModal?.(contextMenu.track)}
            onStartRadio={() => startRadio?.(contextMenu.track)}
            onDownload={contextMenu.track.src?.startsWith('yt:') ? () => handleDownload(contextMenu.track) : undefined}
          />
        )}
      </div>
    )
  }

  const artistHeaderArt = getHighQualityArtURL(artistData?.headerImage || artistData?.header?.thumbnail || artistData?.thumbnail || artistData?.sections?.[0]?.items?.[0]?.thumbnail || GLOBAL_ARTIST_AVATARS[artistName?.toLowerCase()] || null)
  const artistDesc = artistData?.header?.description || ''
  const artistSubs = artistData?.header?.subscribers || ''

  // Partition Top Songs section from other categorized shelves (Albums, Singles, Playlists, Related Artists)
  const topSongsSection = (artistData.sections || []).find(s => {
    const t = (s.title || '').toLowerCase()
    return t.includes('top song') || t.includes('songs') || t === 'popular'
  }) || (artistData.sections?.[0]?.items?.some(i => i.type === 'Song') ? artistData.sections[0] : null)

  const otherSections = (artistData.sections || []).filter(s => s !== topSongsSection)

  const topSongsList = topSongsSection?.items || []
  const displayedTopSongs = showAllTopSongs ? topSongsList : topSongsList.slice(0, 5)

  return (
    <div className="flex-1 w-full h-full overflow-y-auto pb-32 animate-in fade-in relative custom-scrollbar">

      {/* Back sits in the empty strip above the portrait, pinned so it survives
          scrolling. `h-0` + `sticky` keeps it out of the layout entirely, which is
          what lets the portrait and name sit flush against the left edge. */}
      <div className="sticky top-0 z-30 h-0">
        <button
          onClick={onBack}
          className="absolute top-2 left-2 sm:left-3 w-9 h-9 rounded-full lg-glass-btn flex items-center justify-center text-white cursor-pointer"
          title="Go Back"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        </button>
      </div>
      
      {/* ── Artist Header ──────────────────────────────────────────────────
          No banner photograph and no surrounding card — just the artist. The back
          button sits in the same band as the portrait rather than reserving a row
          of its own, which is what pushed the name down the page. */}
      <div className="px-6 sm:px-10 pt-2">
        <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-7">
          <div className="flex items-center shrink-0">
            {/* Circular portrait */}
            <div
              className="w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden shrink-0 border relative flex items-center justify-center bg-white/5"
              style={{ borderColor: 'var(--hairline-strong)', boxShadow: `0 16px 40px -16px ${accentColor || '#ef4444'}80` }}
            >
              <span className="absolute text-4xl sm:text-5xl font-black text-white/40 select-none pointer-events-none">
                {(artistDisplayName?.[0] || 'A').toUpperCase()}
              </span>
              {artistHeaderArt ? (
                <img
                  src={artistHeaderArt}
                  onLoad={onArtLoad}
                  alt={artistDisplayName}
                  className="relative w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : null}
            </div>
          </div>

          <div className="flex-1 min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-white/10 text-white border border-white/15">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                </svg>
                Verified Artist
              </span>
              {artistSubs && (
                <span className="text-xs text-white/50 font-medium">{artistSubs}</span>
              )}
            </div>

            <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-white tracking-tight leading-none mb-3">
              {artistDisplayName}
            </h1>

            {artistDesc && (
              <div className="max-w-2xl mx-auto sm:mx-0">
                <p className={`text-xs sm:text-sm text-white/70 leading-relaxed whitespace-pre-wrap ${isBioExpanded ? '' : 'line-clamp-2'}`}>
                  {artistDesc}
                </p>
                {artistDesc.length > 140 && (
                  <button
                    onClick={() => setIsBioExpanded(!isBioExpanded)}
                    className="text-xs font-bold text-white/90 hover:text-white mt-1 cursor-pointer underline underline-offset-2"
                  >
                    {isBioExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 mt-4">
                <button 
                  onClick={() => {
                    if (topSongsList.length > 0) {
                      handlePlaySong(topSongsList[0], topSongsList)
                    } else {
                      for (const sec of (artistData.sections || [])) {
                        const firstSong = sec.items.find(i => i.type !== 'Playlist' && i.type !== 'Artist')
                        if (firstSong) {
                          handlePlaySong(firstSong, sec.items)
                          break
                        }
                      }
                    }
                  }}
                  style={{ backgroundColor: accentColor || '#ef4444' }}
                  className="px-7 py-3 rounded-full text-white font-bold text-sm shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  <span>Play Artist</span>
                </button>

                {/* Shuffle Play Top Songs */}
                {topSongsList.length > 0 && (
                  <button 
                    onClick={() => {
                      const shuffled = [...topSongsList].sort(() => Math.random() - 0.5)
                      handlePlaySong(shuffled[0], shuffled)
                    }}
                    className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-sm shadow-lg border border-white/15 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
                    </svg>
                    <span>Shuffle</span>
                  </button>
                )}

                {/* Follow Button */}
                {(() => {
                  const isFollowing = isFollowingArtist?.(artistDisplayName)
                  return (
                    <button
                      onClick={() => {
                        toggleFollowArtist?.({
                          name: artistDisplayName,
                          thumbnail: artistHeaderArt,
                          headerImage: artistHeaderArt,
                          subscribers: artistSubs
                        })
                      }}
                      className={`group/btn px-6 py-3 rounded-full font-bold text-sm shadow-lg hover:scale-105 active:scale-95 transition-all duration-200 border cursor-pointer flex items-center gap-2 ${
                        isFollowing
                          ? 'border-white/40 bg-white/20 text-white shadow-[0_0_20px_rgba(var(--ink-rgb),0.15)] hover:bg-white/25'
                          : 'border-white/20 bg-white/10 text-white hover:bg-white/20 hover:border-white/40'
                      }`}
                      title={isFollowing ? 'Click to Unfollow' : `Follow ${artistDisplayName}`}
                    >
                      {isFollowing ? (
                        <>
                          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                          </svg>
                          <span className="group-hover/btn:hidden">Following</span>
                          <span className="hidden group-hover/btn:inline text-white/80">Unfollow</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                          </svg>
                          <span>Follow</span>
                        </>
                      )}
                    </button>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>
      {/* Sections Container */}
      <div className="px-6 sm:px-10 flex flex-col gap-10 mt-6">
        
        {/* ── Top Songs Dedicated Tracklist ── */}
        {topSongsList.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Popular Songs</h2>
              {topSongsList.length > 5 && (
                <button 
                  onClick={() => setShowAllTopSongs(!showAllTopSongs)}
                  className="text-xs font-bold text-white/60 hover:text-white transition-colors cursor-pointer px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10"
                >
                  {showAllTopSongs ? 'Show Less' : `Show All (${topSongsList.length})`}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1">
              {displayedTopSongs.map((track, idx) => (
                <div 
                  key={track.id || track.videoId || idx}
                  onClick={() => handlePlaySong(track, topSongsList)}
                  onContextMenu={(e) => handleContextMenu(e, track)}
                  className="group flex items-center justify-between p-2.5 sm:p-3 rounded-xl hover:bg-white/[0.07] transition-all duration-200 cursor-pointer border border-transparent hover:border-white/5"
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="w-6 text-center text-xs font-semibold text-white/40 group-hover:text-white flex items-center justify-center">
                      <span className="group-hover:hidden">{idx + 1}</span>
                      <svg className="w-4 h-4 hidden group-hover:block ml-0.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>

                    <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/5 border border-white/10 relative">
                      <img 
                        src={getSizedArtURL(track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`, 'card')} 
                        alt="" 
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.opacity = '0.5' }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-semibold text-white/90 truncate group-hover:text-white">
                        {track.title}
                      </h4>
                      <p className="text-xs text-white/50 truncate mt-0.5">
                        {track.album || track.artist || artistDisplayName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-xs text-white/40">
                    {track.duration > 0 && <span>{formatTime(track.duration)}</span>}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation()
                        handleContextMenu(e, track)
                      }}
                      className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      title="More options"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Categorized Discography Sections (Albums, Singles & EPs, Videos, Playlists, Related Artists) ── */}
        {otherSections.map((section, idx) => (
          <div key={idx} className="flex flex-col gap-4">
            <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{section.title}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {section.items.map(item => renderCard(item, section.items))}
            </div>
          </div>
        ))}
      </div>

      {/* ── Context Menu for Artist Songs & Albums ── */}
      {contextMenu.visible && contextMenu.track && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          track={contextMenu.track}
          playlists={playlists}
          isFavourite={favourites?.has(contextMenu.track.src) || streamingFavourites?.some(t => t.src === contextMenu.track.src)}
          onClose={() => setContextMenu(prev => ({ ...prev, visible: false }))}
          onPlay={() => replaceQueue([contextMenu.track])}
          onPlayNext={() => playNext([contextMenu.track])}
          onAddToQueue={() => addToQueue([contextMenu.track])}
          onAddToFavourites={() => onAddToFavourites?.(contextMenu.track)}
          onRemoveFromFavourites={() => onRemoveFromFavourites?.(contextMenu.track)}
          onAddToPlaylist={(plId) => onAddToPlaylist?.(contextMenu.track, plId)}
          onCreateAndAddToPlaylist={(name) => onCreateAndAddToPlaylist?.(contextMenu.track, name)}
          onOpenPlaylistModal={() => onOpenPlaylistModal?.(contextMenu.track)}
          onStartRadio={() => startRadio?.(contextMenu.track)}
          onDownload={contextMenu.track.src?.startsWith('yt:') ? () => handleDownload(contextMenu.track) : undefined}
        />
      )}
    </div>
  )
}

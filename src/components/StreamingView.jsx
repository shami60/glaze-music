import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { usePlayer } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import ContextMenu from './ContextMenu'
import { togglePin, isPinned, pinIdFor } from '../pinnedPlaylists'
import ClickableArtists from './ClickableArtists'
import QuickAudioControls from './QuickAudioControls'
import { GLOBAL_ARTIST_AVATARS } from '../constants/curatedMixes'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { getSizedArtURL } from '../utils'

const playlistCache = {}

// How many playlist rows to build up front, and how many to add each time the
// user reaches the bottom of the scroll area.
const PLAYLIST_INITIAL_TRACKS = 300
const PLAYLIST_TRACK_CHUNK = 300
const PLAYLIST_EXTEND_PX = 800

// ── Horizontal Carousel with smooth chevrons (GPU-Optimized) ──────────────────
function ShelfCarousel({ children, className = "" }) {
  const containerRef = React.useRef(null)
  const [showLeft, setShowLeft] = useState(false)
  const [showRight, setShowRight] = useState(true)

  const checkScroll = React.useCallback(() => {
    const el = containerRef.current
    if (!el) return
    // Nothing to decide when the shelf has no box: the view is `hidden`, or
    // `content-visibility: auto` is skipping it below the fold. Reading
    // scrollWidth here would force a layout for a result we cannot use — with
    // ~19 shelves that was 38 layouts per switch to Explore (~40 ms), the bulk
    // of the remaining lag. The ResizeObserver fires again once it has a size.
    if (!el.clientWidth) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const canLeft = scrollLeft > 10
    const canRight = scrollLeft < scrollWidth - clientWidth - 10
    setShowLeft(canLeft)
    setShowRight(canRight)
  }, [])

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return

    checkScroll()

    // Multiple timers to catch async layout, image decodes, and DOM renders
    const timers = [50, 200, 500, 1200].map(d => setTimeout(checkScroll, d))

    // During the sidebar-width animation this container resizes on *every* frame.
    // checkScroll reads scrollWidth, which forces a full layout — running it per
    // frame, for every shelf, cost ~100 ms of JS plus a layout storm (Explore
    // collapsed at 14 fps against 68 on Home). A trailing debounce settles the
    // chevrons once the width stops moving instead.
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
          className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-[var(--surface-1)]/95 hover:bg-black text-white border border-white/25 shadow-[0_4px_25px_rgba(0,0,0,0.85)] backdrop-blur-md flex items-center justify-center transition-all duration-200 opacity-90 hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer"
          style={{ contain: 'strict', isolation: 'isolate' }}
          title="Previous"
        >
          <svg className="w-5 h-5 -ml-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Scrollable Container */}
      <div ref={containerRef} className={className}>
        {children}
      </div>

      {/* Right Chevron */}
      {showRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 z-30 w-11 h-11 rounded-full bg-[var(--surface-1)]/95 hover:bg-black text-white border border-white/25 shadow-[0_4px_25px_rgba(0,0,0,0.85)] backdrop-blur-md flex items-center justify-center transition-all duration-200 opacity-90 hover:opacity-100 hover:scale-110 active:scale-95 cursor-pointer"
          style={{ contain: 'strict', isolation: 'isolate' }}
          title="Next"
        >
          <svg className="w-5 h-5 ml-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}

// Memoised: App re-renders on every sidebar toggle and on any transport change.
// Without this the whole Explore grid (5 700 nodes, 440 images) reconciled on
// each one — a ~95 ms block that turned the collapse animation into 14 fps.
function StreamingView({ 
  homeFeed, setHomeFeed, 
  userProfile,
  favourites, streamingFavourites, 
  onAddToFavourites, onRemoveFromFavourites, 
  playlists = [], onAddToPlaylist, onCreateAndAddToPlaylist, onOpenPlaylistModal, onDeletePlaylist,
  downloadFolder, onShowDownloadNotification, refreshDownloads,
  pendingOnlineItem, onConsumePendingOnlineItem, isExploreActive = true
}) {
  const { replaceQueue, addToQueue, playNext, startRadio, accentColor = '#ef4444', theme, currentTrack, togglePlayPause } = usePlayer()
  const { followedArtists = [], toggleFollowArtist, isFollowingArtist } = useLibrary() || {}
  const online = useOnlineStatus()

  const CURATED_POPULAR_ARTISTS = [
    { name: 'Justin Bieber', image: GLOBAL_ARTIST_AVATARS['justin bieber'] },
    { name: 'The Weeknd', image: GLOBAL_ARTIST_AVATARS['the weeknd'] },
    { name: 'Taylor Swift', image: GLOBAL_ARTIST_AVATARS['taylor swift'] },
    { name: 'Drake', image: GLOBAL_ARTIST_AVATARS['drake'] },
    { name: 'Billie Eilish', image: GLOBAL_ARTIST_AVATARS['billie eilish'] },
    { name: 'Ariana Grande', image: GLOBAL_ARTIST_AVATARS['ariana grande'] },
    { name: 'Travis Scott', image: GLOBAL_ARTIST_AVATARS['travis scott'] },
    { name: 'Bruno Mars', image: GLOBAL_ARTIST_AVATARS['bruno mars'] },
    { name: 'Dua Lipa', image: GLOBAL_ARTIST_AVATARS['dua lipa'] },
    { name: 'Kendrick Lamar', image: GLOBAL_ARTIST_AVATARS['kendrick lamar'] },
    { name: 'Post Malone', image: GLOBAL_ARTIST_AVATARS['post malone'] },
    { name: 'Ed Sheeran', image: GLOBAL_ARTIST_AVATARS['ed sheeran'] },
    { name: 'Coldplay', image: GLOBAL_ARTIST_AVATARS['coldplay'] },
    { name: 'Arijit Singh', image: GLOBAL_ARTIST_AVATARS['arijit singh'] },
    { name: 'Eminem', image: GLOBAL_ARTIST_AVATARS['eminem'] },
    { name: 'Sabrina Carpenter', image: GLOBAL_ARTIST_AVATARS['sabrina carpenter'] },
    { name: 'Shakira', image: GLOBAL_ARTIST_AVATARS['shakira'] },
    { name: 'One Direction', image: GLOBAL_ARTIST_AVATARS['one direction'] },
    { name: 'Dave', image: GLOBAL_ARTIST_AVATARS['dave'] },
    { name: 'Tems', image: GLOBAL_ARTIST_AVATARS['tems'] },
  ]
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  // Selected item state for details view
  const [selectedItem, setSelectedItem] = useState(null)
  const [playlistTracks, setPlaylistTracks] = useState([])
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false)
  const [playlistFilter, setPlaylistFilter] = useState('')
  const [playlistSort, setPlaylistSort] = useState('default')
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false)

  // A liked-songs playlist can hold 1,300+ tracks. Rendering every row built
  // ~32,000 nodes and fired 1,300 image requests in one commit, which is what
  // made opening it feel heavy. Render a window and extend it on scroll; the
  // row images are `loading="lazy"`, so art only downloads as it comes into
  // view. Reset whenever a different playlist is loaded.
  const [trackLimit, setTrackLimit] = useState(PLAYLIST_INITIAL_TRACKS)
  useEffect(() => { setTrackLimit(PLAYLIST_INITIAL_TRACKS) }, [playlistTracks])

  // Extend only while a detail view is open, so scrolling the explore feed does
  // not inflate the limit that a playlist will later render with.
  const handleContentScroll = (e) => {
    if (!selectedItem) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight > PLAYLIST_EXTEND_PX) return
    setTrackLimit(prev => (prev >= playlistTracks.length ? prev : prev + PLAYLIST_TRACK_CHUNK))
  }

  // Category view state
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [categoryItems, setCategoryItems] = useState([])
  const [isLoadingCategory, setIsLoadingCategory] = useState(false)
  const [isFetchingMore, setIsFetchingMore] = useState(false)

  // Context Menu State
  const contextMenuRef = React.useRef(null)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, track: null })

  // Personalized taste radar state
  const [topArtistHero, setTopArtistHero] = useState(null)
  const [topArtistsList, setTopArtistsList] = useState([])

  React.useEffect(() => {
    let isMounted = true
    const fetchTasteProfile = async () => {
      try {
        let dbArtMap = {}
        if (window.electronAPI?.dbGetArtistArtCache) {
          dbArtMap = await window.electronAPI.dbGetArtistArtCache().catch(() => ({})) || {}
        }

        const artistMap = new Map()

        // 1. Followed Artists first with high priority
        for (const f of (followedArtists || [])) {
          const name = (typeof f === 'string' ? f : f?.name || f?.title || '').trim()
          if (!name) continue
          const key = name.toLowerCase()
          let img = dbArtMap[name] || dbArtMap[key] || GLOBAL_ARTIST_AVATARS[key] || f.thumbnail || f.headerImage || null
          artistMap.set(key, {
            name,
            count: 1000,
            image: img,
            isFollowed: true,
            isRecommended: false
          })
        }

        // 2. Add history & stats
        if (window.electronAPI?.dbGetAllStats) {
          const s = await window.electronAPI.dbGetAllStats()
          const historyArr = s?.history || []
          const statsObj = s?.stats || {}

          for (const h of historyArr) {
            if (h?.artist && h.artist !== 'Unknown' && h.artist !== 'Unknown Artist' && h.artist !== 'Local Artist') {
              const main = h.artist.split(/[,&/]/)[0].trim()
              if (main) {
                const key = main.toLowerCase()
                const isFollowed = (followedArtists || []).some(f => (f.name || f).toLowerCase() === key)
                const prev = artistMap.get(key) || { 
                  name: main, 
                  count: 0, 
                  image: dbArtMap[main] || dbArtMap[key] || GLOBAL_ARTIST_AVATARS[key] || h.thumbnail || h.albumArt || null,
                  isFollowed,
                  isRecommended: !isFollowed
                }
                prev.count += 3
                if (!prev.image) {
                  prev.image = dbArtMap[main] || dbArtMap[key] || GLOBAL_ARTIST_AVATARS[key] || h.thumbnail || h.albumArt || null
                }
                artistMap.set(key, prev)
              }
            }
          }

          for (const src of Object.keys(statsObj)) {
            const st = statsObj[src]
            if (st?.artist && st.artist !== 'Unknown' && st.artist !== 'Unknown Artist') {
              const main = st.artist.split(/[,&/]/)[0].trim()
              if (main) {
                const key = main.toLowerCase()
                const isFollowed = (followedArtists || []).some(f => (f.name || f).toLowerCase() === key)
                const prev = artistMap.get(key) || { 
                  name: main, 
                  count: 0, 
                  image: dbArtMap[main] || dbArtMap[key] || GLOBAL_ARTIST_AVATARS[key] || null,
                  isFollowed,
                  isRecommended: !isFollowed
                }
                prev.count += (st.playCount || 1) * 2
                artistMap.set(key, prev)
              }
            }
          }
        }

        // 3. Always ensure full curated recommendations for new users or to fill carousel
        for (const rec of CURATED_POPULAR_ARTISTS) {
          const key = rec.name.toLowerCase()
          if (!artistMap.has(key)) {
            const isFollowed = (followedArtists || []).some(f => (f.name || f).toLowerCase() === key)
            artistMap.set(key, {
              name: rec.name,
              count: 1,
              image: dbArtMap[rec.name] || dbArtMap[key] || rec.image || null,
              isFollowed,
              isRecommended: !isFollowed
            })
          }
        }

        let sorted = Array.from(artistMap.values()).sort((a, b) => {
          if (a.isFollowed && !b.isFollowed) return -1
          if (!a.isFollowed && b.isFollowed) return 1
          return b.count - a.count
        })

        const topList = sorted.slice(0, 20)
        if (isMounted && topList.length > 0) {
          setTopArtistsList(topList)
          const hero = topList[0]

          // Fetch quick preview recommendations for the hero artist
          if (window.electronAPI?.youtubeSearch) {
            try {
              const searchRes = await window.electronAPI.youtubeSearch(hero.name + ' official', 'songs')
              const tracks = (searchRes?.songs || []).slice(0, 4).map(mapSong)
              if (isMounted) {
                setTopArtistHero({
                  ...hero,
                  image: hero.image || tracks[0]?.thumbnail || null,
                  tracks
                })
              }
            } catch (e) {}
          }
        }
      } catch (err) {
        console.error('Failed to load taste profile:', err)
      }
    }

    fetchTasteProfile()
    return () => { isMounted = false }
  }, [(followedArtists || []).length])

  const handleStartArtistRadio = async (artistName) => {
    try {
      if (window.electronAPI?.youtubeSearch) {
        const res = await window.electronAPI.youtubeSearch(artistName + ' hits radio', 'songs')
        const tracks = res?.songs || []
        if (tracks.length > 0) {
          const mapped = tracks.map(mapSong)
          replaceQueue(mapped, 0)
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  React.useEffect(() => {
    const handleGlobalClick = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(prev => ({ ...prev, visible: false }))
      }
    }
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleGlobalClick)
      return () => document.removeEventListener('mousedown', handleGlobalClick)
    }
  }, [contextMenu.visible])

  const handleContextMenu = (e, track) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      track
    })
  }

  const handleDownload = (track) => {
    if (!track) return
    const vId = track.videoId || (track.src?.startsWith('yt:') ? track.src.replace('yt:', '') : track.id)
    if (!vId) return
    const api = window.electronAPI?.youtubeDownloadTrack || window.electronAPI?.downloadTrack
    if (api) {
      api(vId, downloadFolder).then(res => {
        const ok = res && res.success !== false
        onShowDownloadNotification?.(track, ok)
        if (ok) refreshDownloads?.()
      }).catch(() => {
        onShowDownloadNotification?.(track, false)
      })
    }
  }

  React.useEffect(() => {
    if (selectedItem && selectedItem.type !== 'Song') {
      const cacheKey = `${selectedItem.videoId || selectedItem.seedQuery || selectedItem.id}_${selectedItem.type}`
      
      if (playlistCache[cacheKey]) {
        setPlaylistTracks(playlistCache[cacheKey])
        return
      }

      setIsLoadingPlaylist(true)

      const isSpotify = selectedItem.type === 'SpotifyPlaylist' || selectedItem.service === 'spotify' || selectedItem.videoId?.startsWith('VLS')
      const isMix = selectedItem.isMix || (!selectedItem.videoId?.startsWith('PL') && !selectedItem.videoId?.startsWith('VL') && !selectedItem.videoId?.startsWith('MPREb_') && !isSpotify)

      if (isMix) {
        const query = selectedItem.seedQuery || selectedItem.videoId || selectedItem.title
        const fetcher = window.electronAPI?.youtubeGetExtendedCategory 
          ? () => window.electronAPI.youtubeGetExtendedCategory(query, 'song')
          : () => window.electronAPI.youtubeSearch(query, 'songs').then(r => r.songs || [])
        
        fetcher().then(tracks => {
          if (!tracks) return setPlaylistTracks([])
          const mapped = tracks.map((t, idx) => ({
            ...t,
            dateAddedTimestamp: Date.now() - (idx * 43200000),
            dateAddedStr: new Date(Date.now() - (idx * 43200000)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          }))
          playlistCache[cacheKey] = mapped
          setPlaylistTracks(mapped)
        }).catch(() => setPlaylistTracks([])).finally(() => setIsLoadingPlaylist(false))
        return
      }

      const fetcher = isSpotify 
        ? window.electronAPI?.spotifyGetPlaylist
        : window.electronAPI?.youtubeGetPlaylist
        
      if (fetcher) {
        fetcher(selectedItem.videoId).then(tracks => {
          if (!tracks) return setPlaylistTracks([])
          const now = Date.now()
          const fallbackArtist = (selectedItem.artist && selectedItem.artist !== 'Unknown' && selectedItem.artist !== 'Unknown Artist')
            ? selectedItem.artist
            : (selectedItem.author && selectedItem.author !== 'Unknown' && selectedItem.author !== 'Unknown Artist' ? selectedItem.author : '')
          const fallbackAlbum = (selectedItem.type === 'Album' || selectedItem.type === 'Single' || selectedItem.type === 'EP') ? selectedItem.title : selectedItem.album
          const mapped = tracks.map((t, idx) => {
            const addedDate = new Date(now - (idx * 43200000))
            const trackArtist = (t.artist && t.artist !== 'Unknown Artist' && t.artist !== 'Unknown')
              ? t.artist
              : (fallbackArtist || 'Unknown Artist')
            return {
              ...t,
              artist: trackArtist,
              album: t.album || fallbackAlbum || null,
              dateAddedTimestamp: addedDate.getTime(),
              dateAddedStr: addedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            }
          })
          playlistCache[cacheKey] = mapped
          setPlaylistTracks(mapped)
        }).catch(err => {
          console.error('Failed to load playlist', err)
          setPlaylistTracks([])
        }).finally(() => {
          setIsLoadingPlaylist(false)
        })
      } else {
        setIsLoadingPlaylist(false)
        setPlaylistTracks([])
      }
    } else {
      setPlaylistTracks([])
    }
  }, [selectedItem])

  // Home feed state (uses props for caching)
  const [isHomeLoading, setIsHomeLoading] = useState(!homeFeed)
  const [isRefreshingHome, setIsRefreshingHome] = useState(false)

  const loadHome = async (force = false) => {
    const lastFetch = parseInt(localStorage.getItem('glaze_last_home_fetch_time') || '0', 10)
    const isStale = Date.now() - lastFetch > 24 * 60 * 60 * 1000

    if (homeFeed && !force && !isStale) return // Already loaded!
    // Nothing on this screen is local — skip the fetches rather than spend 30 s
    // timing out, and leave the cache timestamp alone so a reconnect refetches.
    if (online === false) {
      setIsHomeLoading(false)
      setIsRefreshingHome(false)
      return
    }
    if (force) setIsRefreshingHome(true)
    else setIsHomeLoading(true)

    try {
      if (window.electronAPI?.youtubeGetHome) {
        // Run home feed search and user recommendations simultaneously in parallel
        const [dataRes, recsRes] = await Promise.allSettled([
          window.electronAPI.youtubeGetHome(),
          (async () => {
            if (!window.electronAPI?.dbGetAllStats || !window.electronAPI?.youtubeGetUpNextBatch) return null
            const statsRes = await window.electronAPI.dbGetAllStats()
            const historyList = statsRes?.history || []
            const recentSeeds = historyList
              .filter(t => t && t.src && t.src.startsWith('yt:'))
              .map(t => t.src.replace('yt:', ''))
            if (recentSeeds.length === 0) return null
            const seeds = [...new Set(recentSeeds)].slice(0, 3)
            return await window.electronAPI.youtubeGetUpNextBatch(seeds)
          })()
        ])

        let data = (dataRes.status === 'fulfilled' && Array.isArray(dataRes.value)) ? dataRes.value : []
        const recs = (recsRes.status === 'fulfilled' && Array.isArray(recsRes.value)) ? recsRes.value : null

        if (recs && recs.length > 0) {
          const uniqueRecs = recs.filter((v, i, a) => a.findIndex(t => t.videoId === v.videoId) === i).slice(0, 24)
          data = [
            { title: 'Based on your recent listening', query: 'Based on your recent listening', items: uniqueRecs },
            ...data
          ]
        }

        // Shuffle category items slightly to give fresh look on refresh
        data = data.map(cat => ({
          ...cat,
          items: Array.isArray(cat.items) ? [...cat.items].sort(() => 0.5 - Math.random()) : cat.items
        }))

        if (data.length > 0) {
          setHomeFeed(data)
          localStorage.setItem('glaze_last_home_fetch_time', Date.now().toString())
        }
      }
    } catch (e) {
      console.error('Failed to load home feed', e)
    } finally {
      setIsHomeLoading(false)
      setIsRefreshingHome(false)
    }
  }

  React.useEffect(() => {
    loadHome()
    // `online` is the only input that turns a skipped (offline) run into a real one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // Helper to format duration (seconds to MM:SS)
  function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '0:00'
    const minutes = Math.floor(sec / 60)
    const seconds = Math.floor(sec % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Map youtubei.js song object to Player track format
  function mapSong(song) {
    if (!song) return null
    const videoId = song.videoId || (song.src?.startsWith('yt:') ? song.src.replace('yt:', '') : song.id) || ''
    const rawArt = song.albumArt || song.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hq720.jpg` : '')
    const artUrl = getCleanArtUrl(rawArt, videoId, 'large')
    
    // We prefix with yt: to identify youtube tracks in PlayerContext
    const streamUrl = song.src || (videoId ? `yt:${videoId}` : '')

    const rawSec = typeof song.duration === 'object' 
      ? (song.duration?.seconds || 0) 
      : (typeof song.duration === 'number' ? song.duration : (parseInt(song.duration, 10) || 0))

    const fallbackArtist = (selectedItem && (selectedItem.artist || selectedItem.author) && selectedItem.artist !== 'Unknown Artist' && selectedItem.artist !== 'Unknown')
      ? (selectedItem.artist || selectedItem.author)
      : ''
    let songArtist = song.artist || song.author || ''
    if (!songArtist || songArtist === 'Unknown Artist' || songArtist === 'Unknown') {
      songArtist = fallbackArtist || 'Unknown Artist'
    }

    return {
      id: streamUrl || videoId || song.id || `${Date.now()}-${Math.random()}`,
      videoId: videoId,
      title: song.title || 'Unknown Title',
      artist: songArtist,
      album: song.album || (selectedItem && selectedItem.title ? selectedItem.title : 'Single'),
      duration: rawSec,
      src: streamUrl,
      albumArt: artUrl,
      isLocal: false,
      type: song.type || 'Song',
    }
  }

  const [searchFilter, setSearchFilter] = useState('all') // 'all' | 'songs' | 'artists' | 'albums' | 'playlists'
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('glaze_recent_searches') || '[]')
    } catch { return [] }
  })

  const saveRecentSearch = (query) => {
    if (!query || !query.trim()) return
    setRecentSearches(prev => {
      const filtered = prev.filter(q => q.toLowerCase() !== query.toLowerCase())
      const updated = [query, ...filtered].slice(0, 8)
      try { localStorage.setItem('glaze_recent_searches', JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  const removeRecentSearch = (e, queryToRemove) => {
    e.stopPropagation()
    setRecentSearches(prev => {
      const updated = prev.filter(q => q !== queryToRemove)
      try { localStorage.setItem('glaze_recent_searches', JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  // Real-time Search Suggestions
  React.useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchSuggestions([])
      return
    }

    const delayDebounceFn = setTimeout(async () => {
      if (window.electronAPI?.youtubeGetSearchSuggestions) {
        try {
          const suggestions = await window.electronAPI.youtubeGetSearchSuggestions(searchQuery.trim())
          setSearchSuggestions(suggestions || [])
        } catch (e) {
          console.error(e)
        }
      }
    }, 200)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery])

  // Execute Search
  const handleSearch = async (e, forcedQuery = null, filter = searchFilter) => {
    if (e) e.preventDefault()
    const query = forcedQuery || searchQuery
    if (!query.trim()) return

    // Searching needs the network. Say so instead of spinning until the request
    // times out and then blaming the user with a generic failure.
    if (navigator.onLine === false) {
      setShowSuggestions(false)
      setSearchError("You're offline — search needs a connection. Your downloads still play.")
      return
    }

    if (forcedQuery) setSearchQuery(forcedQuery)
    setShowSuggestions(false)
    setIsSearching(true)
    setSearchError('')
    saveRecentSearch(query.trim())

    try {
      if (window.electronAPI?.youtubeSearch) {
        const results = await window.electronAPI.youtubeSearch(query.trim(), filter)
        setSearchResults(results)
      }
    } catch (err) {
      console.error(err)
      setSearchError('Failed to load search results. Please try again.')
    } finally {
      setIsSearching(false)
    }
  }

  // Load Album / Playlist / Mix tracks into detail view
  const handleSelectItem = async (item) => {
    // Opened from within Explore (search results, shelves) — not from YouTube
    // Music, so the detail belongs to this tab.
    openedFromYTM.current = false
    setSelectedItem(item)
    setIsLoadingPlaylist(true)
    setPlaylistTracks([])

    try {
      if (playlistCache[item.videoId]) {
        setPlaylistTracks(playlistCache[item.videoId])
        setIsLoadingPlaylist(false)
        return
      }

      if (window.electronAPI?.youtubeGetPlaylist) {
        const tracks = await window.electronAPI.youtubeGetPlaylist(item.videoId)
        playlistCache[item.videoId] = tracks
        setPlaylistTracks(tracks)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoadingPlaylist(false)
    }
  }

  const handleOpenCategory = async (section) => {
    setSelectedCategory(section.title)
    setCategoryItems(section.items || [])
    setIsLoadingCategory(true)
    try {
      const targetQuery = section.query || section.title
      const itemType = section.items?.[0]?.type === 'Playlist' ? 'playlist' : 'song'
      if (window.electronAPI?.youtubeGetExtendedCategory && targetQuery) {
        const data = await window.electronAPI.youtubeGetExtendedCategory(targetQuery, itemType)
        // Deduplicate against existing items
        const existingIds = new Set((section.items || []).map(i => i.videoId))
        const newItems = data.filter(i => !existingIds.has(i.videoId))
        setCategoryItems([...(section.items || []), ...newItems])
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoadingCategory(false)
    }
  }

  // A playlist / album picked elsewhere (YouTube Music, Home, Queue) arrives as
  // a prop rather than an event: the event fired before this view mounted, so a
  // window listener here would always miss it.
  const selectItemRef = React.useRef(null)
  React.useEffect(() => { selectItemRef.current = handleSelectItem })

  // Explore and YouTube Music render this same component, and it stays mounted
  // so search and scroll survive navigation. The side effect was that a
  // playlist opened from YouTube Music kept its `selectedItem` when you later
  // switched to Explore — the playlist then appeared inside Explore, and its
  // back button dropped you on the Explore feed. Drop a YouTube Music detail the
  // moment the Explore tab becomes active; a detail opened *within* Explore is
  // left alone, since that belongs to this tab.
  const openedFromYTM = React.useRef(false)
  React.useEffect(() => {
    if (!isExploreActive || !openedFromYTM.current) return
    openedFromYTM.current = false
    setSelectedItem(null)
    setPlaylistTracks([])
  }, [isExploreActive])

  React.useEffect(() => {
    if (!pendingOnlineItem) return
    setSelectedCategory(null)
    selectItemRef.current?.(pendingOnlineItem)
    openedFromYTM.current = true
    onConsumePendingOnlineItem?.()
  }, [pendingOnlineItem, onConsumePendingOnlineItem])

  // Listen for global search events from HomeDashboard and Queue
  React.useEffect(() => {
    const handleExecSearch = (e) => {
      const q = typeof e.detail === 'string' ? e.detail : (e.detail?.query || '')
      if (q && q.trim()) {
        const query = q.trim()
        setSearchQuery(query)
        setSelectedItem(null)
        setSelectedCategory(null)
        handleSearch(null, query)
      }
    }
    window.addEventListener('execute-online-search', handleExecSearch)
    return () => {
      window.removeEventListener('execute-online-search', handleExecSearch)
    }
  }, [])

  const playSong = (song) => {
    if (!song) return
    const track = mapSong(song)
    if (!track) return
    if (currentTrack?.src === track.src) {
      togglePlayPause()
      return
    }
    replaceQueue([track], 0)
  }

  const addSongToQueue = (song) => {
    if (!song) return
    const track = mapSong(song)
    if (!track) return
    addToQueue([track])
  }

  // --- Rendering UI Helpers ---

// Every call site here draws a small tile — cards, artist circles, row
// thumbnails. Sizing the request to the tile instead of forcing hq720 is the
// difference between ~230 KB and ~3.7 MB of decoded bitmap per image.
// `mapSong` asks for 'large' because its output becomes the track object, and
// that artwork is what the now-playing dock and full-screen player draw.
const getCleanArtUrl = (url, videoId, size = 'card') =>
  getSizedArtURL(url || (videoId ? `yt:${videoId}` : ''), size)

  const renderCard = (song) => {
    const vId = song.videoId || song.id || ''
    const rawArt = song.thumbnail || (vId ? `https://i.ytimg.com/vi/${vId}/hq720.jpg` : '')
    const artUrl = getCleanArtUrl(rawArt, vId)
    const artistName = song.artist || song.author || 'Unknown'
    const isArtist = song.type === 'Artist'
    const isPlaylist = song.type === 'Playlist'
    const isSong = !isArtist && !isPlaylist

    return (
      <div 
        key={vId || song.title} 
        onClick={() => isArtist ? window.dispatchEvent(new CustomEvent('open-artist', { detail: song.title })) : (isSong ? playSong(song) : setSelectedItem(song))}
        onContextMenu={(e) => handleContextMenu(e, mapSong(song))}
        className="group relative flex flex-col gap-2 cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
      >
        <div className={`relative aspect-square w-full ${isArtist ? 'rounded-full' : 'rounded-2xl'} overflow-hidden bg-white/5 shadow-md`}>
          <img 
            src={artUrl} 
            alt={song.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            decoding="async"
            onError={(e) => {
              if (e.currentTarget.src.includes('hq720.jpg')) {
                e.currentTarget.src = `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`
              } else {
                e.currentTarget.onerror = null
              }
            }}
          />
          {/* Pin to sidebar — playlists only. Cards for songs and artists get
              nothing extra, so the hover state stays quiet where it is not useful. */}
          {isPlaylist && (() => {
            const pinned = isPinned(pinIdFor(song))
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(song, isExploreActive ? 'explore' : 'yt')
                }}
                className={`absolute top-2 right-12 w-8 h-8 rounded-full border flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer z-10 ${
                  pinned
                    ? 'opacity-100 bg-white text-black border-white'
                    : 'opacity-0 group-hover:opacity-100 bg-[var(--surface-1)] hover:bg-black text-white border-white/20'
                }`}
                style={{ contain: 'strict', isolation: 'isolate' }}
                title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                aria-label={pinned ? `Unpin ${song.title} from sidebar` : `Pin ${song.title} to sidebar`}
                aria-pressed={pinned}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                  <path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>
                </svg>
              </button>
            )
          })()}

          {/* 3-dots Quick Menu Button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleContextMenu(e, mapSong(song))
            }}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-[var(--surface-1)] hover:bg-black border border-white/20 flex items-center justify-center text-white shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer z-10"
            style={{ contain: 'strict', isolation: 'isolate' }}
            title="More Options / Add to Playlist"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
          </button>
        </div>
        <div className="w-full min-w-0 px-0.5">
          <h4 className="text-[13px] font-semibold text-white/90 truncate group-hover:text-white transition-colors" title={song.title}>
            {song.title}
          </h4>
          <p className="text-[11px] text-white/50 truncate mt-0.5">
            <ClickableArtists artistString={artistName} />
          </p>
        </div>
      </div>
    )
  }

  const [filterTag, setFilterTag] = useState('All')
  const filterTags = ['All', 'Trending', 'Playlists', 'Viral', 'Chill', 'Late Night', 'Workout', 'Bollywood', 'Remixes', 'Podcasts']

  const renderHomeFeed = () => {
    if (isHomeLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-white/50">
          <svg className="animate-spin mb-4 w-10 h-10" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p>Loading discovery feed...</p>
        </div>
      )
    }

    if (!homeFeed || !Array.isArray(homeFeed) || homeFeed.length === 0) {
      if (online === false) {
        return (
          <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ padding: '56px 40px' }}>
            <p className="text-white/80 font-semibold text-sm">You&apos;re offline</p>
            <p className="text-white/50 text-xs max-w-sm">
              Explore needs a connection. Your downloads, playlists and library are still here — open
              Downloads or your playlists to keep listening.
            </p>
          </div>
        )
      }
      return (
        <div style={{ textAlign: 'center', padding: '40px', color: '#b3b3b3' }}>
          <p>Failed to load home feed. Try searching instead.</p>
        </div>
      )
    }

    const filteredSections = homeFeed.filter(sec => {
      if (filterTag === 'All') return true
      const title = (sec.title || '').toLowerCase()
      if (filterTag === 'Trending') return title.includes('trending') || title.includes('top')
      if (filterTag === 'Playlists') return title.includes('playlist') || title.includes('mix')
      if (filterTag === 'Viral') return title.includes('viral') || title.includes('social')
      if (filterTag === 'Chill') return title.includes('chill') || title.includes('lofi')
      if (filterTag === 'Late Night') return title.includes('night') || title.includes('r&b')
      if (filterTag === 'Workout') return title.includes('workout') || title.includes('energy')
      if (filterTag === 'Bollywood') return title.includes('bollywood') || title.includes('regional')
      if (filterTag === 'Remixes') return title.includes('remix') || title.includes('slowed')
      if (filterTag === 'Podcasts') return title.includes('podcast') || title.includes('show')
      return true
    })

    return (
      <div className="flex flex-col gap-8">
        {/* ── 1. Artists In Your Orbit (Story-Style Horizontal Carousel with Chevrons) ── */}
        {filterTag === 'All' && topArtistsList.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3 px-0.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-500" />
                <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white/80">
                  Artists In Your Orbit
                </h3>
              </div>
              <span className="text-[11px] text-white/40 font-medium">Click to explore full profile & discography</span>
            </div>

            <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2 no-scrollbar">
              {topArtistsList.map((artist, idx) => {
                const isFollowed = isFollowingArtist ? isFollowingArtist(artist.name) : !!artist.isFollowed

                return (
                  <button
                    key={idx}
                    onClick={() => window.dispatchEvent(new CustomEvent('open-artist', { detail: artist.name }))}
                    className="flex flex-col items-center gap-2 group shrink-0 cursor-pointer text-center p-1.5 rounded-2xl hover:bg-white/[0.06] transition-all"
                  >
                    <div className={`relative w-16 h-16 sm:w-18 sm:h-18 rounded-full p-[2.5px] transition-all duration-300 group-hover:scale-105 shadow-xl ${
                      isFollowed 
                        ? 'bg-gradient-to-tr from-emerald-400 via-teal-500 to-cyan-500 ring-2 ring-emerald-500/30' 
                        : 'bg-gradient-to-tr from-purple-500 via-pink-500 to-rose-400 ring-1 ring-pink-500/20'
                    }`}>
                      <div className="w-full h-full rounded-full overflow-hidden bg-neutral-900 border-2 border-[#090910] relative flex items-center justify-center">
                        {artist.image ? (
                          <img 
                            src={artist.image} 
                            alt={artist.name} 
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none'
                              if (e.currentTarget.nextElementSibling) {
                                e.currentTarget.nextElementSibling.style.display = 'flex'
                              }
                            }}
                          />
                        ) : null}
                        <div 
                          className={`w-full h-full items-center justify-center font-bold text-lg text-white bg-gradient-to-tr from-purple-800 to-indigo-600 ${artist.image ? 'hidden' : 'flex'}`}
                        >
                          {artist.name.charAt(0).toUpperCase()}
                        </div>
                      </div>

                      {/* Followed status indicator badge vs Recommended + Follow button */}
                      {isFollowed ? (
                        <div 
                          className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#090910] flex items-center justify-center text-black shadow-md"
                          title="Following"
                        >
                          <svg className="w-3 h-3 text-black stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div 
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFollowArtist?.({
                              name: artist.name,
                              thumbnail: artist.image
                            })
                          }}
                          className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 border-2 border-[#090910] flex items-center justify-center text-white shadow-md hover:scale-125 active:scale-95 transition-transform cursor-pointer"
                          title={`Follow ${artist.name}`}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-center max-w-[84px]">
                      <span className="text-xs font-bold text-white/90 group-hover:text-white truncate w-full leading-tight flex items-center justify-center gap-1">
                        <span className="truncate">{artist.name}</span>
                      </span>
                      
                      {isFollowed ? (
                        <span className="text-[10px] mt-0.5 truncate leading-tight font-semibold text-emerald-400">
                          Following
                        </span>
                      ) : (
                        <span className="text-[9.5px] mt-0.5 truncate leading-tight font-medium text-pink-300/85 flex items-center justify-center gap-0.5">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-2.5 h-2.5 text-pink-400 shrink-0"><path d="M12 2l2.4 7.2h7.6l-6 4.8 2.4 7.2-6.4-4.8-6.4 4.8 2.4-7.2-6-4.8h7.6z"/></svg>
                          <span>Suggested</span>
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </ShelfCarousel>
          </section>
        )}

        {/* ── 2. Category Pill Filters ── */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {filterTags.map(tag => (
            <button
              key={tag}
              onClick={() => setFilterTag(tag)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer ${
                filterTag === tag
                  ? 'bg-white text-black shadow-lg scale-105'
                  : 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* ── 3. Dynamic Streaming & Chart Sections (2-Row Horizontal Carousels with Chevrons) ── */}
        {filteredSections.map((section, idx) => {
          let items = section.items || []
          // Ensure even number of items so both rows are completely full and balanced with 0 empty gaps
          if (items.length % 2 !== 0 && items.length > 1) {
            items = items.slice(0, items.length - 1)
          }

          // Chunk items into pairs of 2 so every category has at least 2 full rows of songs
          const pairs = []
          for (let i = 0; i < items.length; i += 2) {
            pairs.push(items.slice(i, i + 2))
          }

          return (
            <section key={idx} className="mb-2">
              <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3 mb-4">
                <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  {section.title}
                </h3>
                <button 
                  onClick={() => handleOpenCategory(section)}
                  className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-emerald-400 hover:text-emerald-300 text-[11px] font-bold tracking-wide transition-all border border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer flex items-center gap-1.5 group/btn shadow-sm active:scale-95"
                  title={`View all ${section.title}`}
                >
                  <span>View All</span>
                  <svg className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <ShelfCarousel className="flex items-start gap-4 overflow-x-auto pb-3 no-scrollbar">
                {pairs.map((pair, colIdx) => (
                  <div key={colIdx} className="flex flex-col gap-3.5 w-36 sm:w-44 shrink-0">
                    {renderCard(pair[0])}
                    {pair[1] && renderCard(pair[1])}
                  </div>
                ))}
              </ShelfCarousel>
            </section>
          )
        })}
      </div>
    )
  }

  const renderCategoryView = () => {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4 border-b border-white/[0.08] pb-4">
          <button 
            onClick={() => setSelectedCategory(null)} 
            className="text-white/60 hover:text-white flex items-center gap-2 text-sm font-semibold transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
            Back
          </button>
          <h2 className="text-3xl font-bold text-white tracking-tight">{selectedCategory}</h2>
        </div>

        {isLoadingCategory && categoryItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/50">
            <svg className="animate-spin mb-4 w-10 h-10" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p>Loading extended collection...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3.5">
              {categoryItems.map(item => renderCard(item))}
            </div>

            {/* Load More Button */}
            {categoryItems.length > 0 && !['DailyMix', 'Station', 'HeroMix'].includes(categoryItems[0]?.type) && (
              <div className="flex justify-center mt-4 mb-8">
                <button
                  onClick={async () => {
                    if (isFetchingMore) return;
                    setIsFetchingMore(true);
                    try {
                      const isPlaylist = categoryItems[0]?.type === 'Playlist';
                      
                      if (!isPlaylist && window.electronAPI?.youtubeGetUpNextBatch) {
                        // Take 3 random items from the current view as seeds
                        const seeds = [...categoryItems].sort(() => 0.5 - Math.random()).slice(0, 3).map(i => i.videoId);
                        const data = await window.electronAPI.youtubeGetUpNextBatch(seeds);
                        const existingIds = new Set(categoryItems.map(i => i.videoId));
                        const newItems = data.filter(i => !existingIds.has(i.videoId));
                        setCategoryItems(prev => [...prev, ...newItems]);
                      } else if (isPlaylist && window.electronAPI?.youtubeGetExtendedCategory) {
                        // For playlists, fetch a randomized variant query to get more
                        const variants = ['mix', 'hits', 'new', 'top', 'collection'];
                        const randomVariant = variants[Math.floor(Math.random() * variants.length)];
                        const q = (selectedCategory || 'Playlists') + ' ' + randomVariant;
                        const data = await window.electronAPI.youtubeGetExtendedCategory(q, 'playlist');
                        const existingIds = new Set(categoryItems.map(i => i.videoId));
                        const newItems = data.filter(i => !existingIds.has(i.videoId));
                        setCategoryItems(prev => [...prev, ...newItems]);
                      }
                    } catch (e) {
                      console.error(e);
                    } finally {
                      setIsFetchingMore(false);
                    }
                  }}
                  disabled={isFetchingMore}
                  className="px-6 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isFetchingMore ? (
                    <>
                      <svg className="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      <span>Loading more...</span>
                    </>
                  ) : (
                    <span>Load More Tracks</span>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderSearchResults = () => {
    if (isSearching) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-white/50">
          <svg className="animate-spin mb-4 w-10 h-10" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p>Searching for music...</p>
        </div>
      )
    }

    if (searchError) {
      return (
        <div className="text-center py-12 text-red-400">
          <p>{searchError}</p>
        </div>
      )
    }

    if (!searchResults || (
      !searchResults.topResult && 
      (!searchResults.songs || searchResults.songs.length === 0) &&
      (!searchResults.artists || searchResults.artists.length === 0) &&
      (!searchResults.albums || searchResults.albums.length === 0) &&
      (!searchResults.playlists || searchResults.playlists.length === 0)
    )) {
      return (
        <div className="text-center py-16 text-white/40">
          <p className="text-lg">No results found for "{searchQuery}"</p>
          <p className="text-sm mt-1 text-white/30">Try a different search term or check spelling.</p>
        </div>
      )
    }

    const rawList = Array.isArray(searchResults) 
      ? searchResults 
      : (searchResults?.[searchFilter] || [])

    return (
      <div className="flex flex-col gap-10">
        {/* Results Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {[
            { id: 'all', label: 'All Results' },
            { id: 'songs', label: 'Songs' },
            { id: 'artists', label: 'Artists' },
            { id: 'albums', label: 'Albums' },
            { id: 'playlists', label: 'Playlists' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setSearchFilter(f.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer ${
                searchFilter === f.id
                  ? 'bg-white text-black shadow-lg scale-105'
                  : 'bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Top Result + Songs Side by Side (if 'all' filter) */}
        {searchFilter === 'all' && (
          <div className="flex flex-col gap-8">
            {/* Row 1: Top Result + Songs Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Top Result Card */}
              {searchResults.topResult && (
                <div className="lg:col-span-5 flex flex-col">
                  <h3 className="text-xl font-bold text-white tracking-tight mb-4">Top Result</h3>
                  <div 
                    onClick={() => {
                      if (searchResults.topResult.type === 'Artist') {
                        window.dispatchEvent(new CustomEvent('open-artist', { detail: searchResults.topResult.name || searchResults.topResult.title }))
                      } else if (searchResults.topResult.type === 'Song' || !searchResults.topResult.type) {
                        playSong(searchResults.topResult)
                      } else {
                        setSelectedItem(searchResults.topResult)
                      }
                    }}
                    className="group relative flex-1 flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-start gap-4 p-5 rounded-3xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all duration-300 shadow-xl cursor-pointer"
                  >
                    <div className={`relative w-28 h-28 sm:w-32 sm:h-32 lg:w-40 lg:h-40 overflow-hidden shadow-2xl shrink-0 border border-white/15 ${searchResults.topResult.type === 'Artist' ? 'rounded-full' : 'rounded-2xl'}`}>
                      <img 
                        src={getCleanArtUrl(searchResults.topResult.thumbnail, searchResults.topResult.videoId || searchResults.topResult.id)} 
                        alt="" 
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          if (e.currentTarget.src.includes('hq720.jpg')) {
                            e.currentTarget.src = `https://i.ytimg.com/vi/${searchResults.topResult.videoId || searchResults.topResult.id}/hqdefault.jpg`
                          }
                        }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span 
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${accentColor} 9.4%, transparent)`,
                            color: accentColor,
                            borderColor: `color-mix(in srgb, ${accentColor} 20%, transparent)`
                          }}
                        >
                          {searchResults.topResult.type === 'Artist' ? 'Artist' : 'Top Track'}
                        </span>
                      </div>

                      <h2 className="text-xl font-bold text-white truncate">
                        {searchResults.topResult.title || searchResults.topResult.name}
                      </h2>
                      
                      <div className="flex items-center gap-2.5 mt-3.5">
                        {searchResults.topResult.type === 'Artist' ? (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.dispatchEvent(new CustomEvent('open-artist', { detail: searchResults.topResult.name || searchResults.topResult.title }))
                              }}
                              className="px-5 py-2 rounded-full bg-white text-black text-xs font-bold hover:scale-105 active:scale-95 transition-all shadow-lg cursor-pointer"
                            >
                              View Artist Profile
                            </button>
                            {searchResults.songs?.[0] && (
                              <button
                                onClick={(e) => { e.stopPropagation(); playSong(searchResults.songs[0]); }}
                                className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 transition-all cursor-pointer flex items-center gap-1.5"
                              >
                                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5v14l11-7z"/></svg>
                                Play Top Song
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); playSong(searchResults.topResult); }}
                              className="px-5 py-2 rounded-full bg-white text-black text-xs font-bold hover:scale-105 active:scale-95 transition-all shadow-lg flex items-center gap-2 cursor-pointer"
                            >
                              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5v14l11-7z"/></svg>
                              Play Now
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); addSongToQueue(searchResults.topResult); }}
                              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/10 transition-all cursor-pointer"
                            >
                              Add to Queue
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Songs Shelf */}
              {searchResults.songs && searchResults.songs.length > 0 && (
                <div className="lg:col-span-7 flex flex-col">
                  <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3 mb-4">
                    <h3 className="text-xl font-bold text-white tracking-tight">Songs</h3>
                    <button 
                      onClick={() => setSearchFilter('songs')}
                      className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-emerald-400 hover:text-emerald-300 text-[11px] font-bold tracking-wide transition-all border border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer flex items-center gap-1.5 group/btn shadow-sm active:scale-95"
                    >
                      <span>View All</span>
                      <svg className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {searchResults.songs.slice(0, 8).map((song) => {
                      const artUrl = getCleanArtUrl(song.thumbnail, song.videoId)
                      return (
                        <div
                          key={song.videoId}
                          onClick={() => playSong(song)}
                          onContextMenu={(e) => handleContextMenu(e, mapSong(song))}
                          className="group flex items-center gap-3.5 p-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-transparent hover:border-white/10 cursor-pointer transition-all duration-200"
                        >
                          <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-md">
                            <img src={artUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-white/95 truncate transition-colors group-hover:text-white">
                              {song.title}
                            </h4>
                            <p className="text-xs text-white/50 truncate mt-0.5">
                              <ClickableArtists artistString={song.artist || 'Unknown'} />
                            </p>
                          </div>

                          <span className="text-xs text-white/40 tabular-nums shrink-0 mr-1">
                            {formatDuration(song.duration)}
                          </span>

                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Favourite Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                const mapped = mapSong(song)
                                const isFav = favourites?.has(mapped.src) || streamingFavourites?.some(t => t.src === mapped.src)
                                if (isFav) onRemoveFromFavourites?.(mapped.src)
                                else onAddToFavourites?.(mapped)
                              }}
                              className="p-1.5 rounded-full hover:bg-white/15 text-white/40 hover:text-white transition-colors cursor-pointer"
                              title="Favourite"
                            >
                              <svg viewBox="0 0 24 24" fill={(favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'none'} stroke={(favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'currentColor'} strokeWidth={2} className="w-4 h-4">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                              </svg>
                            </button>

                            {/* 3-dots More / Add to Playlist */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleContextMenu(e, mapSong(song))
                              }}
                              className="p-1.5 rounded-full hover:bg-white/15 text-white/40 hover:text-white transition-colors cursor-pointer"
                              title="More Options / Add to Playlist"
                            >
                              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Row 2: Artists Shelf (Full Width with ShelfCarousel and Chevrons) */}
            {searchResults.artists && searchResults.artists.length > 0 && (
              <section>
                <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3 mb-4">
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">Artists</h3>
                  <button 
                    onClick={() => setSearchFilter('artists')}
                    className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-emerald-400 hover:text-emerald-300 text-[11px] font-bold tracking-wide transition-all border border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer flex items-center gap-1.5 group/btn shadow-sm active:scale-95"
                  >
                    <span>View All</span>
                    <svg className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <ShelfCarousel className="flex items-center gap-4 overflow-x-auto pb-2 no-scrollbar">
                  {searchResults.artists.map((artist, i) => (
                    <div
                      key={artist.id || i}
                      onClick={() => window.dispatchEvent(new CustomEvent('open-artist', { detail: artist.name || artist.title }))}
                      className="group flex flex-col items-center text-center p-2 rounded-2xl hover:bg-white/[0.06] cursor-pointer transition-all duration-300 w-32 sm:w-36 shrink-0"
                    >
                      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden mb-2.5 border-2 border-white/10 shadow-xl group-hover:border-white/30 group-hover:scale-105 transition-all bg-neutral-900">
                        <img 
                          src={getCleanArtUrl(artist.thumbnail, artist.id)} 
                          alt={artist.name} 
                          className="w-full h-full object-cover" 
                        />
                      </div>
                      <h4 className="text-xs sm:text-sm font-bold text-white/90 truncate w-full group-hover:text-white transition-colors">
                        {artist.name || artist.title}
                      </h4>
                      <p className="text-[11px] text-white/40 truncate w-full mt-0.5">
                        {artist.subscribers || 'Artist'}
                      </p>
                    </div>
                  ))}
                </ShelfCarousel>
              </section>
            )}

            {/* Row 3: Albums & Singles (Full Width with ShelfCarousel and Chevrons) */}
            {searchResults.albums && searchResults.albums.length > 0 && (
              <section>
                <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3 mb-4">
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">Albums & Singles</h3>
                  <button 
                    onClick={() => setSearchFilter('albums')}
                    className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-emerald-400 hover:text-emerald-300 text-[11px] font-bold tracking-wide transition-all border border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer flex items-center gap-1.5 group/btn shadow-sm active:scale-95"
                  >
                    <span>View All</span>
                    <svg className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <ShelfCarousel className="flex items-start gap-4 overflow-x-auto pb-2 no-scrollbar">
                  {searchResults.albums.map((album, i) => (
                    <div key={i} className="w-36 sm:w-44 shrink-0">
                      {renderCard(album)}
                    </div>
                  ))}
                </ShelfCarousel>
              </section>
            )}

            {/* Row 4: Featured Playlists (Full Width with ShelfCarousel and Chevrons) */}
            {searchResults.playlists && searchResults.playlists.length > 0 && (
              <section>
                <div className="flex items-center gap-3 border-b border-white/[0.08] pb-3 mb-4">
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">Featured Playlists</h3>
                  <button 
                    onClick={() => setSearchFilter('playlists')}
                    className="px-3 py-1 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-emerald-400 hover:text-emerald-300 text-[11px] font-bold tracking-wide transition-all border border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer flex items-center gap-1.5 group/btn shadow-sm active:scale-95"
                  >
                    <span>View All</span>
                    <svg className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <ShelfCarousel className="flex items-start gap-4 overflow-x-auto pb-2 no-scrollbar">
                  {searchResults.playlists.map((pl, i) => (
                    <div key={i} className="w-36 sm:w-44 shrink-0">
                      {renderCard(pl)}
                    </div>
                  ))}
                </ShelfCarousel>
              </section>
            )}
          </div>
        )}

        {/* ── SPECIFIC CATEGORY FILTER VIEW (Artists, Songs, Albums, Playlists) ── */}
        {(searchFilter !== 'all' || Array.isArray(searchResults)) && (
          <div>
            {searchFilter === 'artists' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {rawList.map((artist, i) => (
                  <div
                    key={artist.id || i}
                    onClick={() => window.dispatchEvent(new CustomEvent('open-artist', { detail: artist.name || artist.title }))}
                    className="group flex flex-col items-center text-center p-4 rounded-3xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-white/15 cursor-pointer transition-all duration-300 shadow-lg"
                  >
                    <div className="w-32 h-32 rounded-full overflow-hidden mb-3.5 border-2 border-white/10 shadow-2xl group-hover:border-white/30 group-hover:scale-105 transition-all">
                      <img 
                        src={getCleanArtUrl(artist.thumbnail, artist.id)} 
                        alt={artist.name} 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                    <h4 className="text-sm font-bold text-white/95 truncate w-full group-hover:text-white transition-colors">
                      {artist.name || artist.title}
                    </h4>
                    <p className="text-xs text-white/40 truncate w-full mt-1">
                      {artist.subscribers || 'Artist'}
                    </p>
                    <button
                      className="mt-3 px-4 py-1 rounded-full bg-white/10 hover:bg-white text-white hover:text-black text-xs font-semibold transition-all duration-200"
                    >
                      View Profile
                    </button>
                  </div>
                ))}
              </div>
            ) : searchFilter === 'songs' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rawList.map((song) => {
                  const artUrl = getCleanArtUrl(song.thumbnail, song.videoId)
                  return (
                    <div
                      key={song.videoId}
                      onClick={() => playSong(song)}
                      onContextMenu={(e) => handleContextMenu(e, mapSong(song))}
                      className="group flex items-center gap-3.5 p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-transparent hover:border-white/10 cursor-pointer transition-all duration-200"
                    >
                      <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-md">
                        <img src={artUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-white ml-0.5"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-white/95 truncate group-hover:text-emerald-400 transition-colors">
                          {song.title}
                        </h4>
                        <p className="text-xs text-white/50 truncate mt-0.5">
                          <ClickableArtists artistString={song.artist || 'Unknown'} />
                        </p>
                      </div>

                      <span className="text-xs text-white/40 tabular-nums shrink-0 mr-1">
                        {formatDuration(song.duration)}
                      </span>

                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Favourite Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const mapped = mapSong(song)
                            const isFav = favourites?.has(mapped.src) || streamingFavourites?.some(t => t.src === mapped.src)
                            if (isFav) onRemoveFromFavourites?.(mapped.src)
                            else onAddToFavourites?.(mapped)
                          }}
                          className="p-1.5 rounded-full hover:bg-white/15 text-white/40 hover:text-white transition-colors cursor-pointer"
                          title="Favourite"
                        >
                          <svg viewBox="0 0 24 24" fill={(favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'none'} stroke={(favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'currentColor'} strokeWidth={2} className="w-4 h-4">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                          </svg>
                        </button>

                        {/* 3-dots More / Add to Playlist */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleContextMenu(e, mapSong(song))
                          }}
                          className="p-1.5 rounded-full hover:bg-white/15 text-white/40 hover:text-white transition-colors cursor-pointer"
                          title="More Options / Add to Playlist"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                {rawList.map(item => renderCard(item))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderDetailsView = () => {
    const artUrl = selectedItem.thumbnail || `https://i.ytimg.com/vi/${selectedItem.videoId}/hqdefault.jpg`
    const artistName = selectedItem.artist || selectedItem.author || 'Unknown'
    const duration = formatDuration(typeof selectedItem.duration === 'object' ? selectedItem.duration?.seconds : selectedItem.duration)
    
    // Check if whole playlist is saved in user's library playlists
    const savedPlaylist = playlists?.find(p => 
      (p.externalId && p.externalId === selectedItem.videoId) || 
      (p.name && selectedItem.title && p.name.trim().toLowerCase() === selectedItem.title.trim().toLowerCase())
    )
    const isPlaylistSaved = !!savedPlaylist

    const playlistTrackSrcs = playlistTracks.map(t => `yt:${t.videoId}`)
    const isAllFavourited = playlistTrackSrcs.length > 0 && playlistTrackSrcs.every(src => 
      favourites?.has(src) || streamingFavourites?.some(f => f.src === src)
    )

    const handleToggleSavePlaylist = () => {
      if (isPlaylistSaved) {
        if (onDeletePlaylist && savedPlaylist?.id) {
          onDeletePlaylist(savedPlaylist.id)
        }
      } else {
        if (onCreateAndAddToPlaylist && playlistTracks.length > 0) {
          const mappedTracks = playlistTracks.map(mapSong)
          onCreateAndAddToPlaylist(mappedTracks, selectedItem.title, {
            externalId: selectedItem.videoId,
            thumbnail: artUrl
          })
        }
      }
    }

    const handleToggleFavouritePlaylist = () => {
      if (isAllFavourited) {
        playlistTrackSrcs.forEach(src => onRemoveFromFavourites?.(src))
      } else {
        playlistTracks.forEach(song => onAddToFavourites?.(mapSong(song)))
      }
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <button 
          onClick={() => {
            setSelectedItem(null)
            window.dispatchEvent(new CustomEvent('navigate-back'))
          }} 
          style={{ 
            background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', 
            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '14px', fontWeight: 'bold'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
          onMouseLeave={(e) => e.currentTarget.style.color = '#b3b3b3'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '24px', height: '24px' }}>
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          Back to list
        </button>
        
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <img 
            src={artUrl} 
            style={{ width: '160px', height: '160px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', objectFit: 'cover', flexShrink: 0 }} 
            alt={selectedItem.title}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#e5e5e5' }}>{selectedItem.type || 'Song'}</span>
            <h1 
              style={{ 
                fontSize: 'clamp(20px, 3vw, 36px)', 
                fontWeight: '900', 
                margin: 0, 
                lineHeight: 1.2,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden'
              }}
            >
              {selectedItem.title}
            </h1>
            <span style={{ fontSize: '13px', color: '#b3b3b3' }}>
              <ClickableArtists artistString={artistName} /> {selectedItem.type === 'Song' ? `• ${selectedItem.album || 'Single'} • ${duration}` : isLoadingPlaylist ? '• Loading tracks...' : playlistTracks.length > 0 ? `• ${playlistTracks.length} song${playlistTracks.length !== 1 ? 's' : ''}` : selectedItem.itemCount ? `• ${selectedItem.itemCount} song${selectedItem.itemCount !== 1 ? 's' : ''}` : ''}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
          {(!selectedItem.type || selectedItem.type === 'Song') && (
            <>
              <button 
                onClick={() => playSong(selectedItem)} 
                style={{ 
                  backgroundColor: accentColor, color: '#fff', 
                  border: 'none', borderRadius: '32px',
                  height: '52px', padding: '0 28px', display: 'flex', alignItems: 'center', gap: '8px', 
                  fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s',
                  boxShadow: `0 8px 24px color-mix(in srgb, ${accentColor} 25.1%, transparent)`
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '20px', height: '20px' }}>
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span>Play Now</span>
              </button>
              
              <button 
                onClick={() => addSongToQueue(selectedItem)} 
                style={{ 
                  background: 'rgba(var(--ink-rgb), 0.08)', border: '1px solid rgba(var(--ink-rgb), 0.15)', color: '#fff', borderRadius: '32px', 
                  padding: '0 22px', height: '52px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer',
                  transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#fff'; e.currentTarget.style.transform = 'scale(1.02)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(var(--ink-rgb), 0.15)'; e.currentTarget.style.transform = 'scale(1)' }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '18px', height: '18px' }}><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
                <span>Add to Queue</span>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const mapped = mapSong(selectedItem)
                  const isFav = favourites?.has(mapped.src) || streamingFavourites?.some(t => t.src === mapped.src)
                  if (isFav) onRemoveFromFavourites?.(mapped.src)
                  else onAddToFavourites?.(mapped)
                }}
                style={{
                  width: '52px', height: '52px', borderRadius: '50%',
                  backgroundColor: (favourites?.has(`yt:${selectedItem.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${selectedItem.videoId}`)) ? `color-mix(in srgb, ${accentColor} 13.3%, transparent)` : 'rgba(var(--ink-rgb), 0.08)',
                  border: `1px solid ${(favourites?.has(`yt:${selectedItem.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${selectedItem.videoId}`)) ? accentColor : 'rgba(var(--ink-rgb), 0.15)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  color: (favourites?.has(`yt:${selectedItem.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${selectedItem.videoId}`)) ? accentColor : '#fff',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                title="Favourite Track"
              >
                <svg viewBox="0 0 24 24" fill={(favourites?.has(`yt:${selectedItem.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${selectedItem.videoId}`)) ? accentColor : 'none'} stroke={(favourites?.has(`yt:${selectedItem.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${selectedItem.videoId}`)) ? accentColor : 'currentColor'} strokeWidth={2} style={{ width: '20px', height: '20px' }}>
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </button>
            </>
          )}
          {selectedItem.type !== 'Song' && playlistTracks.length > 0 && (
            <>
              {/* 1. Play Playlist */}
              <button 
                onClick={() => replaceQueue(playlistTracks.map(mapSong))} 
                style={{ 
                  backgroundColor: accentColor, color: '#fff', 
                  border: 'none', borderRadius: '32px',
                  padding: '0 32px', height: '52px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer',
                  transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px',
                  boxShadow: `0 8px 24px color-mix(in srgb, ${accentColor} 25.1%, transparent)`
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.04)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '20px', height: '20px' }}>
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span>Play Playlist</span>
              </button>

              {/* 2. Add All to Queue */}
              <button 
                onClick={() => addToQueue(playlistTracks.map(mapSong))} 
                style={{ 
                  background: 'rgba(var(--ink-rgb), 0.08)', border: '1px solid rgba(var(--ink-rgb), 0.15)', color: '#fff', borderRadius: '32px', 
                  padding: '0 22px', height: '52px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer',
                  transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#fff'; e.currentTarget.style.transform = 'scale(1.02)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(var(--ink-rgb), 0.15)'; e.currentTarget.style.transform = 'scale(1)' }}
                title="Add all songs to queue"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '18px', height: '18px' }}>
                  <path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/>
                </svg>
                <span>Add to Queue</span>
              </button>

              {/* 3. Save Playlist to Library / Collection */}
              <button
                onClick={handleToggleSavePlaylist}
                style={{
                  backgroundColor: isPlaylistSaved ? `color-mix(in srgb, ${accentColor} 13.3%, transparent)` : 'rgba(25, 25, 35, 0.95)',
                  borderColor: isPlaylistSaved ? accentColor : 'rgba(var(--ink-rgb), 0.15)',
                  color: isPlaylistSaved ? accentColor : '#fff',
                  border: '1px solid',
                  borderRadius: '32px',
                  padding: '0 24px',
                  height: '52px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                title={isPlaylistSaved ? "Remove playlist from your library" : "Save this entire playlist to your library collection"}
              >
                {isPlaylistSaved ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '18px', height: '18px' }}>
                      <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>
                    <span>Saved to Library</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '18px', height: '18px' }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    <span>Save to Library</span>
                  </>
                )}
              </button>

              {/* 4. Add all songs to favourites (Heart button) */}
              <button
                onClick={handleToggleFavouritePlaylist}
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  backgroundColor: isAllFavourited ? `color-mix(in srgb, ${accentColor} 13.3%, transparent)` : 'rgba(var(--ink-rgb), 0.08)',
                  border: `1px solid ${isAllFavourited ? accentColor : 'rgba(var(--ink-rgb), 0.15)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: isAllFavourited ? accentColor : '#fff',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                title={isAllFavourited ? "Remove all songs from favourites" : "Add all songs to favourites"}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill={isAllFavourited ? accentColor : 'none'} 
                  stroke={isAllFavourited ? accentColor : 'currentColor'} 
                  strokeWidth={2} 
                  style={{ width: '22px', height: '22px' }}
                >
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
              </button>
            </>
          )}
        </div>

        {selectedItem.type !== 'Song' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #333', paddingBottom: '16px', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>Tracks</h3>
              {!isLoadingPlaylist && playlistTracks.length > 0 && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input 
                    type="text" 
                    placeholder="Filter tracks..." 
                    value={playlistFilter}
                    onChange={e => setPlaylistFilter(e.target.value)}
                    style={{ background: 'rgba(var(--ink-rgb),0.05)', border: '1px solid rgba(var(--ink-rgb),0.1)', color: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', outline: 'none' }}
                  />
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                      style={{ background: 'rgba(var(--ink-rgb),0.05)', border: '1px solid rgba(var(--ink-rgb),0.1)', color: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                    >
                      {playlistSort === 'default' ? 'Default Order' : playlistSort === 'recent' ? 'Recently Added' : playlistSort === 'title' ? 'Title (A-Z)' : 'Artist (A-Z)'}
                      <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '14px', height: '14px' }}><path d="M7 10l5 5 5-5z"/></svg>
                    </button>
                    {isSortDropdownOpen && (
                      <div 
                        className="absolute right-0 mt-2 w-48 bg-[var(--surface-2)] border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 flex flex-col py-1"
                        onMouseLeave={() => setIsSortDropdownOpen(false)}
                      >
                        <button onClick={() => { setPlaylistSort('default'); setIsSortDropdownOpen(false); }} className={`text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${playlistSort === 'default' ? 'text-[#1db954] font-bold bg-white/5' : 'text-white'}`}>Default Order</button>
                        <button onClick={() => { setPlaylistSort('recent'); setIsSortDropdownOpen(false); }} className={`text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${playlistSort === 'recent' ? 'text-[#1db954] font-bold bg-white/5' : 'text-white'}`}>Recently Added</button>
                        <button onClick={() => { setPlaylistSort('title'); setIsSortDropdownOpen(false); }} className={`text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${playlistSort === 'title' ? 'text-[#1db954] font-bold bg-white/5' : 'text-white'}`}>Title (A-Z)</button>
                        <button onClick={() => { setPlaylistSort('artist'); setIsSortDropdownOpen(false); }} className={`text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors ${playlistSort === 'artist' ? 'text-[#1db954] font-bold bg-white/5' : 'text-white'}`}>Artist (A-Z)</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {playlistTracks.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 140px 70px 70px', gap: '16px', padding: '0 12px 8px 12px', borderBottom: '1px solid rgba(var(--ink-rgb),0.05)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#b3b3b3', fontWeight: 'bold', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>#</div>
                <div>Title</div>
                <div>Date Added</div>
                <div style={{ textAlign: 'right' }}>Duration</div>
                <div style={{ textAlign: 'center' }}>Actions</div>
              </div>
            )}

            {isLoadingPlaylist ? (
              <p style={{ color: '#b3b3b3', padding: '12px' }}>Loading playlist tracks...</p>
            ) : playlistTracks.length === 0 ? (
              <p style={{ color: '#b3b3b3', padding: '12px' }}>No tracks found.</p>
            ) : (
              [...playlistTracks]
                .filter(t => !playlistFilter || (t && t.title && String(t.title).toLowerCase().includes(playlistFilter.toLowerCase())) || (t && t.artist && String(t.artist).toLowerCase().includes(playlistFilter.toLowerCase())))
                .sort((a, b) => {
                  if (playlistSort === 'title') return a.title.localeCompare(b.title)
                  if (playlistSort === 'artist') return (a.artist||'').localeCompare(b.artist||'')
                  if (playlistSort === 'recent') return (b.dateAddedTimestamp || 0) - (a.dateAddedTimestamp || 0)
                  return 0
                })
                .slice(0, trackLimit)
                .map((song, idx) => {
                const pArt = song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`
                return (
                  <div 
                    key={song.videoId + '-' + idx}
                    style={{ display: 'grid', gridTemplateColumns: '40px 1fr 140px 70px 70px', gap: '16px', alignItems: 'center', padding: '8px 12px', backgroundColor: 'transparent', borderRadius: '8px', cursor: 'pointer', transition: 'background-color 0.2s' }}
                    onClick={() => playSong(song)}
                    onContextMenu={(e) => handleContextMenu(e, mapSong(song))}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(var(--ink-rgb), 0.08)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    className="group"
                  >
                    <div style={{ textAlign: 'center', fontSize: '13px', color: '#b3b3b3', fontWeight: 'bold' }}>
                      {idx + 1}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <img src={getSizedArtURL(pArt, 'thumb')} loading="lazy" decoding="async" style={{ width: '44px', height: '44px', borderRadius: '6px', marginRight: '14px', objectFit: 'cover' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '14px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                        <div style={{ fontSize: '12px', color: '#b3b3b3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><ClickableArtists artistString={song.artist || song.author || 'Unknown'} /></div>
                      </div>
                    </div>
                    
                    <div style={{ fontSize: '13px', color: '#b3b3b3', display: 'flex', alignItems: 'center' }}>
                      {song.dateAddedStr}
                    </div>

                    <div style={{ fontSize: '13px', color: '#b3b3b3', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatDuration(song.duration)}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      {/* Heart Favourite Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          const mapped = mapSong(song)
                          const isFav = favourites?.has(mapped.src) || streamingFavourites?.some(t => t.src === mapped.src)
                          if (isFav) onRemoveFromFavourites?.(mapped.src)
                          else onAddToFavourites?.(mapped)
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: (favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'rgba(var(--ink-rgb),0.4)' }}
                        className="hover:scale-110 active:scale-95 transition-transform"
                        title="Favourite track"
                      >
                        <svg viewBox="0 0 24 24" fill={(favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'none'} stroke={(favourites?.has(`yt:${song.videoId}`) || streamingFavourites?.some(t => t.src === `yt:${song.videoId}`)) ? accentColor : 'currentColor'} strokeWidth={2} style={{ width: '16px', height: '16px' }}>
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                      </button>

                      {/* 3-dots More / Add to Playlist Button */}
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation()
                          handleContextMenu(e, mapSong(song))
                        }}
                        style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', padding: '6px' }}
                        className="hover:text-white hover:scale-110 active:scale-95 transition-transform"
                        title="More Options / Add to Playlist"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '18px', height: '18px' }}>
                          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      
      {/* Search Header */}
      <div className="sticky top-0 z-20 px-8 py-6 bg-transparent flex items-center gap-4">
        {((Array.isArray(searchResults) && searchResults.length > 0) || (searchResults && typeof searchResults === 'object' && Object.keys(searchResults).length > 0)) && (
          <button 
            onClick={() => { setSearchResults([]); setSearchQuery(''); }}
            className="p-3 bg-white/5 hover:bg-white/10 rounded-full text-white transition-colors border border-white/10 cursor-pointer"
            title="Back to Home Feed"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
        )}
        <form onSubmit={e => handleSearch(e)} className="flex gap-3 flex-1 max-w-2xl group relative">
          <div className="relative flex-1">
            <svg 
              viewBox="0 0 24 24" 
              fill="currentColor" 
              className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors duration-300 pointer-events-none"
              style={{ color: showSuggestions || searchQuery ? accentColor : 'rgba(var(--ink-rgb),0.4)' }}
            >
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              type="text"
              placeholder="Search songs, artists, albums, or playlists..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 250)}
              className="w-full bg-[var(--surface-1)] text-white placeholder-white/30 text-[15px] font-medium rounded-full py-3.5 pl-14 pr-12 outline-none transition-all duration-300"
              style={{
                border: `1px solid ${showSuggestions ? `color-mix(in srgb, ${accentColor} 50.2%, transparent)` : 'rgba(var(--ink-rgb),0.1)'}`,
                boxShadow: showSuggestions ? `0 0 25px color-mix(in srgb, ${accentColor} 14.5%, transparent), inset 0 1px 1px rgba(var(--ink-rgb),0.15)` : 'none'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setSearchResults([])
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
                title="Clear search"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            )}

            {/* Suggestions & Recent Searches Dropdown — Dynamically Adapts to Theme */}
            {showSuggestions && (
              <div 
                className="menu-surface absolute top-full left-0 right-0 mt-2.5 rounded-3xl overflow-hidden border z-50 py-2 animate-in fade-in zoom-in-95 duration-200"
              >
                {/* When input has text -> live suggestions */}
                {searchQuery.trim() && searchSuggestions.length > 0 && (
                  <div>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">Suggestions</div>
                    {searchSuggestions.map((sug, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSearch(null, sug, 'all')}
                        className="w-full text-left px-4 py-2.5 hover:bg-white/[0.08] text-white/90 transition-all flex items-center justify-between font-medium text-sm group cursor-pointer"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <svg 
                            viewBox="0 0 24 24" 
                            fill="currentColor" 
                            className="w-4 h-4 text-white/40 group-hover:scale-110 transition-all shrink-0"
                            style={{ color: `color-mix(in srgb, ${accentColor} 80%, transparent)` }}
                          >
                            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                          </svg>
                          <span className="truncate group-hover:text-white">{sug}</span>
                        </div>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white/20 group-hover:text-white/70 -rotate-45 shrink-0 transition-colors">
                          <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                )}

                {/* When input is empty -> show recent searches */}
                {!searchQuery.trim() && recentSearches.length > 0 && (
                  <div>
                    <div className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
                        Recent Searches
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRecentSearches([])
                          localStorage.removeItem('glaze_recent_searches')
                        }}
                        className="text-white/40 hover:text-white transition-colors cursor-pointer text-[10px] font-semibold"
                        style={{ color: `color-mix(in srgb, ${accentColor} 93.3%, transparent)` }}
                      >
                        Clear All
                      </button>
                    </div>
                    {recentSearches.map((rec, i) => (
                      <div
                        key={i}
                        onClick={() => handleSearch(null, rec, 'all')}
                        className="w-full text-left px-4 py-2.5 hover:bg-white/[0.08] text-white/80 transition-all flex items-center justify-between font-medium text-sm group cursor-pointer"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <svg 
                            viewBox="0 0 24 24" 
                            fill="currentColor" 
                            className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110"
                            style={{ color: `color-mix(in srgb, ${accentColor} 70.2%, transparent)` }}
                          >
                            <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
                          </svg>
                          <span className="truncate group-hover:text-white">{rec}</span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => removeRecentSearch(e, rec)}
                          className="p-1 rounded-full hover:bg-white/20 text-white/30 hover:text-white transition-colors cursor-pointer"
                          title="Remove"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <button 
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="px-8 rounded-full font-bold transition-all duration-300 active:scale-95 disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed cursor-pointer shadow-lg"
            style={{
              background: searchQuery.trim() 
                ? `linear-gradient(135deg, ${accentColor} 0%, color-mix(in srgb, ${accentColor} 80%, transparent) 100%)` 
                : 'rgba(var(--ink-rgb),0.06)',
              color: searchQuery.trim() ? '#ffffff' : 'rgba(var(--ink-rgb),0.3)',
              border: searchQuery.trim() ? '1px solid rgba(var(--ink-rgb),0.2)' : '1px solid rgba(var(--ink-rgb),0.08)',
              boxShadow: searchQuery.trim() && !isSearching ? `0 6px 20px color-mix(in srgb, ${accentColor} 25.1%, transparent), inset 0 1px 1px rgba(var(--ink-rgb),0.3)` : 'none'
            }}
          >
            Search
          </button>
        </form>

        {/* 8D Spatial Audio & Equalizer Studio Quick Access */}
        <QuickAudioControls />

        <button
          onClick={() => loadHome(true)}
          disabled={isRefreshingHome || isHomeLoading}
          title="Refresh Home Feed"
          style={{
            background: 'rgba(var(--ink-rgb),0.05)',
            border: '1px solid rgba(var(--ink-rgb),0.1)',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: (isRefreshingHome || isHomeLoading) ? 'not-allowed' : 'pointer',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: (isRefreshingHome || isHomeLoading) ? 0.6 : 1
          }}
          onMouseEnter={(e) => { if (!isRefreshingHome && !isHomeLoading) e.currentTarget.style.backgroundColor = 'rgba(var(--ink-rgb),0.1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(var(--ink-rgb),0.05)' }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '20px', height: '20px' }} className={isRefreshingHome ? 'animate-spin' : ''}>
            <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
        </button>
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 88px 32px' }} onScroll={handleContentScroll}>
        {selectedItem ? renderDetailsView() : (selectedCategory ? renderCategoryView() : (searchQuery ? renderSearchResults() : renderHomeFeed()))}
      </div>
      
      {/* ── Custom Context Menu ── */}
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
          onStartRadio={() => startRadio(contextMenu.track)}
          onDownload={contextMenu.track.src?.startsWith('yt:') ? () => handleDownload(contextMenu.track) : undefined}
        />
      )}
    </div>
  )
}

export default React.memo(StreamingView)

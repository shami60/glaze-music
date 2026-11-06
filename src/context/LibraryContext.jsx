import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

const LibraryContext = createContext()

// The scanned library index is stored authoritatively in SQLite. localStorage is
// kept only as a small, *bounded* first-paint mirror so the grid isn't empty for
// a frame on launch. Unbounded, this key is what used to blow the ~5 MB quota
// and then fail silently inside an empty catch — so the index stopped
// persisting and every launch paid for a full re-scan.
const LIBRARY_MIRROR_KEY = 'glaze_library_files'
const LIBRARY_MIRROR_MAX = 2000

// Helper to normalize any track item
function normalizeTrack(item) {
  if (!item) return null
  if (typeof item === 'string') {
    const isYt = item.startsWith('yt:')
    let videoId = isYt ? item.replace('yt:', '') : null
    const filename = item.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')
    
    if (!isYt) {
      const match = filename.match(/\[([a-zA-Z0-9_-]{11})\]/)
      if (match) videoId = match[1]
    }

    return {
      src: item,
      id: item,
      videoId: videoId,
      title: isYt ? '' : filename,
      artist: 'Unknown Artist',
      album: isYt ? 'Single' : 'Local Track',
      albumArt: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
      duration: 0
    }
  }
  const src = item.src || (item.videoId ? `yt:${item.videoId}` : (item.id?.startsWith('yt:') ? item.id : `yt:${item.id}`))
  const isYt = src && src.startsWith('yt:')
  let videoId = isYt ? src.replace('yt:', '') : (item.videoId || null)
  
  if (!videoId && typeof src === 'string' && !isYt) {
    const filename = src.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')
    const match = filename.match(/\[([a-zA-Z0-9_-]{11})\]/)
    if (match) videoId = match[1]
  }

  return {
    ...item,
    id: item.id || src,
    src: src,
    videoId: videoId,
    title: item.title || (src ? (isYt ? '' : src.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '')) : 'Unknown Track'),
    artist: item.artist || item.author || 'Unknown Artist',
    album: item.album || (isYt ? 'Single' : 'Local Track'),
    albumArt: item.albumArt || item.art || item.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null),
    duration: typeof item.duration === 'object' ? item.duration?.seconds : (item.duration || 0)
  }
}

// Helper to normalize followed artist items
function normalizeArtist(item) {
  if (!item) return null
  if (typeof item === 'string') {
    const trimmed = item.trim()
    if (!trimmed) return null
    return {
      name: trimmed,
      thumbnail: null,
      headerImage: null,
      subscribers: null,
      createdAt: Date.now()
    }
  }
  const name = (item.name || item.title || '').trim()
  if (!name) return null
  return {
    name,
    thumbnail: item.thumbnail || item.art || item.albumArt || null,
    headerImage: item.headerImage || item.headerArt || null,
    subscribers: item.subscribers || null,
    createdAt: item.createdAt || Date.now()
  }
}

export function LibraryProvider({ children }) {
  // Synchronous initial state from localStorage so there is zero flash of empty data
  const [folders, setFolders] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('glaze_folders') || '[]')
    } catch { return [] }
  })
  
  const [libraryFiles, setLibraryFiles] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(LIBRARY_MIRROR_KEY) || '[]')
      return Array.isArray(parsed) ? parsed.slice(0, LIBRARY_MIRROR_MAX) : []
    } catch { return [] }
  })

  // Guard flag: DO NOT persist the index until SQLite has been read, otherwise
  // the truncated localStorage mirror would be written back over the real index.
  const [isLibraryIndexLoaded, setIsLibraryIndexLoaded] = useState(false)
  
  const [artCache, setArtCache] = useState({})
  const [isScanning, setIsScanning] = useState(false)
  const scanAbortRef = useRef(false)
  // In-flight guard. React StrictMode double-invokes effects in development, so
  // without this every `npm run dev` walked the entire library twice.
  const scanningRef = useRef(false)
  // Latest index, readable from inside scanAllFolders without making it depend on
  // `libraryFiles` — which would re-create the callback and re-trigger the scan
  // effect on every result, forever.
  const libraryFilesRef = useRef([])
  useEffect(() => { libraryFilesRef.current = libraryFiles }, [libraryFiles])
  
  // App-wide data stores
  const [playlists, setPlaylists] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_playlists') || '[]')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  
  const [favourites, setFavourites] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_favourites') || '[]')
      return new Set(Array.isArray(saved) ? saved : [])
    } catch { return new Set() }
  })
  
  const [streamingFavourites, setStreamingFavourites] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_streaming_favourites') || '[]')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })

  const [followedArtists, setFollowedArtists] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_followed_artists') || '[]')
      if (Array.isArray(saved)) {
        return saved.map(normalizeArtist).filter(Boolean)
      }
      return []
    } catch { return [] }
  })
  
  const [downloadFolder, setDownloadFolder] = useState(() => {
    return localStorage.getItem('glaze_download_folder') || ''
  })
  
  const [downloadedIds, setDownloadedIds] = useState(new Set())

  // Guard flag: DO NOT SAVE until preferences are loaded from Electron disk storage
  const [isPrefsLoaded, setIsPrefsLoaded] = useState(false)

  // 1. Initial Load of Preferences from Electron Disk Storage
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        let defaultDownDir = ''
        if (window.electronAPI?.getDefaultDownloadFolder) {
          defaultDownDir = await window.electronAPI.getDefaultDownloadFolder()
        }

        if (window.electronAPI?.loadPreferences) {
          const prefs = await window.electronAPI.loadPreferences()
          if (mounted && prefs) {
            if (Array.isArray(prefs.folders) && prefs.folders.length > 0) {
              setFolders(prev => Array.from(new Set([...prev, ...prefs.folders])))
            }
            // The disk copy is authoritative whenever the key is present — it is
            // rewritten on every change. These used to require `length > 0`, so an
            // empty array (user deleted everything) was skipped and the in-memory
            // value won; favourites/artists were also *merged*, so a removal could
            // never take effect across a restart. Together with the SQLite
            // fallback in `preferences:load` that resurrected deleted data.
            if (Array.isArray(prefs.playlists)) {
              setPlaylists(prefs.playlists)
            }
            if (Array.isArray(prefs.favourites)) {
              setFavourites(new Set(prefs.favourites))
            }
            if (Array.isArray(prefs.streamingFavourites)) {
              setStreamingFavourites(prefs.streamingFavourites)
            }
            if (Array.isArray(prefs.followedArtists)) {
              setFollowedArtists(prefs.followedArtists.map(normalizeArtist).filter(Boolean))
            }
            if (prefs.downloadFolder) {
              setDownloadFolder(prefs.downloadFolder)
            } else if (defaultDownDir && !downloadFolder) {
              setDownloadFolder(defaultDownDir)
            }
          } else if (mounted && defaultDownDir && !downloadFolder) {
            setDownloadFolder(defaultDownDir)
          }
        }
      } catch (err) {
        console.error('Failed to load preferences from disk:', err)
      } finally {
        if (mounted) {
          setIsPrefsLoaded(true)
        }
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  // 1b. Load the authoritative library index from SQLite
  useEffect(() => {
    let mounted = true
    async function loadIndex() {
      try {
        if (window.electronAPI?.loadLibraryIndex) {
          const paths = await window.electronAPI.loadLibraryIndex()
          if (mounted && Array.isArray(paths) && paths.length > 0) {
            setLibraryFiles(paths)
          }
        }
      } catch (err) {
        console.error('Failed to load library index from SQLite:', err)
      } finally {
        if (mounted) setIsLibraryIndexLoaded(true)
      }
    }
    loadIndex()
    return () => { mounted = false }
  }, [])

  // 1c. Persist the library index whenever it changes.
  //     NOTE: the scan now carries forward entries under roots it could not
  //     reach, so an unplugged drive leaves the index intact rather than
  //     pruning it. No file is ever deleted from disk.
  useEffect(() => {
    if (!isLibraryIndexLoaded) return

    // Bounded first-paint mirror. A quota failure is no longer fatal, because
    // SQLite holds the real index — but surface it instead of swallowing it.
    try {
      localStorage.setItem(
        LIBRARY_MIRROR_KEY,
        JSON.stringify(libraryFiles.slice(0, LIBRARY_MIRROR_MAX))
      )
    } catch (e) {
      console.warn('localStorage library mirror write failed (non-fatal):', e?.message || e)
    }

    if (window.electronAPI?.syncLibraryIndex) {
      window.electronAPI.syncLibraryIndex(libraryFiles).catch(err => {
        console.error('Failed to persist library index to SQLite:', err)
      })
    }
  }, [libraryFiles, isLibraryIndexLoaded])

  // 2. Safe Save: Only runs AFTER isPrefsLoaded is true to prevent wiping data on mount
  useEffect(() => {
    if (!isPrefsLoaded) return // GUARD: Never overwrite disk before initial load!

    const favArray = Array.from(favourites)
    
    // Save to localStorage synchronously
    try {
      localStorage.setItem('glaze_folders', JSON.stringify(folders))
      localStorage.setItem('glaze_playlists', JSON.stringify(playlists))
      localStorage.setItem('glaze_favourites', JSON.stringify(favArray))
      localStorage.setItem('glaze_streaming_favourites', JSON.stringify(streamingFavourites))
      localStorage.setItem('glaze_followed_artists', JSON.stringify(followedArtists))
      localStorage.setItem('glaze_download_folder', downloadFolder || '')
    } catch (e) {}

    // Save to Electron disk storage (preferences.json + SQLite DB)
    if (window.electronAPI?.savePreferences) {
      window.electronAPI.savePreferences({
        folders,
        playlists,
        favourites: favArray,
        streamingFavourites,
        followedArtists,
        downloadFolder
      })
    }
  }, [folders, playlists, favourites, streamingFavourites, followedArtists, downloadFolder, isPrefsLoaded])

  // 3. Scan user folders AND downloadFolder
  //
  // Roots that cannot be reached this pass (an unplugged drive, an offline share,
  // a permissions change) keep their existing index entries. The previous version
  // rebuilt the list from scratch and replaced it unconditionally, so launching
  // with a drive detached silently dropped every track under it — and the
  // truncation was then written to SQLite by the persistence effect above.
  const scanAllFolders = useCallback(async () => {
    const scanFn = window.electronAPI?.scanLibrary
    if (!scanFn) return
    if (scanningRef.current) return
    scanningRef.current = true

    setIsScanning(true)
    try {
      // Include user folders PLUS download folder
      const allDirsToScan = [...folders]
      if (downloadFolder && !allDirsToScan.includes(downloadFolder)) {
        allDirsToScan.push(downloadFolder)
      }

      // Also include default download folder if available
      if (window.electronAPI?.getDefaultDownloadFolder) {
        const defaultDown = await window.electronAPI.getDefaultDownloadFolder()
        if (defaultDown && !allDirsToScan.includes(defaultDown)) {
          allDirsToScan.push(defaultDown)
        }
      }

      if (allDirsToScan.length === 0) return

      const merged = []
      const seen = new Set()
      const reachableRoots = []

      for (const dir of allDirsToScan) {
        if (!dir) continue
        try {
          const files = await scanFn(dir)
          reachableRoots.push(dir)
          for (const f of files || []) {
            if (!seen.has(f)) {
              seen.add(f)
              merged.push(f)
            }
          }
        } catch (err) {
          console.warn('[Library] Root unreachable — keeping its existing index entries:', dir, err)
        }
      }

      // Carry forward entries that live under a root we could not reach, so an
      // absent drive degrades to "stale" rather than "deleted".
      const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase()
      const underAny = (file, roots) => roots.some((r) => {
        const nf = norm(file)
        const nr = norm(r).replace(/\/+$/, '')
        return nf === nr || nf.startsWith(nr + '/')
      })
      const reachableSet = new Set(reachableRoots.map(norm))
      const unreachable = allDirsToScan.filter((d) => d && !reachableSet.has(norm(d)))
      const carried = unreachable.length > 0
        ? libraryFilesRef.current.filter((f) => typeof f === 'string' && !seen.has(f) && underAny(f, unreachable))
        : []

      const nextFiles = [...merged, ...carried]
      setLibraryFiles(nextFiles)
      // Persistence is handled by the guarded effect above (SQLite + mirror).

      // Metadata caching in background
      if (window.electronAPI?.dbCacheMetadata && window.electronAPI?.getTrackMetadata && nextFiles.length > 0) {
        try {
          const cachedMeta = await window.electronAPI.dbGetBulkMetadata(nextFiles)
          setArtCache(cachedMeta || {})

          const toScan = nextFiles.filter(f => !cachedMeta[f])
          scanAbortRef.current = false
          const BATCH = 8
          const newMeta = {}
          for (let i = 0; i < toScan.length; i += BATCH) {
            if (scanAbortRef.current) break
            const batch = toScan.slice(i, i + BATCH)
            const results = await Promise.all(
              batch.map(fp => window.electronAPI.getTrackMetadata(fp).then(m => [fp, m]))
            )
            for (const [fp, meta] of results) {
              if (meta) {
                window.electronAPI.dbCacheMetadata(fp, meta)
                newMeta[fp] = meta
              }
            }
          }
          if (Object.keys(newMeta).length > 0) {
            setArtCache(prev => ({ ...prev, ...newMeta }))
          }
        } catch (err) {
          console.error('[Library] Metadata pass failed:', err)
        }
      }
    } finally {
      scanningRef.current = false
      setIsScanning(false)
    }
  }, [folders, downloadFolder])

  useEffect(() => {
    scanAllFolders()
    return () => { scanAbortRef.current = true }
  }, [scanAllFolders])

  // Fetch downloaded YouTube video IDs
  const fetchDownloadedIds = useCallback(async () => {
    if (window.electronAPI?.getDownloadedVideoIds) {
      try {
        const ids = await window.electronAPI.getDownloadedVideoIds(downloadFolder)
        if (Array.isArray(ids)) {
          setDownloadedIds(new Set(ids))
        }
      } catch (e) {}
    }
  }, [downloadFolder])

  useEffect(() => {
    fetchDownloadedIds()
  }, [fetchDownloadedIds, libraryFiles.length])

  // Instant real-time listener for download:completed
  useEffect(() => {
    if (!window.electronAPI?.onDownloadCompleted) return
    const unbind = window.electronAPI.onDownloadCompleted(async (data) => {
      const { videoId, filePath, baseDir } = data || {}
      if (videoId) {
        setDownloadedIds(prev => new Set([...prev, videoId]))
      }
      if (filePath) {
        setLibraryFiles(prev => prev.includes(filePath) ? prev : [filePath, ...prev])
        if (window.electronAPI?.getTrackMetadata) {
          window.electronAPI.getTrackMetadata(filePath).then(meta => {
            if (meta) {
              setArtCache(prev => ({ ...prev, [filePath]: meta }))
              if (window.electronAPI?.dbCacheMetadata) {
                window.electronAPI.dbCacheMetadata(filePath, meta)
              }
            }
          }).catch(() => {})
        }
      }
      // Also immediately scan download folder to ensure 100% sync
      const dir = baseDir || downloadFolder
      if (dir && window.electronAPI?.scanLibrary) {
        window.electronAPI.scanLibrary(dir).then(files => {
          if (Array.isArray(files) && files.length > 0) {
            setLibraryFiles(prev => {
              const existing = new Set(prev)
              const added = files.filter(f => !existing.has(f))
              return added.length > 0 ? [...added, ...prev] : prev
            })
          }
        }).catch(() => {})
      }
    })
    return () => unbind?.()
  }, [downloadFolder])

  // Helper to check if a track or src is downloaded
  const isDownloaded = useCallback((trackOrSrc) => {
    if (!trackOrSrc) return false
    const videoId = typeof trackOrSrc === 'string'
      ? (trackOrSrc.startsWith('yt:') ? trackOrSrc.replace('yt:', '') : null)
      : (trackOrSrc.videoId || (trackOrSrc.src?.startsWith('yt:') ? trackOrSrc.src.replace('yt:', '') : (trackOrSrc.id?.startsWith('yt:') ? trackOrSrc.id.replace('yt:', '') : null)))
    if (!videoId) return false
    return downloadedIds.has(videoId)
  }, [downloadedIds])

  // Helper to re-scan downloads explicitly (e.g. after a song finishes downloading)
  const refreshDownloads = useCallback(async () => {
    await fetchDownloadedIds()
    let dirs = []
    if (downloadFolder) dirs.push(downloadFolder)
    if (window.electronAPI?.getDefaultDownloadFolder) {
      const defDir = await window.electronAPI.getDefaultDownloadFolder()
      if (defDir && !dirs.includes(defDir)) dirs.push(defDir)
    }
    for (const dir of dirs) {
      if (window.electronAPI?.scanLibrary) {
        try {
          const files = await window.electronAPI.scanLibrary(dir)
          if (Array.isArray(files) && files.length > 0) {
            setLibraryFiles(prev => {
              const existing = new Set(prev)
              const added = files.filter(f => !existing.has(f))
              return added.length > 0 ? [...added, ...prev] : prev
            })
          }
        } catch (_) {}
      }
    }
    await scanAllFolders()
  }, [downloadFolder, fetchDownloadedIds, scanAllFolders])

  // Favourites actions
  const addToFavourites = useCallback((item) => {
    if (!item) return
    const norm = normalizeTrack(item)
    if (!norm) return

    setFavourites(prev => new Set([...prev, norm.src]))
    
    if (norm.src.startsWith('yt:')) {
      setStreamingFavourites(prev => {
        if (prev.some(t => t.src === norm.src)) return prev
        return [...prev, norm]
      })
      if (window.electronAPI?.dbCacheMetadata && (norm.title || norm.artist || norm.albumArt)) {
        window.electronAPI.dbCacheMetadata(norm.src, {
          title: norm.title,
          artist: norm.artist,
          album: norm.album,
          albumArt: norm.albumArt,
          duration: norm.duration
        })
      }
    }
  }, [])

  const removeFromFavourites = useCallback((item) => {
    if (!item) return
    const src = typeof item === 'string' ? item : (item.src || (item.videoId ? `yt:${item.videoId}` : item.id))
    if (!src) return

    setFavourites(prev => {
      const s = new Set(prev)
      s.delete(src)
      return s
    })

    if (src.startsWith('yt:')) {
      setStreamingFavourites(prev => prev.filter(t => t.src !== src))
    }
  }, [])

  // Playlist actions
  const createAndAddToPlaylist = useCallback((srcOrTracks, playlistName, extra = {}) => {
    if (!playlistName || !playlistName.trim()) return
    const name = playlistName.trim()
    let list = []
    if (Array.isArray(srcOrTracks)) {
      list = srcOrTracks.map(t => {
        if (typeof t === 'string') return t
        const src = t.src || (t.videoId ? `yt:${t.videoId}` : (t.id?.startsWith('yt:') ? t.id : `yt:${t.id}`))
        if (window.electronAPI?.dbCacheMetadata && (t.title || t.albumArt || t.thumbnail || t.artist)) {
          window.electronAPI.dbCacheMetadata(src, {
            title: t.title,
            artist: t.artist || t.author || 'Unknown Artist',
            albumArt: t.albumArt || t.thumbnail || null,
            duration: typeof t.duration === 'object' ? t.duration?.seconds : t.duration
          })
        }
        return src
      })
    } else if (srcOrTracks) {
      const s = typeof srcOrTracks === 'string' ? srcOrTracks : (srcOrTracks.src || (srcOrTracks.videoId ? `yt:${srcOrTracks.videoId}` : (srcOrTracks.id?.startsWith('yt:') ? srcOrTracks.id : `yt:${srcOrTracks.id}`)))
      if (s) {
        list = [s]
        if (typeof srcOrTracks === 'object' && window.electronAPI?.dbCacheMetadata) {
          window.electronAPI.dbCacheMetadata(s, {
            title: srcOrTracks.title,
            artist: srcOrTracks.artist || srcOrTracks.author || 'Unknown Artist',
            albumArt: srcOrTracks.albumArt || srcOrTracks.thumbnail || null,
            duration: typeof srcOrTracks.duration === 'object' ? srcOrTracks.duration?.seconds : srcOrTracks.duration
          })
        }
      }
    }

    const firstTrackArt = Array.isArray(srcOrTracks) && srcOrTracks.length > 0 && typeof srcOrTracks[0] === 'object' 
      ? (srcOrTracks[0].albumArt || srcOrTracks[0].thumbnail)
      : null

    const newPlaylist = {
      id: Date.now().toString(),
      name,
      files: list,
      tracks: list,
      thumbnail: extra?.thumbnail || firstTrackArt || null,
      externalId: extra?.externalId || null,
      createdAt: Date.now()
    }

    setPlaylists(prev => [...prev, newPlaylist])
  }, [])

  const addToPlaylist = useCallback((srcOrTrack, playlistId) => {
    if (!playlistId || !srcOrTrack) return
    const src = typeof srcOrTrack === 'string' ? srcOrTrack : (srcOrTrack.src || (srcOrTrack.videoId ? `yt:${srcOrTrack.videoId}` : (srcOrTrack.id?.startsWith('yt:') ? srcOrTrack.id : `yt:${srcOrTrack.id}`)))
    if (!src) return

    if (typeof srcOrTrack === 'object' && window.electronAPI?.dbCacheMetadata) {
      window.electronAPI.dbCacheMetadata(src, {
        title: srcOrTrack.title,
        artist: srcOrTrack.artist || srcOrTrack.author || 'Unknown Artist',
        albumArt: srcOrTrack.albumArt || srcOrTrack.thumbnail || null,
        duration: typeof srcOrTrack.duration === 'object' ? srcOrTrack.duration?.seconds : srcOrTrack.duration
      })
    }

    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        const currentList = p.files || p.tracks || []
        if (currentList.includes(src)) return p
        const updated = [...currentList, src]
        return { ...p, files: updated, tracks: updated }
      }
      return p
    }))
  }, [])

  const removeFromPlaylist = useCallback((playlistId, trackSrc) => {
    if (!playlistId || !trackSrc) return
    const src = typeof trackSrc === 'string' ? trackSrc : (trackSrc.src || trackSrc.id)
    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        const currentList = p.files || p.tracks || []
        const updated = currentList.filter(f => f !== src)
        return { ...p, files: updated, tracks: updated }
      }
      return p
    }))
  }, [])

  const deletePlaylist = useCallback((playlistId) => {
    if (!playlistId) return
    setPlaylists(prev => prev.filter(p => p.id !== playlistId))
  }, [])

  const renamePlaylist = useCallback((playlistId, newName) => {
    if (!playlistId || !newName || !newName.trim()) return
    const name = newName.trim()
    setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, name } : p))
  }, [])

  const removeFolder = useCallback((folderPath) => {
    setFolders(prev => prev.filter(f => !f.startsWith(folderPath)))
    setLibraryFiles(prev => prev.filter(f => !f.startsWith(folderPath)))
  }, [])

  // Followed artists actions
  const isFollowingArtist = useCallback((artistName) => {
    if (!artistName) return false
    const target = typeof artistName === 'string' ? artistName.trim().toLowerCase() : (artistName.name || '').trim().toLowerCase()
    return followedArtists.some(a => a.name && a.name.trim().toLowerCase() === target)
  }, [followedArtists])

  const followArtist = useCallback((artist) => {
    if (!artist) return
    const norm = normalizeArtist(artist)
    if (!norm || !norm.name) return
    const target = norm.name.trim().toLowerCase()

    setFollowedArtists(prev => {
      const idx = prev.findIndex(a => a.name && a.name.trim().toLowerCase() === target)
      if (idx !== -1) {
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          ...norm,
          thumbnail: norm.thumbnail || updated[idx].thumbnail,
          headerImage: norm.headerImage || updated[idx].headerImage,
          subscribers: norm.subscribers || updated[idx].subscribers
        }
        return updated
      }
      return [norm, ...prev]
    })
  }, [])

  const unfollowArtist = useCallback((artistName) => {
    if (!artistName) return
    const target = typeof artistName === 'string' ? artistName.trim().toLowerCase() : (artistName.name || '').trim().toLowerCase()
    setFollowedArtists(prev => prev.filter(a => !a.name || a.name.trim().toLowerCase() !== target))
  }, [])

  const toggleFollowArtist = useCallback((artist) => {
    if (!artist) return
    const name = typeof artist === 'string' ? artist : (artist.name || artist.title || '')
    if (isFollowingArtist(name)) {
      unfollowArtist(name)
    } else {
      followArtist(artist)
    }
  }, [isFollowingArtist, unfollowArtist, followArtist])

  // Global Playlist Picker Modal State
  const [playlistModalTrack, setPlaylistModalTrack] = useState(null)

  const openPlaylistModal = useCallback((track) => {
    if (track) setPlaylistModalTrack(track)
  }, [])

  const closePlaylistModal = useCallback(() => {
    setPlaylistModalTrack(null)
  }, [])

  const toggleTrackInPlaylist = useCallback((srcOrTrack, playlistId) => {
    if (!playlistId || !srcOrTrack) return
    const src = typeof srcOrTrack === 'string' ? srcOrTrack : (srcOrTrack.src || (srcOrTrack.videoId ? `yt:${srcOrTrack.videoId}` : (srcOrTrack.id?.startsWith('yt:') ? srcOrTrack.id : `yt:${srcOrTrack.id}`)))
    if (!src) return

    setPlaylists(prev => prev.map(p => {
      if (p.id === playlistId) {
        const currentList = p.files || p.tracks || []
        const exists = currentList.includes(src)
        if (exists) {
          const updated = currentList.filter(f => f !== src)
          return { ...p, files: updated, tracks: updated }
        } else {
          if (typeof srcOrTrack === 'object' && window.electronAPI?.dbCacheMetadata) {
            window.electronAPI.dbCacheMetadata(src, {
              title: srcOrTrack.title,
              artist: srcOrTrack.artist || srcOrTrack.author || 'Unknown Artist',
              albumArt: srcOrTrack.albumArt || srcOrTrack.thumbnail || null,
              duration: typeof srcOrTrack.duration === 'object' ? srcOrTrack.duration?.seconds : srcOrTrack.duration
            })
          }
          const updated = [...currentList, src]
          return { ...p, files: updated, tracks: updated }
        }
      }
      return p
    }))
  }, [])

  const restoreLibraryData = useCallback((backup, mode = 'replace') => {
    if (!backup || typeof backup !== 'object') return { success: false, error: 'Invalid backup object' }

    if (mode === 'replace') {
      // 1. Playlists
      if (Array.isArray(backup.playlists)) {
        setPlaylists(backup.playlists)
      }
      // 2. Favourites
      if (Array.isArray(backup.favourites)) {
        setFavourites(new Set(backup.favourites))
      }
      if (Array.isArray(backup.streamingFavourites)) {
        setStreamingFavourites(backup.streamingFavourites)
      }
      // 3. Followed Artists
      if (Array.isArray(backup.followedArtists)) {
        setFollowedArtists(backup.followedArtists.map(normalizeArtist).filter(Boolean))
      }
      // 4. Folders & Download Folder
      if (Array.isArray(backup.folders)) {
        setFolders(backup.folders)
      }
      if (backup.downloadFolder) {
        setDownloadFolder(backup.downloadFolder)
      }
    } else {
      // Merge mode
      if (Array.isArray(backup.playlists)) {
        setPlaylists(prev => {
          const existingIds = new Set(prev.map(p => p.id))
          const existingNames = new Set(prev.map(p => (p.name || '').toLowerCase()))
          const toAdd = backup.playlists.filter(p => !existingIds.has(p.id) && !existingNames.has((p.name || '').toLowerCase()))
          return [...prev, ...toAdd]
        })
      }
      if (Array.isArray(backup.favourites)) {
        setFavourites(prev => new Set([...prev, ...backup.favourites]))
      }
      if (Array.isArray(backup.streamingFavourites)) {
        setStreamingFavourites(prev => {
          const seen = new Set(prev.map(s => s.src || s.id))
          const toAdd = backup.streamingFavourites.filter(s => s && !seen.has(s.src || s.id))
          return [...prev, ...toAdd]
        })
      }
      if (Array.isArray(backup.followedArtists)) {
        setFollowedArtists(prev => {
          const seen = new Set(prev.map(a => (a.name || '').toLowerCase()))
          const toAdd = backup.followedArtists.map(normalizeArtist).filter(a => a && a.name && !seen.has(a.name.toLowerCase()))
          return [...prev, ...toAdd]
        })
      }
      if (Array.isArray(backup.folders)) {
        setFolders(prev => Array.from(new Set([...prev, ...backup.folders])))
      }
    }

    return { success: true }
  }, [])

  const value = {
    folders, setFolders,
    libraryFiles, setLibraryFiles,
    artCache, setArtCache,
    isScanning,
    playlists, setPlaylists,
    favourites, setFavourites,
    streamingFavourites, setStreamingFavourites,
    followedArtists, setFollowedArtists,
    followArtist, unfollowArtist,
    isFollowingArtist, toggleFollowArtist,
    downloadFolder, setDownloadFolder,
    downloadedIds, isDownloaded, fetchDownloadedIds,
    addToFavourites, removeFromFavourites,
    addToPlaylist, createAndAddToPlaylist,
    removeFromPlaylist, deletePlaylist, renamePlaylist,
    toggleTrackInPlaylist,
    playlistModalTrack, openPlaylistModal, closePlaylistModal,
    removeFolder,
    refreshDownloads,
    scanAllFolders,
    restoreLibraryData
  }

  return (
    <LibraryContext.Provider value={value}>
      {children}
    </LibraryContext.Provider>
  )
}

export function useLibrary() {
  return useContext(LibraryContext)
}

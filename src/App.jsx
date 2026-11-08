/**
 * App.jsx — Root application shell
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  TitleBar (draggable, window controls)    │
 *   ├──────────┬───────────────────────────────┤
 *   │ Sidebar  │  Main content (routed by view) │
 *   │ (140px)  │                               │
 *   ├──────────┴───────────────────────────────┤
 *   │  AudioPlayer (bottom bar)                │
 *   └──────────────────────────────────────────┘
 *
 * Library state (files, folderName, isScanning) is kept here so it
 * persists when the user switches between sidebar views.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PlayerProvider } from './context/PlayerContext'
import { usePlayer } from './context/usePlayer'
import { buildCustomTheme, CUSTOM_VAR_KEYS } from './customTheme'
import { LibraryProvider, useLibrary } from './context/LibraryContext'
import TitleBar from './components/TitleBar'
import AudioPlayer from './components/AudioPlayer'
import Sidebar from './components/Sidebar'
import { usePinnedPlaylists, unpinPlaylist } from './pinnedPlaylists'
import TrackList from './components/TrackList'
import { getRandomAnimePfp } from './constants/animePfps'
import StreamingView from './components/StreamingView'
import { getArtURL, getSizedArtURL } from './utils'
import Queue from './components/Queue'
import FavouritesView from './components/FavouritesView'
import AlbumsView from './components/AlbumsView'
import HomeDashboard from './components/HomeDashboard'
import ArtistsView from './components/ArtistsView'
import PlaylistsView from './components/PlaylistsView'
import SettingsView from './components/SettingsView'
import FullScreenPlayer from './components/FullScreenPlayer'
import SetupWizard from './components/SetupWizard'
import ProfileView from './components/ProfileView'
import ArtistProfileView from './components/ArtistProfileView'
import LyricsView from './components/LyricsView'
import ListeningInsightsDashboard from './components/ListeningInsightsDashboard'
import AddToPlaylistModal from './components/AddToPlaylistModal'
import YouTubeMusicView from './components/YouTubeMusicView'
import MiniPlayerView from './components/MiniPlayerView'
import UpdateBanner from './components/UpdateBanner'
import OfflineBanner from './components/OfflineBanner'

import { THEMES } from './themes'
import { normalizeAppearance } from './appearanceThemes'

// ── Component: Dynamic mesh background ─────────────────────────────────────

function DynamicBackground({ currentArt, accentColor, theme, customThemes, ambience }) {
  const [layers, setLayers] = useState([{ id: '0', art: null }, { id: '1', art: null }])
  const [activeLayer, setActiveLayer] = useState(0)
  // Use refs to track state without putting them in dependency arrays (prevents render loops)
  const activeLayerRef = React.useRef(0)
  const layersRef = React.useRef([{ id: '0', art: null }, { id: '1', art: null }])

  const fixedTheme = THEMES.find(t => t.id === theme && t.id !== 'dynamic') || (customThemes || []).find(t => t.id === theme)
  const artToShow = fixedTheme ? fixedTheme.img : currentArt

  React.useEffect(() => {
    // Only swap layers when the art actually changes — avoids infinite loop
    if (layersRef.current[activeLayerRef.current].art === artToShow) return
    const nextLayer = activeLayerRef.current === 0 ? 1 : 0
    const newLayers = [...layersRef.current]
    newLayers[nextLayer] = { id: `${Date.now()}`, art: artToShow }
    layersRef.current = newLayers
    activeLayerRef.current = nextLayer
    setLayers(newLayers)
    setActiveLayer(nextLayer)
  }, [artToShow])

  const layerBaseStyle = {
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: 'blur(var(--backdrop-blur))',
    transform: 'scale(1.08) translateZ(0)',
    contain: 'strict',
    isolation: 'isolate',
    backfaceVisibility: 'hidden',
    willChange: 'opacity',
  }

  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" style={{ contain: 'strict', isolation: 'isolate' }}>
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-[1500ms] ease-in-out"
        style={{
          backgroundImage: layers[0].art ? `url("${layers[0].art}")` : 'none',
          opacity: activeLayer === 0 && layers[0].art ? 'var(--backdrop-opacity)' : 0,
          ...layerBaseStyle,
        }}
      />
      <div
        className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-[1500ms] ease-in-out"
        style={{
          backgroundImage: layers[1].art ? `url("${layers[1].art}")` : 'none',
          opacity: activeLayer === 1 && layers[1].art ? 'var(--backdrop-opacity)' : 0,
          ...layerBaseStyle,
        }}
      />
      {/* Ambient colour bleed. `accentColor` is an `rgb(r,g,b)` string, so the old
          `${accentColor}40` produced `rgb(...)40` — invalid CSS that silently
          killed this whole layer. color-mix() takes any colour format. */}
      <div
        className="ambient-layer absolute inset-0 z-0 pointer-events-none"
        style={{
          contain: 'strict',
          isolation: 'isolate',
          '--ambient-color': accentColor,
          background: ambience
            ? `
              radial-gradient(ellipse 95% 75% at 68% 12%, color-mix(in srgb, var(--ambient-color) 22%, transparent) 0%, transparent 58%),
              radial-gradient(ellipse 75% 60% at 18% 72%, color-mix(in srgb, var(--ambient-color) 15%, transparent) 0%, transparent 58%),
              radial-gradient(ellipse 85% 45% at 50% 102%, color-mix(in srgb, var(--ambient-color) 18%, transparent) 0%, transparent 62%),
              color-mix(in srgb, var(--app-bg) ${layers[activeLayer]?.art ? '32%' : '62%'}, transparent)`
            : `
              radial-gradient(ellipse 90% 70% at 65% 15%, color-mix(in srgb, var(--ambient-color) 12%, transparent) 0%, transparent 50%),
              color-mix(in srgb, var(--app-bg) ${layers[activeLayer]?.art ? '55%' : '85%'}, transparent)`,
        }}
      />
    </div>
  )
}

function AppShell() {
  const { accentColor, currentTrack, theme, setTheme, appearance, customAccent, customMode, ambience, motion, eqGains, isFullScreen, toggleFullScreen, is8D, setIs8D, panSpeed, setPanSpeed, updateEqualizer, isAutoplay, setIsAutoplay, audioElement, duration, togglePlayPause, skipNext, skipPrev, seekTo, setIsMuted } = usePlayer()

  // Apply the appearance theme. Every built-in palette lives in index.css under
  // [data-theme="…"], so one attribute swap re-themes the whole app. The custom
  // palette can't be static, so it is derived from the picked colour and written
  // as inline custom properties — those beat the stylesheet, hence the explicit
  // cleanup when switching back to a built-in theme.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = normalizeAppearance(appearance)
    root.dataset.ambience = ambience ? 'on' : 'off'
    root.dataset.motion = motion ? 'on' : 'off'
    for (const key of CUSTOM_VAR_KEYS) root.style.removeProperty(key)
    if (appearance === 'custom') {
      const vars = buildCustomTheme(customAccent, customMode)
      for (const [key, val] of Object.entries(vars)) root.style.setProperty(key, val)
    }
  }, [appearance, customAccent, customMode, ambience, motion])

  // ── OOBE / Profile ──────────────────────────────────────────────────────
  const [setupComplete, setSetupComplete] = useState(() => {
    try {
      return localStorage.getItem('glaze_setup_complete') === 'true'
    } catch {
      return true
    }
  })
  const [userProfile, setUserProfile] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_profile') || 'null')
      if (saved) {
        if (!saved.profileImage) {
          saved.profileImage = getRandomAnimePfp()
          try { localStorage.setItem('glaze_profile', JSON.stringify(saved)) } catch {}
        }
        return saved
      }
      const initial = { userName: 'User', profileImage: getRandomAnimePfp() }
      try { localStorage.setItem('glaze_profile', JSON.stringify(initial)) } catch {}
      return initial
    } catch { 
      return { userName: 'User', profileImage: getRandomAnimePfp() } 
    }
  })

  const { 
    libraryFiles, setLibraryFiles,
    artCache, setArtCache,
    folders, setFolders,
    isScanning,
    favourites,
    streamingFavourites,
    followedArtists,
    followArtist, unfollowArtist,
    isFollowingArtist, toggleFollowArtist,
    downloadFolder, setDownloadFolder,
    playlists, setPlaylists,
    addToFavourites, removeFromFavourites,
    addToPlaylist, createAndAddToPlaylist,
    removeFromPlaylist, deletePlaylist, renamePlaylist,
    toggleTrackInPlaylist,
    playlistModalTrack, openPlaylistModal, closePlaylistModal,
    removeFolder, refreshDownloads
  } = useLibrary()

  function handleSetupComplete(profile) {
    try {
      localStorage.setItem('glaze_setup_complete', 'true')
      localStorage.setItem('glaze_profile', JSON.stringify({
        userName: profile.userName,
        profileImage: profile.profileImage
      }))
    } catch {}
    setUserProfile({ userName: profile.userName, profileImage: profile.profileImage })
    setSetupComplete(true)
    if (profile.theme) setTheme(profile.theme)
    if (profile.enable8D !== undefined) setIs8D(profile.enable8D)
    if (profile.enableAutoplay !== undefined) setIsAutoplay(profile.enableAutoplay)
    if (profile.musicFolder) {
      setFolders(prev => prev.includes(profile.musicFolder) ? prev : [...prev, profile.musicFolder])
      if (profile.scannedFiles?.length) {
        setLibraryFiles(prev => {
          const existing = new Set(prev)
          const merged = [...prev]
          for (const f of profile.scannedFiles) if (!existing.has(f)) merged.push(f)
          return merged
        })
      }
    }
  }

  // ── Active view & Mini Player ──────────────────────────────────────────
  const [activeView, setActiveView] = useState('home')
  const [viewHistory, setViewHistory] = useState([])
  const [artistHistory, setArtistHistory] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // A pin re-opens its playlist through the same `pendingOnlineItem` handshake the
  // YouTube Music view already uses, so the detail view needs no new entry point.
  // Local playlists are not pinnable — they are already listed in the sidebar.
  const pinnedPlaylists = usePinnedPlaylists()

  const handleOpenPinned = (pin) => {
    if (!pin?.item) return
    setPendingOnlineItem(pin.item)
    // `streaming` is Explore; `yt_streaming` keeps YouTube Music highlighted.
    navigateTo(pin.source === 'explore' ? 'streaming' : 'yt_streaming')
  }
  const [selectedArtistName, setSelectedArtistName] = useState(null)
  // Mirrors of the two values the artist event listener needs. The listener is
  // bound once with `[]` deps, so reading `activeView` / `selectedArtistName`
  // straight from the closure would see their values at mount (null / 'home').
  const activeViewRef = React.useRef(activeView)
  const selectedArtistRef = React.useRef(null)
  React.useEffect(() => { activeViewRef.current = activeView }, [activeView])
  React.useEffect(() => { selectedArtistRef.current = selectedArtistName }, [selectedArtistName])
  const [isLyricsOverlay, setIsLyricsOverlay] = useState(false)
  const [isMiniPlayer, setIsMiniPlayer] = useState(false)

  // Listen for Mini Player mode changes from main process (IPC / Global Shortcuts)
  React.useEffect(() => {
    if (window.electronAPI?.onMiniPlayerChange) {
      const unsubscribe = window.electronAPI.onMiniPlayerChange((mini) => {
        setIsMiniPlayer(mini)
      })
      return unsubscribe
    }
  }, [])

  // Keyboard shortcut: Ctrl+Shift+M / Cmd+Shift+M toggles Mini Player
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        window.electronAPI?.toggleMiniPlayer?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Only YouTube Music is linkable now — Spotify was removed.
  const [connectedServices, setConnectedServices] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_connected_services') || '{}')
      return { youtubeMusic: !!saved?.youtubeMusic }
    } catch { return { youtubeMusic: false } }
  })

  // A playlist / album chosen in YouTube Music has to survive the view switch:
  // the event fires before StreamingView mounts, so the detail is parked here
  // and StreamingView consumes it once it is actually on screen.
  const [pendingOnlineItem, setPendingOnlineItem] = useState(null)
  const consumePendingOnlineItem = React.useCallback(() => setPendingOnlineItem(null), [])

  // YouTube Music is mounted lazily on first visit and then kept alive (see the
  // render block) so its tab, loaded library and scroll survive a detour through
  // Home/Favourites. `streaming` uses the same trick for the same reason.
  const [ytMusicMounted, setYtMusicMounted] = useState(false)
  React.useEffect(() => {
    if (activeView === 'youtube_music' || activeView === 'cloud_library') setYtMusicMounted(true)
  }, [activeView])
  
  React.useEffect(() => {
    localStorage.setItem('glaze_connected_services', JSON.stringify(connectedServices))
  }, [connectedServices])

  // Reconcile the local "connected" flag with the main process on launch. The
  // cookies are the real source of truth; localStorage can outlive them (or be
  // wiped while they survive), and either way the UI must not lie.
  React.useEffect(() => {
    let active = true
    window.electronAPI?.youtubeGetAuthStatus?.().then(res => {
      if (!active || !res) return
      if (res.connected) {
        setConnectedServices(s => (s.youtubeMusic ? s : { ...s, youtubeMusic: true }))
      }
    }).catch(() => {})
    return () => { active = false }
  }, [])

  const navigateTo = (view) => {
    setActiveView(prev => {
      if (prev !== view) setViewHistory(h => [...h, prev])
      return view
    })
  }

  const navigateBack = () => {
    setViewHistory(h => {
      const newH = [...h]
      // Skip detail views. `artist_profile` needs the selection it was opened
      // with, and that is not restored here, so landing on it showed whichever
      // artist happened to still be selected — the "back takes me somewhere
      // strange" report.
      let prev
      while (newH.length > 0) {
        const candidate = newH.pop()
        if (candidate && candidate !== 'artist_profile') { prev = candidate; break }
      }
      setActiveView(prev || 'home')
      return newH
    })
  }

  const handleArtistBack = () => {
    if (artistHistory.length > 0) {
      const prevArtist = artistHistory[artistHistory.length - 1]
      setArtistHistory(h => h.slice(0, -1))
      setSelectedArtistName(prevArtist)
    } else {
      navigateBack()
    }
  }

  React.useEffect(() => {
    const handleOpenArtist = (e) => {
      if (!e.detail || e.detail === 'Unknown Artist') return
      const rawTarget = typeof e.detail === 'object'
        ? (e.detail.name || e.detail.title || e.detail.id)
        : e.detail
      if (rawTarget == null) return
      const name = String(rawTarget).split(',')[0].trim()
      if (!name) return

      // Only a link followed from *inside* an artist page continues the chain.
      // `selectedArtistName` deliberately survives after you leave the page, so
      // opening an artist from a list used to push the previously-viewed artist
      // onto the stack — back then went to an artist you never came from.
      if (activeViewRef.current !== 'artist_profile') {
        setArtistHistory([])
      } else {
        const prev = selectedArtistRef.current
        if (prev && prev.toLowerCase() !== name.toLowerCase()) {
          setArtistHistory(h => [...h, prev])
        }
      }
      setSelectedArtistName(name)
      navigateTo('artist_profile')
    }
    const handleOpenPlaylist = (e) => {
      if (e.detail) {
        setPendingOnlineItem(e.detail)
        navigateTo('streaming')
      }
    }
    const handleSwitchView = (e) => {
      if (e.detail) {
        navigateTo(e.detail)
      }
    }
    const handleNavigateBack = () => navigateBack()
    
    window.addEventListener('open-artist', handleOpenArtist)
    window.addEventListener('open-online-playlist', handleOpenPlaylist)
    window.addEventListener('switch-view', handleSwitchView)
    window.addEventListener('navigate-back', handleNavigateBack)
    return () => {
      window.removeEventListener('open-artist', handleOpenArtist)
      window.removeEventListener('open-online-playlist', handleOpenPlaylist)
      window.removeEventListener('switch-view', handleSwitchView)
      window.removeEventListener('navigate-back', handleNavigateBack)
    }
  }, [])

  // ── Additional Settings State ──────────────────────────────────────────
  const [localInsights, setLocalInsights] = useState(true)
  const [customThemes, setCustomThemes]   = useState([])
  const [downloadNotification, setDownloadNotification] = useState(null)
  
  // Feed states with instant cache recovery on start
  const [streamingHomeFeed, setStreamingHomeFeedState] = useState(() => {
    try {
      const cached = localStorage.getItem('glaze_home_feed')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
  const [homeRecommendations, setHomeRecommendationsState] = useState(() => {
    try {
      const cached = localStorage.getItem('glaze_home_recs')
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })
  const [quickPicks, setQuickPicksState] = useState(() => {
    try {
      const cached = localStorage.getItem('glaze_quick_picks')
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })

  const setStreamingHomeFeed = (data) => {
    setStreamingHomeFeedState(data)
    if (data) {
      try { localStorage.setItem('glaze_home_feed', JSON.stringify(data)) } catch {}
    }
  }

  const setHomeRecommendations = (data) => {
    setHomeRecommendationsState(data)
    if (data) {
      try { localStorage.setItem('glaze_home_recs', JSON.stringify(data)) } catch {}
    }
  }

  const setQuickPicks = (data) => {
    setQuickPicksState(data)
    if (data) {
      try { localStorage.setItem('glaze_quick_picks', JSON.stringify(data)) } catch {}
    }
  }

  // ── Load & Save Preferences (Non-library) ──────────────────────────────
  const isPrefsLoadedRef = useRef(false)
  const [isSessionLoaded, setIsSessionLoaded] = useState(false)

  React.useEffect(() => {
    async function loadPrefs() {
      let loaded = false
      try {
        if (window.electronAPI?.loadPreferences) {
          const prefs = await window.electronAPI.loadPreferences()
          if (prefs) {
            if (prefs.theme) setTheme(prefs.theme)
            if (typeof prefs.localInsights === 'boolean') setLocalInsights(prefs.localInsights)
            if (prefs.customThemes) setCustomThemes(prefs.customThemes)

            if (typeof prefs.is8D === 'boolean') setIs8D(prefs.is8D)
            if (typeof prefs.panSpeed === 'number') setPanSpeed(prefs.panSpeed)
            if (typeof prefs.isAutoplay === 'boolean') setIsAutoplay(prefs.isAutoplay)
            else setIsAutoplay(true)
            if (prefs.eqGains && Array.isArray(prefs.eqGains)) {
              prefs.eqGains.forEach((gain, i) => updateEqualizer(i, gain))
            }

            // OOBE & Profile
            if (typeof prefs.setupComplete === 'boolean') setSetupComplete(prefs.setupComplete)
            if (prefs.userProfile) setUserProfile(prefs.userProfile)
          }
        }

        // Load session
        if (window.electronAPI?.loadSessionState) {
          const sess = await window.electronAPI.loadSessionState()
          if (sess) {
            // Only restore a view that can stand on its own. A detail view needs the
            // selection it was opened with, and that is not part of the saved session
            // — restoring `artist_profile` mounted the page with no artist, whose
            // fetch effect bails immediately, so it sat on "Loading…" until the user
            // happened to navigate somewhere else. Land on the parent list instead.
            const NEEDS_SELECTION = { artist_profile: 'artists' }
            if (sess.activeView) {
              setActiveView(NEEDS_SELECTION[sess.activeView] || sess.activeView)
            }
            if (sess.viewHistory) setViewHistory(sess.viewHistory)
          }
        }

        loaded = true
      } catch (err) {
        // Degrade to defaults. isSessionLoaded gates the entire UI, so a throw
        // here used to leave the splash screen spinning forever with no error
        // and no way out but killing the process.
        console.error('[App] Failed to load preferences/session, using defaults:', err)
      } finally {
        // Only arm the save effect if we actually read the existing preferences —
        // otherwise a load failure would immediately write defaults over the
        // user's real file.
        if (loaded) isPrefsLoadedRef.current = true
        setIsSessionLoaded(true)
      }
    }
    loadPrefs()
  }, []) // run once on mount

  React.useEffect(() => {
    if (!isPrefsLoadedRef.current || !window.electronAPI?.savePreferences) return
    const saveTimeout = setTimeout(() => {
      window.electronAPI.savePreferences({
        theme,
        eqGains,
        is8D,
        panSpeed,
        isAutoplay,
        localInsights,
        customThemes,
        setupComplete,
        userProfile,
    // (Folders, playlists, favs are now saved in LibraryContext)
      })
    }, 500) // debounce saving slightly
    return () => clearTimeout(saveTimeout)
  }, [
    theme, eqGains, is8D, panSpeed, isAutoplay, localInsights, customThemes,
    setupComplete, userProfile
  ])

  React.useEffect(() => {
    if (!isSessionLoaded || !window.electronAPI?.saveSessionState) return
    const saveTimeout = setTimeout(() => {
      window.electronAPI.saveSessionState({ activeView, viewHistory })
    }, 500)
    return () => clearTimeout(saveTimeout)
  }, [activeView, viewHistory, isSessionLoaded])

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────
  // Single owner for the global transport keys.
  //
  // AudioPlayer and LyricsView used to each register their own Space handler.
  // Both are mounted at the same time when the lyrics view is open, so both
  // fired and the two toggles cancelled out — Space appeared to do nothing.
  React.useEffect(() => {
    function isTypingTarget(el) {
      if (!el || !el.tagName) return false
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
             el.tagName === 'SELECT' || el.isContentEditable === true
    }

    // Seek relative to the live audio element rather than to React state, so
    // App.jsx never has to subscribe to the 4x/sec position context (see H3).
    function nudge(seconds) {
      const el = audioElement
      if (!el || !duration) return false
      const target = Math.min(Math.max((el.currentTime || 0) + seconds, 0), duration)
      seekTo((target / duration) * 100)
      return true
    }

    function handleKeyDown(e) {
      // Never shadow OS/browser combos (Ctrl+R, Cmd+Q, Ctrl+Shift+I, …)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === 'F11') {
        e.preventDefault()
        toggleFullScreen()
        return
      }
      if (e.key === 'Escape' && isFullScreen) {
        toggleFullScreen()
        return
      }

      if (isTypingTarget(e.target)) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlayPause()
          break
        case 'ArrowRight':
          if (e.shiftKey) { e.preventDefault(); skipNext() }
          else if (nudge(5)) e.preventDefault()
          break
        case 'ArrowLeft':
          if (e.shiftKey) { e.preventDefault(); skipPrev() }
          else if (nudge(-5)) e.preventDefault()
          break
        case 'm':
        case 'M':
          e.preventDefault()
          setIsMuted(prev => !prev)
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleFullScreen, isFullScreen, togglePlayPause, skipNext, skipPrev, seekTo, setIsMuted, audioElement, duration])

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  // Drag-and-drop file import was removed: Electron removed `File.path` in v32
  // (this app runs Electron 36), so the old handler silently did nothing.
  // Use "Add Folder" / "Open Files" in the library view instead.
  React.useEffect(() => {
    // Suppress the browser's default "open file" behaviour when a file is
    // dropped anywhere on the window, so the app doesn't navigate away.
    function onDragOver(e) { e.preventDefault() }
    function onDrop(e) { e.preventDefault() }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // ── Scan handlers ──────────────────────────────────────────────────────
  async function handleAddFolder() {
    if (!window.electronAPI) return
    const folderPath = await window.electronAPI.openFolderDialog()
    if (!folderPath) return
    setFolders(prev => prev.includes(folderPath) ? prev : [...prev, folderPath])
  }

  async function handleOpenFiles() {
    if (!window.electronAPI) return
    const paths = await window.electronAPI.openFilesDialog()
    if (!paths?.length) return

    setLibraryFiles(prev => {
      const existing = new Set(prev)
      const merged = [...prev]
      for (const p of paths) {
        if (!existing.has(p)) merged.push(p)
      }
      return merged
    })

    if (window.electronAPI?.getTrackMetadata) {
      for (const p of paths) {
        window.electronAPI.getTrackMetadata(p).then(meta => {
          if (meta) {
            setArtCache(prev => ({ ...prev, [p]: meta }))
            if (window.electronAPI?.dbCacheMetadata) {
              window.electronAPI.dbCacheMetadata(p, meta)
            }
          }
        })
      }
    }
  }

  // Listen for real-time download completion
  useEffect(() => {
    if (!window.electronAPI?.onDownloadCompleted) return
    const unbind = window.electronAPI.onDownloadCompleted(({ filePath }) => {
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
    })
    return () => unbind?.()
  }, [setLibraryFiles, setArtCache])

  const downloadFiles = useMemo(() => {
    const normDownFolder = (downloadFolder || '').replace(/\\/g, '/').toLowerCase()
    return libraryFiles.filter(f => {
      if (!f || typeof f !== 'string') return false
      if (f.match(/\[[a-zA-Z0-9_-]{11}\]/)) return true
      const normF = f.replace(/\\/g, '/').toLowerCase()
      if (normF.includes('glaze downloads') || normF.includes('glaze_downloads')) return true
      if (normDownFolder && normF.includes(normDownFolder)) return true
      return false
    })
  }, [libraryFiles, downloadFolder])

  const handleShowDownloadNotification = useCallback((track, success) => {
    setDownloadNotification({ track, success })
    setTimeout(() => setDownloadNotification(null), 3500)
    
    // Automatically add downloaded track to the library
    if (success && window.electronAPI) {
      const videoId = track.src?.replace('yt:', '') || track.videoId
      if (videoId) {
        window.electronAPI.findDownloadedTrack(videoId, downloadFolder).then(localPath => {
          if (localPath) {
            // Add the downloaded file to the library so it shows in Songs / Downloads immediately
            setLibraryFiles(prev => {
              if (prev.includes(localPath)) return prev
              return [localPath, ...prev]
            })
            // Scan metadata and cache it
            if (window.electronAPI.getTrackMetadata) {
              window.electronAPI.getTrackMetadata(localPath).then(meta => {
                if (meta) {
                  setArtCache(prev => ({ ...prev, [localPath]: meta }))
                  if (window.electronAPI.dbCacheMetadata) {
                    window.electronAPI.dbCacheMetadata(localPath, meta)
                  }
                }
              })
            }
          }
        }).catch(console.error)
      }
      refreshDownloads?.()
    }
  }, [downloadFolder, setLibraryFiles, setArtCache, refreshDownloads])

  function removeFromLibrary(fp) {
    setLibraryFiles(prev => prev.filter(f => f !== fp))
    // We don't remove from DB artCache for now, just hide it from libraryFiles.
  }

  // ── Shared props passed to every view that embeds a TrackList ────────────
  // Memoised because it is spread into every heavy view: rebuilding this object
  // on each App render defeated `React.memo` on StreamingView, so collapsing the
  // sidebar (a single boolean in App state) re-rendered all 5 700 nodes of the
  // Explore grid — one ~95 ms main-thread block per toggle, which is what made
  // that animation stutter while every other view stayed smooth.
  const sharedTrackProps = React.useMemo(() => ({
    artCache,
    favourites,
    streamingFavourites,
    followedArtists,
    followArtist,
    unfollowArtist,
    isFollowingArtist,
    toggleFollowArtist,
    playlists,
    downloadFolder,
    onShowDownloadNotification: handleShowDownloadNotification,
    onAddToFavourites:          addToFavourites,
    onRemoveFromFavourites:     removeFromFavourites,
    onAddToPlaylist:            addToPlaylist,
    onCreateAndAddToPlaylist:   createAndAddToPlaylist,
    onToggleTrackInPlaylist:    toggleTrackInPlaylist,
    onOpenPlaylistModal:        openPlaylistModal,
    onRemoveFromPlaylist:       removeFromPlaylist,
    onDeletePlaylist:           deletePlaylist,
    onRenamePlaylist:           renamePlaylist,
    onRemoveFromLibrary:        removeFromLibrary,
    refreshDownloads:           refreshDownloads,
  }), [artCache, favourites, streamingFavourites, followedArtists, followArtist, unfollowArtist,
       isFollowingArtist, toggleFollowArtist, playlists, downloadFolder, handleShowDownloadNotification,
       addToFavourites, removeFromFavourites, addToPlaylist, createAndAddToPlaylist,
       toggleTrackInPlaylist, openPlaylistModal, removeFromPlaylist, deletePlaylist, renamePlaylist,
       removeFromLibrary, refreshDownloads])

  // Dynamic background tracks the playing song
  // The backdrop is drawn full-screen under a 20-28 px blur, so the source only
  // needs to be a thumbnail. Handing it the full-resolution cover meant decoding
  // and uploading a 1280x720 bitmap for something that has no detail left.
  const artToUse = getSizedArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src), 'thumb')

  // Calculate distinct local artists count + followed artists count
  const localArtistsCount = React.useMemo(() => {
    const set = new Set()
    for (const f of libraryFiles) {
      const art = artCache[f]?.artist
      if (art && art !== 'Unknown Artist') set.add(art)
    }
    return set.size
  }, [libraryFiles, artCache])

  const totalArtistsCount = (followedArtists?.length || 0) + localArtistsCount

  // Deduplicated unique favourites count (prevents local Set + streaming array double counting)
  const totalFavouritesCount = useMemo(() => {
    const uniqueKeys = new Set(favourites || [])
    if (Array.isArray(streamingFavourites)) {
      for (const st of streamingFavourites) {
        if (!st) continue
        const k = st.src || (st.id?.startsWith('yt:') ? st.id : `yt:${st.id}`)
        if (k) uniqueKeys.add(k)
      }
    }
    return uniqueKeys.size
  }, [favourites, streamingFavourites])

  // ── OOBE Gate ──
  if (!isSessionLoaded) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[var(--surface-0)] text-white">
        {/* Boot splash: the real icon with a pulsing ring, so the first thing a
            user sees matches the taskbar and the installer. */}
        <div className="relative w-20 h-20 mb-6 flex items-center justify-center">
          <span
            className="absolute inset-0 rounded-full border-2 animate-ping opacity-40"
            style={{ borderColor: accentColor || '#fff', animationDuration: '2s' }}
          />
          <img src="./icon.png" alt="" aria-hidden="true" className="relative w-20 h-20 object-contain" />
        </div>
      </div>
    )
  }

  if (!setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />
  }

  // ── Mini Player (Picture-in-Picture) View Gate ──
  if (isMiniPlayer) {
    return (
      <MiniPlayerView
        favourites={favourites}
        streamingFavourites={streamingFavourites}
        onAddToFavourites={addToFavourites}
        onRemoveFromFavourites={removeFromFavourites}
      />
    )
  }

  return (
    <div
      className="glaze-shell relative flex flex-col h-screen w-screen overflow-hidden bg-[var(--surface-0)]"
      // The player dock is `fixed`, so it cannot see the flex row. Publishing the
      // sidebar width lets it sit inside the content column instead of running
      // under the sidebar. It now changes in one step rather than animating: the
      // sidebar itself is an overlay (see Sidebar.jsx), so there is no width
      // transition left for this to follow.
      style={{ '--sidebar-w': sidebarCollapsed ? '0px' : '205px' }}
    >
      <DynamicBackground currentArt={artToUse} accentColor={accentColor} theme={theme} customThemes={customThemes} ambience={ambience} />

      {/* ── App Content ── */}
      <div 
        className={`relative z-10 flex flex-col h-full w-full transition-opacity duration-500 ${
          isFullScreen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <TitleBar 
          userProfile={userProfile} 
          onOpenProfile={() => setActiveView('profile')} 
          activeView={activeView} 
        />

        {/* Sits between the title bar and the content so it never covers anything. */}
        <OfflineBanner />

        {/* `relative` is what the sidebar overlays against; the left padding is
            its footprint. Padding changes in one step (no transition) so the
            content lays out once per toggle instead of once per frame. */}
        <div
          className="relative flex flex-1 overflow-hidden"
          style={{ paddingLeft: sidebarCollapsed ? 0 : 205 }}
        >
          {/* Sidebar toggle button (visible when collapsed) */}
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="absolute top-4 left-4 z-50 p-2 rounded-lg transition-all hover:bg-white/10"
              style={{ color: 'rgba(var(--ink-rgb),0.6)' }}
              title="Show sidebar"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
              </svg>
            </button>
          )}

          <Sidebar
            activeView={activeView === 'yt_streaming' ? 'youtube_music' : activeView}
            setActiveView={setActiveView}
            songCount={libraryFiles.length}
            artistsCount={totalArtistsCount}
            isScanning={isScanning}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            userProfile={userProfile}
            playlists={playlists}
            pinnedPlaylists={pinnedPlaylists}
            onOpenPinned={handleOpenPinned}
            onUnpinPlaylist={unpinPlaylist}
            favouritesCount={totalFavouritesCount}
            downloadsCount={downloadFiles.length}
            onCreatePlaylist={(name) => createAndAddToPlaylist(null, name)}
          />

          <div className="flex-1 overflow-hidden glass-content min-w-0">
            {activeView === 'home'       && (
              <HomeDashboard
                userProfile={userProfile}
                libraryFiles={libraryFiles}
                artCache={artCache}
                playlists={playlists}
                favourites={favourites}
                localInsights={localInsights}
                onlineRecommendations={homeRecommendations}
                setOnlineRecommendations={setHomeRecommendations}
                quickPicks={quickPicks}
                setQuickPicks={setQuickPicks}
                onOnlineSearch={(query) => {
                  setActiveView('streaming')
                  window.dispatchEvent(new CustomEvent('execute-online-search', { detail: query }))
                }}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'songs'      && (
              <TrackList
                files={libraryFiles}
                isScanning={isScanning}
                onAddFolder={handleAddFolder}
                onOpenFiles={handleOpenFiles}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'favourites' && (
              <FavouritesView
                libraryFiles={libraryFiles}
                userProfile={userProfile}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'downloads' && (
              <TrackList
                files={downloadFiles}
                isScanning={isScanning}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'albums'     && (
              <AlbumsView
                libraryFiles={libraryFiles}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'artists'    && (
              <ArtistsView
                libraryFiles={libraryFiles}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'playlists'  && (
              <PlaylistsView
                playlists={playlists}
                artCache={artCache}
                onDeletePlaylist={deletePlaylist}
                {...sharedTrackProps}
              />
            )}
            {activeView === 'settings'   && (
              <SettingsView
                folders={folders}
                isScanning={isScanning}
                onAddFolder={handleAddFolder}
                onRemoveFolder={removeFolder}
                localInsights={localInsights}
                setLocalInsights={setLocalInsights}
                customThemes={customThemes}
                setCustomThemes={setCustomThemes}
                downloadFolder={downloadFolder}
                setDownloadFolder={setDownloadFolder}
                userProfile={userProfile}
                setUserProfile={setUserProfile}
              />
            )}
            
            {/* Always mount StreamingView to preserve search/scroll cache, just hide it.
                `yt_streaming` is the same view opened from YouTube Music — a separate id so
                the sidebar keeps highlighting YouTube Music and clicking Explore still
                navigates (both ids render this component, they are different contexts). */}
            <div className={activeView === 'streaming' || activeView === 'yt_streaming' ? 'h-full flex-1' : 'hidden'}>
              <StreamingView
                homeFeed={streamingHomeFeed}
                setHomeFeed={setStreamingHomeFeed}
                userProfile={userProfile}
                pendingOnlineItem={pendingOnlineItem}
                onConsumePendingOnlineItem={consumePendingOnlineItem}
                isExploreActive={activeView === 'streaming'}
                {...sharedTrackProps}
              />
            </div>

            {activeView === 'queue'      && <Queue />}
            {activeView === 'insights'   && <ListeningInsightsDashboard onBack={() => setActiveView('home')} />}
            {/* Mounted on first visit, then kept alive like StreamingView. Without this,
                opening a playlist (which switches to `streaming`) and coming back threw
                the whole view away — back to the Home tab, library refetched from disk.
                Lazy rather than always-on so a user who never opens YouTube Music does
                not pay for the library fetch at launch. */}
            {ytMusicMounted && (
              <div
                className={
                  activeView === 'youtube_music' || activeView === 'cloud_library'
                    ? 'h-full flex-1'
                    : 'hidden'
                }
              >
                <YouTubeMusicView
                  connectedServices={connectedServices}
                  setConnectedServices={setConnectedServices}
                  setActiveView={setActiveView}
                  onOpenOnlineItem={(item) => {
                    setPendingOnlineItem(item)
                    // Stays in the YouTube Music context: `streaming` is the Explore
                    // view id, so navigating there made the sidebar highlight Explore
                    // whenever you opened a playlist, album or artist from YTM.
                    navigateTo('yt_streaming')
                  }}
                />
              </div>
            )}
            {activeView === 'profile'    && (
              <ProfileView
                userProfile={userProfile}
                onUpdateProfile={setUserProfile}
                connectedServices={connectedServices}
                setConnectedServices={setConnectedServices}
              />
            )}
            {activeView === 'artist_profile' && (
              <ArtistProfileView 
                artistName={selectedArtistName} 
                onBack={handleArtistBack} 
                {...sharedTrackProps}
              />
            )}
          </div>
        </div>

        <AudioPlayer
          favourites={favourites}
          streamingFavourites={streamingFavourites}
          playlists={playlists}
          onAddToFavourites={addToFavourites}
          onRemoveFromFavourites={removeFromFavourites}
          onAddToPlaylist={addToPlaylist}
          onCreateAndAddToPlaylist={createAndAddToPlaylist}
          onOpenPlaylistModal={openPlaylistModal}
          downloadFolder={downloadFolder}
          onShowDownloadNotification={handleShowDownloadNotification}
          onToggleLyrics={() => setIsLyricsOverlay(!isLyricsOverlay)}
          isLyricsActive={isLyricsOverlay}
          activeView={activeView}
          setActiveView={setActiveView}
        />

        {/* Overlay lyrics if active (Full Screen) */}
        {isLyricsOverlay && (
          <div className="absolute inset-0 z-[100] transition-all duration-500" style={{ backgroundColor: 'rgba(20,20,20,0.95)' }}>
            <LyricsView onClose={() => setIsLyricsOverlay(false)} />
          </div>
        )}
      </div>

      {/* ── Full Screen View ── */}
      {isFullScreen && <FullScreenPlayer />}

      {/* ── Download Notification ── */}
      {downloadNotification && (
        <div className="fixed top-8 right-[24px] z-[9999] glass-notification">
          <div className="glass-panel border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5)] rounded-2xl p-2.5 pr-6 flex items-center gap-3 backdrop-blur-xl bg-white/5 w-[400px]">
            <img 
              src={downloadNotification.track.albumArt || getArtURL(downloadNotification.track.src)} 
              alt="" 
              className="w-12 h-12 rounded-xl object-cover shadow-md"
            />
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-white text-sm font-bold tracking-tight truncate w-full">
                {downloadNotification.success ? 'Downloaded' : 'Download Failed'}
              </span>
              <span className="text-white/60 text-xs font-medium truncate w-full">
                {downloadNotification.track.title}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Online update prompt ── */}
      <UpdateBanner />

      {/* ── Global Add to Playlist Modal ── */}
      {playlistModalTrack && (
        <AddToPlaylistModal
          track={playlistModalTrack}
          playlists={playlists}
          onClose={closePlaylistModal}
          onToggleTrack={toggleTrackInPlaylist}
          onCreateAndAdd={createAndAddToPlaylist}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <LibraryProvider>
        <AppShell />
      </LibraryProvider>
    </PlayerProvider>
  )
}

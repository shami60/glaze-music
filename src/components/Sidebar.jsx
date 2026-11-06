import React, { useState, useMemo } from 'react'
import { usePlayer } from '../context/usePlayer'
import { getRandomAnimePfp, resolvePfpUrl } from '../constants/animePfps'
import FancyUsername, { AnimatedAvatar } from './FancyUsername'

export default function Sidebar({
  activeView,
  setActiveView,
  songCount = 0,
  artistsCount = 0,
  isScanning = false,
  collapsed,
  onToggleCollapse,
  userProfile,
  playlists = [],
  favouritesCount = 0,
  downloadsCount = 0,
  onCreatePlaylist
}) {
  const { accentColor = '#ef4444' } = usePlayer()
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')

  // ── Nav Groups ─────────────────────────────────────────────────────────────
  const discoverNav = [
    { 
      id: 'home', 
      label: 'Home', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> 
    },
    { 
      id: 'streaming', 
      label: 'Explore', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>,
      badge: 'Online'
    },
    { 
      id: 'youtube_music', 
      label: 'YouTube Music', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg> 
    }
  ]

  const libraryNav = [
    { 
      id: 'favourites', 
      label: 'Favourites', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>,
      count: favouritesCount
    },
    { 
      id: 'playlists', 
      label: 'Playlists', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>,
      count: playlists?.length || 0
    },
    { 
      id: 'downloads', 
      label: 'Downloads', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>,
      count: downloadsCount
    },
    { 
      id: 'songs', 
      label: 'All Songs', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>,
      count: songCount 
    },
    { 
      id: 'albums', 
      label: 'Albums', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg> 
    },
    { 
      id: 'artists', 
      label: 'Artists', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>,
      count: artistsCount
    },
    { 
      id: 'queue', 
      label: 'Queue', 
      icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg> 
    }
  ]

  const handleCreatePlaylistSubmit = (e) => {
    e?.preventDefault()
    if (newPlaylistName.trim()) {
      onCreatePlaylist?.(newPlaylistName.trim())
      setNewPlaylistName('')
      setIsCreatingPlaylist(false)
    }
  }

  const renderNavBtn = (item) => {
    const active = activeView === item.id
    return (
      <button
        key={item.id}
        onClick={() => setActiveView(item.id)}
        style={active ? {
          backgroundColor: 'rgba(var(--ink-rgb), 0.12)',
          color: '#ffffff',
        } : {}}
        className={`sidebar-nav-btn ${active ? 'active' : ''}`}
      >
        <span 
          className="shrink-0 transition-transform duration-200" 
          style={{ color: active ? accentColor : undefined }}
        >
          {item.icon}
        </span>
        <span className="truncate flex-1 text-[13px]">{item.label}</span>
        
        {/* Count pill or status badge */}
        {item.count !== undefined && item.count > 0 && (
          <span className="shrink-0 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">
            {item.count}
          </span>
        )}
        {item.badge && (
          <span 
            className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full font-mono"
            style={{ 
              backgroundColor: `color-mix(in srgb, ${accentColor} 13.3%, transparent)`, 
              color: accentColor 
            }}
          >
            {item.badge}
          </span>
        )}
      </button>
    )
  }

  return (
    <div 
      // Out of flow on purpose. As a flex sibling its width animated from 205px
      // to 0, so the content column re-laid-out and re-rastered ~440 album
      // images on every frame — measured at 14 fps on Explore against 73 on Home,
      // with layout itself at 0.7 ms (it was raster, not JS). Overlaying the
      // content with a transform moves the whole thing onto the compositor: the
      // content reflows exactly once, and the drawer slides over it.
      className={`glass-sidebar absolute inset-y-0 left-0 z-30 flex flex-col h-full w-[205px] select-none overflow-hidden transition-[transform,opacity] duration-200 ease-out ${
        collapsed ? '-translate-x-full opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'
      }`}
    >
      {/* ── 1. Top User Profile & Collapse Toggle ─────────────────── */}
      <div className="relative pt-1 px-3 pb-1 shrink-0 flex flex-col items-center">
        {/* Collapse Toggle */}
        <button
          onClick={onToggleCollapse}
          className="absolute top-1.5 right-2 z-10 w-7 h-7 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/15 text-white/50 hover:text-white transition-all cursor-pointer border border-white/[0.06] shadow-sm hover:scale-105 active:scale-95"
          title="Collapse sidebar"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
        </button>

        {/* Clean Profile Button (Avatar + Name) */}
        <button
          onClick={() => setActiveView('profile')}
          className="flex flex-col items-center justify-center cursor-pointer group w-full pt-1 transition-all"
        >
          {/* Animated Avatar */}
          <AnimatedAvatar
            userProfile={userProfile}
            className="w-16 h-16 shadow-xl group-hover:scale-105 transition-transform duration-300"
          />

          {/* Fancy Username */}
          <div className="text-[14px] font-bold leading-tight truncate mt-2 max-w-[170px] text-center">
            <FancyUsername userProfile={userProfile} fallback="User" />
          </div>
        </button>
      </div>

      {/* ── 2. Scrollable Navigation Content ────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 space-y-2.5 pt-0.5 pb-2 custom-scrollbar">
        
        {/* DISCOVER SECTION */}
        <div>
          <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/35">
            Discover
          </div>
          <div className="space-y-0.5">
            {discoverNav.map(renderNavBtn)}
          </div>
        </div>

        {/* LIBRARY SECTION */}
        <div>
          <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/35">
            Library
          </div>
          <div className="space-y-0.5">
            {libraryNav.map(renderNavBtn)}
          </div>
        </div>

        {/* PLAYLISTS SECTION (Populated Live Shelf) */}
        <div className="pt-0.5">
          <div className="px-2 pb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-white/35">
            <span 
              onClick={() => setActiveView('playlists')} 
              className="hover:text-white/70 transition-colors cursor-pointer"
            >
              Playlists ({playlists?.length || 0})
            </span>
            <button
              onClick={() => setIsCreatingPlaylist(p => !p)}
              className="p-0.5 rounded-full hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
              title="Create new playlist"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
            </button>
          </div>

          {/* Quick Create Playlist Input */}
          {isCreatingPlaylist && (
            <form onSubmit={handleCreatePlaylistSubmit} className="mb-2 px-1">
              <input
                type="text"
                autoFocus
                placeholder="Playlist name..."
                value={newPlaylistName}
                onChange={e => setNewPlaylistName(e.target.value)}
                onBlur={() => { if (!newPlaylistName.trim()) setIsCreatingPlaylist(false) }}
                className="w-full bg-white/10 text-white text-xs px-2.5 py-1.5 rounded-lg border border-white/20 outline-none placeholder-white/30 focus:border-white/40"
              />
            </form>
          )}

          {/* List of Real Playlists */}
          <div className="space-y-0.5">
            {playlists && playlists.length > 0 ? (
              playlists.slice(0, 8).map(pl => {
                const isActive = activeView === 'playlists' // active in playlists view
                return (
                  <button
                    key={pl.id}
                    onClick={() => setActiveView('playlists')}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.07] text-white/60 hover:text-white text-left transition-all text-xs group cursor-pointer"
                  >
                    <span 
                      className="w-1.5 h-1.5 rounded-full shrink-0 group-hover:scale-125 transition-transform"
                      style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 66.7%, transparent)` }} 
                    />
                    <span className="truncate flex-1 font-medium">{pl.name}</span>
                    <span className="text-[10px] font-mono text-white/30 group-hover:text-white/50">
                      {pl.files?.length || 0}
                    </span>
                  </button>
                )
              })
            ) : (
              <button
                onClick={() => setActiveView('playlists')}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-[11px] text-white/40 hover:text-white/70 transition-colors cursor-pointer flex items-center gap-2"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0 opacity-60">
                  <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
                </svg>
                <span>View all playlists</span>
              </button>
            )}
          </div>
        </div>

      </div>

      {/* ── 3. Footer Area (Settings) ───────────────────── */}
      <div className="px-2 py-2 shrink-0 border-t border-white/[0.06]">
        {/* Settings Button */}
        <button
          onClick={() => setActiveView('settings')}
          style={activeView === 'settings' ? {
            backgroundColor: 'rgba(var(--ink-rgb), 0.12)',
            color: '#ffffff',
          } : {}}
          className={`sidebar-nav-btn ${activeView === 'settings' ? 'active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0" style={{ color: activeView === 'settings' ? accentColor : undefined }}>
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          <span className="truncate text-[13px]">Settings</span>
        </button>
      </div>
    </div>
  )
}

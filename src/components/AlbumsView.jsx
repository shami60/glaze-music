import React, { useState, useMemo } from 'react'
import TrackList from './TrackList'
import { getArtURL } from '../utils'


function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8" style={{ color: 'rgba(var(--ink-rgb),0.15)' }}>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
    </svg>
  )
}

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
    </svg>
  )
}

export default function AlbumsView({ libraryFiles = [], artCache = {}, ...trackListProps }) {
  const [selected, setSelected] = useState(null)

  const albums = useMemo(() => {
    const map = {}
    const safeFiles = Array.isArray(libraryFiles) ? libraryFiles : []
    for (const fp of safeFiles) {
      const meta = artCache[fp]
      const albumName = meta?.album || null
      const key = albumName || '__unknown__'
      if (!map[key]) {
        map[key] = {
          name: albumName || 'Unknown Album',
          files: [],
          art: null,
          artists: new Set(),
        }
      }
      map[key].files.push(fp)
      if (!map[key].art) map[key].art = getArtURL(fp)
      if (meta?.artist)                    map[key].artists.add(meta.artist)
    }
    return Object.values(map)
      .map(a => ({ ...a, artistStr: [...a.artists].slice(0, 2).join(', ') || 'Unknown Artist' }))
      .sort((a, b) => {
        if (a.name === 'Unknown Album') return 1
        if (b.name === 'Unknown Album') return -1
        return a.name.localeCompare(b.name)
      })
  }, [libraryFiles, artCache])

  if (selected) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Drill-down header */}
        <div className="flex items-center gap-4 px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(var(--ink-rgb),0.05)' }}>
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: 'rgba(var(--ink-rgb),0.45)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'rgba(var(--ink-rgb),0.8)'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(var(--ink-rgb),0.45)'}
          >
            <BackArrow /> Albums
          </button>
          <span style={{ color: 'rgba(var(--ink-rgb),0.2)' }}>/</span>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded overflow-hidden shrink-0 flex items-center justify-center relative" style={{ background: 'rgba(var(--ink-rgb),0.07)' }}>
              <MusicIcon />
              <img loading="lazy" src={selected.art} alt="" className="w-full h-full object-cover absolute inset-0 z-10 transition-opacity" style={{ opacity: 0 }} onLoad={e => e.target.style.opacity='1'} onError={e => e.target.style.opacity='0'} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{selected.name}</p>
              <p className="text-xs" style={{ color: 'rgba(var(--ink-rgb),0.4)' }}>{selected.artistStr}</p>
            </div>
          </div>
        </div>
        <TrackList files={selected.files} artCache={artCache} {...trackListProps} />
      </div>
    )
  }

  if (!libraryFiles.length) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ color: 'rgba(var(--ink-rgb),0.15)' }}>
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-14 h-14">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
        </svg>
        <p className="text-sm" style={{ color: 'rgba(var(--ink-rgb),0.2)' }}>Scan a folder to see albums</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(var(--ink-rgb),0.05)' }}>
        <p className="text-sm font-semibold text-white">Albums</p>
        <p className="text-sm" style={{ color: 'rgba(var(--ink-rgb),0.3)' }}>{albums.length} albums</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {albums.map(album => (
            <AlbumCard key={album.name} album={album} onClick={() => setSelected(album)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AlbumCard({ album, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="cursor-pointer rounded-xl p-3 transition-all"
      style={{ background: hovered ? 'rgba(var(--ink-rgb),0.07)' : 'rgba(var(--ink-rgb),0.03)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div
        className="w-full aspect-square rounded-lg mb-3 overflow-hidden flex items-center justify-center relative"
        style={{ background: 'rgba(var(--ink-rgb),0.07)' }}
      >
        <MusicIcon />
        <img loading="lazy" src={album.art} alt="" className="w-full h-full object-cover absolute inset-0 z-10 transition-opacity" style={{ opacity: 0 }} onLoad={e => e.target.style.opacity='1'} onError={e => e.target.style.opacity='0'} />
      </div>
      <p className="text-sm font-semibold text-white truncate leading-tight">{album.name}</p>
      <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(var(--ink-rgb),0.4)' }}>{album.artistStr}</p>
      <p className="text-xs mt-0.5" style={{ color: 'rgba(var(--ink-rgb),0.25)' }}>{album.files.length} songs</p>
    </div>
  )
}

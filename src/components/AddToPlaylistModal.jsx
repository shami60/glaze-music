import React, { useState, useEffect, useMemo, useRef } from 'react'
import { getArtURL, getSizedArtURL } from '../utils'

export default function AddToPlaylistModal({
  track,
  playlists = [],
  onClose,
  onToggleTrack,
  onCreateAndAdd
}) {
  const [search, setSearch] = useState('')
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // NOTE: this must stay ABOVE the `if (!track) return null` guard. It used to
  // sit below it, so the hook count differed between the open and closed states
  // and React threw "Rendered more hooks than during the previous render".
  const filteredPlaylists = useMemo(() => {
    if (!search.trim()) return playlists
    const q = search.toLowerCase()
    return playlists.filter(p => p.name?.toLowerCase().includes(q))
  }, [playlists, search])

  if (!track) return null

  const trackSrc = typeof track === 'string' ? track : (track.src || track.id || (track.videoId ? `yt:${track.videoId}` : ''))
  const trackTitle = track.title || 'Unknown Track'
  const trackArtist = track.artist || track.author || 'Unknown Artist'
  const trackArt = track.albumArt || track.thumbnail || track.art || (trackSrc ? getArtURL(trackSrc) : null)

  const handleCreate = (e) => {
    e?.preventDefault()
    if (!newPlaylistName.trim()) return
    onCreateAndAdd?.(track, newPlaylistName.trim())
    setNewPlaylistName('')
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div 
        className="relative z-10 w-full max-w-md rounded-3xl bg-[var(--surface-1)]/95 border border-white/15 p-6 shadow-2xl backdrop-blur-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
        style={{
          boxShadow: '0 25px 60px -15px rgba(0,0,0,0.8), inset 0 1px 1px rgba(var(--ink-rgb),0.15)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">Add to Playlist</h2>
            <p className="text-xs text-white/40 mt-0.5">Select a playlist or create a new one</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white flex items-center justify-center text-sm transition-colors cursor-pointer"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Selected Track Preview Mini-Card */}
        <div className="flex items-center gap-3.5 my-4 p-3 rounded-2xl bg-white/[0.04] border border-white/10 shrink-0">
          <img 
            src={getSizedArtURL(trackArt, 'thumb')} 
            alt="" 
            className="w-12 h-12 rounded-xl object-cover bg-white/5 shadow-md shrink-0"
            onError={(e) => { e.target.style.opacity = '0.5' }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate leading-tight">{trackTitle}</p>
            <p className="text-xs text-white/50 truncate mt-0.5">{trackArtist}</p>
          </div>
        </div>

        {/* Search bar if multiple playlists */}
        {playlists.length >= 3 && (
          <div className="mb-3 shrink-0">
            <div className="relative flex items-center">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/40 absolute left-3 pointer-events-none">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <input
                type="text"
                placeholder="Search your playlists..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 focus:border-white/30 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-white/30 outline-none transition-all"
              />
            </div>
          </div>
        )}

        {/* Playlists List */}
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 py-1 pr-1">
          {filteredPlaylists.length > 0 ? (
            filteredPlaylists.map(pl => {
              const list = pl.files || pl.tracks || []
              const isIncluded = list.includes(trackSrc)
              const plArt = pl.thumbnail || (list.length > 0 && typeof list[0] === 'string' ? getArtURL(list[0]) : null)

              return (
                <div
                  key={pl.id}
                  onClick={() => onToggleTrack?.(track, pl.id)}
                  className={`flex items-center justify-between gap-3 p-2.5 rounded-2xl border transition-all cursor-pointer group ${
                    isIncluded
                      ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/15'
                      : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.08] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-white/10 overflow-hidden flex items-center justify-center shrink-0">
                      {plArt ? (
                        <img src={getSizedArtURL(plArt, 'thumb')} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white/40">
                          <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
                        </svg>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate leading-tight group-hover:text-white">
                        {pl.name}
                      </p>
                      <p className="text-[11px] text-white/40 mt-0.5">
                        {list.length} {list.length === 1 ? 'song' : 'songs'}
                      </p>
                    </div>
                  </div>

                  {/* Toggle Checkmark / Add Button */}
                  <div className="shrink-0">
                    {isIncluded ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-black shadow-md transition-all">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        Added
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 group-hover:bg-white/20 text-white/80 group-hover:text-white transition-all">
                        + Add
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="py-8 text-center flex flex-col items-center justify-center text-white/40">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 opacity-30 mb-2">
                <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
              </svg>
              <p className="text-sm font-semibold text-white/60">
                {search ? 'No playlists match your search' : 'No playlists yet'}
              </p>
              <p className="text-xs text-white/30 mt-0.5">Create one below to save this track!</p>
            </div>
          )}
        </div>

        {/* Create New Playlist Footer Form */}
        <div className="pt-4 mt-2 border-t border-white/10 shrink-0">
          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="New playlist name..."
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              className="flex-1 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/15 focus:border-white/40 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-white/30 outline-none transition-all"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim()}
              className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                newPlaylistName.trim()
                  ? 'bg-white text-black hover:scale-105 active:scale-95 shadow-lg'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              <span>+ Create & Add</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

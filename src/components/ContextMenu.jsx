import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLibrary } from '../context/LibraryContext'

// ── Icon helpers ────────────────────────────────────────────────────────────
function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M8 5v14l11-7z"/></svg>
}

function PlayNextIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
}

function QueueIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM2 16h8v-2H2v2z"/></svg>
}

function DownloadIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" fill="none" stroke="currentColor" /></svg>
}

function StarIcon({ filled }) {
  return filled
    ? <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-yellow-400"><path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
    : <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zm-10 6.53l-3.75 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.4 4.38.38-3.32 2.88 1 4.28L12 15.77z"/></svg>
}

function PlaylistIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>
}

function TrashIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
}

function RadioIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z"/></svg>
}

function ChevronRight() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 ml-auto"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
}

// ── Playlist submenu ────────────────────────────────────────────────────────
function PlaylistSubmenu({ track, playlists, onAdd, onCreate, onOpenModal, side = 'right' }) {
  const [newName, setNewName] = useState('')
  const trackSrc = typeof track === 'string' ? track : (track?.src || track?.id || (track?.videoId ? `yt:${track.videoId}` : ''))

  return (
    <div
      className="menu-surface rounded-2xl absolute top-0 w-52 border p-1.5 backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
      style={{
        [side === 'right' ? 'left' : 'right']: 'calc(100% + 6px)',
        zIndex: 50,
      }}
    >
      <div className="px-2 py-1 flex items-center justify-between border-b border-white/10 mb-1">
        <span className="text-[10px] uppercase font-bold tracking-wider text-white/40">Playlists</span>
        {onOpenModal && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenModal() }}
            className="text-[10px] text-white/60 hover:text-white underline cursor-pointer"
          >
            Manage
          </button>
        )}
      </div>

      {playlists?.length > 0 ? (
        <div className="py-0.5 max-h-48 overflow-y-auto no-scrollbar space-y-0.5">
          {playlists.map(pl => {
            const list = pl.files || pl.tracks || []
            const isIncluded = trackSrc && list.includes(trackSrc)

            return (
              <button
                key={pl.id}
                onClick={() => onAdd(pl.id)}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs rounded-xl text-left transition-all cursor-pointer ${
                  isIncluded
                    ? 'bg-emerald-500/15 text-emerald-300 font-semibold'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <PlaylistIcon />
                  <span className="truncate">{pl.name}</span>
                </div>
                {isIncluded && (
                  <span className="text-emerald-400 text-xs font-bold shrink-0">✓</span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="px-2 py-2 text-[11px] text-white/40 text-center">No playlists yet</p>
      )}

      <div className="pt-1.5 mt-1 border-t border-white/10">
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newName.trim()) {
                onCreate(newName.trim())
                setNewName('')
              }
              e.stopPropagation()
            }}
            placeholder="New playlist…"
            className="w-full px-2.5 py-1.5 rounded-lg text-xs text-white placeholder-white/30 bg-white/5 border border-white/10 focus:border-white/30 focus:outline-none transition-all"
          />
          {newName.trim() && (
            <button
              onClick={() => { onCreate(newName.trim()); setNewName('') }}
              className="px-2 py-1.5 rounded-lg text-xs font-bold bg-white text-black hover:scale-105 transition-all shrink-0 cursor-pointer"
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MenuItem ────────────────────────────────────────────────────────────────
function MenuItem({ icon, label, onClick, danger, hasSubmenu, children }) {
  const [subOpen, setSubOpen] = useState(false)
  const [side, setSide] = useState('right')
  const ref = useRef(null)

  function handleEnter() {
    if (hasSubmenu) {
      const rect = ref.current?.closest('.glass-menu')?.getBoundingClientRect()
      const spaceRight = window.innerWidth - (rect?.right ?? 0)
      setSide(spaceRight > 230 ? 'right' : 'left')
      setSubOpen(true)
    }
  }

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={() => hasSubmenu && setSubOpen(false)}
    >
      <button
        onClick={onClick}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-left transition-colors cursor-pointer rounded-lg mx-0.5"
        style={{ color: danger ? 'rgb(248,113,113)' : 'rgba(var(--ink-rgb),0.85)' }}
        onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.15)' : 'rgba(var(--ink-rgb),0.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {icon}
        <span className="flex-1 truncate">{label}</span>
        {hasSubmenu && <ChevronRight />}
      </button>
      {hasSubmenu && subOpen && React.isValidElement(children) && React.cloneElement(children, { side })}
    </div>
  )
}

// ── Main ContextMenu ─────────────────────────────────────────────────────────
export default function ContextMenu({
  x, y,
  track,
  isFavourite,
  isDownloaded: isDownloadedProp,
  playlists,
  onClose,
  onAddToFavourites,
  onRemoveFromFavourites,
  onAddToPlaylist,
  onCreateAndAddToPlaylist,
  onOpenPlaylistModal,
  onRemoveFromLibrary,
  onPlay,
  onPlayNext,
  onAddToQueue,
  onDownload,
  onStartRadio,
}) {
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ left: x, top: y })

  const { isDownloaded: checkDownloaded } = useLibrary() || {}
  const isAlreadyDownloaded = isDownloadedProp !== undefined 
    ? isDownloadedProp 
    : (checkDownloaded ? checkDownloaded(track) : false)

  // Adjust position after mount to avoid viewport overflow
  useEffect(() => {
    if (!menuRef.current) return
    const { width, height } = menuRef.current.getBoundingClientRect()
    setPos({
      left: x + width  > window.innerWidth  ? x - width  : x,
      top:  y + height > window.innerHeight ? y - height : y,
    })
  }, [x, y])

  // Close on Escape or outside click is handled by the backdrop div

  useEffect(() => {
    const handler = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const menu = (
    <>
      {/* Click-outside backdrop */}
      <div className="fixed inset-0 z-[998]" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />

      {/* Menu panel — no overflow-hidden so submenus are never clipped */}
      <div
        ref={menuRef}
        className="glass-menu rounded-2xl fixed z-[999] min-w-[220px] shadow-2xl border border-white/10 backdrop-blur-2xl"
        style={{ left: pos.left, top: pos.top }}
        onClick={e => e.stopPropagation()}
      >
        {/* Track header */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(var(--ink-rgb),0.07)' }}>
          <p className="text-sm font-semibold text-white leading-tight truncate">
            {track.title}
          </p>
          {track.artist && (
            <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(var(--ink-rgb),0.45)' }}>
              {track.artist}
            </p>
          )}
        </div>

        {/* Items */}
        <div className="py-1.5">
          {onPlay && (
            <MenuItem
              icon={<PlayIcon />}
              label="Play Now"
              onClick={() => { onPlay(); onClose() }}
            />
          )}

          {onPlayNext && (
            <MenuItem
              icon={<PlayNextIcon />}
              label="Play Next"
              onClick={() => { onPlayNext(); onClose() }}
            />
          )}

          {onAddToQueue && (
            <MenuItem
              icon={<QueueIcon />}
              label="Add to Queue"
              onClick={() => { onAddToQueue(); onClose() }}
            />
          )}

          {onStartRadio && (
            <MenuItem
              icon={<RadioIcon />}
              label="Start Radio"
              onClick={() => { onStartRadio(); onClose() }}
            />
          )}

          {(onPlay || onPlayNext || onAddToQueue) && (
            <div style={{ height: '1px', background: 'rgba(var(--ink-rgb),0.06)', margin: '4px 12px' }} />
          )}

          {onDownload && (
            <>
              <MenuItem
                icon={isAlreadyDownloaded ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-emerald-400"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                ) : (
                  <DownloadIcon />
                )}
                label={isAlreadyDownloaded ? "Downloaded" : "Download Track"}
                disabled={isAlreadyDownloaded}
                onClick={() => { 
                  if (!isAlreadyDownloaded) {
                    onDownload(); 
                    onClose() 
                  }
                }}
              />
              <div style={{ height: '1px', background: 'rgba(var(--ink-rgb),0.06)', margin: '4px 12px' }} />
            </>
          )}

          <MenuItem
            icon={<StarIcon filled={isFavourite} />}
            label={isFavourite ? 'Remove from Favourites' : 'Add to Favourites'}
            onClick={() => { isFavourite ? onRemoveFromFavourites() : onAddToFavourites(); onClose() }}
          />

          <MenuItem
            icon={<PlaylistIcon />}
            label="Add to Playlist"
            hasSubmenu
            onClick={() => {
              if (onOpenPlaylistModal) {
                onOpenPlaylistModal(track)
                onClose()
              }
            }}
          >
            <PlaylistSubmenu
              track={track}
              playlists={playlists}
              onAdd={id => { onAddToPlaylist(id); onClose() }}
              onCreate={name => { onCreateAndAddToPlaylist(name); onClose() }}
              onOpenModal={() => { onOpenPlaylistModal?.(track); onClose() }}
            />
          </MenuItem>

          {onRemoveFromLibrary && (
            <>
              <div style={{ height: '1px', background: 'rgba(var(--ink-rgb),0.06)', margin: '4px 12px' }} />
              <MenuItem
                icon={<TrashIcon />}
                label="Remove from Library"
                danger
                onClick={() => { onRemoveFromLibrary(); onClose() }}
              />
            </>
          )}
        </div>
      </div>
    </>
  )

  return createPortal(menu, document.body)
}

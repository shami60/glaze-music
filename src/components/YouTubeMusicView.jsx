import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { usePlayer } from '../context/usePlayer'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/**
 * YouTubeMusicView — the signed-in user's own YouTube Music, rendered inside the
 * app. Replaces the old "Cloud Library" screen, which only showed two columns of
 * imported playlists and never surfaced liked songs, artists or albums.
 *
 * Data comes from `youtube:fetchLibrary` (liked songs, playlists, subscribed
 * artists, albums — cached to disk) and `youtube:getMusicHome` (the personalised
 * recommendation shelves, refreshed on a TTL).
 */

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'songs', label: 'Songs' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
  { id: 'albums', label: 'Albums' },
]

function formatDuration(seconds) {
  const s = Number(seconds) || 0
  if (!s) return ''
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

function relativeTime(ts) {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.round(hrs / 24)} d ago`
}

function toQueueTrack(t) {
  return {
    id: t.videoId,
    src: `yt:${t.videoId}`,
    title: t.title,
    artist: t.artist,
    album: t.album || null,
    albumArt: t.thumbnail || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
    duration: t.duration || 0,
    fromStreaming: true,
  }
}

// ── Small presentational pieces ──────────────────────────────────────────────

function CollectionCard({ item, onOpen }) {
  return (
    <button
      onClick={() => onOpen(item)}
      className="group text-left cursor-pointer block w-full min-w-0"
      title={item.name}
    >
      <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-2.5 shadow-lg shadow-black/40 bg-white/[0.04]">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
            </svg>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-xl">
            <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
      </div>
      <p className="text-[13px] font-bold text-white truncate">{item.name}</p>
      {item.count ? (
        <p className="text-[11px] text-white/40 mt-0.5">
          {item.count} {item.kind === 'album' ? (item.count === 1 ? 'song' : 'songs') : (item.count === 1 ? 'track' : 'tracks')}
        </p>
      ) : item.subtitle ? (
        // Mixes subtitle with the artists they were built from ("Travis Scott,
        // Don Toliver, …"), albums with "Album · Artist". Far more useful than
        // a bare "Playlist" label, and it is what YouTube Music shows too.
        <p className="text-[11px] text-white/40 mt-0.5 truncate">{item.subtitle}</p>
      ) : (
        // Auto-generated mixes ("Sounds from Shorts", "Liked Music") carry no
        // item count in the payload; showing nothing read like a broken card.
        <p className="text-[11px] text-white/40 mt-0.5">
          {item.kind === 'album' ? 'Album' : item.kind === 'artist' ? 'Artist' : 'Playlist'}
        </p>
      )}
    </button>
  )
}

function ArtistCard({ item, onOpen }) {
  return (
    <button onClick={() => onOpen(item)} className="group text-center cursor-pointer block w-full min-w-0" title={item.name}>
      <div className="relative aspect-square w-full rounded-full overflow-hidden mb-2.5 shadow-lg shadow-black/40 bg-white/[0.04]">
        {item.thumbnail ? (
          <img
            src={item.thumbnail}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/25">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        )}
      </div>
      <p className="text-[13px] font-bold text-white truncate">{item.name}</p>
      <p className="text-[11px] text-white/40 mt-0.5">Artist</p>
    </button>
  )
}

function SongRow({ track, index, isCurrent, onPlay }) {
  return (
    <button
      onClick={onPlay}
      className={`w-full grid grid-cols-[20px_40px_minmax(0,1.6fr)_minmax(0,1.4fr)_56px] items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer group ${
        isCurrent ? 'bg-white/[0.10]' : 'hover:bg-white/[0.06]'
      }`}
    >
      {/* One slot for both the row number and the hover play glyph — as two
          spans they consumed two grid columns and shifted every row. */}
      <span className="relative w-5 h-5 flex items-center justify-center shrink-0">
        <span className="text-[11px] tabular-nums text-white/35 group-hover:hidden">{index + 1}</span>
        <svg className="hidden group-hover:block w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </span>
      <img
        src={track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        className="w-10 h-10 rounded-md object-cover shrink-0 bg-white/5"
      />
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold truncate ${isCurrent ? 'text-white' : 'text-white/90'}`}>{track.title}</p>
        <p className="text-[11px] text-white/45 truncate">{track.artist}</p>
      </div>
      <span className="hidden md:block text-[11px] text-white/35 truncate">{track.album || ''}</span>
      <span className="text-[11px] tabular-nums text-white/35 text-right">
        {formatDuration(track.duration)}
      </span>
    </button>
  )
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function YouTubeMusicView({ connectedServices, setConnectedServices, setActiveView, onOpenOnlineItem }) {
  const [tab, setTab] = useState('home')
  const [library, setLibrary] = useState(null)
  const [home, setHome] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [visibleSongs, setVisibleSongs] = useState(120)

  const online = useOnlineStatus()

  const { replaceQueue, currentTrack } = usePlayer()
  const isConnected = !!connectedServices?.youtubeMusic

  const loadLibrary = useCallback(async (force = false) => {
    if (!window.electronAPI?.youtubeFetchLibrary) return
    try {
      const data = await window.electronAPI.youtubeFetchLibrary(force)
      setLibrary(data)
      // The main process is the source of truth: if it has no auth, the local
      // "connected" flag was stale.
      if (data && data.connected === false && isConnected) {
        setConnectedServices?.(s => ({ ...s, youtubeMusic: false }))
      }
      return data
    } catch (err) {
      console.error('[YouTubeMusic] Library fetch failed:', err)
      setError('Could not load your YouTube Music library.')
    }
  }, [isConnected, setConnectedServices])

  const loadHome = useCallback(async (force = false) => {
    if (!window.electronAPI?.youtubeGetMusicHome) return
    // No point asking the feed for recommendations with no connection; it only
    // produces a failed request and an error banner over cached data.
    if (!online) return
    try {
      setHome(await window.electronAPI.youtubeGetMusicHome(force))
    } catch (err) {
      console.error('[YouTubeMusic] Home feed failed:', err)
    }
  }, [online])

  useEffect(() => {
    if (!isConnected) {
      setLibrary(null)
      setHome(null)
      return
    }
    let active = true
    setIsLoading(true)
    setError(null)
    // The library is cached on disk by the main process, so it still resolves
    // offline — only the recommendation shelves need the network.
    Promise.all([loadLibrary(), loadHome()])
      .then(([lib]) => {
        // A cache that never expires means likes and playlists added in the
        // YouTube app never show up. Past six hours, refresh in the background
        // so the cached payload still paints instantly.
        const age = Date.now() - (lib?.syncedAt || 0)
        if (lib?.connected && age > 6 * 60 * 60 * 1000 && online) {
          loadLibrary(true).catch(() => {})
          loadHome(true).catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [isConnected, loadLibrary, loadHome, online])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)
    try {
      await Promise.all([loadLibrary(true), loadHome(true)])
    } finally {
      setIsSyncing(false)
    }
  }

  const songs = useMemo(() => library?.likedTracks || [], [library])
  const playlists = useMemo(() => library?.playlists || [], [library])
  const artists = useMemo(() => library?.artists || [], [library])
  const albums = useMemo(() => library?.albums || [], [library])

  const currentVideoId = currentTrack?.src?.startsWith('yt:') ? currentTrack.src.slice(3) : null

  const playSongs = (list, index) => {
    if (!list?.length) return
    replaceQueue(list.map(toQueueTrack), Math.max(0, index))
  }

  const openCollection = (item) => {
    if (!onOpenOnlineItem) return
    onOpenOnlineItem({
      type: item.kind === 'album' ? 'Album' : 'Playlist',
      videoId: item.id,
      title: item.name,
      thumbnail: item.thumbnail,
      artist: 'YouTube Music',
      service: 'youtube',
    })
  }

  const openArtist = (item) => {
    window.dispatchEvent(new CustomEvent('open-artist', { detail: item.name }))
  }

  const shownSongs = useMemo(() => songs.slice(0, visibleSongs), [songs, visibleSongs])

  // The main process supplies the algorithmic shelves ("Mixed for you", "New
  // releases"); the subscribed artists are already in the library payload, so
  // that shelf is assembled here rather than paying for another round trip.
  const homeShelves = useMemo(() => {
    const list = [...(home?.shelves || [])]
    if (artists.length) {
      list.push({ title: 'Artists you follow', artists: artists.slice(0, 14), songs: [], collections: [] })
    }
    return list
  }, [home, artists])

  // ── Signed out ────────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center relative z-10">
        <div className="w-24 h-24 mb-6 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-11 h-11 text-red-500">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Connect YouTube Music</h2>
        <p className="text-white/40 text-sm mb-6 max-w-sm">
          Sign in once and your liked songs, playlists, subscribed artists, albums and personal
          recommendations all appear here.
        </p>
        <button
          onClick={() => setActiveView('profile')}
          className="px-6 py-2.5 on-accent bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-all shadow-lg cursor-pointer"
        >
          Go to Profile
        </button>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar relative z-10 text-white">
      {/* Fluid, not a 1200px column: at 1920 the old cap left ~240px of dead
          margin on each side while the shelves still scrolled sideways. */}
      <div className="max-w-[1680px] mx-auto px-6 md:px-8 xl:px-10 pt-6 pb-28">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center shrink-0 shadow-lg shadow-red-500/25">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-black tracking-tight truncate">YouTube Music</h1>
              <p className="text-[11px] text-white/45 truncate">
                {library?.account?.name ? `${library.account.name} · ` : ''}
                {songs.length} songs · {playlists.length} playlists · {artists.length} artists
                {library?.syncedAt ? ` · synced ${relativeTime(library.syncedAt)}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50 disabled:cursor-wait"
            >
              <svg className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </svg>
              {isSyncing ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1.5 mb-7 overflow-x-auto custom-scrollbar pb-1">
          {TABS.map(t => {
            const disabled = t.id === 'artists' ? artists.length === 0
              : t.id === 'albums' ? albums.length === 0
              : t.id === 'playlists' ? playlists.length === 0
              : t.id === 'songs' ? songs.length === 0
              : false
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                disabled={disabled}
                className={`px-4 py-1.5 rounded-full text-[13px] font-bold border transition-all cursor-pointer shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${
                  tab === t.id
                    ? 'bg-white text-black border-transparent shadow-md'
                    : 'bg-white/[0.06] border-white/10 text-white/60 hover:bg-white/[0.12] hover:text-white'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* The offline panel below already explains a failed load; a red error box
            on top of it just says "broken" twice. */}
        {error && online && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-[12px] text-red-300">
            {error}
          </div>
        )}

        {/* Offline with nothing cached is not an error — say what is happening and
            what still works, instead of "could not load your library". */}
        {!online && !library && !isLoading ? (
          <div className="w-full flex flex-col items-center justify-center py-24 text-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                <path d="M3.27 2 2 3.27l2.1 2.1A11.9 11.9 0 0 0 1 9l2 2a9.9 9.9 0 0 1 3.2-2.13L8.1 10.8A7 7 0 0 0 5 12.5l2 2a5 5 0 0 1 2.4-1.35l1.5 1.5a3 3 0 0 0 2.6 2.6l5.2 5.2L20 21.27 3.27 2zM12 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
              </svg>
            </div>
            <p className="text-white/70 font-semibold">You&apos;re offline</p>
            <p className="text-white/40 text-xs max-w-sm">
              YouTube Music needs a connection. Your downloaded songs, playlists and library are
              still available — this view picks up again as soon as you reconnect.
            </p>
          </div>
        ) : isLoading && !library ? (
          <div className="w-full flex flex-col items-center justify-center py-24">
            <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-red-500 animate-spin mb-4" />
            <p className="text-white/50 font-medium animate-pulse">Syncing your YouTube Music…</p>
            <p className="text-white/30 text-xs mt-1">First sync reads your whole library — it is cached after that.</p>
          </div>
        ) : (
          <div className="space-y-8">

            {/* ── HOME: personalised shelves ── */}
            {tab === 'home' && (
              <>
                {homeShelves.length === 0 && (
                  <div className="py-16 text-center text-white/40 text-sm">
                    No recommendations yet. Try Sync once you have listened to something on YouTube Music.
                  </div>
                )}
                {homeShelves.map((shelf, si) => (
                  <section key={`${shelf.title}-${si}`}>
                    <h2 className="text-[17px] font-bold mb-3">{shelf.title}</h2>
                    {/* Fixed 150px cards left the row short and forced sideways
                        scrolling. `auto-fill` keeps the card size stable while
                        the column count follows the window — so the widest
                        shelf lands in a single row instead of wrapping. */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-5">
                      {shelf.songs?.map(track => (
                        <button
                          key={`s-${track.videoId}`}
                          onClick={() => playSongs(shelf.songs, shelf.songs.indexOf(track))}
                          className="group text-left w-full min-w-0 cursor-pointer"
                          title={`${track.title} — ${track.artist}`}
                        >
                          <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-2 shadow-lg shadow-black/40 bg-white/[0.04]">
                            <img
                              src={track.thumbnail}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-xl">
                                <svg className="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                              </span>
                            </div>
                          </div>
                          <p className="text-[12px] font-bold text-white truncate">{track.title}</p>
                          <p className="text-[11px] text-white/40 truncate">{track.artist}</p>
                        </button>
                      ))}
                      {shelf.collections?.map(item => (
                        <CollectionCard
                          key={`c-${item.id}`}
                          item={item}
                          onOpen={(it) => (it.kind === 'artist' ? openArtist(it) : openCollection(it))}
                        />
                      ))}
                      {shelf.artists?.map(item => (
                        <ArtistCard key={`a-${item.id}`} item={item} onOpen={openArtist} />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}

            {/* ── SONGS: liked music ── */}
            {tab === 'songs' && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[17px] font-bold">Liked songs</h2>
                  <button
                    onClick={() => playSongs(songs, 0)}
                    className="px-4 py-1.5 rounded-full bg-white text-black text-[12px] font-bold hover:bg-white/90 transition-colors cursor-pointer"
                  >
                    Play all
                  </button>
                </div>
                {/* Column labels matter now that the list spans the full width —
                    without them the album column reads as stray text. */}
                <div className="hidden md:grid grid-cols-[20px_40px_minmax(0,1.6fr)_minmax(0,1.4fr)_56px] items-center gap-3 px-3 pb-2 mb-1 border-b border-white/10 text-[10px] font-bold uppercase tracking-wider text-white/35">
                  <span />
                  <span />
                  <span>Title</span>
                  <span>Album</span>
                  <span className="text-right">Time</span>
                </div>
                <div className="space-y-0.5">
                  {shownSongs.map((track, i) => (
                    <SongRow
                      key={`${track.videoId}-${i}`}
                      track={track}
                      index={i}
                      isCurrent={currentVideoId === track.videoId}
                      onPlay={() => playSongs(songs, i)}
                    />
                  ))}
                </div>
                {songs.length > visibleSongs && (
                  <button
                    onClick={() => setVisibleSongs(v => v + 200)}
                    className="mt-4 w-full py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-[12px] font-bold text-white/70 transition-colors cursor-pointer"
                  >
                    Show more ({songs.length - visibleSongs} left)
                  </button>
                )}
              </section>
            )}

            {/* ── PLAYLISTS ── */}
            {tab === 'playlists' && (
              <section>
                <h2 className="text-[17px] font-bold mb-3">Your playlists</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
                  {playlists.map(p => <CollectionCard key={p.id} item={p} onOpen={openCollection} />)}
                </div>
              </section>
            )}

            {/* ── ARTISTS (subscribed) ── */}
            {tab === 'artists' && (
              <section>
                <h2 className="text-[17px] font-bold mb-3">Artists you follow</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
                  {artists.map(a => <ArtistCard key={a.id} item={a} onOpen={openArtist} />)}
                </div>
              </section>
            )}

            {/* ── ALBUMS ── */}
            {tab === 'albums' && (
              <section>
                <h2 className="text-[17px] font-bold mb-3">Your albums</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
                  {albums.map(a => <CollectionCard key={a.id} item={a} onOpen={openCollection} />)}
                </div>
              </section>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

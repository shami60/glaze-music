import React, { useState, useMemo } from 'react'
import TrackList from './TrackList'
import { getArtURL, getSizedArtURL } from '../utils'
import { useLibrary } from '../context/LibraryContext'
import { usePlayer } from '../context/usePlayer'
import { GLOBAL_ARTIST_AVATARS } from '../constants/curatedMixes'

function BackArrow() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
}

function ArtistAvatar({ art, name, size = 'md', accentColor = '#ef4444' }) {
  const sz = size === 'xl' ? 'w-24 h-24 sm:w-28 sm:h-28' : size === 'lg' ? 'w-14 h-14' : 'w-10 h-10'
  const textSz = size === 'xl' ? 'text-2xl' : size === 'lg' ? 'text-lg' : 'text-sm'
  const resolvedArt = art || (name ? GLOBAL_ARTIST_AVATARS[name.toLowerCase()] : null)
  // 'xl' draws up to 112 px (224 px at 2x), so it needs the 320 px tier; the
  // 56/40 px variants are covered by the 120 px tier. Requesting 800x800 for a
  // 40 px avatar cost ~2.4 MB of decoded bitmap each.
  const highRes = resolvedArt ? getSizedArtURL(resolvedArt, size === 'xl' ? 'card' : 'thumb') : null

  return (
    <div
      className={`${sz} rounded-full overflow-hidden shrink-0 flex items-center justify-center font-bold ${textSz} select-none relative shadow-lg border border-white/10 bg-white/5`}
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 26.7%, transparent), #181824)`
      }}
    >
      {highRes ? (
        <img
          loading="lazy"
          src={highRes}
          alt={name}
          className="w-full h-full object-cover transition-all duration-300"
          onError={(e) => {
            const fallback = name ? GLOBAL_ARTIST_AVATARS[name.toLowerCase()] : null
            if (fallback && e.currentTarget.src !== fallback) {
              e.currentTarget.src = fallback
            } else {
              e.currentTarget.style.display = 'none'
            }
          }}
        />
      ) : null}
      <span className="text-white/80 absolute select-none pointer-events-none -z-10">{(name?.[0] || '?').toUpperCase()}</span>
    </div>
  )
}

const POPULAR_SUGGESTED_ARTISTS = [
  { name: 'Justin Bieber', art: GLOBAL_ARTIST_AVATARS['justin bieber'], subscribers: '80M+ Listeners' },
  { name: 'The Weeknd', art: GLOBAL_ARTIST_AVATARS['the weeknd'], subscribers: '110M+ Listeners' },
  { name: 'Taylor Swift', art: GLOBAL_ARTIST_AVATARS['taylor swift'], subscribers: '105M+ Listeners' },
  { name: 'Drake', art: GLOBAL_ARTIST_AVATARS['drake'], subscribers: '85M+ Listeners' },
  { name: 'Billie Eilish', art: GLOBAL_ARTIST_AVATARS['billie eilish'], subscribers: '78M+ Listeners' },
  { name: 'Ariana Grande', art: GLOBAL_ARTIST_AVATARS['ariana grande'], subscribers: '75M+ Listeners' },
  { name: 'Travis Scott', art: GLOBAL_ARTIST_AVATARS['travis scott'], subscribers: '70M+ Listeners' },
  { name: 'Bruno Mars', art: GLOBAL_ARTIST_AVATARS['bruno mars'], subscribers: '68M+ Listeners' },
  { name: 'Dua Lipa', art: GLOBAL_ARTIST_AVATARS['dua lipa'], subscribers: '65M+ Listeners' },
  { name: 'Kendrick Lamar', art: GLOBAL_ARTIST_AVATARS['kendrick lamar'], subscribers: '64M+ Listeners' },
  { name: 'Ed Sheeran', art: GLOBAL_ARTIST_AVATARS['ed sheeran'], subscribers: '72M+ Listeners' },
  { name: 'Coldplay', art: GLOBAL_ARTIST_AVATARS['coldplay'], subscribers: '70M+ Listeners' },
]

export default function ArtistsView({ libraryFiles = [], artCache = {}, ...trackListProps }) {
  const { followedArtists = [], unfollowArtist, toggleFollowArtist, isFollowingArtist } = useLibrary() || {}
  const { accentColor = '#ef4444', replaceQueue } = usePlayer()

  const [selectedLocalArtist, setSelectedLocalArtist] = useState(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'followed' | 'local'

  // Local scanned artists calculation
  const localArtists = useMemo(() => {
    const map = {}
    const safeFiles = Array.isArray(libraryFiles) ? libraryFiles : []
    for (const fp of safeFiles) {
      const meta = artCache[fp]
      const artistName = meta?.artist || null
      const key = artistName || '__unknown__'
      if (!map[key]) {
        map[key] = {
          name: artistName || 'Unknown Artist',
          files: [],
          art: null,
          albums: new Set(),
          isLocal: true
        }
      }
      map[key].files.push(fp)
      if (!map[key].art) map[key].art = getArtURL(fp)
      if (meta?.album) map[key].albums.add(meta.album)
    }
    return Object.values(map).sort((a, b) => {
      if (a.name === 'Unknown Artist') return 1
      if (b.name === 'Unknown Artist') return -1
      return a.name.localeCompare(b.name)
    })
  }, [libraryFiles, artCache])

  // Normalized followed artists with extra metadata
  const safeFollowed = useMemo(() => {
    return (followedArtists || []).map(a => ({
      name: a.name,
      art: a.thumbnail || a.headerImage || null,
      subscribers: a.subscribers || null,
      createdAt: a.createdAt,
      isFollowed: true
    }))
  }, [followedArtists])

  // Combined and filtered list
  const { displayedFollowed, displayedLocal, totalCount } = useMemo(() => {
    const q = search.trim().toLowerCase()
    
    let fList = safeFollowed
    let lList = localArtists

    if (q) {
      fList = fList.filter(a => a.name.toLowerCase().includes(q))
      lList = lList.filter(a => a.name.toLowerCase().includes(q))
    }

    return {
      displayedFollowed: fList,
      displayedLocal: lList,
      totalCount: fList.length + lList.length
    }
  }, [safeFollowed, localArtists, search])

  const handleOpenArtistProfile = (artistName) => {
    if (!artistName) return
    window.dispatchEvent(new CustomEvent('open-artist', { detail: artistName }))
  }

  const handlePlayArtistRadio = async (artistName, e) => {
    e?.stopPropagation()
    if (!window.electronAPI?.youtubeSearch) return
    try {
      const res = await window.electronAPI.youtubeSearch(artistName + ' top songs', 'songs')
      const tracks = res?.songs || []
      if (tracks.length > 0) {
        const queue = tracks.map(s => ({
          id: s.videoId,
          src: `yt:${s.videoId}`,
          title: s.title,
          artist: s.artist || artistName,
          albumArt: s.thumbnail || `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`,
          duration: typeof s.duration === 'object' ? s.duration?.seconds : s.duration,
          fromStreaming: true
        }))
        replaceQueue(queue, 0)
      }
    } catch (err) {
      console.error('Failed to play artist radio:', err)
    }
  }

  // If a local artist is selected, show their track drilldown
  if (selectedLocalArtist) {
    return (
      <div className="flex flex-col h-full overflow-hidden animate-in fade-in">
        <div className="flex items-center gap-4 px-6 py-4 shrink-0 border-b border-white/[0.06] bg-white/[0.02]">
          <button
            onClick={() => setSelectedLocalArtist(null)}
            className="flex items-center gap-1.5 text-sm transition-colors text-white/50 hover:text-white cursor-pointer"
          >
            <BackArrow /> Artists
          </button>
          <span className="text-white/20">/</span>
          <div className="flex items-center gap-3">
            <ArtistAvatar art={selectedLocalArtist.art} name={selectedLocalArtist.name} size="lg" accentColor={accentColor} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-white leading-tight">{selectedLocalArtist.name}</p>
                <button
                  onClick={() => handleOpenArtistProfile(selectedLocalArtist.name)}
                  className="px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  View Online Profile ↗
                </button>
              </div>
              <p className="text-xs text-white/40 mt-0.5">
                {selectedLocalArtist.files.length} song{selectedLocalArtist.files.length !== 1 ? 's' : ''} · {selectedLocalArtist.albums.size} album{selectedLocalArtist.albums.size !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
        <TrackList files={selectedLocalArtist.files} artCache={artCache} {...trackListProps} />
      </div>
    )
  }

  const showFollowedSection = (activeTab === 'all' || activeTab === 'followed') && displayedFollowed.length > 0
  const showLocalSection = (activeTab === 'all' || activeTab === 'local') && displayedLocal.length > 0
  const hasZeroArtists = safeFollowed.length === 0 && localArtists.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden select-none">
      
      {/* ── Top Header with Title, Tabs, and Search ── */}
      <div className="px-6 pt-5 pb-4 shrink-0 border-b border-white/[0.06] flex flex-col gap-3.5 bg-white/[0.01] backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Artists</h1>
            <p className="text-xs text-white/40 mt-0.5 font-medium">
              {safeFollowed.length} followed · {localArtists.length} local
            </p>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <svg viewBox="0 0 24 24" fill="currentColor"
              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-white/30">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              type="text"
              placeholder="Search artists..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl text-xs sm:text-sm text-white placeholder-white/30 focus:outline-none bg-white/[0.05] border border-white/[0.08] focus:border-white/20 transition-colors"
            />
            {search && (
              <button 
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'all'
                ? 'bg-white text-black shadow-md'
                : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5'
            }`}
          >
            All ({totalCount})
          </button>
          <button
            onClick={() => setActiveTab('followed')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'followed'
                ? 'bg-white text-black shadow-md'
                : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5'
            }`}
          >
            <span>Followed</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${activeTab === 'followed' ? 'bg-black/10 text-black' : 'bg-white/10 text-white/70'}`}>
              {safeFollowed.length}
            </span>
          </button>
          {localArtists.length > 0 && (
            <button
              onClick={() => setActiveTab('local')}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'local'
                  ? 'bg-white text-black shadow-md'
                  : 'bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/5'
              }`}
            >
              <span>Local Library</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${activeTab === 'local' ? 'bg-black/10 text-black' : 'bg-white/10 text-white/70'}`}>
                {localArtists.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable Content Area ── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar space-y-8 pb-32">
        
        {/* Empty State when no artists and searching */}
        {hasZeroArtists && search && (
          <div className="flex flex-col items-center justify-center h-72 gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-white/20 border border-white/10">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-white/80">No Artists Found</p>
              <p className="text-xs text-white/40 mt-1 max-w-sm leading-relaxed">
                No matching artists found for "{search}".
              </p>
            </div>
          </div>
        )}

        {/* ── Suggested Artists to Follow (when user has no followed artists yet) ── */}
        {safeFollowed.length === 0 && !search && (
          <section className="space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"></span>
                <h2 className="text-lg font-bold text-white tracking-tight">Popular Artists to Follow</h2>
              </div>
              <span className="text-xs text-white/40">Suggested for you</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {POPULAR_SUGGESTED_ARTISTS.map(artist => {
                const isFollowed = isFollowingArtist ? isFollowingArtist(artist.name) : (followedArtists || []).some(f => (f.name || f).toLowerCase() === artist.name.toLowerCase())
                return (
                  <div
                    key={artist.name}
                    onClick={() => handleOpenArtistProfile(artist.name)}
                    className="group relative flex flex-col items-center p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] hover:border-white/15 transition-all duration-300 cursor-pointer shadow-md hover:-translate-y-1"
                  >
                    {/* Circular Avatar */}
                    <div className="relative mb-3">
                      <ArtistAvatar art={artist.art} name={artist.name} size="xl" accentColor={accentColor} />

                      {/* Follow status badge */}
                      {isFollowed ? (
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-[#090910] flex items-center justify-center text-black shadow-md">
                          <svg className="w-3.5 h-3.5 text-black stroke-[3]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div 
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFollowArtist?.({
                              name: artist.name,
                              thumbnail: artist.art
                            })
                          }}
                          className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 border-2 border-[#090910] flex items-center justify-center text-white shadow-md hover:scale-125 active:scale-95 transition-transform cursor-pointer"
                          title={`Follow ${artist.name}`}
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                        </div>
                      )}
                    </div>

                    {/* Name & Listeners details */}
                    <div className="w-full text-center min-w-0">
                      <h3 className="text-sm font-bold text-white truncate group-hover:text-white transition-colors" title={artist.name}>
                        {artist.name}
                      </h3>
                      <p className="text-[11px] text-white/40 truncate mt-0.5">
                        {artist.subscribers}
                      </p>
                    </div>

                    {/* Follow Action Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleFollowArtist?.({
                          name: artist.name,
                          thumbnail: artist.art
                        })
                      }}
                      className={`mt-3 px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer ${
                        isFollowed 
                          ? 'bg-white/10 text-white/70 hover:bg-red-500/20 hover:text-red-300' 
                          : 'bg-white text-black hover:bg-emerald-400 shadow-md hover:scale-105'
                      }`}
                    >
                      {isFollowed ? 'Following' : '+ Follow'}
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Followed Artists Section (Rich Cards Grid) ── */}
        {showFollowedSection && (
          <section className="space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <h2 className="text-lg font-bold text-white tracking-tight">Followed Artists</h2>
              </div>
              <span className="text-xs text-white/40 font-mono">{displayedFollowed.length} total</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {displayedFollowed.map(artist => (
                <div
                  key={artist.name}
                  onClick={() => handleOpenArtistProfile(artist.name)}
                  className="group relative flex flex-col items-center p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] hover:border-white/15 transition-all duration-300 cursor-pointer shadow-md hover:-translate-y-1"
                >
                  {/* Circular Avatar */}
                  <div className="relative mb-3">
                    <ArtistAvatar art={artist.art} name={artist.name} size="xl" accentColor={accentColor} />

                    {/* Quick Play Floating Button */}
                    <button
                      onClick={(e) => handlePlayArtistRadio(artist.name, e)}
                      style={{ backgroundColor: accentColor }}
                      className="absolute bottom-1 right-1 w-9 h-9 rounded-full text-white shadow-2xl flex items-center justify-center opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer z-10"
                      title="Play Artist Radio"
                    >
                      <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </button>
                  </div>

                  {/* Name & Subscriber details */}
                  <div className="w-full text-center min-w-0">
                    <h3 className="text-sm font-bold text-white truncate group-hover:text-white transition-colors" title={artist.name}>
                      {artist.name}
                    </h3>
                    <p className="text-[11px] text-white/40 truncate mt-0.5">
                      {artist.subscribers || 'Followed Artist'}
                    </p>
                  </div>

                  {/* Unfollow button */}
                  <div className="mt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        unfollowArtist(artist.name)
                      }}
                      className="px-2.5 py-1 rounded-full text-[10px] font-semibold text-white/60 hover:text-red-300 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 transition-all cursor-pointer"
                      title="Unfollow"
                    >
                      Unfollow
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Local Scanned Artists Section ── */}
        {showLocalSection && (
          <section className="space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                <h2 className="text-lg font-bold text-white tracking-tight">Local Library Artists</h2>
              </div>
              <span className="text-xs text-white/40 font-mono">{displayedLocal.length} total</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {displayedLocal.map(artist => (
                <div
                  key={artist.name}
                  onClick={() => setSelectedLocalArtist(artist)}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/10 transition-all duration-200 cursor-pointer group"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <ArtistAvatar art={artist.art} name={artist.name} size="md" accentColor={accentColor} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white/90 group-hover:text-white truncate">
                        {artist.name}
                      </p>
                      <p className="text-xs text-white/40 truncate mt-0.5">
                        {artist.files.length} song{artist.files.length !== 1 ? 's' : ''}
                        {artist.albums.size > 0 && ` · ${artist.albums.size} album${artist.albums.size !== 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenArtistProfile(artist.name)
                      }}
                      className="p-1.5 rounded-lg text-white/30 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="View Online Profile"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
                    </button>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors">
                      <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

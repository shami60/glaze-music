import React, { useState, useEffect, useMemo } from 'react'
import { usePlayer } from '../context/usePlayer'
import { useLibrary } from '../context/LibraryContext'
import { getArtURL, getSizedArtURL, formatTime } from '../utils'
import { getArtistArt, GLOBAL_ARTIST_AVATARS } from '../constants/curatedMixes'
import FancyUsername from './FancyUsername'

const TIME_RANGES = [
  { id: 'all', label: 'All Time' },
  { id: '30d', label: 'Last 30 Days' },
  { id: '7d', label: 'Last 7 Days' },
  { id: 'today', label: 'Today' }
]

const TIME_OF_DAY_SLOTS = [
  { id: 'morning', name: 'Morning Glow', hours: [6, 7, 8, 9, 10, 11], color: '#e2e8f0', desc: '6 AM – 12 PM' },
  { id: 'afternoon', name: 'Afternoon Focus', hours: [12, 13, 14, 15, 16], color: '#cbd5e1', desc: '12 PM – 5 PM' },
  { id: 'evening', name: 'Golden Hour', hours: [17, 18, 19, 20, 21], color: '#94a3b8', desc: '5 PM – 9 PM' },
  { id: 'night', name: 'Midnight Nomad', hours: [22, 23, 0, 1, 2, 3, 4, 5], color: '#64748b', desc: '9 PM – 6 AM' }
]

export default function ListeningInsightsDashboard({ onBack }) {
  const { replaceQueue, accentColor = '#ef4444' } = usePlayer()
  const { isFollowingArtist } = useLibrary()

  const [data, setData] = useState({ 
    history: [], 
    stats: {}, 
    hourly: new Array(24).fill(0), 
    daily: {}, 
    artistStats: {}, 
    albumStats: {} 
  })
  const [selectedRange, setSelectedRange] = useState('all')
  const [selectedHour, setSelectedHour] = useState(null)
  const [isResetting, setIsResetting] = useState(false)
  const [showConfirmReset, setShowConfirmReset] = useState(false)
  const [artistArtMap, setArtistArtMap] = useState({})
  const [copiedToast, setCopiedToast] = useState(false)

  // Fetch full stats and SQLite artist cache
  useEffect(() => {
    if (window.electronAPI?.dbGetAllStats) {
      window.electronAPI.dbGetAllStats().then(s => {
        if (s) setData(s)
      }).catch(() => {})
    }
    if (window.electronAPI?.dbGetArtistArtCache) {
      window.electronAPI.dbGetArtistArtCache().then(m => {
        if (m) setArtistArtMap(m)
      }).catch(() => {})
    }
  }, [])

  // Filter history based on selected time range
  const filteredHistory = useMemo(() => {
    const hist = Array.isArray(data.history) ? data.history : []
    if (selectedRange === 'all') return hist

    const now = Date.now()
    let cutoff = 0
    if (selectedRange === '30d') cutoff = now - 30 * 24 * 60 * 60 * 1000
    else if (selectedRange === '7d') cutoff = now - 7 * 24 * 60 * 60 * 1000
    else if (selectedRange === 'today') {
      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      cutoff = startOfToday.getTime()
    }

    return hist.filter(h => (h.played_at || 0) >= cutoff)
  }, [data.history, selectedRange])

  // Calculate dynamic metrics based on filtered history
  const {
    rangeTotalPlays,
    rangeEstimatedSeconds,
    rangeTopArtists,
    rangeTopTracks,
    rangeHourly,
    peakHour,
    timeOfDayBreakdown,
    dominantVibe,
    selectedHourTracks
  } = useMemo(() => {
    const hourlyCounts = new Array(24).fill(0)
    const artistCounts = {}
    const trackCounts = {}
    let totalSec = 0

    for (const h of filteredHistory) {
      // Hourly
      if (h.played_at) {
        const hour = new Date(h.played_at).getHours()
        hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1
      }

      // Duration
      totalSec += (typeof h.duration === 'number' && h.duration > 0 ? h.duration : 210)

      // Artist
      if (h.artist && h.artist !== 'Unknown Artist') {
        const primary = h.artist.split(/[,&/]/)[0].trim()
        if (primary) {
          if (!artistCounts[primary]) {
            artistCounts[primary] = { name: primary, count: 0, sampleTrack: h }
          }
          artistCounts[primary].count += 1
        }
      }

      // Track
      if (h.src && h.title && !h.title.startsWith('yt:') && h.title !== 'Online Stream') {
        if (!trackCounts[h.src]) {
          trackCounts[h.src] = { ...h, count: 0 }
        }
        trackCounts[h.src].count += 1
      }
    }

    // Top Artists Array
    const topArtistsList = Object.values(artistCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((a, rank) => {
        let art = artistArtMap[a.name] || artistArtMap[a.name.toLowerCase()] || GLOBAL_ARTIST_AVATARS[a.name.toLowerCase()]
        if (!art) art = getArtistArt(a.name, filteredHistory, {}, artistArtMap)
        return { ...a, rank: rank + 1, image: art }
      })

    // Top Tracks Array
    const topTracksList = Object.values(trackCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((t, rank) => {
        let art = t.albumArt || t.art || t.thumbnail
        if (!art || art.includes('i.scdn.co')) {
          if (t.src?.startsWith('yt:')) art = `https://i.ytimg.com/vi/${t.src.replace('yt:', '')}/hqdefault.jpg`
          else art = getArtURL(t.src)
        }
        return { ...t, rank: rank + 1, albumArt: art }
      })

    // Peak Hour calculation
    const maxVal = Math.max(...hourlyCounts, 0)
    const peakH = maxVal > 0 ? hourlyCounts.indexOf(maxVal) : 17

    // Time of Day distribution
    const timeOfDay = TIME_OF_DAY_SLOTS.map(slot => {
      let sum = 0
      for (const h of slot.hours) sum += (hourlyCounts[h] || 0)
      return { ...slot, count: sum }
    })

    // Calculate Sound Aura Persona
    let vibe = 'Eclectic Sound Explorer'
    const maxSlot = [...timeOfDay].sort((a, b) => b.count - a.count)[0]
    if (maxSlot && maxSlot.count > 0) {
      if (maxSlot.id === 'night') vibe = 'Midnight Melodic Nomad'
      else if (maxSlot.id === 'morning') vibe = 'Dawn Acoustic Flow'
      else if (maxSlot.id === 'afternoon') vibe = 'Afternoon Focus Beats'
      else if (maxSlot.id === 'evening') vibe = 'Golden Hour Groove'
    }

    // Selected hour tracks
    const hourTracks = selectedHour !== null
      ? filteredHistory.filter(h => h.played_at && new Date(h.played_at).getHours() === selectedHour)
      : []

    return {
      rangeTotalPlays: filteredHistory.length,
      rangeEstimatedSeconds: totalSec,
      rangeTopArtists: topArtistsList,
      rangeTopTracks: topTracksList,
      rangeHourly: hourlyCounts,
      peakHour: peakH,
      timeOfDayBreakdown: timeOfDay,
      dominantVibe: vibe,
      selectedHourTracks: hourTracks
    }
  }, [filteredHistory, artistArtMap, selectedHour])

  const peakHourFormatted = useMemo(() => {
    const period = peakHour >= 12 ? 'PM' : 'AM'
    const h12 = peakHour % 12 || 12
    return `${h12}:00 ${period}`
  }, [peakHour])

  const formatStreamedTime = (seconds) => {
    if (!seconds || seconds <= 0) return '0h 0m'
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hrs > 0) return `${hrs}h ${mins}m`
    return `${mins}m`
  }

  const handleResetHistory = async () => {
    setIsResetting(true)
    try {
      if (window.electronAPI?.dbResetStats) {
        await window.electronAPI.dbResetStats()
        setData({ history: [], stats: {}, hourly: new Array(24).fill(0), daily: {}, artistStats: {}, albumStats: {} })
        setSelectedHour(null)
      }
    } catch {}
    setIsResetting(false)
    setShowConfirmReset(false)
  }

  const handlePlayTopTrack = (track) => {
    if (!track) return
    replaceQueue([{
      id: track.src?.replace('yt:', '') || track.id,
      src: track.src,
      title: track.title,
      artist: track.artist,
      albumArt: track.albumArt,
      duration: track.duration || 0
    }], 0)
  }

  const handlePlayArtistStation = (artistName) => {
    if (!artistName) return
    window.dispatchEvent(new CustomEvent('open-online-playlist', {
      detail: { query: `${artistName} Essentials`, title: `${artistName} Station` }
    }))
  }

  const handleCopySoundCapsule = () => {
    const topArt = rangeTopArtists[0]?.name || 'Various Artists'
    const topSong = rangeTopTracks[0]?.title || 'Various Anthems'
    const text = `My Glaze Music Sound Capsule\nPersona: ${dominantVibe}\nTop Artist: ${topArt}\nTop Track: ${topSong}\nTotal Streams: ${rangeTotalPlays} (${formatStreamedTime(rangeEstimatedSeconds)})\nPeak Listening: ${peakHourFormatted}`
    navigator.clipboard?.writeText?.(text)
    setCopiedToast(true)
    setTimeout(() => setCopiedToast(false), 2500)
  }

  return (
    <div className="w-full h-full overflow-y-auto pb-36 px-6 sm:px-8 lg:px-12 pt-8 select-none custom-scrollbar animate-in fade-in">
      <div className="w-full max-w-none mx-auto space-y-6 lg:space-y-8">

        {/* ── 1. Top Navigation & Timeframe Switcher ── */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/5">
          <div className="flex items-center gap-6">
            {onBack && (
              <button
                onClick={onBack}
                className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-all cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
              </button>
            )}
            <div>
              <h1 className="text-3xl font-semibold text-white tracking-tight">Listening Insights</h1>
              <p className="text-sm text-white/40 mt-1 font-light">
                Analytics and audio footprint
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 p-1.5 rounded-full bg-white/[0.03] border border-white/5 self-start md:self-auto backdrop-blur-md">
            {TIME_RANGES.map(range => (
              <button
                key={range.id}
                onClick={() => {
                  setSelectedRange(range.id)
                  setSelectedHour(null)
                }}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
                  selectedRange === range.id
                    ? 'text-white shadow-lg'
                    : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                }`}
                style={selectedRange === range.id ? { backgroundColor: accentColor } : {}}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Row 1: Hero & Metrics ── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8">
          
          {/* Minimal Hero Card */}
          <div className="xl:col-span-6 relative rounded-3xl p-8 lg:p-10 overflow-hidden bg-white/[0.02] border border-white/10 shadow-2xl backdrop-blur-xl flex flex-col justify-between">
            <div className="relative z-10 space-y-4">
              <span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-white/40">Sound Profile</span>
              <h2 className="text-3xl sm:text-4xl 2xl:text-5xl font-medium text-white tracking-tight">
                {dominantVibe}
              </h2>
              <p className="text-sm text-white/40 font-light leading-relaxed max-w-md">
                {rangeTotalPlays > 0 ? (
                  <>
                    A total of <span className="text-white/90">{rangeTotalPlays} tracks</span> streamed across <span className="text-white/90">{formatStreamedTime(rangeEstimatedSeconds)}</span>, peaking steadily around <span className="text-white/90">{peakHourFormatted}</span>.
                  </>
                ) : (
                  'Play your favorite tracks and albums on Glaze to reveal your personalized sound persona.'
                )}
              </p>
            </div>

            <div className="mt-8 flex items-center shrink-0">
              <button
                onClick={handleCopySoundCapsule}
                className="px-5 py-2.5 rounded-full text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all cursor-pointer flex items-center gap-2"
              >
                {copiedToast ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M20 6L9 17L4 12"/></svg>
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
                    <span>Share Capsule</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Four Core Highlight Metric Cards */}
          <div className="xl:col-span-6 grid grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors flex flex-col justify-between backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Total Plays</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5" style={{ color: accentColor }}><path strokeLinecap="round" strokeLinejoin="round" d="M14.75 2.25H9.25C5.384 2.25 2.25 5.384 2.25 9.25V14.75C2.25 18.616 5.384 21.75 9.25 21.75H14.75C18.616 21.75 21.75 18.616 21.75 14.75V9.25C21.75 5.384 18.616 2.25 14.75 2.25Z"/><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 15.25V8.75L15.25 12L9.75 15.25Z"/></svg>
              </div>
              <div className="mt-8">
                <p className="text-3xl lg:text-4xl font-black text-white tracking-tight">{rangeTotalPlays}</p>
              </div>
            </div>

            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors flex flex-col justify-between backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Streamed</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5" style={{ color: accentColor }}><circle cx="12" cy="12" r="9.75"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75V12L15.75 15.75"/></svg>
              </div>
              <div className="mt-8">
                <p className="text-3xl lg:text-4xl font-black text-white tracking-tight">{formatStreamedTime(rangeEstimatedSeconds)}</p>
              </div>
            </div>

            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors flex flex-col justify-between backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Peak Hour</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5" style={{ color: accentColor }}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 20.25L9 15L13.5 19.5L20.25 3.75"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 3.75H20.25V9"/></svg>
              </div>
              <div className="mt-8">
                <p className="text-3xl lg:text-4xl font-black text-white tracking-tight">{rangeTotalPlays > 0 ? peakHourFormatted : '—'}</p>
              </div>
            </div>

            <div className="p-6 rounded-3xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-colors flex flex-col justify-between backdrop-blur-xl overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Top Artist</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5" style={{ color: accentColor }}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21.75C17.3848 21.75 21.75 17.3848 21.75 12C21.75 6.61522 17.3848 2.25 12 2.25C6.61522 2.25 2.25 6.61522 2.25 12C2.25 17.3848 6.61522 21.75 12 21.75Z"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 12C14.0711 12 15.75 10.3211 15.75 8.25C15.75 6.17893 14.0711 4.5 12 4.5C9.92893 4.5 8.25 6.17893 8.25 8.25C8.25 10.3211 9.92893 12 12 12Z"/><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21.75V19.5C2.25 16.5 6.5 15 12 15C17.5 15 21.75 16.5 21.75 19.5V21.75"/></svg>
              </div>
              <div className="mt-6 flex items-center gap-3">
                {rangeTopArtists[0] ? (
                  <>
                    <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-full overflow-hidden shrink-0 border border-white/5 bg-white/5">
                      <img src={getSizedArtURL(rangeTopArtists[0].image, 'thumb')} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate leading-tight">{rangeTopArtists[0].name}</p>
                      <p className="text-[10px] text-white/40 mt-0.5">{rangeTopArtists[0].count} streams</p>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-white/30">Not available</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 2: Interactive 24-Hour Rhythm Heatmap ── */}
        <div className="grid grid-cols-1 gap-6">
          <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/10 space-y-8 backdrop-blur-xl shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">Circadian Activity</h3>
                <p className="text-sm text-white/60 mt-1 font-light">Distribution of playback across 24 hours</p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {timeOfDayBreakdown.map(slot => (
                  <div 
                    key={slot.name}
                    className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-white/5 border border-white/10 flex items-center gap-2"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: slot.color }}></span>
                    <span className="text-white/70">{slot.name}</span>
                    <span className="text-white/40 bg-white/10 px-1.5 rounded-md">{slot.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-12 sm:grid-cols-24 gap-1.5 pt-6 border-t border-white/10">
              {rangeHourly.map((val, h) => {
                const max = Math.max(...rangeHourly, 1)
                const pct = Math.min(1, val / max)
                const isSelected = selectedHour === h
                const heightPx = Math.max(12, Math.round(pct * 100))

                return (
                  <div 
                    key={h} 
                    onClick={() => setSelectedHour(selectedHour === h ? null : h)}
                    className="flex flex-col items-center gap-3 group/bar cursor-pointer"
                  >
                    <div className="h-28 w-full flex items-end justify-center">
                      <div 
                        className={`w-full max-w-[20px] rounded-[4px] transition-all duration-300 ${
                          isSelected 
                            ? 'shadow-[0_0_15px_currentColor]' 
                            : ''
                        }`}
                        style={{ 
                          height: `${heightPx}px`, 
                          backgroundColor: isSelected ? '#ffffff' : pct > 0 ? `rgba(var(--ink-rgb),${(0.2 + pct * 0.8).toFixed(2)})` : 'rgba(var(--ink-rgb),0.05)',
                          color: '#ffffff'
                        }}
                        title={`${h}:00 — ${val} streams`}
                      />
                    </div>
                    <span className={`text-[9px] font-mono ${isSelected ? 'text-white font-bold' : 'text-white/30'}`}>
                      {h}h
                    </span>
                  </div>
                )
              })}
            </div>

            {selectedHour !== null && (
              <div className="mt-4 p-5 rounded-2xl bg-white/5 border border-white/10 animate-in fade-in">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <span className="text-xs font-medium text-white">
                    Playback history for {selectedHour}:00 ({selectedHourTracks.length} tracks)
                  </span>
                  <button 
                    onClick={() => setSelectedHour(null)}
                    className="text-[10px] uppercase tracking-wider font-semibold text-white/40 hover:text-white transition-colors"
                  >
                    Close
                  </button>
                </div>

                {selectedHourTracks.length > 0 ? (
                  <div className="max-h-64 overflow-y-auto pt-2 space-y-1 custom-scrollbar">
                    {selectedHourTracks.map((tr, idx) => (
                      <div 
                        key={idx}
                        onClick={() => handlePlayTopTrack(tr)}
                        className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 rounded shrink-0 bg-white/5 overflow-hidden">
                            <img src={getSizedArtURL(tr.albumArt || getArtURL(tr.src), 'thumb')} alt="" className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white/90 truncate group-hover:text-white transition-colors">{tr.title}</p>
                            <p className="text-[11px] text-white/40 truncate mt-0.5">{tr.artist}</p>
                          </div>
                        </div>
                        <span className="text-xs text-white/30 font-mono">
                          {new Date(tr.played_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-white/30 py-4 text-center">No activity recorded during this hour.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Row 3: Interactive Top 10 Artists & Top 10 Anthems ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/10 shadow-lg backdrop-blur-xl">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 mb-6">Top Artists</h3>
            
            <div className="space-y-1.5">
              {rangeTopArtists.map((artist, idx) => {
                const maxPlays = rangeTopArtists[0]?.count || 1
                const pct = Math.min(100, Math.round((artist.count / maxPlays) * 100))

                return (
                  <div 
                    key={artist.name}
                    className="group flex items-center p-2.5 rounded-2xl hover:bg-white/10 transition-all cursor-pointer relative overflow-hidden"
                    onClick={() => window.dispatchEvent(new CustomEvent('open-artist', { detail: artist.name }))}
                  >
                    <div 
                      className="absolute left-0 top-0 bottom-0 transition-all rounded-2xl pointer-events-none"
                      style={{ width: `${pct}%`, backgroundColor: `color-mix(in srgb, ${accentColor} 10.2%, transparent)` }}
                    />
                    
                    <span className="w-8 text-[11px] font-bold font-mono text-right pr-4 shrink-0" style={{ color: idx < 3 ? accentColor : 'rgba(var(--ink-rgb),0.3)' }}>
                      {(idx + 1).toString().padStart(2, '0')}
                    </span>
                    
                    <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 bg-white/5 border border-white/10 mr-4 shadow-sm z-10 relative">
                      {artist.image ? (
                        <img src={getSizedArtURL(artist.image, 'thumb')} alt="" className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-medium text-sm text-white/50">
                          {artist.name.charAt(0)}
                        </div>
                      )}
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white/90 truncate">{artist.name}</p>
                    </div>
                    
                    <span className="text-xs text-white/40 shrink-0 ml-4 font-medium">{artist.count} plays</span>
                  </div>
                )
              })}

              {rangeTopArtists.length === 0 && (
                <p className="text-xs text-white/30 py-6 text-center">No artist data available.</p>
              )}
            </div>
          </div>

          <div className="p-8 rounded-3xl bg-white/[0.02] border border-white/10 shadow-lg backdrop-blur-xl">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40 mb-6">Top Tracks</h3>
            
            <div className="space-y-1.5">
              {rangeTopTracks.map((track, idx) => {
                const maxPlays = rangeTopTracks[0]?.count || 1
                const pct = Math.min(100, Math.round((track.count / maxPlays) * 100))

                return (
                  <div 
                    key={track.src || track.id}
                    className="group flex items-center p-2.5 rounded-2xl hover:bg-white/10 transition-all cursor-pointer relative overflow-hidden"
                    onClick={() => handlePlayTopTrack(track)}
                  >
                    <div 
                      className="absolute left-0 top-0 bottom-0 transition-all rounded-2xl pointer-events-none"
                      style={{ width: `${pct}%`, backgroundColor: `color-mix(in srgb, ${accentColor} 10.2%, transparent)` }}
                    />
                    
                    <span className="w-8 text-[11px] font-bold font-mono text-right pr-4 shrink-0" style={{ color: idx < 3 ? accentColor : 'rgba(var(--ink-rgb),0.3)' }}>
                      {(idx + 1).toString().padStart(2, '0')}
                    </span>
                    
                    <div className="w-12 h-12 rounded-xl shrink-0 bg-white/5 overflow-hidden border border-white/10 mr-4 shadow-sm z-10 relative">
                      <img src={getSizedArtURL(track.albumArt, 'thumb')} alt="" className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all" />
                    </div>
                    
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-sm font-medium text-white/90 truncate">{track.title}</p>
                      <p className="text-[11px] text-white/40 truncate mt-0.5">{track.artist}</p>
                    </div>
                    
                    <span className="text-xs text-white/40 shrink-0 font-medium">{track.count} plays</span>
                  </div>
                )
              })}

              {rangeTopTracks.length === 0 && (
                <p className="text-xs text-white/30 py-6 text-center">No track data available.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── 6. Bottom Privacy & Clear Actions ── */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30 font-medium">
            Local Data Only
          </p>
          
          <button
            onClick={() => setShowConfirmReset(true)}
            className="text-[10px] uppercase tracking-wider font-semibold text-white/30 hover:text-white transition-colors cursor-pointer"
          >
            Clear Data
          </button>
        </div>

        {showConfirmReset && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-sm p-8 rounded-3xl bg-[var(--surface-0)] border border-white/10 space-y-6 shadow-2xl">
              <div>
                <h3 className="text-lg font-medium text-white">Clear History</h3>
                <p className="text-sm text-white/50 mt-2 leading-relaxed">
                  This will permanently erase all listening statistics from your local database.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowConfirmReset(false)}
                  className="px-5 py-2.5 rounded-full text-xs font-medium text-white/60 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetHistory}
                  disabled={isResetting}
                  className="px-5 py-2.5 rounded-full text-xs font-bold text-black bg-white hover:bg-white/90 transition-all cursor-pointer shadow-lg active:scale-95"
                >
                  {isResetting ? 'Clearing...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

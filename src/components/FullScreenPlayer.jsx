import React from 'react'
import { usePlayer, usePlaybackTime } from '../context/usePlayer'
import { getArtURL, getHighQualityArtURL, onArtLoad, formatTime } from '../utils'
import LyricsView from './LyricsView'

// ── Icons ──────────────────────────────────────────────────────────────────
function PlayIcon()  { return <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 ml-1"><path d="M8 5v14l11-7z"/></svg> }
function PauseIcon() { return <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> }
function PrevIcon()  { return <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M6 6h2v12H6zm2 6 8.5 6V6L8 12z"/></svg> }
function NextIcon()  { return <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg> }
function ShuffleIcon({ active }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`w-5 h-5 transition-colors ${active ? 'text-red-500' : 'text-white/40'}`}>
      <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
    </svg>
  )
}
function RepeatIcon({ mode }) {
  const color = mode !== 'none' ? 'text-red-500' : 'text-white/40'
  if (mode === 'one') {
    return <svg viewBox="0 0 24 24" fill="currentColor" className={`w-5 h-5 ${color}`}><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
  }
  return <svg viewBox="0 0 24 24" fill="currentColor" className={`w-5 h-5 ${color}`}><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
}
function CollapseIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>
}

function VisualizerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h1m3 0h1m3 0h1m3 0h1m3 0h1m3 0h1M7 12V8m0 8v-4m4 8V4m0 16v-4m4-4v-4m0 8V8m4 4v-2m0 4v-2" />
    </svg>
  )
}

const presetLabels = {
  room: 'Living Room',
  studio: 'Cozy Studio',
  hall: 'Concert Hall',
  cathedral: 'Cathedral',
  none: 'Dry (None)'
}

// ── Component ──────────────────────────────────────────────────────────────
export default function FullScreenPlayer() {
  const {
    currentTrack, isPlaying, duration, audioElement,
    shuffle, repeat, accentColor, getAnalyserNode,
    togglePlayPause, skipNext, skipPrev, seekTo,
    setShuffle, cycleRepeat, toggleFullScreen,
    is8D, reverbPreset
  } = usePlayer()
  // Position lives in its own context so the 4x/sec time updates don't re-render the app.
  const { currentTime: ctxCurrentTime, progress: ctxProgress } = usePlaybackTime()

  // Toggle for showing the visualizer vs standard cover art view
  const [showVisualizer, setShowVisualizer] = React.useState(() => {
    const saved = localStorage.getItem('glaze_fs_visualizer')
    return saved === 'true' // default to false
  })

  const toggleVisualizer = () => {
    setShowVisualizer(prev => {
      const next = !prev
      localStorage.setItem('glaze_fs_visualizer', String(next))
      return next
    })
  }
  
  const [showLyrics, setShowLyrics] = React.useState(false)
  const artUrl = getHighQualityArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src))

  // Use local state driven by audioElement for smoother updates,
  // but fall back to context values if audioElement is unavailable
  const [localTime, setLocalTime] = React.useState(0)
  const [localProgress, setLocalProgress] = React.useState(0)
  const [isDragging, setIsDragging] = React.useState(false)
  const [seekPercent, setSeekPercent] = React.useState(0)

  React.useEffect(() => {
    if (!audioElement) return
    const updateTime = () => {
      setLocalTime(audioElement.currentTime)
      setLocalProgress(audioElement.duration ? (audioElement.currentTime / audioElement.duration) * 100 : 0)
    }
    updateTime()
    audioElement.addEventListener('timeupdate', updateTime)
    return () => audioElement.removeEventListener('timeupdate', updateTime)
  }, [audioElement])

  // Global mouse release while dragging seekbar
  React.useEffect(() => {
    if (!isDragging) return
    const handleGlobalRelease = () => {
      seekTo(seekPercent)
      setIsDragging(false)
    }
    window.addEventListener('mouseup', handleGlobalRelease)
    window.addEventListener('touchend', handleGlobalRelease)
    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease)
      window.removeEventListener('touchend', handleGlobalRelease)
    }
  }, [isDragging, seekPercent, seekTo])

  const handleSeekStart = (e) => {
    setIsDragging(true)
    setSeekPercent(parseFloat(e.target.value))
  }

  const handleSeekChange = (e) => {
    setSeekPercent(parseFloat(e.target.value))
    if (!isDragging) setIsDragging(true)
  }

  const handleSeekCommit = (e) => {
    const val = parseFloat(e.target.value)
    if (!isNaN(val)) {
      setSeekPercent(val)
      seekTo(val)
    }
    setIsDragging(false)
  }

  // Use local values if audioElement is available, otherwise use context values
  const baseCurrentTime = audioElement ? localTime : ctxCurrentTime
  const baseProgress = audioElement ? localProgress : ctxProgress

  const currentPercent = isDragging ? seekPercent : baseProgress
  const currentTime = isDragging ? ((seekPercent / 100) * (duration || 0)) : baseCurrentTime

  const seekStyle = {
    background: `linear-gradient(to right, rgba(var(--ink-rgb),0.9) ${currentPercent}%, rgba(var(--ink-rgb),0.1) ${currentPercent}%)`,
  }

  // Determine button color
  const btnBg = accentColor !== 'rgb(80, 80, 180)' ? accentColor : 'rgb(239, 68, 68)'
  // Generate a shadow string. Replace closing ')' with ', 0.4)'
  const shadowColor = btnBg.replace('rgb', 'rgba').replace(')', ', 0.4)')

  // Lyrics mode is the Apple-style screen: artwork and meta on one half, lyrics
  // on the other, transport only on hover. It is the same component the lyrics
  // overlay uses, so the two entry points cannot drift apart.
  if (showLyrics) {
    return (
      <div className="on-media absolute inset-0 z-40 overflow-hidden animate-in fade-in duration-500" style={{ animationDuration: '400ms' }}>
        <LyricsView onClose={() => setShowLyrics(false)} />
      </div>
    )
  }

  return (
    <div className="on-media absolute inset-0 z-40 flex flex-col items-center justify-between overflow-hidden animate-in fade-in duration-500 p-8" style={{ animationDuration: '400ms' }}>

      {/* ── Immersive backdrop ───────────────────────────────────────────────
          The old version was `bg-black/40` over the app's dynamic background.
          In a light theme that background is pale, so the result was a grey
          wash with nothing to look at. This rebuilds it from the cover art:
          a heavily blurred, slowly drifting copy of the artwork, two colour
          blobs taken from the album accent, and a scrim to keep the lyrics
          readable. `on-media` pins the ink white in every theme — a
          fullscreen player is a media surface, not a page. */}
      <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
        <div
          className="fs-art absolute inset-0"
          style={{ backgroundImage: artUrl ? `url("${artUrl}")` : 'none' }}
        />
        <div
          className="fs-blob fs-blob-a"
          style={{ background: `radial-gradient(circle at 50% 50%, ${accentColor}, transparent 68%)` }}
        />
        <div
          className="fs-blob fs-blob-b"
          style={{ background: `radial-gradient(circle at 50% 50%, ${accentColor}, transparent 70%)` }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(6,6,10,0.26) 0%, rgba(6,6,10,0.58) 100%)' }}
        />
      </div>
      
      {/* Top Bar: Visualizer Toggle on Left, Exit Button on Right */}
      <div className="w-full flex items-center justify-between z-50 shrink-0">
        <button
          onClick={toggleVisualizer}
          className={`p-3 rounded-full transition-all shadow-lg backdrop-blur-md flex items-center justify-center ${showVisualizer ? 'bg-white/15 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'}`}
          title={showVisualizer ? 'Hide Visualizer' : 'Show Visualizer'}
        >
          <VisualizerIcon />
        </button>

        <button 
          onClick={toggleFullScreen}
          className="p-3 rounded-full bg-white/5 hover:bg-white/20 text-white/60 hover:text-white transition-all shadow-lg backdrop-blur-md"
          title="Exit Full Screen (F11 / Esc)"
        >
          <CollapseIcon />
        </button>
      </div>

      {/* Main Center Area */}
      <div className={`flex-1 flex items-center w-full relative transition-all duration-700 ${showLyrics ? 'justify-start px-8 md:px-16 lg:px-24 gap-8 md:gap-16' : 'justify-center'}`}>
        {/* Left Side: Art/Visualizer */}
        <div className={`relative flex items-center justify-center shrink-0 transition-all duration-700 ${showLyrics ? 'w-56 h-56 sm:w-72 sm:h-72 lg:w-80 lg:h-80 opacity-60 hover:opacity-100' : 'w-80 h-80 sm:w-96 sm:h-96 opacity-100'}`}>
          {showVisualizer ? (
            /* ONLY Visualizer in the Center + Screensaver Clock */
            <div className="relative w-full h-full flex items-center justify-center shrink-0">

              {/* Rotating Vinyl Disc / Cover Art Label Overlay */}
              <div className="absolute flex items-center justify-center pointer-events-none z-10 animate-in fade-in duration-700">
                <div 
                  className="p-1 rounded-full bg-white/5 border border-white/15 shadow-2xl backdrop-blur-sm transition-all duration-300"
                  style={{
                    transform: `scale(${isPlaying ? 1.05 : 1})`,
                    boxShadow: `0 0 50px ${accentColor.replace('rgb', 'rgba').replace(')', ', 0.35)')}`
                  }}
                >
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center rounded-full overflow-hidden">
                    {/* Background Ambient Art */}
                    <div className="absolute inset-0 z-0 overflow-hidden mix-blend-screen opacity-20 pointer-events-none">
                      <img 
                        src={getHighQualityArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src))}
                        onLoad={onArtLoad} 
                        className="w-full h-full object-cover blur-[100px] scale-150 saturate-200" 
                      />
                    </div>
                    {/* Rotating Cover Art */}
                    <img
                      src={getHighQualityArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src))}
                      onLoad={onArtLoad}
                      alt=""
                      className="w-full h-full object-cover rounded-full animate-[spin_12s_linear_infinite]"
                      style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                    />
                    {/* Spindle hole decoration to make it look like a vinyl label */}
                    <div className="absolute w-4 h-4 rounded-full bg-black border border-white/20 flex items-center justify-center shadow-inner">
                      <div className="w-1.5 h-1.5 rounded-full bg-white/90 shadow-sm" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Normal Cover Art Card in the Center */
            <div className="relative w-full h-full flex items-center justify-center shrink-0">
              <div className="w-full h-full rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden relative bg-white/5 flex items-center justify-center z-10">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-20 h-20 text-white/20 absolute inset-0 m-auto">
                  <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
                </svg>
                <img
                  src={getHighQualityArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src))}
                  alt=""
                  className="w-full h-full object-cover absolute inset-0 z-10 transition-opacity duration-700"
                  onError={e => e.target.style.opacity = '0'}
                  onLoad={e => { e.target.style.opacity = '1'; onArtLoad(e) }}
                  style={{ opacity: 0 }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Embedded Lyrics */}
        {showLyrics && (
          <div className="flex-1 min-w-0 h-full max-h-[70vh] animate-in fade-in slide-in-from-right-8 duration-700">
            <LyricsView embedded={true} />
          </div>
        )}
      </div>

      {/* Bottom Area */}
      {showVisualizer ? (
        /* Visualizer Mode Bottom Bar */
        <div className="w-full max-w-6xl md:grid md:grid-cols-3 flex flex-col items-center gap-6 mt-auto z-10 shrink-0 p-4">
          
          {/* Left Column: Cover Art + Info */}
          <div className="flex items-center gap-4 justify-start w-full md:w-auto">
            <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 bg-white/5 flex items-center justify-center relative shadow-lg">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white/20 absolute inset-0 m-auto">
                <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/>
              </svg>
              <img
                src={getHighQualityArtURL(currentTrack?.albumArt || getArtURL(currentTrack?.src))}
                alt=""
                className="w-full h-full object-cover absolute inset-0 z-10 transition-opacity duration-700"
                onError={e => e.target.style.opacity = '0'}
                onLoad={e => { e.target.style.opacity = '1'; onArtLoad(e) }}
                style={{ opacity: 0 }}
              />
            </div>
            <div className="overflow-hidden flex flex-col justify-center text-left">
              <h1 className="text-xl font-bold text-white truncate drop-shadow-sm">
                {currentTrack?.title || 'No track playing'}
              </h1>
              <h2 
                className="text-sm text-white/70 truncate font-medium drop-shadow-sm mt-0.5 cursor-pointer hover:underline"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('open-artist', { detail: currentTrack?.artist }))
                  toggleFullScreen() // Exit full screen when navigating to artist
                }}
              >
                {currentTrack?.artist || 'Unknown Artist'}
              </h2>
            </div>
          </div>

          {/* Center Column: Seek Bar + Controls */}
          <div className="flex flex-col items-center w-full max-w-xl mx-auto col-start-2">
            {/* Seek Bar */}
            <div className="flex items-center gap-4 w-full mb-4 px-2">
              <span className="text-xs font-medium text-white/60 w-10 text-right tabular-nums drop-shadow-sm">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={currentPercent}
                onMouseDown={handleSeekStart}
                onTouchStart={handleSeekStart}
                onChange={handleSeekChange}
                onMouseUp={handleSeekCommit}
                onTouchEnd={handleSeekCommit}
                onKeyUp={handleSeekCommit}
                style={seekStyle}
                className="flex-1 h-1.5 rounded-full cursor-pointer"
              />
              <span className="text-xs font-medium text-white/60 w-10 tabular-nums drop-shadow-sm">
                {formatTime(duration)}
              </span>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-6">
              <button onClick={() => setShuffle(s => !s)} className="p-2 rounded-full hover:bg-white/10 transition-all">
                <ShuffleIcon active={shuffle} />
              </button>
              
              <button onClick={skipPrev} className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all">
                <PrevIcon />
              </button>

              <button
                onClick={togglePlayPause}
                className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95"
                style={{ 
                  background: btnBg,
                  boxShadow: `0 8px 32px ${shadowColor}`
                }}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>

              <button onClick={skipNext} className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all">
                <NextIcon />
              </button>

              <button onClick={cycleRepeat} className="p-2 rounded-full hover:bg-white/10 transition-all">
                <RepeatIcon mode={repeat} />
              </button>

              <button 
                onClick={() => setShowLyrics(p => !p)}
                className={`p-2 ml-4 rounded-full transition-all font-bold text-sm tracking-widest ${showLyrics ? 'text-white bg-white/20' : 'text-white/50 hover:text-white/90 hover:bg-white/10'}`}
                title="Toggle Lyrics"
              >
                LYRICS
              </button>
            </div>
          </div>

          {/* Right Column: Spacer to balance layout */}
          <div className="hidden md:block col-start-3" />
        </div>
      ) : (
        /* Normal Mode Bottom Section (Stacked) */
        <div className="w-full flex flex-col items-center mt-auto z-10 shrink-0">
          {/* Track Info */}
          <div className="text-center mb-8 max-w-2xl w-full px-4">
            <h1 className="text-3xl sm:text-4xl font-bold text-white truncate mb-2 drop-shadow-md">
              {currentTrack?.title || 'No track playing'}
            </h1>
            <h2 
              className="text-lg sm:text-xl text-white/70 truncate font-medium drop-shadow-sm cursor-pointer hover:underline"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-artist', { detail: currentTrack?.artist }))
                toggleFullScreen() // Exit full screen when navigating to artist
              }}
            >
              {currentTrack?.artist || 'Unknown Artist'}
            </h2>
          </div>

          {/* Seek Bar */}
          <div className="flex items-center gap-4 w-full max-w-xl mb-10 px-4">
            <span className="text-xs font-medium text-white/60 w-10 text-right tabular-nums drop-shadow-sm">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={currentPercent}
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              onChange={handleSeekChange}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              onKeyUp={handleSeekCommit}
              style={seekStyle}
              className="flex-1 h-1.5 rounded-full cursor-pointer"
            />
            <span className="text-xs font-medium text-white/60 w-10 tabular-nums drop-shadow-sm">
              {formatTime(duration)}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between w-full max-w-2xl mb-4 relative px-4">
            {/* Left Controls */}
            <div className="flex items-center justify-end flex-1 gap-4">
              <button onClick={() => setShuffle(s => !s)} className="p-2 rounded-full hover:bg-white/10 transition-all">
                <ShuffleIcon active={shuffle} />
              </button>
            </div>

            {/* Main Center Controls */}
            <div className="flex items-center justify-center gap-6 mx-4">
              <button onClick={skipPrev} className="p-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all">
                <PrevIcon />
              </button>

              <button
                onClick={togglePlayPause}
                className="w-20 h-20 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 shrink-0"
                style={{ 
                  background: btnBg,
                  boxShadow: `0 8px 32px ${shadowColor}`
                }}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>

              <button onClick={skipNext} className="p-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all">
                <NextIcon />
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center justify-start flex-1 gap-4">
              <button onClick={cycleRepeat} className="p-2 rounded-full hover:bg-white/10 transition-all">
                <RepeatIcon mode={repeat} />
              </button>

              <button 
                onClick={() => setShowLyrics(p => !p)}
                className={`px-3 py-1.5 rounded-full transition-all font-bold text-xs tracking-widest ${showLyrics ? 'text-white bg-white/20' : 'text-white/50 hover:text-white/90 hover:bg-white/10'}`}
                title="Toggle Lyrics"
              >
                LYRICS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

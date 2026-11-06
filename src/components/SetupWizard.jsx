import React, { useState, useEffect, useRef } from 'react'
import { THEMES } from '../themes'
import { ANIME_PFP_PRESETS, getRandomAnimePfp, resolvePfpUrl } from '../constants/animePfps'

const RANDOM_NICKNAMES = [
  'CyberVibe', 'NeonPulse', 'EchoDrifter', 'GlazeRhythm', 'MidnightAura',
  'SonicWave', 'RetroGroove', 'HyperBeat', 'AstraMelody', 'VaporSynth'
]

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
    title: '100M+ Instant Streaming',
    subtitle: 'Lightning-fast cloud search, albums, charts, artist profiles, and infinite algorithmic radio.',
    badge: 'Sub-Second Audio',
    color: '#ef4444'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
      </svg>
    ),
    title: '3D Spatial & 8D Audio',
    subtitle: 'Full 360-degree rotating headphone immersion with custom pan velocity and 10-band EQ.',
    badge: 'Pro Audio FX',
    color: '#a855f7'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    ),
    title: '1-Click Offline Downloader',
    subtitle: 'Download songs and albums with high-res cover art directly to your local library.',
    badge: 'Offline Mode',
    color: '#3b82f6'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
      </svg>
    ),
    title: 'Fullscreen Vinyl & Synced Lyrics',
    subtitle: 'Ambient real-time background blur, rotating vinyl player, and synchronized karaoke lyrics.',
    badge: 'Visualizer',
    color: '#ec4899'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    title: 'Lossless Local Library',
    subtitle: 'Lightning-fast multi-folder scanner, automatic ID3 tag metadata parsing, and SQLite caching.',
    badge: 'Smart Indexing',
    color: '#10b981'
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.804-2.803a3.75 3.75 0 015.304 0l2.196 2.196a3.75 3.75 0 010 5.304l-2.803 2.804M10.5 8.197l-2.803 2.804" />
      </svg>
    ),
    title: 'Glassmorphic Audio Themes',
    subtitle: 'Curated dark themes, custom hex colors, and dynamic album art responsive backgrounds.',
    badge: 'Dynamic UI',
    color: '#f59e0b'
  }
]

const STEPS = [
  { id: 'identity', label: 'Persona' },
  { id: 'features', label: 'Features' },
  { id: 'vibe', label: 'Theme & Vibe' },
  { id: 'ready', label: 'Launch' }
]

export default function SetupWizard({ onComplete, onClose, isReplay = false }) {
  const [step, setStep] = useState(0)
  const [userName, setUserName] = useState('')
  const [profileImage, setProfileImage] = useState(ANIME_PFP_PRESETS[0].url)
  const [selectedTheme, setSelectedTheme] = useState('dynamic')
  const [musicFolder, setMusicFolder] = useState(null)
  const [scanCount, setScanCount] = useState(0)
  const [isScanning, setIsScanning] = useState(false)
  const [scanDone, setScanDone] = useState(false)
  const [scannedFiles, setScannedFiles] = useState([])
  const [enable8D, setEnable8D] = useState(false)
  const [enableAutoplay, setEnableAutoplay] = useState(true)

  const nameInputRef = useRef(null)
  const counterRef = useRef(null)

  useEffect(() => {
    // Load existing profile if available
    try {
      const saved = JSON.parse(localStorage.getItem('glaze_profile') || 'null')
      if (saved?.userName) setUserName(saved.userName)
      if (saved?.profileImage) setProfileImage(saved.profileImage)
    } catch {}
  }, [])

  useEffect(() => {
    if (step === 0 && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [step])

  function handleRandomName() {
    const random = RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)]
    setUserName(random)
  }

  async function handlePickCustomImage() {
    if (!window.electronAPI?.openImageDialog) return
    const result = await window.electronAPI.openImageDialog()
    if (result) setProfileImage(result)
  }

  async function handlePickFolder() {
    if (!window.electronAPI?.openFolderDialog) return
    const folderPath = await window.electronAPI.openFolderDialog()
    if (!folderPath) return
    setMusicFolder(folderPath)
    setIsScanning(true)
    setScanDone(false)
    setScanCount(0)

    if (counterRef.current) clearInterval(counterRef.current)

    try {
      const files = await window.electronAPI.scanLibrary(folderPath)
      const list = files || []
      setScannedFiles(list)
      const target = list.length
      let current = 0
      const increment = Math.max(1, Math.floor(target / 60))
      const timer = setInterval(() => {
        current = Math.min(current + increment, target)
        setScanCount(current)
        if (current >= target) {
          clearInterval(timer)
          setScanDone(true)
          setIsScanning(false)
        }
      }, 16)
      counterRef.current = timer
    } catch (err) {
      console.error('Scan error:', err)
      setIsScanning(false)
    }
  }

  function handleFinish() {
    const profile = {
      userName: userName.trim() || 'User',
      profileImage: profileImage || getRandomAnimePfp(),
      nameStyle: 'aurora',
      nameFont: 'default',
      nameEffect: 'shimmer',
      nameGlow: 'subtle',
      avatarRing: 'none',
      theme: selectedTheme,
      musicFolder,
      scannedFiles,
      enable8D,
      enableAutoplay,
      setupComplete: true,
    }
    try {
      localStorage.setItem('glaze_setup_complete', 'true')
      localStorage.setItem('glaze_profile', JSON.stringify({
        userName: profile.userName,
        profileImage: profile.profileImage,
        nameStyle: profile.nameStyle,
        nameFont: profile.nameFont,
        nameEffect: profile.nameEffect,
        nameGlow: profile.nameGlow,
        avatarRing: profile.avatarRing
      }))
    } catch {}
    onComplete(profile)
  }

  const selectedPresetObj = ANIME_PFP_PRESETS.find(p => p.url === profileImage || p.legacyPath === profileImage || resolvePfpUrl(p.url) === resolvePfpUrl(profileImage))
  const currentAccent = selectedPresetObj?.accent || '#ef4444'

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--surface-0)]/95 backdrop-blur-3xl select-none overflow-hidden p-4">
      {/* Ambient background glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute -top-32 -left-32 w-[600px] h-[600px] rounded-full opacity-25 blur-[120px] transition-colors duration-1000"
          style={{ background: currentAccent }}
        />
        <div 
          className="absolute -bottom-32 -right-32 w-[600px] h-[600px] rounded-full opacity-20 blur-[130px] transition-colors duration-1000"
          style={{ background: '#6366f1' }}
        />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-red-600/10 blur-[160px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center w-full max-w-4xl h-[92vh] max-h-[840px]">
        {/* Top Header & Close button for Replay */}
        <div className="w-full flex items-center justify-between px-2 mb-4 shrink-0">
          <div className="flex items-center gap-3">
            {/* The real app icon, not a stand-in glyph — this is the first screen
                a new user sees, so it should match the taskbar and installer. */}
            <img
              src="./icon.png"
              alt=""
              aria-hidden="true"
              className="w-10 h-10 object-contain drop-shadow-[0_8px_24px_rgba(99,102,241,0.45)]"
            />
            <div>
              <span className="text-xl font-black text-white tracking-tight block">Glaze Music</span>
              <span className="text-[11px] text-white/40 font-medium">Out of the Box Experience</span>
            </div>
          </div>

          {/* Stepper Dots */}
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] px-3.5 py-1.5 rounded-full backdrop-blur-xl">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setStep(i)}
                className="group flex items-center gap-1.5 cursor-pointer"
                title={s.label}
              >
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{
                    width: i === step ? 28 : 8,
                    backgroundColor: i === step ? currentAccent : i < step ? `${currentAccent}80` : 'rgba(var(--ink-rgb),0.15)'
                  }}
                />
              </button>
            ))}
          </div>

          {isReplay && onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
              title="Close Tour"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Main Glass Card Content */}
        <div className="relative overflow-hidden rounded-3xl bg-white/[0.03] border border-white/[0.08] shadow-[0_16px_48px_0_rgba(0,0,0,0.5)] backdrop-blur-2xl w-full flex-1 flex flex-col p-6 sm:p-8 min-h-0">
          
          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 0: IDENTITY & ANIMATED PFP                                   */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 0 && (
            <div className="flex-1 flex flex-col items-center justify-between gap-4 overflow-y-auto custom-scrollbar">
              <div className="text-center space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">Step 1 of 4</span>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Create Your Listener Identity</h2>
                <p className="text-xs sm:text-sm text-white/50 max-w-md">
                  Choose a custom avatar or an anime icon and set your name across the player.
                </p>
              </div>

              {/* Central Avatar Showcase */}
              <div className="flex flex-col items-center gap-3 my-auto">
                <div className="relative group">
                  <div 
                    className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-4 shadow-2xl transition-all duration-500 flex items-center justify-center"
                    style={{ 
                      borderColor: currentAccent,
                      boxShadow: `0 0 35px ${currentAccent}50` 
                    }}
                  >
                    <img 
                      src={resolvePfpUrl(profileImage)} 
                      alt="Avatar" 
                      className="w-full h-full object-cover" 
                    />
                  </div>

                  {/* Upload Custom Avatar Button */}
                  <button
                    onClick={handlePickCustomImage}
                    className="absolute bottom-0 right-0 p-2 rounded-full bg-white text-black shadow-lg hover:scale-110 active:scale-95 transition-all cursor-pointer"
                    title="Upload Custom Avatar"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                    </svg>
                  </button>
                </div>

                {/* Display Name Input with Random Generator */}
                <div className="flex items-center gap-2 w-full max-w-xs">
                  <input
                    ref={nameInputRef}
                    type="text"
                    placeholder="Enter your listener name..."
                    value={userName}
                    onChange={e => setUserName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') setStep(1) }}
                    className="flex-1 px-4 py-2.5 rounded-2xl bg-white/[0.05] border border-white/[0.1] text-white placeholder-white/25 text-sm font-semibold outline-none focus:border-white/40 focus:bg-white/[0.08] transition-all text-center"
                  />
                  <button
                    onClick={handleRandomName}
                    className="p-2.5 rounded-2xl bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.1] text-white/60 hover:text-white transition-all cursor-pointer shrink-0"
                    title="Generate Random Nickname"
                  >
                    🎲
                  </button>
                </div>
              </div>

              {/* Animated PFP Gallery Grid */}
              <div className="w-full">
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                    Animated & Anime Presets
                  </span>
                  <span className="text-[10px] text-white/30 font-mono">
                    {ANIME_PFP_PRESETS.length} Curated Avatars
                  </span>
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
                  {ANIME_PFP_PRESETS.map((pfp) => {
                    const isSelected = profileImage === pfp.url
                    return (
                      <button
                        key={pfp.id}
                        type="button"
                        onClick={() => setProfileImage(pfp.url)}
                        className={`group/card relative rounded-2xl overflow-hidden aspect-square border-2 transition-all duration-300 cursor-pointer shadow-md ${
                          isSelected
                            ? 'scale-105 shadow-xl'
                            : 'border-white/[0.08] opacity-75 hover:opacity-100 hover:scale-105 hover:border-white/30'
                        }`}
                        style={{
                          borderColor: isSelected ? pfp.accent : undefined,
                          boxShadow: isSelected ? `0 0 20px ${pfp.accent}60` : undefined
                        }}
                        title={`${pfp.name} (${pfp.tag})`}
                      >
                        <img src={resolvePfpUrl(pfp.url)} alt={pfp.name} className="w-full h-full object-cover" />
                        {isSelected && (
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                            <div className="w-5 h-5 rounded-full bg-white text-black flex items-center justify-center shadow-lg">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                              </svg>
                            </div>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 1: SUPERCHARGED FEATURES SHOWCASE                            */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <div className="flex-1 flex flex-col items-center justify-between gap-4 overflow-y-auto custom-scrollbar">
              <div className="text-center space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">Step 2 of 4</span>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Supercharged Features</h2>
                <p className="text-xs sm:text-sm text-white/50 max-w-md">
                  Everything you need for audiophile streaming, lossless local playback, and immersive audio effects.
                </p>
              </div>

              {/* 6 Features Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full my-auto">
                {FEATURES.map((feat, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3.5 p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-300 group"
                  >
                    <div 
                      className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md transition-transform duration-300 group-hover:scale-110"
                      style={{ backgroundColor: `${feat.color}22`, color: feat.color, border: `1px solid ${feat.color}40` }}
                    >
                      {feat.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <h4 className="text-sm font-bold text-white tracking-tight leading-snug">{feat.title}</h4>
                        <span 
                          className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md font-mono shrink-0"
                          style={{ backgroundColor: `${feat.color}20`, color: feat.color }}
                        >
                          {feat.badge}
                        </span>
                      </div>
                      <p className="text-[12px] text-white/50 leading-relaxed">{feat.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 2: THEME & AUDIO ENHANCEMENTS                                */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <div className="flex-1 flex flex-col items-center justify-between gap-4 overflow-y-auto custom-scrollbar">
              <div className="text-center space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/40">Step 3 of 4</span>
                <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Pick Your Vibe & Audio</h2>
                <p className="text-xs sm:text-sm text-white/50 max-w-md">
                  Choose your visual theme and configure default audio enhancements.
                </p>
              </div>

              {/* Theme Grid */}
              <div className="w-full space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/50 block px-1">
                  Select Visual Backdrop
                </span>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                  {THEMES.map(t => {
                    const isSelected = selectedTheme === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTheme(t.id)}
                        className={`relative rounded-2xl overflow-hidden aspect-[4/3] border-2 transition-all duration-300 cursor-pointer shadow-md group ${
                          isSelected ? 'border-white scale-[1.03] shadow-xl shadow-red-500/20' : 'border-white/[0.08] hover:border-white/20'
                        }`}
                      >
                        {t.img ? (
                          <img src={t.img} alt={t.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-purple-900/60 via-blue-900/40 to-indigo-900/60 flex items-center justify-center">
                            <span className="text-lg">✨</span>
                          </div>
                        )}
                        <div className={`absolute inset-x-0 bottom-0 py-1 text-center text-[10px] font-bold transition-colors ${
                          isSelected ? 'text-white bg-black/70' : 'text-white/60 bg-black/40'
                        }`}>
                          {t.name}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Quick Audio Enhancers & Local Folder */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {/* 8D Audio Toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <div>
                    <h5 className="text-xs font-bold text-white">3D Spatial 8D Audio</h5>
                    <p className="text-[10px] text-white/40">Smooth surround panning simulation</p>
                  </div>
                  <button
                    onClick={() => setEnable8D(!enable8D)}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${enable8D ? 'bg-red-500' : 'bg-white/15'}`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${enable8D ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                {/* Local Folder Scanner (Optional) */}
                <button
                  onClick={handlePickFolder}
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] text-left transition-all cursor-pointer group"
                >
                  <div className="min-w-0 pr-2">
                    <h5 className="text-xs font-bold text-white truncate">
                      {musicFolder ? 'Folder Linked' : 'Add Local Music (Optional)'}
                    </h5>
                    <p className="text-[10px] text-white/40 truncate">
                      {musicFolder ? `${scanCount} tracks indexed` : 'Scan device MP3 / FLAC files'}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-red-400 group-hover:underline shrink-0">
                    {musicFolder ? 'Change' : 'Browse'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════ */}
          {/* STEP 3: GRAND LAUNCH READY                                        */}
          {/* ═════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center my-auto">
              <div 
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden border-4 shadow-2xl flex items-center justify-center relative group"
                style={{ 
                  borderColor: currentAccent,
                  boxShadow: `0 0 50px ${currentAccent}70` 
                }}
              >
                <img 
                  src={resolvePfpUrl(profileImage || getRandomAnimePfp())} 
                  alt="" 
                  className="w-full h-full object-cover" 
                />
              </div>

              <div className="space-y-1.5 max-w-sm">
                <span className="text-xs font-bold uppercase tracking-widest text-emerald-400 font-mono">
                  ● All Systems Ready
                </span>
                <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                  Welcome, {userName.trim() || 'User'}!
                </h2>
                <p className="text-xs sm:text-sm text-white/50">
                  Your Glaze Music streaming engine is primed with 100M+ songs, 3D Spatial Audio, and dynamic themes.
                </p>
              </div>

              {/* Persona Pill */}
              <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-xs text-white/60 font-medium">
                <span>🎨 {THEMES.find(t => t.id === selectedTheme)?.name || 'Theme'}</span>
                <span>•</span>
                <span>🎧 {enable8D ? '8D Audio Active' : 'Stereo Audio'}</span>
                <span>•</span>
                <span>📁 {musicFolder ? `${scanCount} Local Tracks` : 'Cloud Streaming'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation Buttons */}
        <div className="flex items-center justify-between w-full mt-4 px-2 shrink-0">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            className={`px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all cursor-pointer ${
              step === 0 ? 'opacity-0 pointer-events-none' : 'text-white/40 hover:text-white hover:bg-white/10'
            }`}
          >
            ← Back
          </button>

          {step < 3 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              style={{
                backgroundColor: currentAccent,
                boxShadow: `0 8px 24px ${currentAccent}40`
              }}
              className="px-8 py-3 rounded-2xl text-sm font-bold text-white hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleFinish}
              style={{
                backgroundColor: currentAccent,
                boxShadow: `0 12px 32px ${currentAccent}60`
              }}
              className="px-10 py-3.5 rounded-2xl text-base font-black text-white hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer flex items-center gap-2"
            >
              <span>Launch Glaze Music</span>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-1">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

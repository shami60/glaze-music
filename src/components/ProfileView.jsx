import React, { useState } from 'react'
import { ANIME_PFP_PRESETS, getRandomAnimePfp, resolvePfpUrl } from '../constants/animePfps'
import FancyUsername, { AnimatedAvatar, FANCY_NAME_PRESETS, FONT_PRESETS } from './FancyUsername'

export default function ProfileView({ userProfile, onUpdateProfile, connectedServices, setConnectedServices }) {
  const [name, setName] = useState(userProfile?.userName || '')
  const [image, setImage] = useState(userProfile?.profileImage || getRandomAnimePfp())
  const [nameStyle, setNameStyle] = useState(userProfile?.nameStyle || 'aurora')
  const [nameFont, setNameFont] = useState(userProfile?.nameFont || 'default')
  const [avatarError, setAvatarError] = useState(null)
  const [isImporting, setIsImporting] = useState(false)
  
  // Custom Color / Gradient
  const [customMode, setCustomMode] = useState(userProfile?.customMode || 'gradient')
  const [customGradient, setCustomGradient] = useState(userProfile?.customGradient || {
    from: '#ff007f',
    via: '#7928ca',
    to: '#00dfd8',
    angle: 135
  })
  const [customColor, setCustomColor] = useState(userProfile?.customColor || '#ec4899')

  const [saved, setSaved] = useState(false)
  const [youtubeProfile, setYoutubeProfile] = useState(null)

  // Fetch the connected YouTube Music account (the only streaming service the
  // app links to now — Spotify was removed because its cookie-based auth kept
  // breaking without warning).
  React.useEffect(() => {
    let active = true
    if (connectedServices?.youtubeMusic && window.electronAPI?.youtubeGetUserProfile) {
      window.electronAPI.youtubeGetUserProfile().then(res => {
        if (!active) return
        if (res?.connected) {
          setYoutubeProfile(res)
        } else {
          setConnectedServices?.(s => ({ ...s, youtubeMusic: false }))
          setYoutubeProfile(null)
        }
      }).catch(() => {})
    } else {
      setYoutubeProfile(null)
    }
    return () => { active = false }
  }, [connectedServices?.youtubeMusic])


  const [ytAuthPending, setYtAuthPending] = useState(false)

  async function handleYouTubeAuth() {
    if (connectedServices?.youtubeMusic) {
      setYtAuthPending(true)
      try {
        await window.electronAPI?.youtubeDisconnect?.()
      } catch (e) {
        console.error('Failed to disconnect YouTube Music:', e)
      }
      setYtAuthPending(false)
      setConnectedServices?.(s => ({ ...s, youtubeMusic: false }))
      setYoutubeProfile(null)
      return
    }
    if (!window.electronAPI?.authYouTube) return

    setYtAuthPending(true)
    try {
      const res = await window.electronAPI.authYouTube()
      if (res?.success) {
        setConnectedServices?.(s => ({ ...s, youtubeMusic: true }))
        const prof = await window.electronAPI.youtubeGetUserProfile?.()
        if (prof?.connected) setYoutubeProfile(prof)
      }
    } catch (e) {
      console.error('YouTube sign-in failed:', e)
    } finally {
      setYtAuthPending(false)
    }
  }

  async function handleChangeImage() {
    if (!window.electronAPI?.openImageDialog) return
    setAvatarError(null)
    setIsImporting(true)
    try {
      const result = await window.electronAPI.openImageDialog()
      if (!result || result.canceled) return
      if (result.error) {
        setAvatarError(result.error)
        return
      }
      // `url` is an avatar:// reference into <userData>/avatars, so the GIF is
      // never inlined into preferences.json and keeps animating.
      const url = typeof result === 'string' ? result : result.url
      if (!url) {
        setAvatarError('That file could not be read.')
        return
      }
      setImage(url)
      setSaved(false)
    } catch (e) {
      setAvatarError(e?.message || 'Upload failed.')
    } finally {
      setIsImporting(false)
    }
  }

  function handleSave() {
    const updated = {
      ...(userProfile || {}),
      userName: name.trim() || 'User',
      profileImage: image,
      nameStyle,
      nameFont,
      // Older builds stored a ring choice; the UI is gone, so profiles are
      // normalised to "no ring" on every save.
      avatarRing: 'none',
      customMode,
      customGradient,
      customColor
    }
    onUpdateProfile(updated)
    setSaved(true)
    // Drop avatar files the user has replaced — they can be several MB each.
    window.electronAPI?.pruneAvatars?.(image).catch(() => {})
    setTimeout(() => setSaved(false), 2500)
  }

  // Active preview object
  const previewProfile = {
    userName: name.trim() || 'Your Name',
    profileImage: image,
    nameStyle,
    nameFont,
    customMode,
    customGradient,
    customColor
  }

  const hasChanges = 
    name.trim() !== (userProfile?.userName || '') ||
    image !== (userProfile?.profileImage || null) ||
    nameStyle !== (userProfile?.nameStyle || 'aurora') ||
    nameFont !== (userProfile?.nameFont || 'default') ||
    customColor !== (userProfile?.customColor || '#ec4899') ||
    JSON.stringify(customGradient) !== JSON.stringify(userProfile?.customGradient || {})

  return (
    <div className="h-full w-full overflow-y-auto px-4 md:px-12 pt-3 pb-24 text-white custom-scrollbar relative z-10 select-none">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* ── 1. Minimal Header Bar ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-black tracking-tight text-white">Profile & Identity</h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-bold uppercase tracking-wider">
              Studio
            </span>
          </div>

          <button
            onClick={handleSave}
            disabled={!hasChanges && !saved}
            className={`px-6 py-2 rounded-full text-xs font-bold transition-all duration-300 shadow-lg cursor-pointer active:scale-95 flex items-center gap-2 ${
              saved
                ? 'on-accent bg-emerald-500 text-white shadow-emerald-500/30 ring-2 ring-emerald-400/50'
                : hasChanges
                  ? 'on-accent bg-red-500 hover:bg-red-600 text-white shadow-red-500/25 ring-2 ring-red-500/30'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
          >
            {saved ? (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                <span>Saved</span>
              </>
            ) : (
              <span>Save Changes</span>
            )}
          </button>
        </div>

        {/* ── 2. Top Identity Hero & Color/Border Controls (Ultra Minimal) ── */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 pb-2 border-b border-white/[0.08]">
          
          {/* Avatar + Display Name & Live Preview */}
          <div className="flex items-center gap-4 min-w-0">
            <div 
              className="relative group/avatar cursor-pointer shrink-0" 
              onClick={handleChangeImage}
              title="Click to upload custom avatar"
            >
              <AnimatedAvatar 
                userProfile={previewProfile} 
                className="w-16 h-16 sm:w-20 sm:h-20 shadow-xl transition-transform duration-300 group-hover/avatar:scale-105"
                imgClassName="w-full h-full object-cover"
                fallbackIconSize="w-10 h-10"
              />
              <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center z-20">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                </svg>
              </div>
            </div>

            {/* Display Name Input & Rendered Live Typography */}
            <div className="space-y-1 min-w-0">
              <div className="relative flex items-center max-w-xs">
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setSaved(false) }}
                  placeholder="Enter Display Name..."
                  className="w-full px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.08] focus:bg-white/[0.12] border border-white/10 focus:border-white/30 text-white placeholder-white/30 text-base font-bold outline-none transition-all pr-8"
                />
                {name && (
                  <button
                    onClick={() => { setName(''); setSaved(false) }}
                    className="absolute right-2.5 text-white/40 hover:text-white transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  </button>
                )}
              </div>

              {/* Rendered Result */}
              <div className="flex items-center gap-2 pl-1">
                <span className="text-base font-black truncate leading-tight">
                  <FancyUsername userProfile={previewProfile} fallback="Listener" />
                </span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-semibold uppercase tracking-wider">
                  0% CPU
                </span>
              </div>
            </div>
          </div>

          {/* Right Side: Text Color Dots + Avatar Border Dots (Minimal Swatches) */}
          <div className="space-y-3 shrink-0">
            
            {/* 1. Text Color Swatches (Circular Dots like Avatar Border) */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 w-20 shrink-0">Text Color</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {FANCY_NAME_PRESETS.map((preset) => {
                  const isSelected = nameStyle === preset.id
                  return (
                    <button
                      key={preset.id}
                      onClick={() => { setNameStyle(preset.id); setSaved(false) }}
                      className={`w-6 h-6 rounded-full transition-all duration-200 cursor-pointer flex items-center justify-center relative ${
                        isSelected
                          ? 'ring-2 ring-white scale-110 shadow-lg'
                          : 'opacity-60 hover:opacity-100 hover:scale-105'
                      }`}
                      style={{
                        background: preset.gradient,
                        border: '1px solid rgba(var(--ink-rgb),0.25)'
                      }}
                      title={`Text Color: ${preset.name}`}
                    >
                      {isSelected && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white shadow" />
                      )}
                    </button>
                  )
                })}

                {/* Custom Color Dot */}
                <label
                  className={`w-6 h-6 rounded-full transition-all duration-200 cursor-pointer flex items-center justify-center relative ${
                    nameStyle === 'custom'
                      ? 'ring-2 ring-white scale-110 shadow-lg'
                      : 'opacity-60 hover:opacity-100 hover:scale-105'
                  }`}
                  style={{
                    background: customMode === 'solid' ? customColor : `linear-gradient(135deg, ${customGradient.from}, ${customGradient.via || customGradient.to})`,
                    border: '1px solid rgba(var(--ink-rgb),0.3)'
                  }}
                  title="Custom Color Picker"
                >
                  <input
                    type="color"
                    value={customColor}
                    onChange={e => {
                      setNameStyle('custom')
                      setCustomMode('solid')
                      setCustomColor(e.target.value)
                      setSaved(false)
                    }}
                    className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                  />
                  {nameStyle === 'custom' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white shadow pointer-events-none" />
                  )}
                </label>
              </div>
            </div>

            {/* 2. Typography Font Selector (Minimal Chips) */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 w-20 shrink-0">Font Style</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {FONT_PRESETS.map((f) => {
                  const isSelected = nameFont === f.id
                  return (
                    <button
                      key={f.id}
                      onClick={() => { setNameFont(f.id); setSaved(false) }}
                      className={`px-2.5 py-1 rounded-lg text-xs transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? 'bg-white/20 text-white font-bold ring-1 ring-white/30'
                          : 'text-white/50 hover:text-white hover:bg-white/[0.05]'
                      }`}
                      style={f.style}
                    >
                      {f.name}
                    </button>
                  )
                })}
              </div>
            </div>

          </div>

        </div>

        {/* ── 3. Avatar Pictures (Curated GIF/WebP Presets Grid) ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Avatar Picture Presets</h3>
              <p className="text-[10px] text-white/40">Pick an animated preset, or upload your own GIF / WebP / PNG (up to 25 MB)</p>
            </div>

            <button
              onClick={handleChangeImage}
              disabled={isImporting}
              className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] font-bold text-white transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 disabled:opacity-50 disabled:cursor-wait shrink-0"
            >
              {isImporting ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  <span>Importing…</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                  <span>Upload GIF</span>
                </>
              )}
            </button>
          </div>

          {avatarError && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
              <svg className="w-4 h-4 shrink-0 mt-px" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/></svg>
              <span className="flex-1">{avatarError}</span>
              <button onClick={() => setAvatarError(null)} className="text-red-300/60 hover:text-red-200 shrink-0">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
          )}

          {/* Clean 8-Column Responsive Grid */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2.5">
            {/* The user's own upload, shown as a selected tile so it is obvious
                that the GIF they picked actually took effect. */}
            {image && !ANIME_PFP_PRESETS.some(p => image === p.url || image === p.legacyPath || resolvePfpUrl(image) === resolvePfpUrl(p.url)) && (
              <div className="p-1 rounded-2xl border border-white bg-white/20 ring-2 ring-white/40 shadow-lg scale-105 text-center group relative overflow-hidden">
                <div className="w-full aspect-square rounded-xl overflow-hidden relative shadow-sm">
                  <img src={resolvePfpUrl(image)} alt="Your upload" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                    </svg>
                  </div>
                </div>
                <p className="text-[10px] font-bold text-white truncate mt-1">Your upload</p>
              </div>
            )}
            {ANIME_PFP_PRESETS.map((pfp) => {
              const isSelected = image === pfp.url || image === pfp.legacyPath || resolvePfpUrl(image) === resolvePfpUrl(pfp.url)
              return (
                <button
                  key={pfp.id}
                  onClick={() => { setImage(pfp.url); setSaved(false) }}
                  className={`p-1 rounded-2xl border text-center transition-all duration-200 cursor-pointer group relative overflow-hidden ${
                    isSelected
                      ? 'border-white bg-white/20 ring-2 ring-white/40 shadow-lg scale-105'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/25 hover:scale-102'
                  }`}
                  title={pfp.name}
                >
                  <div className="w-full aspect-square rounded-xl overflow-hidden relative shadow-sm">
                    <img src={resolvePfpUrl(pfp.url)} alt={pfp.name} className="w-full h-full object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-white truncate mt-1">{pfp.name}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 4. Connected Account (YouTube Music) ── */}
        <div className="mt-8 pt-6 pb-6 border-t border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">Connected Account</h3>
              <p className="text-[10px] text-white/40 mt-0.5">
                Sign in once to sync your YouTube Music library, liked songs, playlists and subscribed artists
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 hover:border-white/20 transition-all shadow-sm">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shrink-0 overflow-hidden">
                {youtubeProfile?.avatar ? (
                  <img src={youtubeProfile.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate leading-tight">YouTube Music</h4>
                <p className="text-xs text-white/50 truncate mt-0.5">
                  {connectedServices?.youtubeMusic
                    ? (youtubeProfile?.name || 'Connected')
                    : 'Not connected'}
                </p>
              </div>
            </div>

            <button
              onClick={handleYouTubeAuth}
              disabled={ytAuthPending}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 active:scale-95 disabled:opacity-50 disabled:cursor-wait ${
                connectedServices?.youtubeMusic
                  // Neutral outline instead of red-on-red: `text-red-300` on a
                  // 15% red fill is ~2:1 on the light themes, so "Disconnect"
                  // was invisible. Red only appears on hover, where it belongs.
                  ? 'bg-white/[0.06] hover:bg-red-500/15 text-white/70 hover:text-red-400 border border-white/15 hover:border-red-500/40'
                  : 'on-accent bg-red-600 hover:bg-red-500 text-white shadow-md hover:scale-105'
              }`}
            >
              {ytAuthPending
                ? (connectedServices?.youtubeMusic ? 'Disconnecting…' : 'Connecting…')
                : connectedServices?.youtubeMusic ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

import React from 'react'
import { resolvePfpUrl } from '../constants/animePfps'

/**
 * Curated Preset Styles for Static Fancy Text
 */
export const FANCY_NAME_PRESETS = [
  {
    id: 'default',
    name: 'Classic White',
    tag: 'Minimal',
    gradient: 'linear-gradient(135deg, #ffffff 0%, #d4d4d8 100%)',
    color: '#ffffff'
  },
  {
    id: 'aurora',
    name: 'Aurora Borealis',
    tag: 'Cyan & Emerald',
    gradient: 'linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)',
    color: '#06b6d4'
  },
  {
    id: 'cyber_neon',
    name: 'Cyberpunk Neon',
    tag: 'Pink & Cyan',
    gradient: 'linear-gradient(135deg, #ff007f 0%, #c084fc 50%, #00f2fe 100%)',
    color: '#ff007f'
  },
  {
    id: 'sunset_gold',
    name: 'Sunset Gold',
    tag: 'Amber & Flame',
    gradient: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #ef4444 100%)',
    color: '#f59e0b'
  },
  {
    id: 'cosmic_purple',
    name: 'Cosmic Nebula',
    tag: 'Violet & Magenta',
    gradient: 'linear-gradient(135deg, #818cf8 0%, #c084fc 50%, #f472b6 100%)',
    color: '#a855f7'
  },
  {
    id: 'holographic',
    name: 'Holographic Prism',
    tag: 'Rainbow Shimmer',
    gradient: 'linear-gradient(135deg, #ff007f 0%, #7928ca 25%, #0070f3 50%, #00dfd8 75%, #ff007f 100%)',
    color: '#00dfd8'
  },
  {
    id: 'ruby_fire',
    name: 'Ruby Flare',
    tag: 'Crimson & Coral',
    gradient: 'linear-gradient(135deg, #e11d48 0%, #fb7185 50%, #fda4af 100%)',
    color: '#e11d48'
  },
  {
    id: 'emerald_matrix',
    name: 'Emerald Matrix',
    tag: 'Cyber Green',
    gradient: 'linear-gradient(135deg, #a3e635 0%, #22c55e 50%, #10b981 100%)',
    color: '#22c55e'
  },
  {
    id: 'pure_frost',
    name: 'Glacial Frost',
    tag: 'Ice Blue & Silver',
    gradient: 'linear-gradient(135deg, #ffffff 0%, #bae6fd 50%, #7dd3fc 100%)',
    color: '#7dd3fc'
  },
  {
    id: 'midnight_electric',
    name: 'Midnight Electric',
    tag: 'Sapphire & Indigo',
    gradient: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 50%, #a855f7 100%)',
    color: '#6366f1'
  }
]

/**
 * Font Typography Presets
 */
export const FONT_PRESETS = [
  { id: 'default', name: 'Modern', label: 'Inter', style: { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 700 } },
  { id: 'cyber', name: 'Cyber', label: 'Orbitron', style: { fontFamily: "'Space Grotesk', 'Orbitron', 'JetBrains Mono', monospace", fontWeight: 800, letterSpacing: '0.04em' } },
  { id: 'display', name: 'Impact', label: 'Syne', style: { fontFamily: "'Syne', 'Outfit', 'Montserrat', sans-serif", fontWeight: 900, letterSpacing: '-0.02em' } },
  { id: 'serif', name: 'Regal', label: 'Cinzel', style: { fontFamily: "'Cinzel', 'Playfair Display', Georgia, serif", fontWeight: 700, letterSpacing: '0.03em' } },
  { id: 'script', name: 'Script', label: 'Cursive', style: { fontFamily: "'Dancing Script', 'Caveat', cursive", fontWeight: 700, fontSize: '1.1em' } }
]

/**
 * Static Avatar Border Presets — kept only so profiles saved by older builds
 * still render. The border-ring customisation UI is gone; the avatar is always
 * drawn with a plain neutral edge.
 */
export const AVATAR_RING_PRESETS = [
  { id: 'none', name: 'None', color: 'rgba(var(--ink-rgb),0.2)', className: 'border border-white/15' },
  { id: 'white', name: 'White', color: '#ffffff', className: 'ring-2 ring-white border border-white/20' },
  { id: 'cyan', name: 'Cyan', color: '#22d3ee', className: 'ring-2 ring-cyan-400 border border-cyan-500/30' },
  { id: 'purple', name: 'Purple', color: '#a855f7', className: 'ring-2 ring-purple-500 border border-purple-500/30' },
  { id: 'emerald', name: 'Emerald', color: '#34d399', className: 'ring-2 ring-emerald-400 border border-emerald-500/30' },
  { id: 'gold', name: 'Gold', color: '#fbbf24', className: 'ring-2 ring-amber-400 border border-amber-500/30' },
  { id: 'rose', name: 'Rose', color: '#f43f5e', className: 'ring-2 ring-rose-500 border border-rose-500/30' }
]

/**
 * Helper to compute the inline style for fancy username
 */
export function getFancyNameStyle(userProfile) {
  if (!userProfile) return {}

  const styleMode = userProfile.nameStyle || 'aurora'
  const fontId = userProfile.nameFont || 'default'
  const fontObj = FONT_PRESETS.find(f => f.id === fontId) || FONT_PRESETS[0]

  let backgroundGradient = 'linear-gradient(135deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)'

  if (styleMode === 'custom') {
    if (userProfile.customGradient?.from && userProfile.customGradient?.to) {
      const angle = userProfile.customGradient.angle || 135
      const via = userProfile.customGradient.via ? `, ${userProfile.customGradient.via} 50%` : ''
      backgroundGradient = `linear-gradient(${angle}deg, ${userProfile.customGradient.from} 0%${via}, ${userProfile.customGradient.to} 100%)`
    } else if (userProfile.customColor) {
      backgroundGradient = `linear-gradient(135deg, ${userProfile.customColor} 0%, ${userProfile.customColor} 100%)`
    }
  } else {
    const preset = FANCY_NAME_PRESETS.find(p => p.id === styleMode) || FANCY_NAME_PRESETS[1]
    backgroundGradient = preset.gradient
  }

  return {
    backgroundImage: backgroundGradient,
    ...fontObj.style
  }
}

/**
 * FancyUsername Component — Pure, crisp, zero-resource static gradient username
 */
export default function FancyUsername({ userProfile, fallback = 'User', className = '', style = {} }) {
  const name = userProfile?.userName?.trim() || userProfile?.name?.trim() || fallback
  const fancyStyle = getFancyNameStyle(userProfile)

  return (
    <span 
      className={`fancy-text-base ${className}`}
      style={{ ...fancyStyle, ...style }}
    >
      {name}
    </span>
  )
}

/**
 * AnimatedAvatar Component — Renders the user avatar in a plain circular frame.
 * Animated GIF/WebP avatars animate on their own; the old ring customisation is
 * gone, so nothing here depends on `avatarRing` any more.
 */
export function AnimatedAvatar({ userProfile, className = 'w-10 h-10', imgClassName = 'w-full h-full object-cover', fallbackIconSize = 'w-5 h-5' }) {
  const pfpUrl = resolvePfpUrl(userProfile?.profileImage)

  return (
    <div className={`relative rounded-full shrink-0 flex items-center justify-center border border-white/15 ${className}`}>
      <div className="w-full h-full rounded-full overflow-hidden relative z-10 bg-[var(--surface-1)]">
        {pfpUrl ? (
          <img 
            src={pfpUrl} 
            alt="Profile" 
            className={`optimized-pfp ${imgClassName}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/40 bg-white/5">
            <svg className={fallbackIconSize} fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

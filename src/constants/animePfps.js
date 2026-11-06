/**
 * animePfps.js — Default Anime & Animated Profile Pictures
 */

import cyberPurpleGif from '../assets/ani_pfp/2040-purple.gif'
import chipiCatGif from '../assets/ani_pfp/3372-chipi-cat.gif'
import raccoonWaveWebp from '../assets/ani_pfp/raccoon-wave.webp'
import ravenCloakWebp from '../assets/ani_pfp/raven-cloak.webp'
import twinSwingsWebp from '../assets/ani_pfp/twin-swings.webp'

export const ANIME_PFP_PRESETS = [
  {
    id: 'cyber_purple',
    name: 'Cyberpunk Neon',
    tag: 'Animated GIF',
    url: cyberPurpleGif,
    legacyPath: '/ani_pfp/2040-purple.gif',
    accent: '#a855f7'
  },
  {
    id: 'chipi_cat',
    name: 'Chipi Chipi Cat',
    tag: 'Meme Animated',
    url: chipiCatGif,
    legacyPath: '/ani_pfp/3372-chipi-cat.gif',
    accent: '#f59e0b'
  },
  {
    id: 'raccoon_wave',
    name: 'Lo-Fi Raccoon',
    tag: 'Animated WebP',
    url: raccoonWaveWebp,
    legacyPath: '/ani_pfp/raccoon-wave.webp',
    accent: '#3b82f6'
  },
  {
    id: 'raven_cloak',
    name: 'Midnight Raven',
    tag: 'Anime Dark',
    url: ravenCloakWebp,
    legacyPath: '/ani_pfp/raven-cloak.webp',
    accent: '#ef4444'
  },
  {
    id: 'twin_swings',
    name: 'Twin Swings',
    tag: 'Lo-Fi Vibe',
    url: twinSwingsWebp,
    legacyPath: '/ani_pfp/twin-swings.webp',
    accent: '#10b981'
  },
  {
    id: 'bot_pulsar',
    name: 'Pulsar Android',
    tag: 'Synth Wave',
    url: 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=GlazeVibe&backgroundColor=6366f1,8b5cf6',
    accent: '#6366f1'
  },
  {
    id: 'aria_cyber',
    name: 'Aria Anime',
    tag: 'Anime Cyber',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=AriaCyber&backgroundColor=ec4899,f43f5e',
    accent: '#ec4899'
  },
  {
    id: 'kaito_blade',
    name: 'Kaito Blade',
    tag: 'Anime Hero',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=KaitoBlade&backgroundColor=06b6d4,3b82f6',
    accent: '#06b6d4'
  }
]

export const DEFAULT_ANIME_PFPS = ANIME_PFP_PRESETS.map(p => p.url)

export function getRandomAnimePfp() {
  const index = Math.floor(Math.random() * DEFAULT_ANIME_PFPS.length)
  return DEFAULT_ANIME_PFPS[index]
}

export function resolvePfpUrl(url) {
  if (!url) return ANIME_PFP_PRESETS[0].url
  if (typeof url !== 'string') return url
  if (url.includes('2040-purple.gif') || url.includes('cyber_purple')) return cyberPurpleGif
  if (url.includes('3372-chipi-cat.gif') || url.includes('chipi_cat')) return chipiCatGif
  if (url.includes('raccoon-wave.webp') || url.includes('raccoon_wave')) return raccoonWaveWebp
  if (url.includes('raven-cloak.webp') || url.includes('raven_cloak')) return ravenCloakWebp
  if (url.includes('twin-swings.webp') || url.includes('twin_swings')) return twinSwingsWebp
  return url
}

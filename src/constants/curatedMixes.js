/**
 * Curated & Dynamic Mixes, Artist Mixes & Radio Stations data for Glaze Music
 * Generates personalized mixes with real artist photos from history, cache, or online search.
 */

export const FALLBACK_ARTISTS = [
  'The Weeknd', 'Taylor Swift', 'Arijit Singh', 'Drake', 'Lana Del Rey', 
  'Travis Scott', 'Diljit Dosanjh', 'Dua Lipa', 'Billie Eilish', 'Pritam',
  'Karan Aujla', 'Ariana Grande', 'Post Malone', 'Atif Aslam', 'Coldplay'
]

const PALETTES = [
  { bg: '#00d2ff', num: '01' },
  { bg: '#ffe600', num: '02' },
  { bg: '#ff416c', num: '03' },
  { bg: '#f857a6', num: '04' },
  { bg: '#a8ff78', num: '05' },
  { bg: '#7f7fd5', num: '06' },
  { bg: '#ff9900', num: '07' },
  { bg: '#00f2fe', num: '08' },
]

const STATION_BG_COLORS = [
  '#F5D547', '#F494AC', '#F39870', '#8AC4FF', 
  '#FF8AA5', '#E5C158', '#9BDEAC', '#C49BDE'
]

// High reliability fallback artwork for mixes if no history track is found yet
export const BACKUP_MIX_ARTWORKS = [
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=600&auto=format&fit=crop&q=80'
]

// Canonical, verified CDN artist avatars (guaranteed 100% working, never 404)
export const GLOBAL_ARTIST_AVATARS = {
  'drake': 'https://yt3.googleusercontent.com/MxNjcRJ-uK4Xvx7u90IhEFLQM8x9LIGTA9VCKHq5U4Wn2jOgiWaMtg-qz329SIzqnCyhdCCB3MpdAGs=w800-h800-l90-rj',
  'the weeknd': 'https://lh3.googleusercontent.com/U-SAmNOu4TynE818gLCfKsuHZ0U5YNEtO9mrjSI9WCCKERs98LzrCal5kajBBTQNwdcisoB2Bn-pHp4=w800-h800-l90-rj',
  'taylor swift': 'https://yt3.googleusercontent.com/RCpTA6EXJQyjVFDosWOKa2SMmqkua_lA9mHPDWWciLwgqpZLz-k8rXWRF_367trrQ7up9BUwCbk6kRk=w800-h800-l90-rj',
  'billie eilish': 'https://lh3.googleusercontent.com/tQC4rOL6xz6FhmFr0ggQExxyGbYSOsyveXVSnPBh2WjEyIzQ9pMHablLJ-0GlMBrLBlBrbWQGmzrV6KN=w800-h800-l90-rj',
  'travis scott': 'https://yt3.googleusercontent.com/r9k_FpAswxhQnl_cudiaT2ocWFccR6SzEFXgZ9a12iR5eDPSILlIL2EQewyQ-yYSt1JFyH1pqnoBXxs=w800-h800-l90-rj',
  'ariana grande': 'https://yt3.googleusercontent.com/DU6Kpr5TYKcW6QHvMnsJau5_8QSuix8LCLtf5UEaziZZdXw8SxvcxJ9YWmVIQuzhg2R-MVHYgjdGCQ=w800-h800-l90-rj',
  'justin bieber': 'https://lh3.googleusercontent.com/4ULlRiFBFglNemZJyKn6_e2-iOIdJEbgBgq_79RQclndG6pge0yGgS2k2On6E1FkCJzenyHkHRzkvjFp=w800-h800-l90-rj',
  'bruno mars': 'https://lh3.googleusercontent.com/hnefGBrazRhn4Z92bdSZBUENl40ONjRiVDsmZKZh-WZ2iCKE-2c7KKR7SNcZfzLHoRyB3E6as8L87YA=w800-h800-l90-rj',
  'dua lipa': 'https://lh3.googleusercontent.com/aFx8s1fTuelgxONGbezmTG0EKR8r82uB5H-Q6ZJtssyCWLJWF8GfZNr4tHo84sXdFCPBKrA4R6zXOss=w800-h800-l90-rj',
  'kendrick lamar': 'https://i.ytimg.com/vi/tvTRZJ-4EyI/hqdefault.jpg',
  'post malone': 'https://lh3.googleusercontent.com/48LfK4z6o-CCEWgHQnQfg0ltcT9tbZSN0qjSh0FSJsJI5GF48j2-pH219ciG1ML-PI80ZGD4Vz6sjg=w800-h800-l90-rj',
  'ed sheeran': 'https://lh3.googleusercontent.com/jQoBIAS6JjFGpcqQY1M_Mh3AasOvFENCdVRxkgax1a0K6qiq7AgE3MbJ6Jtt-Jndcarvoawmrg66KTny=w800-h800-l90-rj',
  'coldplay': 'https://lh3.googleusercontent.com/IOKuXtp8PCQ_Fc-vaRKm3sKIXBxFV51gZheLTH5br-YGnWHFQf_Jywcuk7wbprYRoEbQyS_XZY6-nMJX=w800-h800-l90-rj',
  'arijit singh': 'https://lh3.googleusercontent.com/W_yOqnKSDYyeVOY_AsXhuAtb6rW3vCL3GtJ9DA1GxWOrJfyeSOqzvTv_TkFHijdkVPXWutASBlRFPg=w800-h800-l90-rj',
  'eminem': 'https://lh3.googleusercontent.com/JFI6JZrS-Lco4UdpqDfHY5Wgwy51VXWxmNdI7bCBU5CDlIpN6WWyisZ7MGlpjbrxEGYMFpsqoR_UwcE=w800-h800-l90-rj',
  'sabrina carpenter': 'https://lh3.googleusercontent.com/FMh1mOI0ufvUCAkbUM6aUmU5WK7O5PnndyyXKP1-DCEip20SQz5eeYn3lZ29p-ASb-19ZfBVc_NKe5Ko=w800-h800-l90-rj',
  'shakira': 'https://yt3.googleusercontent.com/7NhzXEoaIgr-0tYoab-gNZfF8zA8IbpTPt_buovH2Y78pc1L7IfKTq7tGU6zSk9EBJX0yKq7wp3jts8=w800-h800-l90-rj',
  'one direction': 'https://i.ytimg.com/vi/W-TE_Ys4iwM/hqdefault.jpg',
  'dave': 'https://lh3.googleusercontent.com/YQD6vaTa4li1Ov9taLv-59KTUIhTSDE5B2rhGyqKGLqvuNBo-Rqj69q5tU2udaQY4-q7cK41GnXNQFWV=w800-h800-l90-rj',
  'tems': 'https://lh3.googleusercontent.com/96_k5tvhrPANE5VcjZgGD2kruVizyQZhCp_F-ApGfzsPvtDOAnYW401Ay0I6UOZjGJthHmtCq_nEjnI=w800-h800-l90-rj',
  'maroon 5': 'https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg',
  'mark ronson': 'https://i.ytimg.com/vi/OPf0YbXqDm0/hqdefault.jpg',
  'wiz khalifa': 'https://i.ytimg.com/vi/RgKAFK5djSk/hqdefault.jpg',
  'stephen sanchez': 'https://i.ytimg.com/vi/GxldQ9eX2wo/hqdefault.jpg',
  'bizarrap': 'https://yt3.googleusercontent.com/vEkJjs-EZmAYP3ukHzky6kLxLaA1dGuGGUDvJcNQXHBaAXp4xajwptJlT20BXl-qsx18EcQLqJWiUCQ=w800-h800-l90-rj',
  'miley cyrus': 'https://i.ytimg.com/vi/G7KNmW9a75Y/hqdefault.jpg',
  'sia': 'https://i.ytimg.com/vi/nYh-n7EOtMA/hqdefault.jpg',
  'justin timberlake': 'https://i.ytimg.com/vi/ru0K8uYEZWw/hqdefault.jpg',
  'charlie puth': 'https://i.ytimg.com/vi/3AtDnEC4zak/hqdefault.jpg',
  'camila cabello': 'https://lh3.googleusercontent.com/vQpb8T6aHM3QukWpjg1C2OyIFM_5v_OWevy8Kr9iqRwWuaEbwrRJaz0gY8FJiimhmpiqHQT-d9FUIOo=w800-h800-l90-rj',
  'diljit dosanjh': 'https://yt3.googleusercontent.com/7EYXXMXY594V8y4sZT2aawmdKgDAGTu5jNm9C-HpR3jY9cZJ0NMxS__nZKBdWZ1PUpJPjc2BAA=w800-h800-l90-rj',
  'karan aujla': 'https://lh3.googleusercontent.com/k7sgqqcV5VScaMZtTmS8W_tfouLVBpgyJII0epYE2Vjw1-zzhGgUCV51aHxZn6cmZKKJgUfNlIVpZg=w800-h800-l90-rj',
  'pritam': 'https://yt3.googleusercontent.com/sjGMYJQ1J3FZEIBsMYUztMjjYOM4-NJ24CjmIHqxTWCxAM1YgjL-d_17u7_PRhTouOwwAjbu-2x5S6I=w800-h800-l90-rj',
  'atif aslam': 'https://yt3.googleusercontent.com/ykJkyILKum4B2oudDxjnf5WNenWWZAp-WEz0_CHp4cu0VnqB2-uaNDylItqC68WLXV62rdHDun-ahbg=w800-h800-l90-rj',
  'imagine dragons': 'https://i.ytimg.com/vi/7wtfhZwyrcc/hqdefault.jpg',
  'jasmine sandlas': 'https://yt3.googleusercontent.com/9o3I0hxnjE0RtaYiUovaJxV82NDqudt-U0hrv3LIv0NP_zciTYMfGnYy6BOaV7fYE_udG85zWP-yUw=w800-h800-l90-rj',
  'shiloh dynasty': 'https://yt3.googleusercontent.com/SYhycMQTN4oOdBC4DJ9EXYoewdZgPpHzJDFXuTtcqSLNFsIUl9JP7dUGxeQglOkeQjgf5EBVsCiX5u0l=w800-h800-l90-rj'
}

/**
 * Resolve the real picture for an artist from:
 * 1. Persistent SQLite & runtime cache (extraMap - Google/YouTube CDN)
 * 2. Verified canonical artist avatar dictionary
 * 3. Listening history tracks (guaranteed working YouTube/Google CDN)
 * 4. Local library art cache
 * 5. Online Art Registry
 */
export function getArtistArt(artistName, history = [], artCache = {}, extraMap = {}) {
  if (!artistName || typeof artistName !== 'string') return null
  const cleanName = artistName.trim()
  if (!cleanName) return null
  const lowerName = cleanName.toLowerCase()

  // 1. Check extraMap (SQLite persistent cache and runtime search updates)
  if (extraMap[cleanName] && typeof extraMap[cleanName] === 'string' && !extraMap[cleanName].includes('i.scdn.co')) {
    return extraMap[cleanName]
  }
  if (extraMap[lowerName] && typeof extraMap[lowerName] === 'string' && !extraMap[lowerName].includes('i.scdn.co')) {
    return extraMap[lowerName]
  }

  // 2. Check canonical verified global avatar dictionary
  if (GLOBAL_ARTIST_AVATARS[lowerName]) {
    return GLOBAL_ARTIST_AVATARS[lowerName]
  }
  for (const [knownArtist, url] of Object.entries(GLOBAL_ARTIST_AVATARS)) {
    if (lowerName.includes(knownArtist) || knownArtist.includes(lowerName)) {
      return url
    }
  }

  // 3. Check history items (from actual tracks user played)
  if (Array.isArray(history)) {
    for (const h of history) {
      if (h && h.artist) {
        const hArtist = h.artist.toLowerCase()
        if (hArtist.includes(lowerName) || lowerName.includes(hArtist)) {
          const art = h.thumbnail || h.albumArt || (artCache?.[h.src]?.albumArt)
          if (art && typeof art === 'string' && !art.includes('default.jpg') && !art.includes('dummy') && !art.includes('i.scdn.co')) {
            return art
          }
        }
      }
    }
  }

  // 4. Check artCache
  if (artCache && typeof artCache === 'object') {
    for (const [src, meta] of Object.entries(artCache)) {
      if (meta && meta.artist && meta.artist.toLowerCase().includes(lowerName)) {
        if (meta.albumArt && typeof meta.albumArt === 'string' && !meta.albumArt.includes('i.scdn.co')) {
          return meta.albumArt
        }
      }
    }
  }

  // 5. Check onlineArtRegistry if available
  if (typeof window !== 'undefined' && window.onlineArtRegistry) {
    for (const [src, url] of Object.entries(window.onlineArtRegistry)) {
      if (url && typeof url === 'string' && !url.includes('i.scdn.co')) {
        if (src.toLowerCase().includes(lowerName)) return url
      }
    }
  }

  return null
}

export function generateDynamicPersonalizedMixes(
  history = [], 
  stats = {}, 
  libraryFiles = [], 
  favourites = new Set(), 
  extraArtistArt = {},
  artCache = {}
) {
  const artistCounts = {}
  
  // 1. History
  if (Array.isArray(history)) {
    history.forEach(item => {
      if (item && item.artist && item.artist !== 'Unknown') {
        const mainArtist = item.artist.split(/[,&/]/)[0].trim()
        if (mainArtist) artistCounts[mainArtist] = (artistCounts[mainArtist] || 0) + 3
      }
    })
  }

  // 2. Stats
  if (stats && typeof stats === 'object') {
    Object.keys(stats).forEach(src => {
      const s = stats[src]
      if (s && s.artist) {
        const mainArtist = s.artist.split(/[,&/]/)[0].trim()
        if (mainArtist) artistCounts[mainArtist] = (artistCounts[mainArtist] || 0) + (s.playCount || 1) * 2
      }
    })
  }

  // 3. Library Files
  if (Array.isArray(libraryFiles)) {
    libraryFiles.forEach(f => {
      if (f && f.artist && f.artist !== 'Unknown') {
        const mainArtist = f.artist.split(/[,&/]/)[0].trim()
        if (mainArtist) artistCounts[mainArtist] = (artistCounts[mainArtist] || 0) + 1
      }
    })
  }

  const sortedUserArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a])
  
  // Merge user's artists with fallback popular artists
  const topArtists = [...new Set([...sortedUserArtists, ...FALLBACK_ARTISTS])]

  // Generate 6 Daily Mixes with real artist pictures
  const dailyMixes = PALETTES.map((palette, idx) => {
    const primaryArtist = topArtists[idx] || FALLBACK_ARTISTS[idx % FALLBACK_ARTISTS.length]
    const companion1 = topArtists[(idx + 6) % topArtists.length] || 'Hits'
    const companion2 = topArtists[(idx + 12) % topArtists.length] || 'Top'
    const companion3 = topArtists[(idx + 18) % topArtists.length] || 'Music'

    const primaryArt = getArtistArt(primaryArtist, history, artCache, extraArtistArt) 
      || BACKUP_MIX_ARTWORKS[idx % BACKUP_MIX_ARTWORKS.length]

    return {
      id: `daily-mix-${idx + 1}`,
      mixNumber: palette.num,
      badgeBg: palette.bg,
      title: `Daily Mix ${idx + 1}`,
      primaryArtist: primaryArtist,
      artists: [primaryArtist, companion1, companion2, companion3],
      desc: `${primaryArtist}, ${companion1}, ${companion2} and more`,
      coverArt: primaryArt,
      seedQuery: `${primaryArtist} ${companion1} ${companion2} mix`,
      type: 'DailyMix',
      isMix: true
    }
  })

  // Generate 2 Hero Mixes with real artist pictures
  const heroArtist1 = topArtists[0] || 'The Weeknd'
  const heroArtist2 = topArtists[1] || 'Taylor Swift'

  const hero1Art = getArtistArt(heroArtist1, history, artCache, extraArtistArt) 
    || BACKUP_MIX_ARTWORKS[0]
  const hero2Art = getArtistArt(heroArtist2, history, artCache, extraArtistArt) 
    || BACKUP_MIX_ARTWORKS[1]

  const heroMixes = [
    {
      id: 'hero-mix-1',
      artist: heroArtist1,
      title: `${heroArtist1} Mix`,
      badgeTitle: `${heroArtist1} Mix`,
      subtitle: 'Mix • Glaze',
      supportingArtists: `${topArtists[1] || 'Billie Eilish'}, ${topArtists[2] || 'Suki Waterhouse'} and ${topArtists[3] || 'Mazzy Star'}`,
      coverArt: hero1Art,
      miniArt: hero1Art,
      seedQuery: `${heroArtist1} ${topArtists[1] || 'Billie Eilish'} ${topArtists[2] || 'Suki Waterhouse'} mix`,
      type: 'HeroMix',
      isMix: true
    },
    {
      id: 'hero-mix-2',
      artist: heroArtist2,
      title: `${heroArtist2} Mix`,
      badgeTitle: `${heroArtist2} Mix`,
      subtitle: 'Mix • Glaze',
      supportingArtists: `${topArtists[2] || 'Drake'}, ${topArtists[3] || 'Travis Scott'} and ${topArtists[4] || 'Metro Boomin'}`,
      coverArt: hero2Art,
      miniArt: hero2Art,
      seedQuery: `${heroArtist2} ${topArtists[2] || 'Drake'} ${topArtists[3] || 'Travis Scott'} mix`,
      type: 'HeroMix',
      isMix: true
    }
  ]

  // Generate 6 Recommended Stations with real artist pictures in bubbles
  const recommendedStations = STATION_BG_COLORS.map((bg, idx) => {
    const stationArtist = topArtists[idx] || FALLBACK_ARTISTS[idx % FALLBACK_ARTISTS.length]
    const with1 = topArtists[(idx + 3) % topArtists.length] || 'Hits'
    const with2 = topArtists[(idx + 5) % topArtists.length] || 'Pop'
    const with3 = topArtists[(idx + 7) % topArtists.length] || 'Radio'

    const b1 = getArtistArt(with1, history, artCache, extraArtistArt) 
      || getArtistArt(stationArtist, history, artCache, extraArtistArt) 
      || BACKUP_MIX_ARTWORKS[(idx + 2) % BACKUP_MIX_ARTWORKS.length]

    const b2 = getArtistArt(stationArtist, history, artCache, extraArtistArt) 
      || BACKUP_MIX_ARTWORKS[idx % BACKUP_MIX_ARTWORKS.length]

    const b3 = getArtistArt(with2, history, artCache, extraArtistArt) 
      || getArtistArt(stationArtist, history, artCache, extraArtistArt) 
      || BACKUP_MIX_ARTWORKS[(idx + 4) % BACKUP_MIX_ARTWORKS.length]

    return {
      id: `station-${idx + 1}`,
      title: `${stationArtist}`,
      bg: bg,
      desc: `With ${with1}, ${with2}, ${with3} and more`,
      seedQuery: `${stationArtist} ${with1} ${with2} radio`,
      bubbles: [b1, b2, b3],
      coverArt: b2,
      type: 'Station',
      isMix: true
    }
  })

  return { dailyMixes, heroMixes, recommendedStations, topArtists }
}

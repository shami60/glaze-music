/**
 * utils.js — Shared utility functions used across the Glaze Music codebase.
 *
 * Centralizes helpers that were previously copy-pasted across 8+ component files.
 */

/**
 * Build an art:// protocol URL from a local file path.
 * The art:// protocol is handled by Electron's main process to extract
 * embedded album art from audio files on demand.
 *
 * Local files always go through art://. They used to be short-circuited to a
 * YouTube thumbnail whenever the filename contained "[videoId]" — which is
 * exactly how Glaze names its own downloads. Since yt-dlp also embeds the
 * thumbnail (`--embed-thumbnail`), that shortcut meant every downloaded track
 * fetched its cover over the network on every render and showed nothing at all
 * offline, while the embedded art sat unused on disk.
 *
 * Trade-off: a track downloaded without ffmpeg has no embedded art, so it now
 * shows the placeholder glyph instead of a YouTube thumbnail. That's the
 * consistent behaviour for every other local file, and it keeps the library
 * renderable with no network at all.
 *
 * @param {string} filePath — Absolute path to an audio file (e.g. "C:\Music\song.mp3")
 * @returns {string} — art:// URL with each path segment individually encoded
 */
export function getArtURL(filePath) {
  if (!filePath) return ''

  if (window.onlineArtRegistry && window.onlineArtRegistry[filePath]) {
    return window.onlineArtRegistry[filePath]
  }

  if (filePath.startsWith('yt:')) {
    const id = filePath.slice(3)
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  }

  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:')) {
    return filePath
  }

  return `art:///${filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((seg, i) => (i === 0 && seg.endsWith(':')) ? seg : encodeURIComponent(seg))
    .join('/')}`
}

/**
 * Format a number of seconds into a human-readable mm:ss string.
 *
 * @param {number} seconds
 * @returns {string} — e.g. "3:42"
 */
export function formatTime(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00'
  const totalSec = Math.floor(seconds)
  if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60).toString().padStart(2, '0')
    const s = Math.floor(totalSec % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/**
 * Extract the filename (without extension) from a full path.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function basename(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop()
  return name.replace(/\.[^.]+$/, '')
}

export function getHighQualityArtURL(url) {
  return getSizedArtURL(url, 'large')
}

/**
 * Recover from YouTube's "missing thumbnail" response.
 *
 * When a variant does not exist — `hq720` on a low-resolution upload, for
 * example — YouTube answers **HTTP 404 with a valid 120x90 grey placeholder
 * JPEG**. The body decodes, so `<img>` fires `load` and never `error`; the
 * placeholder gets painted as if it were real cover art (a grey rounded box
 * with three white dots). `onError` cannot catch this — only the decoded size
 * gives it away.
 *
 * Wire to `onLoad`. Steps down to `hqdefault`, which YouTube generates for
 * every video.
 */
export function onArtLoad(e) {
  const img = e && e.currentTarget
  if (!img || img.dataset.artFallback) return
  const w = img.naturalWidth
  const h = img.naturalHeight
  // Anything genuinely 120px or smaller is the placeholder; real variants are
  // 320x180 (mqdefault) and up, so this cannot misfire on real artwork.
  if (!w || w > 120 || h > 120) return
  const current = img.currentSrc || img.src || ''
  const next = current.replace(/\/(hq720|maxresdefault|sddefault)\.jpg/, '/hqdefault.jpg')
  if (next === current) return
  img.dataset.artFallback = '1'
  img.src = next
}


/**
 * Thumbnail at a size that matches how it will be drawn.
 *
 * The grids render cards at ~150–200 px but were requesting `hq720.jpg`, which
 * decodes to a 1280×720 bitmap — ~3.7 MB of RGBA per image, ~40× the pixels
 * actually shown. With 400+ cards on Explore that is the single largest
 * consumer in the renderer (measured: 1.04 GB working set).
 *
 * `mqdefault` is 320×180 (~230 KB decoded) — still sharper than a 176 px card
 * needs at 1x and close at 2x. Anything drawn large (now-playing, full-screen
 * player, hero headers) should ask for `'large'`.
 *
 * @param {string} url      — any thumbnail URL, `yt:<id>`, or empty
 * @param {'thumb'|'card'|'large'} size
 */
export function getSizedArtURL(url, size = 'card') {
  const large = size === 'large'
  const thumb = size === 'thumb'
  // 320×180 vs 1280×720 for YouTube; 120 / 320 / 800 for Google-hosted images.
  const ytVariant = large ? 'hq720' : 'mqdefault'
  const googleSide = large ? 800 : thumb ? 120 : 320

  if (!url || typeof url !== 'string') return ''

  if (url.startsWith('yt:')) {
    return `https://i.ytimg.com/vi/${url.slice(3)}/${ytVariant}.jpg`
  }

  if (url.includes('i.ytimg.com') || url.includes('img.youtube.com')) {
    // Replace whichever variant is present — hqdefault, sddefault, maxresdefault…
    return url.replace(/\/(hq720|hqdefault|sddefault|mqdefault|maxresdefault|default)\.jpg/,
      `/${ytVariant}.jpg`)
  }

  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    if (url.includes('=w') || url.includes('=s')) {
      return url
        .replace(/=w\d+-h\d+[^?#]*/g, `=w${googleSide}-h${googleSide}-l90-rj`)
        .replace(/=s\d+[^?#]*/g, `=s${googleSide}`)
    }
    return `${url}=w${googleSide}-h${googleSide}-l90-rj`
  }

  // art:// (local files) and anything else: leave untouched.
  return url
}

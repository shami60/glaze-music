/**
 * pinnedPlaylists.js — playlists the user has pinned to the sidebar.
 *
 * A pin has to survive a restart and has to re-open the *same* view it came
 * from. That second part is the subtle bit: YouTube Music and Explore both render
 * `StreamingView`, but under different view ids (`yt_streaming` vs `streaming`),
 * and opening a YouTube Music playlist through the Explore id makes the sidebar
 * highlight the wrong tab. So the source is captured at pin time and replayed on
 * open, rather than guessed later.
 *
 * Kept in localStorage rather than SQLite: it is a handful of rows, it is
 * per-machine UI state, and it must be readable before the library index has
 * finished loading (the sidebar paints on the first frame).
 */

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'glaze_pinned_playlists'
const MAX_PINS = 24

let pins = read()
const listeners = new Set()

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((p) => p && typeof p.id === 'string' && p.id)
      // Repair pins saved before the art was normalised — otherwise the fix only
      // helps playlists pinned from now on.
      .map((p) => ({ ...p, art: artUrlOf({ thumbnail: p.art }) }))
  } catch {
    return []
  }
}

function commit(next) {
  pins = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked — the sidebar still reflects the in-memory list.
  }
  for (const fn of listeners) fn()
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function getSnapshot() {
  return pins
}

export function usePinnedPlaylists() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Stable identity for a playlist across the places it can be opened from. */
export function pinIdFor(item) {
  if (!item) return ''
  return String(item.browseId || item.playlistId || item.id || item.title || '')
}

export function isPinned(id) {
  return pins.some((p) => p.id === id)
}

/**
 * @param {object} item    the playlist as the view already holds it
 * @param {'yt'|'explore'|'local'} source  which view id should reopen it
 */
/**
 * Innertube gives `thumbnail` as an array of {url,width,height}, not a string, so
 * `item.thumbnail || item.art` could store an array. It is truthy, so the sidebar
 * rendered an <img> — with an empty src, because getSizedArtURL rejects
 * non-strings. Result: a broken-image glyph instead of a cover.
 */
function artUrlOf(item) {
  const raw = item?.thumbnail || item?.art || ''
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    const best = raw
      .filter((x) => x && typeof x.url === 'string' && x.url)
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0]
    return best?.url || ''
  }
  if (raw && typeof raw === 'object' && typeof raw.url === 'string') return raw.url
  return ''
}

export function pinPlaylist(item, source = 'yt') {
  const id = pinIdFor(item)
  if (!id) return false
  if (pins.some((p) => p.id === id)) return false

  const pin = {
    id,
    source,
    title: item.title || 'Playlist',
    subtitle: item.subtitle || item.author || item.artist || '',
    art: artUrlOf(item),
    // Only the fields StreamingView actually reads when reopening — the full
    // Innertube response is far too large to keep 24 copies of.
    item: {
      type: item.type || 'Playlist',
      browseId: item.browseId,
      playlistId: item.playlistId,
      videoId: item.videoId,
      title: item.title,
      subtitle: item.subtitle,
      thumbnail: item.thumbnail,
      itemCount: item.itemCount,
      service: item.service,
    },
  }

  commit([...pins, pin].slice(-MAX_PINS))
  cachePinArt(id)
  return true
}

/**
 * Playlist covers come from i.ytimg.com/pl_c/... with `sqp`/`rs` signature
 * parameters that expire — a pin saved a few days ago renders a broken image,
 * and the URL cannot be rebuilt from the playlist id (the unsigned form 404s).
 * Pinning is the one moment the URL is known to be fresh, so the bytes are
 * copied into localStorage as a data URL.
 */
async function cachePinArt(id) {
  const url = pins.find((p) => p.id === id)?.art
  if (!url || !/^https?:/i.test(url)) return
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const blob = await res.blob()
    if (blob.size > 60000) return // keep localStorage sane
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result)
      fr.onerror = reject
      fr.readAsDataURL(blob)
    })
    commit(pins.map((p) => (p.id === id ? { ...p, art: dataUrl } : p)))
  } catch {
    // Offline or blocked — the remote URL stays and may still work.
  }
}

export function unpinPlaylist(id) {
  commit(pins.filter((p) => p.id !== id))
}

/** Returns true when the playlist ended up pinned. */
export function togglePin(item, source = 'yt') {
  const id = pinIdFor(item)
  if (isPinned(id)) {
    unpinPlaylist(id)
    return false
  }
  return pinPlaylist(item, source)
}

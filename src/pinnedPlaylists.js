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
    return parsed.filter((p) => p && typeof p.id === 'string' && p.id)
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
export function pinPlaylist(item, source = 'yt') {
  const id = pinIdFor(item)
  if (!id) return false
  if (pins.some((p) => p.id === id)) return false

  const pin = {
    id,
    source,
    title: item.title || 'Playlist',
    subtitle: item.subtitle || item.author || item.artist || '',
    art: item.thumbnail || item.art || '',
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
  return true
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

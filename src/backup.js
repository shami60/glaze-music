/**
 * Backup format.
 *
 * The payload builder and the settings applier live here rather than inside
 * SettingsView so they can be exercised by `npm run test:backup`. That matters
 * more than it looks: a key that is written by the persistence effect but
 * forgotten here is dropped silently — which is exactly how the colour theme
 * (appearance / custom accent / ambience / motion) used to disappear on restore
 * while the dialog promised "your complete collection, themes included".
 *
 * Bump BACKUP_SCHEMA_VERSION only when the shape changes in a way an older
 * reader cannot handle. Adding keys is safe: readers ignore what they do not
 * know, and `applyBackupSettings` skips anything missing.
 */

export const BACKUP_APP_TAG = 'Glaze Music'
export const BACKUP_SCHEMA_VERSION = 1
export const MAX_SUPPORTED_SCHEMA_VERSION = 1

/**
 * Validate a parsed backup file and report what we can do with it.
 * Returns { ok, schemaVersion, legacy } or { ok: false, error }.
 */
export function describeBackup(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Not a valid backup file.' }
  }
  if (parsed.app !== BACKUP_APP_TAG) {
    return { ok: false, error: 'This file was not created by Glaze Music.' }
  }

  const v = parsed.schemaVersion
  if (v === undefined) {
    // Pre-versioning export. The shape is still readable — flag it so the
    // restore confirmation can say so rather than pretending nothing changed.
    return { ok: true, schemaVersion: 0, legacy: true }
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) {
    return { ok: false, error: `Unrecognised backup format version: ${String(v)}` }
  }
  if (v > MAX_SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This backup was written by a newer version of Glaze Music (format v${v}). Update the app to restore it.`
    }
  }
  return { ok: true, schemaVersion: v, legacy: false }
}

/**
 * Every preference that survives a restart and is not library data.
 *
 * Keep this in sync with the persistence effect in `PlayerContext` (the object
 * saved as `glaze_playback`) and with `buildCustomTheme`'s inputs. Volume,
 * shuffle, repeat and the queue are deliberately excluded — they describe the
 * current session, not the user's setup.
 */
export const BACKUP_SETTING_KEYS = [
  'theme',            // backdrop image id
  'localInsights',
  'is8D', 'panSpeed', 'reverbPreset', 'eqGains',
  'appearance',       // colour palette id
  'customAccent', 'customMode',
  'ambience', 'motion',
  'streamQuality', 'playbackSpeed', 'crossfade', 'isAutoplay',
]

/** Pull just the setting keys out of a flat state object. */
export function pickBackupSettings(state) {
  const out = {}
  if (!state || typeof state !== 'object') return out
  for (const key of BACKUP_SETTING_KEYS) {
    if (state[key] !== undefined) out[key] = state[key]
  }
  return out
}

/** Build the object written to a `.glaze` file. */
export function buildBackupPayload({
  appVersion = 'unknown',
  userProfile,
  playlists,
  favourites,
  streamingFavourites,
  followedArtists,
  folders,
  downloadFolder,
  customThemes,
  settings,
} = {}) {
  const pl = Array.isArray(playlists) ? playlists : []
  const fav = Array.isArray(favourites) ? favourites : []
  const streaming = Array.isArray(streamingFavourites) ? streamingFavourites : []
  const artists = Array.isArray(followedArtists) ? followedArtists : []
  const themes = Array.isArray(customThemes) ? customThemes : []

  return {
    app: BACKUP_APP_TAG,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    userProfile: userProfile || { userName: 'User' },
    playlists: pl,
    favourites: fav,
    streamingFavourites: streaming,
    followedArtists: artists,
    folders: Array.isArray(folders) ? folders : [],
    downloadFolder: downloadFolder || '',
    customThemes: themes,
    appSettings: pickBackupSettings(settings),
    statsSummary: {
      totalPlaylists: pl.length,
      totalLikedSongs: fav.length + streaming.length,
      totalFollowedArtists: artists.length,
      totalThemes: themes.length,
    },
  }
}

/**
 * Apply `backup.appSettings` through the setters the caller supplies.
 *
 * Returns the list of keys that were actually applied, so the UI can tell the
 * user what came back instead of guessing. Each value is type-checked before it
 * is handed over: a malformed file should not be able to put the player into an
 * impossible state (a string where a number belongs, an unknown theme id, ...).
 */
export function applyBackupSettings(settings, setters = {}) {
  const applied = []
  if (!settings || typeof settings !== 'object') return applied

  const run = (key, fn, valid) => {
    if (typeof fn !== 'function') return
    const value = settings[key]
    if (value === undefined || value === null) return
    if (valid && !valid(value)) return
    fn(value)
    applied.push(key)
  }

  const isStr = (v) => typeof v === 'string' && v.length > 0
  const isBool = (v) => typeof v === 'boolean'
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

  run('theme', setters.setTheme, isStr)
  run('localInsights', setters.setLocalInsights, isBool)
  run('is8D', setters.setIs8D, isBool)
  run('panSpeed', setters.setPanSpeed, isNum)
  run('reverbPreset', setters.setReverbPreset, isStr)
  run('eqGains', setters.applyEqGains, (v) => Array.isArray(v) && v.every(isNum))
  run('appearance', setters.setAppearance, isStr)
  run('customAccent', setters.setCustomAccent, isStr)
  run('customMode', setters.setCustomMode, (v) => v === 'light' || v === 'dark')
  run('ambience', setters.setAmbience, isBool)
  run('motion', setters.setMotion, isBool)
  run('streamQuality', setters.applyStreamQuality, isStr)
  run('playbackSpeed', setters.setPlaybackSpeed, isNum)
  run('crossfade', setters.setCrossfade, isNum)
  run('isAutoplay', setters.setIsAutoplay, isBool)

  return applied
}

// ── Folder relinking ─────────────────────────────────────────────────────────
// A backup stores absolute library paths, so restoring onto a machine where the
// music lives elsewhere (D:/ instead of F:/, an external disk, a new PC) leaves
// every local track pointing at a directory that does not exist. The restore
// dialog asks the user to point each missing root at its new home, and these
// helpers rewrite every stored path that sat underneath it.

/** Lowercase, forward slashes, no trailing separator — for comparison only. */
function comparablePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Rewrite `p` when it lives under one of the old roots in `remap`
 * (`{ oldRoot: newRoot }`). Longest root wins, and the match must end on a
 * separator, so relinking `F:/Criminal` never touches `F:/Criminal2`.
 */
export function remapPath(p, remap) {
  if (typeof p !== 'string' || !p || !remap) return p
  const norm = comparablePath(p)

  let best = null
  for (const [oldRoot, newRoot] of Object.entries(remap)) {
    if (!oldRoot || !newRoot) continue
    const oldNorm = comparablePath(oldRoot)
    if (!oldNorm) continue
    if (norm === oldNorm || norm.startsWith(oldNorm + '/')) {
      if (!best || oldNorm.length > best.oldNorm.length) {
        best = { oldRoot: oldRoot.replace(/[\\/]+$/, ''), oldNorm, newRoot }
      }
    }
  }
  if (!best) return p

  // Slice the *original* string so its own separators and casing survive.
  const rest = p.slice(best.oldRoot.length)
  return best.newRoot.replace(/[\\/]+$/, '') + rest
}

/**
 * Return a copy of `backup` with every stored path rewritten through `remap`.
 * `yt:<videoId>` entries and anything outside the remapped roots pass through.
 */
export function remapBackupPaths(backup, remap) {
  if (!backup || typeof backup !== 'object') return backup
  if (!remap || Object.keys(remap).length === 0) return backup

  const mapList = (list) => (Array.isArray(list) ? list.map((x) => remapPath(x, remap)) : list)

  return {
    ...backup,
    folders: mapList(backup.folders),
    downloadFolder: backup.downloadFolder ? remapPath(backup.downloadFolder, remap) : backup.downloadFolder,
    favourites: mapList(backup.favourites),
    playlists: Array.isArray(backup.playlists)
      ? backup.playlists.map((p) => {
          if (!p || typeof p !== 'object') return p
          const next = { ...p }
          if (Array.isArray(p.files)) next.files = mapList(p.files)
          if (Array.isArray(p.tracks)) next.tracks = mapList(p.tracks)
          return next
        })
      : backup.playlists,
  }
}

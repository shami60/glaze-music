// Round-trip the backup format. Run with: npm run test:backup
//
// The failure this guards against is silent: a preference that is written to the
// file but never applied on restore. That is how the colour theme, custom accent,
// ambience, motion, stream quality, playback speed and crossfade used to vanish
// while the dialog promised "your complete collection, themes included".

import assert from 'node:assert/strict'
import {
  BACKUP_APP_TAG,
  BACKUP_SCHEMA_VERSION,
  BACKUP_SETTING_KEYS,
  buildBackupPayload,
  applyBackupSettings,
  describeBackup,
  remapPath,
  remapBackupPaths,
} from '../src/backup.js'

const STATE = {
  appVersion: '1.0.4',
  userProfile: { userName: 'Shami', avatar: 'x.png' },
  playlists: [{ id: 'p1', name: 'Daily Mix 4', files: ['yt:a', 'yt:b'] }],
  favourites: ['C:/music/a.mp3'],
  streamingFavourites: [{ src: 'yt:zzz', title: 'Song' }],
  followedArtists: [{ name: 'Izzamuzzic' }],
  folders: ['F:\\Criminal'],
  downloadFolder: 'C:\\Users\\Admin\\Music\\Glaze Downloads',
  customThemes: [{ id: 'custom-1', name: 'Mine', img: 'data:image/webp;base64,AAA' }],
  settings: {
    theme: 'golden-hour',
    localInsights: true,
    is8D: false,
    panSpeed: 0.5,
    reverbPreset: 'room',
    eqGains: [2, 1, 0, -1, 0],
    appearance: 'sandstone',
    customAccent: '#e2b04a',
    customMode: 'light',
    ambience: true,
    motion: false,
    streamQuality: 'high',
    playbackSpeed: 1.25,
    crossfade: 4,
    isAutoplay: true,
  },
}

const backup = buildBackupPayload(STATE)

// ── 1. Payload shape ─────────────────────────────────────────────────────────
assert.equal(backup.app, BACKUP_APP_TAG)
assert.equal(backup.schemaVersion, BACKUP_SCHEMA_VERSION)
assert.equal(backup.playlists.length, 1)
assert.equal(backup.favourites.length, 1)
assert.equal(backup.streamingFavourites.length, 1)
assert.equal(backup.folders[0], 'F:\\Criminal')
assert.equal(backup.customThemes.length, 1)
assert.equal(backup.statsSummary.totalLikedSongs, 2)
console.log('payload shape  ✓')

// ── 2. Every persisted preference is in the file ─────────────────────────────
for (const key of BACKUP_SETTING_KEYS) {
  assert.ok(key in backup.appSettings, `appSettings is missing "${key}" — it would be lost on restore`)
  assert.deepEqual(backup.appSettings[key], STATE.settings[key], `appSettings.${key} does not match the state`)
}
console.log(`all ${BACKUP_SETTING_KEYS.length} settings present  ✓`)

// ── 3. Survives JSON (the file is written and read as text) ──────────────────
const parsed = JSON.parse(JSON.stringify(backup))
assert.deepEqual(parsed, backup)
console.log('JSON round-trip  ✓')

// ── 4. Restore applies every key, with the right value ───────────────────────
const applied = {}
const setters = {}
for (const key of BACKUP_SETTING_KEYS) {
  const setterName =
    key === 'eqGains' ? 'applyEqGains' :
    key === 'streamQuality' ? 'applyStreamQuality' :
    'set' + key.charAt(0).toUpperCase() + key.slice(1)
  setters[setterName] = (v) => { applied[key] = v }
}

const appliedKeys = applyBackupSettings(parsed.appSettings, setters)

for (const key of BACKUP_SETTING_KEYS) {
  assert.ok(appliedKeys.includes(key), `applyBackupSettings skipped "${key}"`)
  assert.deepEqual(applied[key], STATE.settings[key], `"${key}" was applied with the wrong value`)
}
console.log('restore applies all settings  ✓')

// ── 5. A malformed file cannot push bad values into the player ───────────────
const junkApplied = []
const junkSetters = {
  setTheme: (v) => junkApplied.push(['theme', v]),
  setPanSpeed: (v) => junkApplied.push(['panSpeed', v]),
  setCustomMode: (v) => junkApplied.push(['customMode', v]),
  applyEqGains: (v) => junkApplied.push(['eqGains', v]),
  setPlaybackSpeed: (v) => junkApplied.push(['playbackSpeed', v]),
}
const junkResult = applyBackupSettings(
  { theme: '', panSpeed: 'fast', customMode: 'sepia', eqGains: [1, 'x'], playbackSpeed: NaN, unknownKey: 1 },
  junkSetters,
)
assert.deepEqual(junkResult, [])
assert.deepEqual(junkApplied, [])
console.log('malformed values rejected  ✓')

// ── 6. Missing settings (an older backup) restore without throwing ───────────
assert.deepEqual(applyBackupSettings(undefined, setters), [])
assert.deepEqual(applyBackupSettings({}, setters), [])
console.log('older backups without settings  ✓')

// ── 7. Format validation ────────────────────────────────────────────────────
assert.equal(describeBackup(parsed).ok, true)
assert.equal(describeBackup({ app: BACKUP_APP_TAG }).legacy, true)     // pre-versioning
assert.equal(describeBackup({ app: 'Other App' }).ok, false)
assert.equal(describeBackup({ app: BACKUP_APP_TAG, schemaVersion: 99 }).ok, false)
assert.equal(describeBackup({ app: BACKUP_APP_TAG, schemaVersion: 0 }).ok, false)
assert.equal(describeBackup(null).ok, false)
assert.equal(describeBackup([]).ok, false)
console.log('format validation  ✓')

// ── 8. Folder relinking (restore onto a different drive) ─────────────────────
const MAP = { 'F:////Criminal': 'D:////Music////Criminal' }

assert.equal(remapPath('F:////Criminal////a.mp3', MAP), 'D:////Music////Criminal////a.mp3')
assert.equal(remapPath('F:////Criminal////sub////b.mp3', MAP), 'D:////Music////Criminal////sub////b.mp3')
assert.equal(remapPath('F:////Criminal', MAP), 'D:////Music////Criminal')
// Boundary: a sibling folder that merely shares the prefix must not be rewritten.
assert.equal(remapPath('F:////Criminal2////c.mp3', MAP), 'F:////Criminal2////c.mp3')
assert.equal(remapPath('F:////Other////d.mp3', MAP), 'F:////Other////d.mp3')
// Streaming ids and foreign schemes pass through untouched.
assert.equal(remapPath('yt:abc123', MAP), 'yt:abc123')
// Case-insensitive on the root, original casing preserved in the tail.
assert.equal(remapPath('f:////criminal////Track.MP3', MAP), 'D:////Music////Criminal////Track.MP3')
// A trailing separator on the stored root is tolerated.
assert.equal(remapPath('F:////Criminal////a.mp3', { 'F:////Criminal////': 'E:////M' }), 'E:////M////a.mp3')
// Longest root wins when one root nests inside another.
assert.equal(
  remapPath('F:////Criminal////live////x.mp3', { 'F:////Criminal': 'D:////A', 'F:////Criminal////live': 'E:////B' }),
  'E:////B////x.mp3',
)
console.log('remapPath  ✓')

const remapped = remapBackupPaths(
  {
    folders: ['F:////Criminal'],
    downloadFolder: 'F:////Criminal////Downloads',
    favourites: ['F:////Criminal////a.mp3', 'yt:keep'],
    playlists: [{ id: 'p1', files: ['F:////Criminal////a.mp3', 'yt:keep'] }],
  },
  MAP,
)
assert.deepEqual(remapped.folders, ['D:////Music////Criminal'])
assert.equal(remapped.downloadFolder, 'D:////Music////Criminal////Downloads')
assert.deepEqual(remapped.favourites, ['D:////Music////Criminal////a.mp3', 'yt:keep'])
assert.deepEqual(remapped.playlists[0].files, ['D:////Music////Criminal////a.mp3', 'yt:keep'])
// The original payload is not mutated.
assert.deepEqual(remapped.playlists[0].id, 'p1')
// No mapping = same object back, no copy churn.
assert.equal(remapBackupPaths(backup, {}), backup)
console.log('remapBackupPaths  ✓')

console.log('\nall backup assertions passed')

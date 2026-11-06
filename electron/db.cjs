const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

// Initialize DB in the user data folder
const dbPath = path.join(app.getPath('userData'), 'glaze_data.db')
const db = new Database(dbPath)

// Initialize tables
db.pragma('journal_mode = WAL') // better performance
// Wait up to 5s for a competing writer instead of throwing SQLITE_BUSY immediately.
// NORMAL is the correct durability/speed tradeoff for WAL (survives app crash,
// only risks the last transaction on an OS-level power loss).
db.pragma('busy_timeout = 5000')
db.pragma('synchronous = NORMAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    src TEXT,
    title TEXT,
    artist TEXT,
    album TEXT,
    album_art TEXT,
    duration INTEGER DEFAULT 0,
    played_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS track_stats (
    src TEXT PRIMARY KEY,
    play_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS artist_stats (
    artist TEXT PRIMARY KEY,
    play_count INTEGER DEFAULT 0
  );
`);

try {
  db.exec('ALTER TABLE history ADD COLUMN duration INTEGER DEFAULT 0;');
} catch (err) {
  // Column already exists, safe to ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS album_stats (

    album TEXT PRIMARY KEY,
    play_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS hourly_stats (
    hour INTEGER PRIMARY KEY,
    play_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    play_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS metadata_cache (
    src TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration REAL,
    album_art TEXT,
    last_scanned INTEGER
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    name TEXT,
    tracks_json TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS favourites (
    src TEXT PRIMARY KEY,
    title TEXT,
    artist TEXT,
    album_art TEXT,
    duration REAL,
    is_streaming INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS followed_artists (
    name TEXT PRIMARY KEY,
    thumbnail TEXT,
    header_image TEXT,
    subscribers TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS artist_art_cache (
    name TEXT PRIMARY KEY,
    image_url TEXT,
    updated_at INTEGER
  );

  -- The local library index. This used to live in localStorage, where a library
  -- of a few thousand tracks blew the ~5 MB quota and the write failed silently
  -- (the catch block was empty), so the index stopped persisting and the app
  -- silently re-scanned from scratch on every launch.
  CREATE TABLE IF NOT EXISTS library_files (
    path TEXT PRIMARY KEY,
    position INTEGER,
    added_at INTEGER
  );
`)

// Column migrations if DB already existed
try { db.exec(`ALTER TABLE history ADD COLUMN album_art TEXT;`) } catch (e) {}
try { db.exec(`ALTER TABLE metadata_cache ADD COLUMN album_art TEXT;`) } catch (e) {}
try { db.exec(`ALTER TABLE favourites ADD COLUMN is_streaming INTEGER DEFAULT 0;`) } catch (e) {}

// ─── Indexes ──────────────────────────────────────────────────────────────────
// getHistory() orders by played_at DESC and logPlay() joins on src — without
// these, every call sorts/scans the whole table.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_history_played_at ON history(played_at DESC);
  CREATE INDEX IF NOT EXISTS idx_history_src       ON history(src);
  CREATE INDEX IF NOT EXISTS idx_track_stats_count ON track_stats(play_count DESC);
  CREATE INDEX IF NOT EXISTS idx_artist_stats_count ON artist_stats(play_count DESC);
  CREATE INDEX IF NOT EXISTS idx_album_stats_count ON album_stats(play_count DESC);
  CREATE INDEX IF NOT EXISTS idx_metadata_scanned  ON metadata_cache(last_scanned);
  CREATE INDEX IF NOT EXISTS idx_artist_art_updated ON artist_art_cache(updated_at);
  CREATE INDEX IF NOT EXISTS idx_library_position   ON library_files(position);
`)

// ─── Retention ────────────────────────────────────────────────────────────────
// These DELETEs used to run inside every single logPlay() transaction — two full
// table scans + sorts per play. They now run on startup and on a daily timer.
const HISTORY_LIMIT = 1000
const DAILY_STATS_LIMIT = 30
const ARTIST_ART_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function pruneStaleData() {
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC LIMIT ?)`
      ).run(HISTORY_LIMIT)

      db.prepare(
        `DELETE FROM daily_stats WHERE date NOT IN (SELECT date FROM daily_stats ORDER BY date DESC LIMIT ?)`
      ).run(DAILY_STATS_LIMIT)

      // Artist art URLs from YouTube/Spotify CDNs expire — drop stale entries so
      // the renderer re-resolves them instead of showing broken images forever.
      db.prepare(`DELETE FROM artist_art_cache WHERE updated_at < ?`).run(Date.now() - ARTIST_ART_TTL_MS)
    })
    tx()
  } catch (err) {
    console.error('pruneStaleData error:', err)
  }
}

function closeDatabase() {
  try {
    // Fold the WAL back into the main DB file so nothing is left behind.
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
  } catch (err) {
    console.error('closeDatabase error:', err)
  }
}

// Clean up old corrupted yt: ID entries in track_stats that have no valid metadata
try {
  db.exec(`DELETE FROM track_stats WHERE src LIKE 'yt:%' AND src NOT IN (SELECT src FROM metadata_cache WHERE title NOT LIKE 'yt:%' AND title IS NOT NULL);`)
} catch (e) {}

// --- History API ---
function logPlay(track) {
  if (!track || !track.src) return

  let { src, title, artist, album, albumArt, art, thumbnail, duration } = track
  const finalArt = albumArt || art || thumbnail || null
  const safeDuration = (typeof duration === 'number' && !isNaN(duration)) ? Math.round(duration) : 0

  // If title is missing or raw YouTube ID, try to get cached metadata
  if (!title || title === src || title.startsWith('yt:')) {
    const cached = getCachedMetadata(src)
    if (cached && cached.title && !cached.title.startsWith('yt:')) {
      title = cached.title
      if (!artist || artist === 'Unknown Artist') artist = cached.artist
      if (!album) album = cached.album
    }
  }

  if (!artist || artist === 'Unknown Artist') {
    const cached = getCachedMetadata(src)
    if (cached && cached.artist && cached.artist !== 'Unknown Artist') {
      artist = cached.artist
    }
  }

  // Cache metadata if valid title exists
  if (title && !title.startsWith('yt:') && title !== src) {
    cacheMetadata(src, { title, artist, album, albumArt: finalArt })
  }

  const playedAt = Date.now()

  // Transaction for atomic updates
  const tx = db.transaction(() => {
    // 1. Add to history
    db.prepare(`INSERT INTO history (src, title, artist, album, album_art, duration, played_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      src, title, artist, album, finalArt, safeDuration, playedAt
    )

    // 2. Track stats
    if (src) {
      db.prepare(`INSERT INTO track_stats (src, play_count) VALUES (?, 1) ON CONFLICT(src) DO UPDATE SET play_count = play_count + 1`).run(src)
    }

    // 3. Artist stats
    if (artist && artist !== 'Unknown Artist') {
      db.prepare(`INSERT INTO artist_stats (artist, play_count) VALUES (?, 1) ON CONFLICT(artist) DO UPDATE SET play_count = play_count + 1`).run(artist)
    }

    // 4. Album stats
    if (album && album !== 'YouTube Music') {
      db.prepare(`INSERT INTO album_stats (album, play_count) VALUES (?, 1) ON CONFLICT(album) DO UPDATE SET play_count = play_count + 1`).run(album)
    }

    // 5. Hourly stats
    const hour = new Date().getHours()
    db.prepare(`INSERT INTO hourly_stats (hour, play_count) VALUES (?, 1) ON CONFLICT(hour) DO UPDATE SET play_count = play_count + 1`).run(hour)

    // 6. Daily stats
    const today = new Date().toISOString().slice(0, 10)
    db.prepare(`INSERT INTO daily_stats (date, play_count) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET play_count = play_count + 1`).run(today)

    // Update existing raw history entries if valid metadata becomes available
    if (title && !title.startsWith('yt:') && title !== src) {
      db.prepare(`UPDATE history SET title = ?, artist = COALESCE(?, artist), album_art = COALESCE(?, album_art) WHERE src = ? AND (title IS NULL OR title = src OR title LIKE 'yt:%')`).run(title, artist, finalArt, src)
    }
  })

  tx()

  // Retention runs off the hot path — at most once per hour, in the background.
  maybePrune()
}

let lastPruneAt = 0
const PRUNE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
function maybePrune() {
  const now = Date.now()
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return
  lastPruneAt = now
  pruneStaleData()
}

function getHistory(limit = 300) {
  const rows = db.prepare(`
    SELECT h.id, h.src, h.title, h.artist, h.album, h.album_art as albumArt, h.played_at, 
           m.title as cached_title, m.artist as cached_artist, m.album_art as cached_art 
    FROM history h 
    LEFT JOIN metadata_cache m ON h.src = m.src 
    ORDER BY h.played_at DESC 
    LIMIT ?
  `).all(limit)

  return rows.map(r => {
    const title = (r.title && !r.title.startsWith('yt:') && r.title !== r.src) ? r.title : (r.cached_title || r.title || r.src)
    const artist = (r.artist && r.artist !== 'Unknown Artist') ? r.artist : (r.cached_artist || r.artist || 'Unknown Artist')
    const albumArt = r.albumArt || r.cached_art || (r.src?.startsWith('yt:') ? `https://i.ytimg.com/vi/${r.src.replace('yt:', '')}/hqdefault.jpg` : null)
    return {
      id: r.id,
      src: r.src,
      title,
      artist,
      album: r.album,
      albumArt,
      played_at: r.played_at
    }
  })
}

// --- Stats API for Dashboard ---
function getAllStats() {
  const history = getHistory()
  
  const tracks = db.prepare(`SELECT * FROM track_stats ORDER BY play_count DESC LIMIT 20`).all()
  const artists = db.prepare(`SELECT * FROM artist_stats ORDER BY play_count DESC LIMIT 20`).all()
  const albums = db.prepare(`SELECT * FROM album_stats ORDER BY play_count DESC LIMIT 20`).all()
  
  // Format hourly array [0-23]
  const hourlyRows = db.prepare(`SELECT * FROM hourly_stats`).all()
  const hourly = new Array(24).fill(0)
  for (const r of hourlyRows) hourly[r.hour] = r.play_count

  // Format daily object { 'YYYY-MM-DD': count }
  const dailyRows = db.prepare(`SELECT * FROM daily_stats ORDER BY date ASC`).all()
  const daily = {}
  for (const r of dailyRows) daily[r.date] = r.play_count

  const statsMap = {}
  // Build a lookup once instead of Array.find() inside the loop (was O(tracks x history))
  const historyBySrc = new Map()
  for (const h of history) {
    if (!historyBySrc.has(h.src)) historyBySrc.set(h.src, h)
  }
  tracks.forEach(t => {
    // Only include track stats if track has a valid title in metadata_cache or history
    const cached = getCachedMetadata(t.src)
    const hist = historyBySrc.get(t.src)
    const validTitle = cached?.title || hist?.title
    if (!t.src.startsWith('yt:') || (validTitle && !validTitle.startsWith('yt:'))) {
      statsMap[t.src] = t.play_count
    }
  })
  
  const artistMap = {}
  artists.forEach(a => {
    if (a.artist && a.artist !== 'Unknown Artist') artistMap[a.artist] = a.play_count
  })
  
  const albumMap = {}
  albums.forEach(a => {
    if (a.album && a.album !== 'YouTube Music') albumMap[a.album] = a.play_count
  })

  return {
    history,
    stats: statsMap,
    hourly,
    daily,
    artistStats: artistMap,
    albumStats: albumMap
  }
}

// ─── Metadata Cache API ───────────────────────────────────────────────────────
function cacheMetadata(src, meta) {
  if (!src || !meta) return
  const { title, artist, album, duration, albumArt, art, thumbnail } = meta
  const finalArt = albumArt || art || thumbnail || null
  if (!title || title === src || title.startsWith('yt:')) return // don't cache invalid titles

  db.prepare(`
    INSERT INTO metadata_cache (src, title, artist, album, duration, album_art, last_scanned) 
    VALUES (?, ?, ?, ?, ?, ?, ?) 
    ON CONFLICT(src) DO UPDATE SET 
      title = excluded.title,
      artist = COALESCE(excluded.artist, artist),
      album = COALESCE(excluded.album, album),
      duration = COALESCE(excluded.duration, duration),
      album_art = COALESCE(excluded.album_art, album_art),
      last_scanned = excluded.last_scanned
  `).run(src, title, artist, album, duration || 0, finalArt, Date.now())
}

function getCachedMetadata(src) {
  if (!src) return null
  return db.prepare(`SELECT * FROM metadata_cache WHERE src = ?`).get(src)
}

// Look up many rows by primary key.
//
// This used to build a single `IN (?,?,…)` clause with one bound parameter per
// library file. SQLite's parameter ceiling is real and low enough to matter —
// the bundled build reports MAX_VARIABLE_NUMBER=32766 — so a library past that
// size threw `too many SQL variables`. The caller swallowed the error, which
// meant a large library loaded with no titles, no artists and no artwork at
// all, and no indication why.
//
// A prepared statement reused inside one transaction is also faster than
// assembling and re-parsing a multi-megabyte SQL string.
const getCachedMetadataStmt = () =>
  db.prepare(`SELECT * FROM metadata_cache WHERE src = ?`)

function getBulkCachedMetadata(srcArray) {
  if (!Array.isArray(srcArray) || srcArray.length === 0) return {}

  const map = {}
  const stmt = getCachedMetadataStmt()
  const run = db.transaction((sources) => {
    for (const src of sources) {
      if (typeof src !== 'string' || !src) continue
      const row = stmt.get(src)
      if (row) map[src] = row
    }
  })

  try {
    run(srcArray)
  } catch (err) {
    // Never fail silently: an empty map here renders as a library with no
    // metadata, which looks like data loss rather than an error.
    console.error('getBulkCachedMetadata error:', err)
  }
  return map
}

function savePlaylistsToDB(playlists) {
  if (!Array.isArray(playlists)) return
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM playlists`).run()
    const stmt = db.prepare(`INSERT OR REPLACE INTO playlists (id, name, tracks_json, created_at) VALUES (?, ?, ?, ?)`)
    const seen = new Set()
    for (const p of playlists) {
      if (!p || !p.id) continue
      const idStr = p.id.toString()
      if (seen.has(idStr)) continue
      seen.add(idStr)
      const tracks = p.files || p.tracks || []
      stmt.run(idStr, p.name || 'Untitled Playlist', JSON.stringify(tracks), p.createdAt || Date.now())
    }
  })
  try { tx() } catch (err) { console.error('savePlaylistsToDB error:', err) }
}

function getPlaylistsFromDB() {
  try {
    const rows = db.prepare(`SELECT * FROM playlists ORDER BY created_at ASC`).all()
    return rows.map(r => {
      let tracks = []
      try { tracks = JSON.parse(r.tracks_json) } catch {}
      return {
        id: r.id,
        name: r.name,
        files: tracks,
        tracks: tracks,
        createdAt: r.created_at
      }
    })
  } catch (err) {
    return []
  }
}

function saveFavouritesToDB(favList, streamingFavList) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM favourites`).run()
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO favourites (src, title, artist, album_art, duration, is_streaming, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const seen = new Set()

    // 1. First save rich streaming favourites with complete metadata
    if (Array.isArray(streamingFavList)) {
      for (const t of streamingFavList) {
        if (!t || !t.src || seen.has(t.src)) continue
        seen.add(t.src)
        stmt.run(
          t.src,
          t.title || 'Streaming Track',
          t.artist || 'Unknown Artist',
          t.albumArt || t.art || t.thumbnail || null,
          t.duration || 0,
          1,
          Date.now()
        )
      }
    }

    // 2. Then save local / string favourites (if not already recorded)
    if (Array.isArray(favList)) {
      for (const item of favList) {
        const src = typeof item === 'string' ? item : item?.src
        if (!src || seen.has(src)) continue
        seen.add(src)
        const isStreaming = src.startsWith('yt:') ? 1 : 0
        const cached = getCachedMetadata(src)
        stmt.run(
          src,
          cached?.title || (isStreaming ? 'Streaming Track' : src.split(/[/\\]/).pop()),
          cached?.artist || 'Unknown Artist',
          cached?.album_art || null,
          cached?.duration || 0,
          isStreaming,
          Date.now()
        )
      }
    }
  })
  try { tx() } catch (err) { console.error('saveFavouritesToDB error:', err) }
}

function getFavouritesFromDB() {
  try {
    const rows = db.prepare(`SELECT * FROM favourites`).all()
    const favArray = []
    const streamingArray = []
    for (const r of rows) {
      favArray.push(r.src)
      if (r.is_streaming === 1) {
        streamingArray.push({
          id: r.src,
          src: r.src,
          title: r.title,
          artist: r.artist,
          albumArt: r.album_art,
          duration: r.duration
        })
      }
    }
    return { favourites: favArray, streamingFavourites: streamingArray }
  } catch (err) {
    return { favourites: [], streamingFavourites: [] }
  }
}

function saveFollowedArtistsToDB(followedArtists) {
  if (!Array.isArray(followedArtists)) return
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM followed_artists`).run()
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO followed_artists (name, thumbnail, header_image, subscribers, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const item of followedArtists) {
      if (!item) continue
      const name = typeof item === 'string' ? item.trim() : (item.name || item.title || '').trim()
      if (!name) continue
      const thumbnail = typeof item === 'object' ? (item.thumbnail || item.art || item.albumArt || null) : null
      const headerImage = typeof item === 'object' ? (item.headerImage || item.headerArt || null) : null
      const subscribers = typeof item === 'object' ? (item.subscribers || null) : null
      const createdAt = typeof item === 'object' && item.createdAt ? item.createdAt : Date.now()
      stmt.run(name, thumbnail, headerImage, subscribers, createdAt)
    }
  })
  try { tx() } catch (err) { console.error('saveFollowedArtistsToDB error:', err) }
}

function getFollowedArtistsFromDB() {
  try {
    const rows = db.prepare(`SELECT * FROM followed_artists ORDER BY created_at DESC`).all()
    return rows.map(r => ({
      name: r.name,
      thumbnail: r.thumbnail,
      headerImage: r.header_image,
      subscribers: r.subscribers,
      createdAt: r.created_at
    }))
  } catch (err) {
    return []
  }
}

// --- Artist Art Cache API ---
function saveArtistArtToDB(artistName, imageUrl) {
  if (!artistName || !imageUrl) return
  try {
    const stmt = db.prepare(`
      INSERT INTO artist_art_cache (name, image_url, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        image_url = excluded.image_url,
        updated_at = excluded.updated_at
    `)
    stmt.run(artistName.trim(), imageUrl, Date.now())
  } catch (err) {
    console.error('saveArtistArtToDB error:', err)
  }
}

function saveBulkArtistArtToDB(entries) {
  if (!entries || typeof entries !== 'object') return
  try {
    const stmt = db.prepare(`
      INSERT INTO artist_art_cache (name, image_url, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        image_url = excluded.image_url,
        updated_at = excluded.updated_at
    `)
    const tx = db.transaction((items) => {
      for (const [name, imageUrl] of Object.entries(items)) {
        if (name && imageUrl) {
          stmt.run(name.trim(), imageUrl, Date.now())
        }
      }
    })
    tx(entries)
  } catch (err) {
    console.error('saveBulkArtistArtToDB error:', err)
  }
}

function getArtistArtFromDB() {
  try {
    // Only return entries that haven't passed the TTL — CDN art URLs are signed
    // and expire, so a stale URL renders as a broken image.
    const cutoff = Date.now() - ARTIST_ART_TTL_MS
    const rows = db.prepare(`SELECT name, image_url FROM artist_art_cache WHERE updated_at >= ?`).all(cutoff)
    const map = {}
    for (const r of rows) {
      if (r.name && r.image_url) {
        map[r.name] = r.image_url
      }
    }
    return map
  } catch (err) {
    return {}
  }
}

// --- Reset Stats API ---
function resetStats() {
  try {
    const tx = db.transaction(() => {
      db.prepare(`DELETE FROM history`).run()
      db.prepare(`DELETE FROM track_stats`).run()
      db.prepare(`DELETE FROM artist_stats`).run()
      db.prepare(`DELETE FROM album_stats`).run()
      db.prepare(`DELETE FROM hourly_stats`).run()
      db.prepare(`DELETE FROM daily_stats`).run()
    })
    tx()
    return true
  } catch (err) {
    console.error('resetStats error:', err)
    return false
  }
}

// ─── Library Index ────────────────────────────────────────────────────────────
// Authoritative store for the list of scanned local file paths. Replaces the
// localStorage key that silently overflowed its quota on large libraries.

/**
 * Reconcile the stored index with the freshly scanned list.
 * Rows that disappeared from disk are deleted, new rows are inserted, and the
 * `position` column is rewritten so the on-disk order matches the array order.
 */
const syncLibraryFilesTx = db.transaction((paths) => {
  const incoming = new Set(paths)
  const existing = db.prepare(`SELECT path FROM library_files`).all().map(r => r.path)

  const del = db.prepare(`DELETE FROM library_files WHERE path = ?`)
  for (const p of existing) {
    if (!incoming.has(p)) del.run(p)
  }

  const upsert = db.prepare(`
    INSERT INTO library_files (path, position, added_at) VALUES (?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET position = excluded.position
  `)
  const now = Date.now()
  for (let i = 0; i < paths.length; i++) {
    upsert.run(paths[i], i, now)
  }
})

function syncLibraryFiles(paths) {
  try {
    if (!Array.isArray(paths)) return false
    syncLibraryFilesTx(paths.filter(p => typeof p === 'string' && p.length > 0))
    return true
  } catch (err) {
    console.error('syncLibraryFiles error:', err)
    return false
  }
}

function getLibraryFiles() {
  try {
    return db.prepare(`SELECT path FROM library_files ORDER BY position ASC`)
      .all()
      .map(r => r.path)
  } catch (err) {
    return []
  }
}

module.exports = {
  logPlay,
  getHistory,
  getAllStats,
  resetStats,
  cacheMetadata,
  getCachedMetadata,
  getBulkCachedMetadata,
  savePlaylistsToDB,
  getPlaylistsFromDB,
  saveFavouritesToDB,
  getFavouritesFromDB,
  saveFollowedArtistsToDB,
  getFollowedArtistsFromDB,
  saveArtistArtToDB,
  saveBulkArtistArtToDB,
  getArtistArtFromDB,
  syncLibraryFiles,
  getLibraryFiles,
  pruneStaleData,
  closeDatabase
}

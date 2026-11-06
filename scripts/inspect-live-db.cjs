// Read-only inspection of the LIVE database, to confirm the real library still
// indexes correctly after the allow-list change. Opens read-only; writes nothing.
//
//   ./node_modules/electron/dist/electron.exe scripts/inspect-live-db.cjs

const electron = require('electron')
const path = require('path')
const fs = require('fs')

// See the note in verify-phase-a.cjs: `require('electron')` returns the binary
// path as a string under plain node or when ELECTRON_RUN_AS_NODE leaks in.
const app = electron && typeof electron === 'object' ? electron.app : null
if (!app) {
  console.error(
    'inspect-live-db must run as an Electron main process:\n' +
      '  ./node_modules/electron/dist/electron.exe scripts/inspect-live-db.cjs\n'
  )
  process.exit(2)
}

// `app.exit()` terminates immediately and does not flush piped stdout, so buffer
// everything and write it synchronously to fd 1 at the end.
const out = []
const say = (...parts) => out.push(parts.join(' '))

// Running the Electron binary directly makes app.getName() return "Electron", so
// userData would resolve to AppData\Roaming\Electron — the WRONG database. The
// real app is launched as `electron .`, which reads package.json's name.
app.setPath('userData', path.join(app.getPath('appData'), 'glaze-music'))

const dbPath = path.join(app.getPath('userData'), 'glaze_data.db')
say('userData:', app.getPath('userData'))
say('db:', dbPath)
try {
  const st = fs.statSync(dbPath)
  say('exists: yes, size:', st.size, 'bytes')
} catch {
  say('exists: NO')
}
say('')

const Database = require('better-sqlite3')
const db = new Database(dbPath, { readonly: true, fileMustExist: true })

say('tables in the live db:')
for (const r of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all()) {
  say('  -', r.name)
}
say('')

function count(sql) {
  try {
    return db.prepare(sql).get().n
  } catch (err) {
    return `ERR: ${err.message}`
  }
}

say('library_files      :', count('SELECT COUNT(*) n FROM library_files'))
say('metadata_cache     :', count('SELECT COUNT(*) n FROM metadata_cache'))
say('tracks with title  :', count('SELECT COUNT(*) n FROM metadata_cache WHERE title IS NOT NULL'))
say('tracks with art    :', count('SELECT COUNT(*) n FROM metadata_cache WHERE album_art IS NOT NULL'))
say('playlists          :', count('SELECT COUNT(*) n FROM playlists'))
say('history rows       :', count('SELECT COUNT(*) n FROM history'))
say('')

try {
  const roots = db.prepare(`SELECT DISTINCT substr(path, 1, 3) AS drive, COUNT(*) n FROM library_files GROUP BY drive ORDER BY n DESC`).all()
  say('library_files by drive:')
  for (const r of roots) say('  ', r.drive, '->', r.n)

  const sample = db.prepare(`SELECT l.path, m.title, m.artist FROM library_files l LEFT JOIN metadata_cache m ON m.src = l.path LIMIT 5`).all()
  say('')
  say('sample rows (library_files JOIN metadata_cache):')
  for (const s of sample) say('  ', JSON.stringify(s))
} catch (err) {
  say('library_files queries failed:', err.message)
}

db.close()
fs.writeSync(1, out.join('\n') + '\n')
app.exit(0)

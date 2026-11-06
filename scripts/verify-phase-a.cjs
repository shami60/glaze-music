// Phase A verification harness.
//
// Run with the Electron binary as a main process (NOT plain node — better-sqlite3
// is built against Electron's ABI):
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe scripts/verify-phase-a.cjs
//
// The `env -u` matters: if ELECTRON_RUN_AS_NODE is set, Electron starts in Node
// mode, `require('electron')` returns a path string, and `app` is undefined. Some
// shells and sandbox wrappers leak that variable into children. Without the
// workaround you get a clear message below rather than a confusing TypeError.
//
// Covers the two Phase A fixes that are testable without booting the app:
//   BUG-2  getBulkCachedMetadata past SQLite's MAX_VARIABLE_NUMBER
//   BUG-3  the async walk in electron/scanner.cjs
//
// It points app.userData at a throwaway directory BEFORE requiring db.cjs, so it
// can never read or write the real glaze_data.db.

const electron = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

// Fail with something actionable rather than a cryptic TypeError further down.
//
// `require('electron')` returns the *path to the binary* as a string — not the
// API object — when the process is actually running under plain node, or with
// ELECTRON_RUN_AS_NODE set in the environment. That has been observed
// intermittently here (some shells/wrappers leak the variable into children),
// and it presents as `Cannot read properties of undefined (reading 'setPath')`,
// which says nothing about the real problem.
const app = electron && typeof electron === 'object' ? electron.app : null
if (!app) {
  console.error(
    'verify-phase-a must run as an Electron main process — better-sqlite3 is built\n' +
      "against Electron's ABI, and db.cjs needs a live `app`.\n\n" +
      '  ./node_modules/electron/dist/electron.exe scripts/verify-phase-a.cjs\n'
  )
  console.error(
    process.env.ELECTRON_RUN_AS_NODE
      ? 'ELECTRON_RUN_AS_NODE is set in this environment — unset it and retry.'
      : `require('electron') returned ${typeof electron}, so this is plain node.`
  )
  process.exit(2)
}

// Temp-dir hygiene.
//
// This harness points `userData` at the temp dir, so Electron's own profile files
// (`Local State`, `Preferences`, caches) land there too — and Chromium holds them
// open for the entire process lifetime. On Windows an open file cannot be deleted,
// so a run can never remove its OWN directory before exit.
//
// The fix is to reclaim a FIXED path at startup rather than clean up at exit: by
// then the previous run is dead and its directory is deletable. That holds the
// steady state at exactly one directory, instead of one more per run — the
// original version left 16 behind before anyone noticed.
const FIXED_TMP = path.join(os.tmpdir(), 'glaze-verify')
let JUNCTION_PATH = null

function claimTempDir() {
  try {
    fs.rmSync(FIXED_TMP, { recursive: true, force: true })
    fs.mkdirSync(FIXED_TMP, { recursive: true })
    return FIXED_TMP
  } catch {
    // A parallel run holds the fixed path — fall back to a unique directory.
    const unique = path.join(os.tmpdir(), `glaze-verify-${process.pid}`)
    fs.mkdirSync(unique, { recursive: true })
    return unique
  }
}

const TMP = claimTempDir()
app.setPath('userData', TMP)

// Sweep leftover fallback directories from crashed or parallel runs. Judged by
// mtime: a live run touches its directory constantly (Electron writes caches into
// it), a finished one goes quiet. PID liveness was tried first and proved
// unreliable — `process.kill(pid, 0)` succeeds for any process that happens to
// hold a reused PID, which stranded directories permanently.
const STALE_AFTER_MS = 60_000

function pruneStaleTempDirs() {
  const base = os.tmpdir()
  let removed = 0
  let skipped = 0
  let failed = 0

  let entries = []
  try {
    entries = fs.readdirSync(base)
  } catch {
    return { removed, skipped, failed }
  }

  const now = Date.now()
  for (const name of entries) {
    // Only the PID-suffixed fallbacks; the fixed path is handled by claimTempDir.
    if (!name.startsWith('glaze-verify-')) continue
    const full = path.join(base, name)
    if (full === TMP) continue

    try {
      if (now - fs.statSync(full).mtimeMs < STALE_AFTER_MS) {
        skipped++
        continue
      }
    } catch {
      continue // vanished between readdir and stat
    }

    try {
      fs.rmSync(full, { recursive: true, force: true })
      removed++
    } catch {
      failed++
    }
  }
  return { removed, skipped, failed }
}

function detachJunction() {
  if (!JUNCTION_PATH) return
  try {
    fs.rmdirSync(JUNCTION_PATH)
  } catch {
    try {
      fs.unlinkSync(JUNCTION_PATH)
    } catch {
      /* already gone */
    }
  }
}

// Required AFTER setPath so db.cjs resolves its path inside TMP.
const db = require('../electron/db.cjs')
const { walkAudioFiles, DEFAULT_MAX_DEPTH } = require('../electron/scanner.cjs')

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

// ─── Test 1: BUG-2 — bulk metadata past SQLite's parameter ceiling ────────────
function testBulkMetadata() {
  console.log('\n=== BUG-2: getBulkCachedMetadata above the SQL variable limit ===')
  const Database = require('better-sqlite3')
  const raw = new Database(path.join(TMP, 'glaze_data.db'))

  const N = 40000
  const sources = []
  const insert = raw.prepare(
    `INSERT INTO metadata_cache (src, title, artist, album, duration, album_art, last_scanned)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const seed = raw.transaction(() => {
    for (let i = 0; i < N; i++) {
      const src = `C:\\Music\\track-${i}.mp3`
      sources.push(src)
      insert.run(src, `Title ${i}`, `Artist ${i % 100}`, `Album ${i % 40}`, 180 + (i % 60), null, Date.now())
    }
  })
  seed()
  raw.close()
  console.log(`seeded ${N} rows into metadata_cache`)

  // The old implementation: one IN (...) with one bound parameter per row.
  let oldThrew = null
  try {
    const placeholders = sources.map(() => '?').join(',')
    const probe = new Database(':memory:')
    probe.prepare(`SELECT 1 WHERE 1 IN (${placeholders})`).all(...sources)
    probe.close()
  } catch (err) {
    oldThrew = err.message
  }
  check(
    'old IN(...) form fails at 40k params (the failure this fix removes)',
    oldThrew !== null,
    oldThrew ? `threw: ${oldThrew}` : 'expected a throw, got none — fixture is not proving anything'
  )

  // The new implementation.
  const t0 = Date.now()
  const map = db.getBulkCachedMetadata(sources)
  const ms = Date.now() - t0
  const got = Object.keys(map).length
  check(
    `new chunked lookup returns all ${N} rows`,
    got === N,
    `got ${got} in ${ms}ms`
  )
  check(
    'returned row carries real metadata (not an empty map)',
    map[sources[12345]]?.title === 'Title 12345' && map[sources[12345]]?.artist === 'Artist 45',
    JSON.stringify(map[sources[12345]] || null)
  )

  // Edge cases the old code also had to survive.
  check('empty array returns {}', Object.keys(db.getBulkCachedMetadata([])).length === 0)
  check('non-array returns {}', Object.keys(db.getBulkCachedMetadata(null)).length === 0)
  check(
    'unknown srcs are simply absent',
    Object.keys(db.getBulkCachedMetadata(['C:\\nope\\x.mp3', '', null, 42])).length === 0
  )
}

// ─── Test 2: BUG-3 — the async walk ──────────────────────────────────────────
// Reference implementation: the ORIGINAL synchronous depth-first walk. Used to
// prove the async refactor preserved file ordering exactly.
function syncReferenceWalk(root) {
  const out = []
  const exts = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus'])
  const seen = new Set()
  function rec(dir) {
    let real
    try {
      real = fs.realpathSync(dir)
    } catch {
      return
    }
    if (seen.has(real)) return
    seen.add(real)
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const subs = []
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) subs.push(full)
      else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) out.push(full)
    }
    for (const s of subs) rec(s)
  }
  rec(root)
  return out
}

async function testWalker() {
  console.log('\n=== BUG-3: async walk (ordering, filtering, loop safety) ===')
  const root = path.join(TMP, 'tree')
  fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true })

  fs.writeFileSync(path.join(root, 'a.mp3'), 'x')
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x')
  fs.writeFileSync(path.join(root, 'cover.jpg'), 'x')
  fs.writeFileSync(path.join(root, 'sub', 'c.flac'), 'x')
  fs.writeFileSync(path.join(root, 'sub', 'deep', 'd.OPUS'), 'x') // uppercase ext
  fs.writeFileSync(path.join(root, 'sub', 'deep', 'e.m4a'), 'x')

  // Self-referential junction: readdir reports it as a directory.
  let junctionMade = false
  try {
    fs.symlinkSync(root, path.join(root, 'sub', 'loop'), 'junction')
    junctionMade = true
    JUNCTION_PATH = path.join(root, 'sub', 'loop')
  } catch (err) {
    console.log(`  (could not create junction: ${err.message})`)
  }

  const { files, visited } = await walkAudioFiles(root)
  const rel = files.map((f) => path.relative(root, f).split(path.sep).join('/'))

  check(
    'collects only audio extensions (case-insensitive), skips .txt/.jpg',
    rel.length === 4 &&
      rel.includes('a.mp3') &&
      rel.includes('sub/c.flac') &&
      rel.includes('sub/deep/e.m4a') &&
      !rel.some((f) => f.endsWith('.txt') || f.endsWith('.jpg')),
    JSON.stringify(rel)
  )
  check('uppercase .OPUS is matched', rel.includes('sub/deep/d.OPUS'), JSON.stringify(rel))

  const ref = syncReferenceWalk(root).map((f) => path.relative(root, f).split(path.sep).join('/'))
  check(
    'order matches the original synchronous walk byte-for-byte',
    JSON.stringify(rel) === JSON.stringify(ref),
    `async: ${JSON.stringify(rel)}\n        sync:  ${JSON.stringify(ref)}`
  )

  if (junctionMade) {
    check(
      'junction loop terminates (visited-dedup via realpath)',
      visited <= 4,
      `visited ${visited} real directories, collected ${files.length} files`
    )
  }

  // root = depth 0 (a.mp3), sub = depth 1 (c.flac), sub/deep = depth 2 -> cut.
  const capped = await walkAudioFiles(root, { maxDepth: 1 })
  check(
    'depth cap is enforced',
    capped.files.length === 2 && capped.depthLimited === 1,
    `maxDepth=1 -> ${capped.files.length} file(s) (expect a.mp3 + sub/c.flac), depthLimited=${capped.depthLimited}`
  )

  const bad = await walkAudioFiles(path.join(TMP, 'does-not-exist'))
  check('missing root returns empty, does not throw', bad.files.length === 0)

  const warns = []
  const noisy = await walkAudioFiles(root, { maxDepth: 1, onWarn: (m) => warns.push(m) })
  check(
    'onWarn receives the depth-cap notice and the cap still applies',
    warns.some((w) => w.includes('Depth limit')) && noisy.files.length === 2,
    JSON.stringify(warns)
  )
  check('default depth cap is 40', DEFAULT_MAX_DEPTH === 40, `got ${DEFAULT_MAX_DEPTH}`)

  // Event-loop responsiveness: the walk must yield between directories.
  let ticks = 0
  const timer = setInterval(() => ticks++, 0)
  await walkAudioFiles(root)
  clearInterval(timer)
  check('walk yields to the event loop (no main-process freeze)', ticks > 0, `${ticks} timer ticks during walk`)
}

async function main() {
  const pruned = pruneStaleTempDirs()
  if (pruned.removed || pruned.failed) {
    console.log(
      `pruned ${pruned.removed} stale temp dir(s) from earlier runs` +
        (pruned.skipped ? `, skipped ${pruned.skipped} in use` : '') +
        (pruned.failed ? `, ${pruned.failed} could not be removed` : '')
    )
  }
  console.log(`userData -> ${TMP}`)

  testBulkMetadata()
  await testWalker()

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('\nFAILURES:')
    failed.forEach((f) => console.log(`  - ${f.name}\n    ${f.detail || ''}`))
  }

  // Release what we can. The directory itself stays until the next run prunes it —
  // see pruneStaleTempDirs for why that is unavoidable on Windows.
  try {
    db.closeDatabase()
  } catch {
    /* nothing to release */
  }
  detachJunction()

  app.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err)
  app.exit(2)
})

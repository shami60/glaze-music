// Crash-logging verification harness.
//
// `electron/crashlog.cjs` takes `app` and `crashReporter` as injected params
// precisely so it can be tested without Electron, so this runs under plain node:
//
//   node scripts/verify-crashlog.cjs

const fs = require('fs')
const os = require('os')
const path = require('path')

const crashlog = require('../electron/crashlog.cjs')

const results = []
function check(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

const TMP = path.join(os.tmpdir(), `glaze-crashlog-${process.pid}`)
fs.mkdirSync(TMP, { recursive: true })

// Minimal stand-ins for Electron's app / crashReporter.
const fakeApp = {
  getVersion: () => '1.0.3',
  getPath(name) {
    if (name === 'userData') return TMP
    if (name === 'crashDumps') return path.join(TMP, 'crashDumps')
    throw new Error(`unexpected getPath(${name})`)
  },
}
const started = []
const fakeCrashReporter = {
  start(opts) {
    started.push(opts)
  },
  getLastCrashReport() {
    return { date: new Date('2026-09-28T10:00:00Z'), id: 'abc123' }
  },
}

// ─── Before init: must be a silent no-op, never a throw ──────────────────────
let threw = null
try {
  crashlog.logToFile('error', 'before init')
} catch (err) {
  threw = err.message
}
check('logToFile before init does not throw', threw === null, threw || '')
check('readLogTail before init returns empty string', crashlog.readLogTail() === '')
check('getCrashInfo before init is safe', crashlog.getCrashInfo().logFile === null)

// ─── Init ────────────────────────────────────────────────────────────────────
const info = crashlog.initCrashLogging({
  app: fakeApp,
  crashReporter: fakeCrashReporter,
  productName: 'Glaze Music',
})

check(
  'creates <userData>/logs/main.log',
  info.logFile === path.join(TMP, 'logs', 'main.log') && fs.existsSync(info.logFile),
  info.logFile
)
check('resolves the crashDumps dir', info.dumpDir === path.join(TMP, 'crashDumps'), info.dumpDir)
check('starts the crash reporter', started.length === 1)
check(
  'records the build it came from (version + platform)',
  // Under plain node there is no electron/chrome version — only assert what the
  // harness can actually produce.
  /version=1\.0\.3 .*node=\d.* platform=\w+ arch=\w+/.test(fs.readFileSync(info.logFile, 'utf8')),
  (fs.readFileSync(info.logFile, 'utf8').split('\n').find((l) => l.includes('version=')) || '').slice(0, 130)
)
check(
  'crash reporter is LOCAL ONLY (uploadToServer false)',
  started[0]?.uploadToServer === false,
  JSON.stringify({ uploadToServer: started[0]?.uploadToServer, submitURL: started[0]?.submitURL })
)

// ─── Serialisation ───────────────────────────────────────────────────────────
crashlog.logToFile('error', 'plain string', 42, { a: 1 })
crashlog.logToFile('error', new Error('boom'))
const afterBasic = fs.readFileSync(info.logFile, 'utf8')
check('writes a timestamped level-tagged line', /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[error\] plain string 42 \{ a: 1 \}$/m.test(afterBasic), afterBasic.split('\n')[1] || '')
check('serialises an Error to its stack', /Error: boom/.test(afterBasic))
check('survives a circular object', (() => {
  const circular = { name: 'loop' }
  circular.self = circular
  try {
    crashlog.logToFile('error', circular)
    return true
  } catch {
    return false
  }
})())

// ─── Process-gone recording ──────────────────────────────────────────────────
for (let i = 0; i < 25; i++) {
  crashlog.recordProcessGone('renderer', { reason: `reason-${i}`, exitCode: -i })
}
const gone = crashlog.getCrashInfo().processGone
check('process-gone entries are recorded', gone.length > 0, `${gone.length} kept`)
check(
  'process-gone list is capped (keeps the most recent)',
  gone.length === 20 && gone[gone.length - 1].reason === 'reason-24',
  `len=${gone.length}, last=${gone[gone.length - 1]?.reason}`
)
check(
  'process-gone captures reason and exit code',
  gone[0].kind === 'renderer' && gone[0].exitCode !== null,
  JSON.stringify(gone[0])
)
check(
  'process-gone is also written to the log',
  /\[ProcessGone\] renderer/.test(fs.readFileSync(info.logFile, 'utf8'))
)

// ─── getCrashInfo shape ──────────────────────────────────────────────────────
const full = crashlog.getCrashInfo()
check('getCrashInfo exposes the last hard crash', full.lastCrash?.id === 'abc123', JSON.stringify(full.lastCrash))
check('getCrashInfo exposes a log tail', typeof full.logTail === 'string' && full.logTail.length > 0)
check('getCrashInfo exposes logDir', full.logDir === path.join(TMP, 'logs'))

// ─── readLogTail ─────────────────────────────────────────────────────────────
const tail = crashlog.readLogTail(200)
check('readLogTail returns at most the requested bytes', tail.length > 0 && tail.length <= 200, `${tail.length} bytes`)
check(
  'readLogTail trims to a whole line (starts at a timestamp, not mid-line)',
  /^\d{4}-\d{2}-\d{2}T/.test(tail),
  JSON.stringify(tail.slice(0, 40))
)

// ─── Rotation ────────────────────────────────────────────────────────────────
const big = 'x'.repeat(4096)
for (let i = 0; i < 300; i++) crashlog.logToFile('error', big) // ~1.2 MB
const sizeNow = fs.statSync(info.logFile).size
check(
  `rotation keeps the live log under the ${crashlog.MAX_LOG_BYTES} byte cap`,
  sizeNow < crashlog.MAX_LOG_BYTES,
  `${sizeNow} bytes`
)
check('rotation keeps one previous generation', fs.existsSync(`${info.logFile}.1`))

// ─── Never throws when the target is unusable ────────────────────────────────
crashlog.resetForTests()
crashlog.initCrashLogging({
  app: { getPath: () => path.join(TMP, 'main.log') }, // a FILE, so mkdir fails
  crashReporter: null,
})
let threw2 = null
try {
  crashlog.logToFile('error', 'into an unusable path')
} catch (err) {
  threw2 = err.message
}
check('logging into an unusable path does not throw', threw2 === null, threw2 || '')
check('initCrashLogging tolerates a missing crashReporter', true)

// ─── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
console.log(`\n${'─'.repeat(60)}`)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('\nFAILURES:')
  failed.forEach((f) => console.log(`  - ${f.name}\n    ${f.detail || ''}`))
}

try {
  fs.rmSync(TMP, { recursive: true, force: true })
} catch {
  /* best effort */
}
process.exit(failed.length ? 1 : 0)

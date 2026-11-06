// Persistent crash + error logging for the main process.
//
// Why this exists: a packaged Windows build has no console attached, so every
// `console.error` / `console.warn` in the main process — and every uncaught
// exception — disappears. `main.cjs` already had `process.on('uncaughtException')`
// handlers, but they logged to `console.error`, which on a user's machine means
// a crash produced nothing on screen, nothing on disk, and nothing to report.
// A renderer death was even quieter: the window just vanished.
//
// This module:
//   - mirrors main-process warnings/errors into `<userData>/logs/main.log`, with
//     rotation so it cannot grow without bound
//   - starts Electron's built-in crash reporter in LOCAL-ONLY mode, so minidumps
//     for hard native crashes (a segfault in a native module, an OOM kill) land
//     in `<userData>/crashDumps` and can be attached to a bug report
//   - records renderer and child-process deaths, which previously left no trace
//
// Nothing is uploaded. There is no account and no endpoint, and silently
// shipping user data to a third party is not a default worth choosing. If a
// crash-reporting backend is ever wired up, it should be opt-in.
//
// Electron's `app` and `crashReporter` are injected rather than required, so the
// logging half of this module can be exercised with plain node.

const fs = require('fs')
const path = require('path')
const util = require('util')

// Keep the log small enough to attach to a bug report and to never be the reason
// a user's disk fills up. One rotated generation is kept.
const MAX_LOG_BYTES = 1024 * 1024
const LOG_DIR_NAME = 'logs'
const LOG_FILE_NAME = 'main.log'
const MAX_RECORDED_GONE = 20

const state = {
  logFile: null,
  dumpDir: null,
  crashReporter: null,
  processGone: [],
}

function serialize(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    return util.inspect(value, { depth: 3, breakLength: Infinity })
  } catch {
    return String(value)
  }
}

function rotateIfNeeded(file) {
  try {
    if (fs.statSync(file).size < MAX_LOG_BYTES) return
    fs.renameSync(file, `${file}.1`)
  } catch {
    // No file yet, or the rename lost a race. Either way there is nothing to do.
  }
}

/**
 * Append one line to the crash log. Never throws — logging must not be able to
 * take the app down, and it must keep working while things are already broken.
 *
 * Writes are synchronous on purpose: an async append can lose its buffered
 * content when the process dies, which is exactly the case this is for.
 */
function logToFile(level, ...args) {
  if (!state.logFile) return
  try {
    rotateIfNeeded(state.logFile)
    const line = `${new Date().toISOString()} [${level}] ${args.map(serialize).join(' ')}\n`
    fs.appendFileSync(state.logFile, line)
  } catch {
    // Ignore.
  }
}

function recordProcessGone(kind, details) {
  const entry = {
    kind,
    at: new Date().toISOString(),
    reason: details?.reason || 'unknown',
    exitCode: details?.exitCode ?? null,
    type: details?.type || null,
    name: details?.name || null,
  }
  state.processGone.push(entry)
  if (state.processGone.length > MAX_RECORDED_GONE) state.processGone.shift()
  logToFile('fatal', `[ProcessGone] ${kind}`, JSON.stringify(entry))
}

/**
 * @param {object} options
 * @param {object} options.app            Electron's `app`.
 * @param {object} [options.crashReporter] Electron's `crashReporter`.
 * @param {string} [options.productName]
 * @returns {{logFile: string|null, dumpDir: string|null}}
 */
function initCrashLogging({ app, crashReporter, productName = 'Glaze Music' }) {
  let userData = null
  try {
    userData = app.getPath('userData')
  } catch {
    return { logFile: null, dumpDir: null }
  }

  try {
    const logDir = path.join(userData, LOG_DIR_NAME)
    fs.mkdirSync(logDir, { recursive: true })
    state.logFile = path.join(logDir, LOG_FILE_NAME)
  } catch {
    state.logFile = null
  }

  // `app.getPath('crashDumps')` is where Electron's crash handler writes
  // minidumps once crashReporter has been started.
  try {
    state.dumpDir = app.getPath('crashDumps')
  } catch {
    state.dumpDir = path.join(userData, 'crashDumps')
  }

  if (crashReporter) {
    state.crashReporter = crashReporter
    try {
      crashReporter.start({
        productName,
        companyName: productName,
        // Required by the API, unused while uploadToServer is false.
        submitURL: 'https://localhost.invalid/glaze-crash',
        uploadToServer: false,
        compress: true,
      })
      logToFile('info', `Crash reporter started (local only). Dumps: ${state.dumpDir}`)
    } catch (err) {
      logToFile('warn', 'crashReporter.start failed:', err)
    }
  }

  logToFile('info', `${productName} main process logging to ${state.logFile}`)

  // A crash log without the build it came from is hard to triage, and asking a
  // user to dig up their version and platform is how bug reports die. Record it
  // up front, on every run.
  try {
    const v = process.versions
    // electron/chrome are absent when this runs under plain node (the harness).
    logToFile(
      'info',
      `version=${app.getVersion?.() ?? 'unknown'} electron=${v.electron ?? 'n/a'} chromium=${v.chrome ?? 'n/a'} node=${v.node ?? 'n/a'} platform=${process.platform} arch=${process.arch}`
    )
  } catch {
    // Non-essential.
  }

  return { logFile: state.logFile, dumpDir: state.dumpDir }
}

/**
 * Everything a bug report needs: where the log and dumps live, the tail of the
 * log, the last hard crash Electron knows about, and any process deaths seen
 * this session.
 */
function getCrashInfo() {
  let lastCrash = null
  try {
    lastCrash = state.crashReporter?.getLastCrashReport?.() || null
  } catch {
    lastCrash = null
  }

  return {
    logFile: state.logFile,
    logDir: state.logFile ? path.dirname(state.logFile) : null,
    dumpDir: state.dumpDir,
    logTail: readLogTail(),
    lastCrash,
    processGone: [...state.processGone],
  }
}

/** Last `maxBytes` of the log, trimmed to whole lines. */
function readLogTail(maxBytes = 64 * 1024) {
  if (!state.logFile) return ''
  try {
    const { size } = fs.statSync(state.logFile)
    const start = Math.max(0, size - maxBytes)
    const fd = fs.openSync(state.logFile, 'r')
    try {
      const buf = Buffer.alloc(size - start)
      fs.readSync(fd, buf, 0, buf.length, start)
      const text = buf.toString('utf8')
      // Drop the first partial line unless we started at the beginning.
      return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function resetForTests() {
  state.logFile = null
  state.dumpDir = null
  state.crashReporter = null
  state.processGone = []
}

module.exports = {
  initCrashLogging,
  logToFile,
  recordProcessGone,
  getCrashInfo,
  readLogTail,
  resetForTests,
  MAX_LOG_BYTES,
}

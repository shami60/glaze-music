const { app, BrowserWindow, ipcMain, dialog, globalShortcut, Tray, Menu, nativeImage, protocol, shell, session, net, safeStorage, utilityProcess, crashReporter } = require('electron')
const path = require('path')
const fs = require('fs')
const vm = require('vm')
const db = require('./db.cjs')
const { walkAudioFiles } = require('./scanner.cjs')
const crashlog = require('./crashlog.cjs')
const { createUpdater } = require('./updater.cjs')

// Start persistent logging and the local-only crash reporter before anything
// else runs, so early warnings are captured. A packaged build has no console,
// so without this a main-process crash leaves no trace at all.
const { logFile: CRASH_LOG_FILE, dumpDir: CRASH_DUMP_DIR } = crashlog.initCrashLogging({
  app,
  crashReporter,
  productName: 'Glaze Music',
})

// Catch unhandled errors gracefully so the app stays resilient — and record them
// where a user can actually find them.
process.on('uncaughtException', (err) => {
  crashlog.logToFile('fatal', 'Uncaught Exception:', err)
  console.error('[Main] Uncaught Exception:', err)
})
process.on('unhandledRejection', (reason, promise) => {
  crashlog.logToFile('fatal', 'Unhandled Rejection:', reason, promise)
  console.error('[Main] Unhandled Rejection:', reason)
})

// ── Atomic JSON writes ───────────────────────────────────────────────────────
// A plain writeFile truncates the target first, so a crash or power loss
// mid-write leaves a zero-length preferences.json and the user silently loses
// every setting. Writing a sibling temp file and renaming is atomic on the same
// volume: a reader sees either the previous file or the complete new one.
async function atomicWriteJson(filePath, value) {
  const tmp = `${filePath}.${process.pid}.tmp`
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fs.promises.rename(tmp, filePath)
  } catch (err) {
    try { await fs.promises.unlink(tmp) } catch { /* already gone */ }
    throw err
  }
}

// Preferences are read-modify-write and several renderer call sites can save at
// once (settings, playlist edits, favourites). Interleaved saves would each read
// the same "existing" object and the last writer would drop the other's keys.
let preferencesWriteChain = Promise.resolve()

// Set once `before-quit` has started deferring for the preferences chain, so the
// second pass through the handler does not defer again.
let quitFlushStarted = false

// Last playback values the renderer handed us. The renderer saves on a throttle,
// so a quit between ticks loses up to one tick of position; writing these again
// synchronously in `before-quit` closes that gap without an extra IPC round-trip.
let lastPlaybackState = null
let lastPlaybackPosition = null

// A renderer dying used to be silent: the window just disappeared. Same for a
// child process (yt-dlp, ffmpeg).
app.on('render-process-gone', (_event, _contents, details) => {
  crashlog.recordProcessGone('renderer', details)
})
app.on('child-process-gone', (_event, details) => {
  crashlog.recordProcessGone('child', details)
})

// Optimize Chromium GPU rendering and compositor overhead
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-component-update')
app.commandLine.appendSwitch('disable-domain-reliability')
app.commandLine.appendSwitch('disable-sync')

// ── Cache ceilings ───────────────────────────────────────────────────────────
// Without a cap Chromium grows the HTTP + media cache unbounded in userData.
// The cache is LRU-evicted at this size, so it stays predictable on small
// system drives. 256 MB is enough for album art and repeated API responses.
app.commandLine.appendSwitch('disk-cache-size', String(256 * 1024 * 1024))
app.commandLine.appendSwitch('media-cache-size', String(128 * 1024 * 1024))

// ── User-agent scrub ─────────────────────────────────────────────────────────
// Electron's default UA advertises "Electron/36.x Glaze Music/1.0.0", which
// some streaming providers treat as an unsupported embedded browser. Strip the
// app tokens so every session (not just the YouTube partition) looks like the
// plain Chrome that is actually underneath.
if (typeof app.userAgentFallback === 'string') {
  app.userAgentFallback = app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\sGlaze Music\/[\d.]+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}


const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  console.log('Another instance is already running. Exiting.')
  app.quit()
} else {
  app.on('second-instance', () => {
    // A first instance can be alive with no window (window closed/destroyed, or
    // still starting). Quitting silently here is exactly "I opened the app and
    // nothing happened, but music was still playing".
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

let ytInstance = null
let ytAuthInstance = null  // Authenticated instance for private library access
let ytInitPromise = null

// Zero-allocation JS evaluator (Replaces leaking vm.runInNewContext with fast JIT execution)
function safeEval(code, env) {
  const script = typeof code === 'string' ? code : code.output
  try {
    if (env) {
      const keys = Object.keys(env)
      const values = Object.values(env)
      const fn = new Function(...keys, script)
      return fn(...values)
    } else {
      const fn = new Function(script)
      return fn()
    }
  } catch {
    return vm.runInNewContext(script, env || {})
  }
}

async function initYouTubeI() {
  if (ytInstance) return ytInstance
  if (ytInitPromise) return ytInitPromise

  ytInitPromise = (async () => {
    try {
      const { Innertube, UniversalCache, Platform } = await import('youtubei.js')
      
      Platform.shim.eval = safeEval

      ytInstance = await Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true
      })
      log.debug('youtubei.js initialized')
      return ytInstance
    } catch (err) {
      console.error('Failed to init youtubei.js:', err)
      ytInitPromise = null
      return null
    }
  })()
  
  return ytInitPromise
}

let ytAuthInitPromise = null

async function initAuthenticatedYT(cookies, { force = false } = {}) {
  if (ytAuthInstance && !force) return ytAuthInstance
  if (!cookies) return null
  if (force) {
    ytAuthInstance = null
    ytAuthInitPromise = null
  }
  if (ytAuthInitPromise) return ytAuthInitPromise

  ytAuthInitPromise = (async () => {
    try {
      const { Innertube, UniversalCache, Platform } = await import('youtubei.js')

      Platform.shim.eval = safeEval

      const instance = await Innertube.create({
        cache: new UniversalCache(false),
        generate_session_locally: true,
        cookie: cookies
      })
      ytAuthInstance = instance
      log.debug('youtubei.js initialized (AUTHENTICATED)')
      return instance
    } catch (err) {
      console.error('Failed to init authenticated youtubei.js:', err)
      return null
    }
  })()

  const instance = await ytAuthInitPromise
  // Never leave a settled promise cached: if the first attempt returned null
  // (offline, expired cookie), every later call used to receive that same null
  // for the rest of the session and YouTube Music stayed "disconnected" even
  // after a successful re-login.
  ytAuthInitPromise = null
  return instance
}

// Wipes every trace of the signed-in YouTube account.
async function resetYouTubeAuth() {
  ytAuthInstance = null
  ytAuthInitPromise = null
  ytLibraryCache = null
  // Declared further down (with the home-feed handler); assigned here because a
  // different account must not inherit the previous one's recommendations.
  ytHomeCache = null
  ytHomeCacheAt = 0
  try { fs.unlinkSync(authCookiePath('yt_cookies')) } catch { /* already gone */ }
  try { fs.unlinkSync(ytLibraryCachePath) } catch { /* already gone */ }
  try {
    const ses = session.fromPartition('persist:youtube-auth')
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] })
  } catch (err) {
    console.error('[YouTube] Failed to clear auth session:', err?.message)
  }
}

// Restores the authenticated client from the encrypted cookie file, if any.
async function ensureYouTubeAuth() {
  if (ytAuthInstance) return ytAuthInstance
  const saved = loadAuthCookies('yt_cookies')
  if (!saved) return null
  const cookieString = Array.isArray(saved)
    ? saved.map(c => `${c.name}=${c.value}`).join('; ')
    : String(saved)
  if (!cookieString) return null
  return initAuthenticatedYT(cookieString)
}
const { Readable } = require('stream')

// ─── Auth Cookie Storage (encrypted) ──────────────────────────────────────────
// These files hold full-account session material (Spotify `sp_dc`, Google
// `SAPISID`/`LOGIN_INFO`). They used to be written as plaintext JSON, readable by
// anything running as the user. Now they go through safeStorage (DPAPI on Windows).
// Files written by older versions are transparently migrated on first read.
function authCookiePath(name) {
  return path.join(app.getPath('userData'), `${name}.enc`)
}

function saveAuthCookies(name, value) {
  try {
    const target = authCookiePath(name)
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(target, safeStorage.encryptString(JSON.stringify(value)))
    } else {
      // No OS keychain available — still write, but never silently.
      console.warn(`[Auth] safeStorage unavailable; storing ${name} unencrypted`)
      fs.writeFileSync(target, JSON.stringify(value), 'utf8')
    }
    // Remove any legacy plaintext file now that the encrypted copy exists.
    const legacy = path.join(app.getPath('userData'), `${name}.json`)
    if (fs.existsSync(legacy)) { try { fs.unlinkSync(legacy) } catch {} }
    return true
  } catch (err) {
    console.error(`[Auth] Failed to save ${name}:`, err.message)
    return false
  }
}

function loadAuthCookies(name) {
  try {
    const target = authCookiePath(name)
    if (fs.existsSync(target)) {
      const raw = fs.readFileSync(target)
      if (safeStorage.isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(raw))
      }
      return JSON.parse(raw.toString('utf8'))
    }
    // Legacy plaintext migration
    const legacy = path.join(app.getPath('userData'), `${name}.json`)
    if (fs.existsSync(legacy)) {
      const parsed = JSON.parse(fs.readFileSync(legacy, 'utf8'))
      saveAuthCookies(name, parsed)
      return parsed
    }
  } catch (err) {
    console.error(`[Auth] Failed to load ${name}:`, err.message)
  }
  return null
}

// ─── Media Path Allow-list ────────────────────────────────────────────────────
// media:// and art:// used to serve ANY path on disk, so any injected renderer
// code could read arbitrary files. Both protocols now only serve paths that were
// explicitly introduced through a folder picker, file picker, library scan,
// download, or the saved preferences.
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus', '.webm'])
const allowedMediaRoots = new Set()   // directories the user has authorised
const allowedMediaFiles = new Set()   // individual files the user has authorised

function addAllowedRoot(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return
  try {
    allowedMediaRoots.add(path.resolve(dirPath).toLowerCase())
  } catch {}
}

function addAllowedFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return
  try {
    allowedMediaFiles.add(path.resolve(filePath).toLowerCase())
  } catch {}
}

function isPathAllowed(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  let resolved
  try { resolved = path.resolve(filePath) } catch { return false }
  const lower = resolved.toLowerCase()

  if (allowedMediaFiles.has(lower)) return true
  for (const root of allowedMediaRoots) {
    if (lower === root || lower.startsWith(root + path.sep)) return true
  }
  return false
}

// A directory is authorised if it *is* an allowed root, or sits inside one.
// Used for the handlers that take a folder rather than a file — they were
// previously happy to readdir any path the renderer named.
function isDirAllowed(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false
  let resolved
  try { resolved = path.resolve(dirPath) } catch { return false }
  const lower = resolved.toLowerCase()

  for (const root of allowedMediaRoots) {
    if (lower === root || lower.startsWith(root + path.sep)) return true
  }
  return false
}

// Guard for every IPC handler that accepts a path from the renderer.
// The allow-list is the app's central defence-in-depth control, so it has to be
// applied uniformly — enforcing it only in the media:// and art:// protocol
// handlers left the plain file handlers as an open door.
function assertAllowed(filePath) {
  if (!isPathAllowed(filePath)) {
    log.warn(`[IPC] Refused path outside allow-list: ${String(filePath).slice(0, 200)}`)
    throw new Error('Path not permitted')
  }
  return filePath
}

function assertDirAllowed(dirPath) {
  if (!isDirAllowed(dirPath)) {
    log.warn(`[IPC] Refused directory outside allow-list: ${String(dirPath).slice(0, 200)}`)
    throw new Error('Directory not permitted')
  }
  return dirPath
}

/**
 * YouTube ids (and the playlist/album ids derived from them) are `[A-Za-z0-9_-]`.
 *
 * This matters for more than tidiness: the download handler interpolates the id into
 * the yt-dlp output template — `%(title)s [<id>].%(ext)s` — so a value containing
 * `/`, `\` or `..` would let whoever called `download:start` write outside the
 * download folder. It is also the first argument of `execFile`, where a leading `-`
 * would be read as an option.
 */
function safeMediaId(value) {
  if (typeof value !== 'string') return null
  const id = value.replace(/^yt:/, '').trim()
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null
}

// Hosts the app legitimately streams from. Everything else is refused by both
// the media:// protocol and the CORS header injection below.
const STREAM_HOST_SUFFIXES = [
  '.googlevideo.com',
  '.youtube.com',
  'youtube.com',
  '.ytimg.com',
  'ytimg.com',
  '.ggpht.com',
  '.googleusercontent.com',
  '.spotifycdn.com',
  '.scdn.co',
]

function isStreamHost(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return STREAM_HOST_SUFFIXES.some(suffix =>
      suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
    )
  } catch {
    return false
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────
// `debug`/`info` are silent in production builds. Use these instead of raw
// console.log so shipped binaries don't spam stdout (and don't leak URLs).
const DEBUG_LOGS = process.env.NODE_ENV === 'development' || !!process.env.DEBUG_GLAZE
const log = {
  debug: (...args) => { if (DEBUG_LOGS) console.log(...args) },
  info:  (...args) => { if (DEBUG_LOGS) console.log(...args) },
  // warn/error are mirrored to disk. In a packaged build console output goes
  // nowhere, so these were producing no durable record of a problem at all.
  warn:  (...args) => { console.warn(...args); crashlog.logToFile('warn', ...args) },
  error: (...args) => { console.error(...args); crashlog.logToFile('error', ...args) },
}

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

// Run async tasks with bounded concurrency. Used for the home feed so a cold
// start doesn't fire ten parallel searches — each of which can fall through to
// spawning its own yt-dlp process.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

// Populate the media allow-list from the user's saved library folders and
// download folder, so previously-scanned files keep working after a restart.
function seedAllowedRootsFromPrefs() {
  try {
    const prefPath = path.join(app.getPath('documents'), 'Glaze Music', 'preferences.json')
    if (fs.existsSync(prefPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8')) || {}
      if (Array.isArray(prefs.folders)) prefs.folders.forEach(addAllowedRoot)
      if (prefs.downloadFolder) addAllowedRoot(prefs.downloadFolder)
      if (Array.isArray(prefs.libraryFiles)) prefs.libraryFiles.forEach(addAllowedFile)
    }
  } catch (err) {
    log.warn('[AllowList] Could not seed from preferences:', err.message)
  }
  // The default download folder is always fair game.
  try {
    addAllowedRoot(path.join(app.getPath('music'), 'Glaze Downloads'))
  } catch {}
  // userData holds downloaded/derived assets (e.g. yt-dlp binary output).
  try {
    addAllowedRoot(app.getPath('userData'))
  } catch {}
}

// ─── Process helpers ─────────────────────────────────────────────────────────
// On Windows, killing a spawned parent (yt-dlp) leaves its children (ffmpeg)
// orphaned — still holding the output file open. Kill the whole tree instead.
function killProcessTree(child) {
  if (!child || child.killed || !child.pid) return
  try {
    if (process.platform === 'win32') {
      require('child_process').execFile(
        'taskkill', ['/F', '/T', '/PID', String(child.pid)],
        { windowsHide: true }, () => {}
      )
    } else {
      child.kill('SIGKILL')
    }
  } catch (err) {
    log.warn('[Process] killProcessTree failed:', err.message)
  }
}

// ─── Custom Media Protocol ────────────────────────────────────────────────────
// Must be registered BEFORE app.whenReady().
// This lets the renderer (running on http://localhost:5173 in dev) load local
// audio files without hitting Chromium's cross-origin file:// block.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,        // Required for HTTP 206 range requests (audio seeking)
    },
  },
  {
    scheme: 'art',
    privileges: {
      secure: true,
      supportFetchAPI: true,
    },
  },
  {
    // Serves user-uploaded avatars (GIF/WebP/PNG) out of <userData>/avatars.
    // Scoped to that one directory by bare filename — it can never reach any
    // other path on disk, so it needs no entry in the media allow-list.
    scheme: 'avatar',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

// ─── Helper: map file extension to MIME type ──────────────────────────────────
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const types = {
    '.mp3':  'audio/mpeg',
    '.flac': 'audio/flac',
    '.wav':  'audio/wav',
    '.ogg':  'audio/ogg',
    '.aac':  'audio/aac',
    '.m4a':  'audio/mp4',
    '.opus': 'audio/opus',
    '.webm': 'audio/webm',
    // Image types — needed by the avatar:// protocol (GIF avatars must come back
    // as image/gif or Chromium refuses to animate them).
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.png':  'image/png',
    '.apng': 'image/apng',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.avif': 'image/avif',
    '.bmp':  'image/bmp',
    '.svg':  'image/svg+xml',
  }
  return types[ext] || 'application/octet-stream'
}

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let updater = null
const isDev = process.env.NODE_ENV === 'development'

// ─── Window Creation ──────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, '../assets/icon.png')
  mainWindow = new BrowserWindow({
    title: 'Glaze Music',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,           // Custom title bar — no OS chrome
    transparent: false,
    backgroundColor: '#0a0a0a',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,   // Security: renderer cannot access Node directly
      nodeIntegration: false,   // Security: Node.js disabled in renderer
      sandbox: true,            // Security: OS-level renderer sandbox (preload only needs contextBridge/ipcRenderer)
      backgroundThrottling: false, // Keep audio processing active when window is minimized/background
      spellcheck: false,
      // Same-origin policy stays ON. Cross-origin access to streaming hosts is
      // granted narrowly via the scoped onHeadersReceived handler in whenReady().
      webSecurity: true,
    },
  })


  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
    log.debug('[Main] Window created and displayed')
    setTimeout(() => {
      updateThumbnailToolbar(false) // Initialise the thumbar buttons once window is ready
    }, 600)
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // level 3 = error. `log.debug` is console-only and a packaged build has no
    // console, so a renderer exception used to leave no trace whatsoever — the
    // window just stayed blank. Persist errors to disk instead.
    if (level >= 3) crashlog.logToFile('error', `[Renderer L${level}] ${message} (${sourceId}:${line})`)
    log.debug(`[Renderer L${level}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-finish-load', () => {
    log.debug('[Renderer] Page finished loading')
    mainWindow?.show()
    mainWindow?.focus()
  })

  // `ready-to-show` only fires once the renderer has painted. If it never does,
  // the window stays hidden while the app keeps running (audio included), which
  // is indistinguishable from a crash. Show it regardless after a grace period.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      crashlog.logToFile('warn', '[Main] ready-to-show did not fire within 6s; forcing window visible')
      mainWindow.show()
      mainWindow.focus()
    }
  }, 6000)

  let loadAttempts = 0
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    // -3 is ERR_ABORTED: a newer navigation superseded this one, not a failure.
    if (errorCode === -3) return
    crashlog.logToFile('error', `[Renderer] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
    if (!isDev) return
    if (loadAttempts >= 12) {
      crashlog.logToFile('error', '[Renderer] Giving up on the dev server after 12 attempts — is vite listening on 5173?')
      return
    }
    loadAttempts++
    // vite may still be booting; the old single 1s retry could leave the app
    // sitting on an error page permanently. Back off instead.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL('http://127.0.0.1:5173')
    }, Math.min(1000 * loadAttempts, 4000))
  })

  // Load the Vite dev server in development, or the built HTML in production
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Intercept new window requests (e.g. target="_blank") and open in default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Prevent renderer navigation to arbitrary external web pages
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && !url.startsWith('http://127.0.0.1:5173') && !url.startsWith('file://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-change', true)
  })

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-change', false)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── yt-dlp Auto-Updater / Downloader ─────────────────────────────────────────
// Ensures yt-dlp is present and automatically self-updates in the background on every launch.
// The user NEVER has to manually update binaries.
async function ensureYtDlp() {
  const fs = require('fs')
  const path = require('path')
  const { execFile } = require('child_process')
  
  const bundledPath = app.isPackaged ? path.join(process.resourcesPath, 'yt-dlp.exe') : path.join(__dirname, '..', 'yt-dlp.exe')
  const destPath = path.join(app.getPath('userData'), 'yt-dlp.exe')
  
  let targetBinary = fs.existsSync(bundledPath) ? bundledPath : (fs.existsSync(destPath) ? destPath : null)
  
  if (targetBinary) {
    global.ytDlpPath = targetBinary
    // Check and apply yt-dlp updates in background asynchronously
    logDebug(`[Updater] Checking for yt-dlp updates in background: ${targetBinary}`)
    execFile(targetBinary, ['-U'], { timeout: 25000, windowsHide: true }, (err, stdout) => {
      if (!err && stdout) {
        logDebug(`[Updater] yt-dlp auto-update status: ${stdout.trim()}`)
      }
    })
    return
  }

  // If binary missing completely, download fresh latest release directly from GitHub
  logDebug('[Updater] No yt-dlp found. Downloading latest release from GitHub...')
  try {
    const response = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe')
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer()
      fs.writeFileSync(destPath, Buffer.from(arrayBuffer))
      global.ytDlpPath = destPath
      logDebug('[Updater] yt-dlp.exe downloaded successfully and is ready.')
    }
  } catch (e) {
    logDebug('[Updater] Failed to download fresh yt-dlp: ' + e.message)
  }
}

// ─── System Tray ──────────────────────────────────────────────────────────────
function createTray() {
  // Use the app icon for the tray
  const iconPath = path.join(__dirname, '../assets/icon.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip('Glaze Music')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Play / Pause',
      click: () => mainWindow?.webContents.send('tray:playpause'),
    },
    {
      label: 'Next Track',
      click: () => mainWindow?.webContents.send('tray:next'),
    },
    {
      label: 'Previous Track',
      click: () => mainWindow?.webContents.send('tray:prev'),
    },
    { type: 'separator' },
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Glaze Music',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)

  // Double-click the tray icon to restore the window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ─── Global Media Key Shortcuts ───────────────────────────────────────────────
function registerMediaKeys() {
  globalShortcut.register('MediaPlayPause', () => {
    mainWindow?.webContents.send('mediakey:playpause')
  })

  globalShortcut.register('MediaNextTrack', () => {
    mainWindow?.webContents.send('mediakey:next')
  })

  globalShortcut.register('MediaPreviousTrack', () => {
    mainWindow?.webContents.send('mediakey:prev')
  })

  globalShortcut.register('MediaStop', () => {
    mainWindow?.webContents.send('mediakey:stop')
  })

  // Global hotkey to toggle Mini-Player / PiP mode
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    toggleMiniPlayer()
  })
}

// ─── Mini-Player & Always-On-Top Window Management ────────────────────────────
let savedWindowBounds = null
let isMiniPlayerMode = false

function toggleMiniPlayer(enable) {
  if (!mainWindow) return false

  const targetState = enable !== undefined ? !!enable : !isMiniPlayerMode
  if (targetState === isMiniPlayerMode) return isMiniPlayerMode

  isMiniPlayerMode = targetState

  if (isMiniPlayerMode) {
    // Save current bounds & maximized state
    savedWindowBounds = {
      bounds: mainWindow.getBounds(),
      isMaximized: mainWindow.isMaximized(),
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }

    // Set widget size constraints allowing rich stretching & dynamic scaling
    // Portrait card, like a phone-sized now-playing tile.
    mainWindow.setMinimumSize(200, 360)
    mainWindow.setMaximumSize(1600, 1200)

    const targetW = 280
    const targetH = 470

    const { screen } = require('electron')
    const currentDisplay = screen.getDisplayMatching(mainWindow.getBounds()) || screen.getPrimaryDisplay()
    const workArea = currentDisplay.workArea

    const newX = Math.round(workArea.x + workArea.width - targetW - 24)
    const newY = Math.round(workArea.y + workArea.height - targetH - 24)

    mainWindow.setBounds({
      x: newX,
      y: newY,
      width: targetW,
      height: targetH,
    }, true)

    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    if (typeof mainWindow.setVisibleOnAllWorkspaces === 'function') {
      mainWindow.setVisibleOnAllWorkspaces(true)
    }
  } else {
    // Restore to normal full player window
    mainWindow.setAlwaysOnTop(false)
    if (typeof mainWindow.setVisibleOnAllWorkspaces === 'function') {
      mainWindow.setVisibleOnAllWorkspaces(false)
    }
    mainWindow.setMaximumSize(10000, 10000)
    mainWindow.setMinimumSize(900, 600)

    if (savedWindowBounds?.bounds) {
      mainWindow.setBounds(savedWindowBounds.bounds, true)
      if (savedWindowBounds.isMaximized) {
        mainWindow.maximize()
      }
    } else {
      mainWindow.setBounds({ width: 1280, height: 800 })
      mainWindow.center()
    }
  }

  mainWindow.webContents.send('mini-player-change', isMiniPlayerMode)
  return isMiniPlayerMode
}

// ─── IPC: Window Controls ─────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on('window:close', () => app.quit()) // Close completely instead of minimizing to tray
// Only hand a URL to the OS shell if it is a plain web/mail link. Without this a
// compromised renderer could pass `file:///…` or a custom protocol (e.g. a
// `ms-settings:` / `steam://` handler) and make the OS launch something else.
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])
ipcMain.handle('app:openExternal', (_event, url) => {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return false
  }
  if (!EXTERNAL_SCHEMES.has(parsed.protocol)) {
    log.warn(`[IPC] Refused openExternal for scheme ${parsed.protocol}`)
    return false
  }
  return shell.openExternal(parsed.toString())
})

// Mini-Player & PiP IPC Handlers
ipcMain.handle('window:toggleMiniPlayer', (_event, enable) => toggleMiniPlayer(enable))
ipcMain.handle('window:isMiniPlayer', () => isMiniPlayerMode)
ipcMain.handle('window:setMiniPlayerHeight', (_event, height) => {
  if (!mainWindow || !isMiniPlayerMode) return
  const bounds = mainWindow.getBounds()
  const clampedHeight = Math.max(130, Math.min(900, parseInt(height) || 165))
  const deltaY = bounds.height - clampedHeight
  mainWindow.setBounds({
    x: bounds.x,
    y: Math.max(0, bounds.y + deltaY),
    width: bounds.width,
    height: clampedHeight,
  }, true)
})
ipcMain.handle('window:toggleAlwaysOnTop', () => {
  if (!mainWindow) return false
  const newState = !mainWindow.isAlwaysOnTop()
  mainWindow.setAlwaysOnTop(newState, 'screen-saver')
  return newState
})
ipcMain.handle('window:getAlwaysOnTop', () => {
  return mainWindow ? mainWindow.isAlwaysOnTop() : false
})

// ─── IPC: Database (Stats, History, Metadata, Artist Art) ─────────────────────
ipcMain.on('db:logPlay', (_event, track) => db.logPlay(track))
ipcMain.handle('db:getAllStats', () => db.getAllStats())
ipcMain.handle('db:resetStats', () => db.resetStats())
ipcMain.handle('db:getHistory', () => db.getHistory())
ipcMain.handle('db:getBulkMetadata', (_event, srcArray) => db.getBulkCachedMetadata(srcArray))
ipcMain.on('db:cacheMetadata', (_event, src, meta) => db.cacheMetadata(src, meta))
ipcMain.handle('db:getArtistArtCache', () => db.getArtistArtFromDB())
ipcMain.on('db:saveArtistArtCache', (_event, artistName, imageUrl) => db.saveArtistArtToDB(artistName, imageUrl))
ipcMain.on('db:saveBulkArtistArtCache', (_event, entries) => db.saveBulkArtistArtToDB(entries))

// ─── IPC: Open Folder Dialog ──────────────────────────────────────────────────
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Music Folder',
  })
  // Return the selected folder path or null if cancelled
  if (result.canceled || result.filePaths.length === 0) return null
  addAllowedRoot(result.filePaths[0])
  return result.filePaths[0]
})

// ─── IPC: Open File Dialog ────────────────────────────────────────────────────
ipcMain.handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Open Audio Files',
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'ogg', 'aac', 'm4a', 'opus'] },
    ],
  })
  if (result.canceled) return []
  result.filePaths.forEach(addAllowedFile)
  return result.filePaths
})

// ─── IPC: Open Image Dialog (for profile picture) ────────────────────────────
// ─── IPC: Avatar upload ───────────────────────────────────────────────────────
// The renderer used to receive the whole file as a base64 data URL. A 4 MB
// animated GIF became a ~5.4 MB string that was stored inside preferences.json
// and re-serialised on every settings save — and it silently failed once the
// file got big enough. Instead the file is copied once into <userData>/avatars
// and the renderer gets an `avatar://<name>` URL back.
const AVATAR_DIR_NAME = 'avatars'
const AVATAR_MAX_BYTES = 25 * 1024 * 1024
const AVATAR_EXTENSIONS = ['gif', 'webp', 'png', 'jpg', 'jpeg', 'bmp', 'apng', 'avif']

function avatarDir() {
  return path.join(app.getPath('userData'), AVATAR_DIR_NAME)
}

ipcMain.handle('dialog:openImage', async () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: 'Choose an avatar (GIF, WebP or image)',
    filters: [
      { name: 'Animated & Image Files', extensions: ['gif', 'webp', 'apng', 'png', 'jpg', 'jpeg', 'avif', 'bmp'] },
      { name: 'Animated GIF', extensions: ['gif', 'webp', 'apng'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }

  try {
    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    if (!AVATAR_EXTENSIONS.includes(ext)) {
      return { error: `.${ext || '???'} is not an image. Use GIF, WebP, PNG or JPG.` }
    }

    const stat = await fs.promises.stat(filePath)
    if (!stat.size) return { error: 'That file is empty.' }
    if (stat.size > AVATAR_MAX_BYTES) {
      return { error: `That file is ${(stat.size / 1048576).toFixed(1)} MB — avatars must be under 25 MB.` }
    }

    const dir = avatarDir()
    await fs.promises.mkdir(dir, { recursive: true })

    // Content-addressed name: re-uploading the same GIF reuses the file, and the
    // immutable cache header below stays valid.
    const crypto = require('crypto')
    const hash = crypto.createHash('sha1')
      .update(await fs.promises.readFile(filePath))
      .digest('hex')
      .slice(0, 16)
    const fileName = `avatar-${hash}.${ext}`
    const dest = path.join(dir, fileName)

    if (!fs.existsSync(dest)) {
      await fs.promises.copyFile(filePath, dest)
    }

    return {
      url: `avatar://${fileName}`,
      fileName,
      size: stat.size,
      isAnimated: ['gif', 'webp', 'apng', 'avif'].includes(ext),
    }
  } catch (err) {
    console.error('Failed to import avatar:', err)
    return { error: err?.message || 'Could not read that file.' }
  }
})

// Drops avatar files that are no longer referenced by the saved profile.
ipcMain.handle('avatar:prune', async (_event, keepUrl) => {
  try {
    const dir = avatarDir()
    if (!fs.existsSync(dir)) return { removed: 0 }
    const keep = typeof keepUrl === 'string' && keepUrl.startsWith('avatar://')
      ? keepUrl.slice('avatar://'.length)
      : null
    let removed = 0
    for (const name of await fs.promises.readdir(dir)) {
      if (name === keep) continue
      try {
        await fs.promises.unlink(path.join(dir, name))
        removed++
      } catch { /* in use — skip */ }
    }
    return { removed }
  } catch (err) {
    console.error('Failed to prune avatars:', err)
    return { removed: 0, error: err?.message }
  }
})

// ─── IPC: Export Backup File (.glaze / .json) ─────────────────────────────────
ipcMain.handle('app:exportBackup', async (_event, backupData) => {
  const win = mainWindow || BrowserWindow.getFocusedWindow()
  const dateStr = new Date().toISOString().split('T')[0]
  const defaultPath = `glaze-backup-${dateStr}.glaze`
  
  const result = await dialog.showSaveDialog(win, {
    title: 'Export Glaze Music Backup',
    defaultPath,
    filters: [
      { name: 'Glaze Music Backup (*.glaze)', extensions: ['glaze'] },
      { name: 'JSON Backup (*.json)', extensions: ['json'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePath) return { canceled: true }
  
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(backupData, null, 2), 'utf8')
    return { success: true, filePath: result.filePath }
  } catch (err) {
    console.error('Failed to write backup file:', err)
    return { success: false, error: err.message }
  }
})

// ─── IPC: Import Backup File (.glaze / .json) ─────────────────────────────────
ipcMain.handle('app:importBackup', async () => {
  const win = mainWindow || BrowserWindow.getFocusedWindow()
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Glaze Music Backup File',
    properties: ['openFile'],
    filters: [
      { name: 'Glaze Music Backup (*.glaze, *.json)', extensions: ['glaze', 'json'] },
      { name: 'All Files (*.*)', extensions: ['*'] }
    ]
  })

  if (result.canceled || !result.filePaths.length) return { canceled: true }

  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8')
    const parsed = JSON.parse(raw)

    // Restoring a backup is an explicit user act — they just chose this file in
    // a native dialog — so this is the one place a backup's library folders may
    // extend the media allow-list. A compromised renderer cannot reach it
    // without the user seeing a file picker.
    //
    // Only paths that currently exist as directories are accepted, so a backup
    // naming a drive that isn't attached can't pre-authorise it. The startup
    // seed re-reads these from preferences.json next launch regardless.
    const restoredRoots = []
    const missingRoots = []
    const candidates = [...(Array.isArray(parsed.folders) ? parsed.folders : []), parsed.downloadFolder]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate) continue
      let exists = false
      try {
        exists = fs.statSync(candidate).isDirectory()
      } catch {
        exists = false
      }
      if (!exists) {
        // Restored onto a machine where this drive/path does not exist — a
        // different drive letter, an unplugged disk, a new PC. Report it so the
        // renderer can offer to relink the folder instead of silently restoring
        // an empty library.
        missingRoots.push(candidate)
        continue
      }
      addAllowedRoot(candidate)
      restoredRoots.push(candidate)
    }

    return { success: true, data: parsed, filePath: result.filePaths[0], restoredRoots, missingRoots }
  } catch (err) {
    console.error('Failed to parse backup file:', err)
    return { success: false, error: err.message }
  }
})

// ─── IPC: Scan Library ────────────────────────────────────────────────────────
// The recursive walk lives in ./scanner.cjs — it used to be a synchronous
// `fs.readdirSync` recursion inlined right here, which froze the main process
// (and therefore the whole UI) for the duration of a large scan. See that file
// for the traversal rules.
const SCAN_MAX_DEPTH = 40
const SCAN_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.aac', '.m4a', '.opus'])

ipcMain.handle('library:scan', async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') return []

  // Refuse to walk a directory the user has not authorised. Without this the
  // renderer could name any path — `C:\Users\...` — and have the main process
  // enumerate every audio file on the machine for it.
  //
  // The caller treats a throw as "root unreachable" and keeps that root's
  // existing index entries, so an unauthorised path degrades to "no results"
  // rather than to data loss.
  assertDirAllowed(folderPath)

  const { files } = await walkAudioFiles(folderPath, {
    maxDepth: SCAN_MAX_DEPTH,
    extensions: SCAN_EXTENSIONS,
    onWarn: (message) => log.warn(`[Scan] ${message}`),
  })

  // No allow-list widening here either — a folder is authorised when the user
  // picks it in a dialog, not when it is scanned. Doing it here meant a scan of
  // any path permanently granted access to it.
  return files
})

// ─── IPC: Local Library Index (SQLite-backed) ─────────────────────────────────
// The index of scanned local file paths lives in SQLite. It previously lived in
// localStorage, where a few thousand tracks exceeded the ~5 MB quota and the
// write failed inside an empty catch block — so the index silently stopped
// persisting and every launch paid for a full re-scan.
ipcMain.handle('library:loadIndex', () => {
  return db.getLibraryFiles()
})

ipcMain.handle('library:syncIndex', (_event, paths) => {
  return db.syncLibraryFiles(paths)
})

// ─── IPC: Read File as Buffer ─────────────────────────────────────────────────
// REMOVED. This handler returned the raw contents of any path the renderer
// named, with no allow-list check — which made it the single easiest way to
// exfiltrate arbitrary files once the renderer was compromised. Nothing called
// it: metadata now goes through `track:getMetadata` (parseFile reads only the
// tag block) and artwork goes through art://, which both enforce the allow-list.
// Deleting it was strictly better than securing it.

// ─── IPC: Extract track metadata (title, artist, album, albumArt, duration) ──
// Uses music-metadata's parseFile which reads only the metadata section of the
// file — much faster than passing the full buffer over IPC.
// Module is cached so the ESM dynamic import only fires once.
let _mm = null
async function getMM() {
  if (!_mm) _mm = await import('music-metadata')
  return _mm
}

ipcMain.handle('track:getMetadata', async (_event, filePath) => {
  try {
    assertAllowed(filePath)
    const { parseFile } = await getMM()
    const meta = await parseFile(filePath, { duration: true, skipPostHeaders: true })

    const result = {
      title:    meta.common.title  || null,
      artist:   meta.common.artist || null,
      album:    meta.common.album  || null,
      duration: meta.format.duration || 0,
      albumArt: null,
    }

    // We no longer return base64 albumArt here to save RAM.
    // The renderer will use the art:/// protocol to load images on demand.

    return result
  } catch (err) {
    if (err?.message !== 'Path not permitted') {
      console.warn('track:getMetadata error:', err.message)
    }
    return null
  }
})

// ─── IPC: Convert local file path → playable media:// URL ───────────────────
// Returns a media:// URL that the custom protocol handler can serve.
// Each path segment is individually encoded to handle spaces, #, ?, etc.
ipcMain.handle('file:toURL', (_event, filePath) => {
  assertAllowed(filePath)
  // Normalise Windows backslashes
  const normalized = filePath.replace(/\\/g, '/')
  // Encode each segment except the Windows drive letter ("C:")
  const encoded = normalized.split('/').map((segment, index) => {
    if (index === 0 && segment.endsWith(':')) return segment // e.g. "C:"
    return encodeURIComponent(segment)
  }).join('/')
  return `media:///${encoded}`
})

// ─── Thumbnail HD Upgrade Helpers ─────────────────────────────────────────────
async function searchWithYtDlp(query, maxResults = 25, type = 'song') {
  try {
    const path = require('path')
    const { execFile } = require('child_process')
    let ytdlpPath = global.ytDlpPath || (app.isPackaged
      ? path.join(process.resourcesPath, 'yt-dlp.exe')
      : path.join(__dirname, '..', 'yt-dlp.exe'))

    if (!fs.existsSync(ytdlpPath)) return []

    const q = `ytsearch${maxResults}:${query}`

    return new Promise((resolve) => {
      execFile(ytdlpPath, [
        q,
        '--dump-json',
        '--flat-playlist',
        '--no-warnings'
      ], { timeout: 10000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve([])
        const lines = stdout.trim().split('\n').filter(Boolean)
        const items = lines.map(line => {
          try {
            const parsed = JSON.parse(line)
            if (!parsed || !parsed.id) return null
            const vId = parsed.id
            const thumb = parsed.thumbnails?.[parsed.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`
            return {
              id: vId,
              videoId: vId,
              title: parsed.title || 'Unknown Title',
              artist: parsed.uploader || parsed.channel || parsed.artist || 'Unknown Artist',
              album: null,
              duration: parsed.duration || 0,
              thumbnail: thumb,
              type: type === 'playlist' ? 'Playlist' : 'Song'
            }
          } catch { return null }
        }).filter(Boolean)
        resolve(items)
      })
    })
  } catch (e) {
    return []
  }
}

function upgradeThumbnailUrl(url, videoId) {
  if (!url && videoId && !videoId.startsWith('UC') && !videoId.startsWith('FE') && !videoId.startsWith('MPREb_') && !videoId.startsWith('VL') && !videoId.startsWith('PL')) {
    return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  }
  if (!url || typeof url !== 'string') return null

  // Upgrade Google User Content / YouTube Music thumbnails to crisp 800x800 HD
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    if (url.includes('=w') || url.includes('=s')) {
      return url.replace(/=w\d+-h\d+[^?#]*/g, '=w800-h800-l90-rj').replace(/=s\d+[^?#]*/g, '=s800')
    }
    return url + '=w800-h800-l90-rj'
  }

  return url
}

function extractBestThumbnail(item, videoId) {
  if (!item) {
    return (videoId && !videoId.startsWith('UC') && !videoId.startsWith('FE') && !videoId.startsWith('MPREb_') && !videoId.startsWith('VL') && !videoId.startsWith('PL'))
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : null
  }
  if (typeof item === 'string') {
    return upgradeThumbnailUrl(item, videoId)
  }

  // Check all possible thumbnail containers from youtubei.js
  const candidates = [
    item.thumbnails,
    item.thumbnail?.contents,
    item.thumbnail,
    item.foreground_thumbnails,
    item.foreground_thumbnail,
    item.visuals?.avatar?.contents,
    item.visuals?.avatar,
    item.visuals?.banner?.contents,
    item.visuals?.banner,
    item.header?.foreground_thumbnails,
    item.header?.thumbnails,
    item.header?.thumbnail?.contents,
    item.header?.thumbnail,
    item.header?.background?.thumbnails,
    item.header?.banner?.thumbnails,
    item.banner?.thumbnails,
    item.background?.thumbnails
  ]

  let rawUrl = null
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      const sorted = [...c].sort((a, b) => (b.width || 0) - (a.width || 0))
      rawUrl = sorted[0]?.url || c[c.length - 1]?.url || c[0]?.url
      if (rawUrl) break
    } else if (typeof c === 'string') {
      rawUrl = c
      break
    } else if (c?.url) {
      rawUrl = c.url
      break
    }
  }

  const id = videoId || item.id || item.videoId || item.video_id
  return upgradeThumbnailUrl(rawUrl, id)
}

// ─── IPC: YouTube Music API (youtubei.js) ──────────────────────────────────
ipcMain.handle('youtube:search', async (_event, query, filterType = 'all') => {
  try {
    const q = (query || '').trim()
    if (!q) return filterType === 'all' ? { songs: [], artists: [], albums: [], playlists: [], topResult: null } : []

    const yt = await initYouTubeI()

    const extractItems = (searchResult) => {
      if (!searchResult || !searchResult.contents) return []
      const shelf = searchResult.contents.find(c => c.type === 'MusicShelf')
      return shelf ? shelf.contents : searchResult.contents
    }

    const parseSongItem = (i) => {
      const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      const id = i.id || i.videoId || i.video_id
      return {
        id: id,
        videoId: id,
        title: tText || 'Unknown Title',
        artist: i.authors?.map(a => a.name).join(', ') || i.artists?.map(a => a.name).join(', ') || (typeof i.author === 'string' ? i.author : i.author?.name) || 'Unknown Artist',
        album: i.album?.name || null,
        duration: i.duration?.seconds || (typeof i.duration === 'number' ? i.duration : 0),
        thumbnail: extractBestThumbnail(i, id),
        type: 'Song'
      }
    }

    const parseArtistItem = (i) => {
      const name = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : (i.name || i.title || 'Unknown Artist')
      const id = i.id || i.browse_id || i.channel_id || i.artist_id
      const subs = typeof i.subscribers === 'object' ? (i.subscribers?.text || i.subscribers?.toString()) : i.subscribers
      return {
        id: id || name,
        videoId: id || name,
        title: name,
        name: name,
        artist: name,
        subscribers: subs || null,
        thumbnail: extractBestThumbnail(i, id),
        type: 'Artist'
      }
    }

    const extractCount = (item) => {
      if (typeof item.item_count === 'number') return item.item_count
      if (typeof item.song_count === 'number') return item.song_count
      const candidates = [
        item.item_count,
        item.song_count,
        item.subtitle?.runs?.[2]?.text,
        item.subtitle?.runs?.[1]?.text,
        item.subtitle?.runs?.[0]?.text,
        item.flex_columns?.[1]?.title?.runs?.[2]?.text,
        item.flex_columns?.[1]?.title?.runs?.[0]?.text
      ]
      for (const val of candidates) {
        if (!val) continue
        const match = String(val).match(/(\d[\d,]*)\s*(?:songs?|tracks?|items?)/i)
        if (match) return parseInt(match[1].replace(/,/g, ''), 10)
      }
      return null
    }

    const parseAlbumItem = (i) => {
      const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      const id = i.id || i.browse_id || i.playlist_id
      return {
        id: id,
        videoId: id,
        title: tText || 'Unknown Album',
        artist: i.authors?.map(a => a.name).join(', ') || i.artists?.map(a => a.name).join(', ') || (typeof i.author === 'string' ? i.author : i.author?.name) || 'Unknown Artist',
        year: i.year || null,
        itemCount: extractCount(i),
        thumbnail: extractBestThumbnail(i, id),
        type: 'Album'
      }
    }

    const parsePlaylistItem = (i) => {
      const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      const id = i.id || i.playlist_id
      return {
        id: id,
        videoId: id,
        title: tText || 'Unknown Playlist',
        artist: i.authors?.map(a => a.name).join(', ') || (typeof i.author === 'string' ? i.author : i.author?.name) || 'YouTube Music',
        itemCount: extractCount(i),
        thumbnail: extractBestThumbnail(i, id),
        type: 'Playlist'
      }
    }

    // ── One response shape, always ───────────────────────────────────────────
    // This handler used to return a bare array for 'song'/'artist'/'album'/
    // 'playlist' and an object for 'all', which forced every caller to defend
    // against both. It now always returns the object below.
    const emptyResult = () => ({ topResult: null, songs: [], artists: [], albums: [], playlists: [] })
    const asResult = (key, items) => {
      const list = Array.isArray(items) ? items : []
      return {
        ...emptyResult(),
        [key]: list,
        topResult: list.length > 0 ? { ...list[0], isTopResult: true } : null,
      }
    }

    // Specific filter searches
    if (filterType === 'song' || filterType === 'songs') {
      try {
        if (yt) {
          const res = await yt.music.search(q, { type: 'song' })
          const parsed = extractItems(res).filter(i => i.id || i.videoId).map(parseSongItem)
          if (parsed.length > 0) return asResult('songs', parsed)
        }
      } catch(e) {}
      return asResult('songs', await searchWithYtDlp(q, 25, 'song'))
    }
    if (filterType === 'artist' || filterType === 'artists') {
      try {
        if (yt) {
          const res = await yt.music.search(q, { type: 'artist' })
          const parsed = extractItems(res).filter(i => i.id || i.name || i.title).map(parseArtistItem)
          if (parsed.length > 0) return asResult('artists', parsed)
        }
      } catch(e) {}
      return emptyResult()
    }
    if (filterType === 'album' || filterType === 'albums') {
      try {
        if (yt) {
          const res = await yt.music.search(q, { type: 'album' })
          const parsed = extractItems(res).filter(i => i.id).map(parseAlbumItem)
          if (parsed.length > 0) return asResult('albums', parsed)
        }
      } catch(e) {}
      return emptyResult()
    }
    if (filterType === 'playlist' || filterType === 'playlists') {
      try {
        if (yt) {
          const res = await yt.music.search(q, { type: 'playlist' })
          const parsed = extractItems(res).filter(i => i.id).map(parsePlaylistItem)
          if (parsed.length > 0) return asResult('playlists', parsed)
        }
      } catch(e) {}
      return asResult('playlists', await searchWithYtDlp(q, 20, 'playlist'))
    }

    // Unified Multi-Type Search (All)
    let songs = []
    let artists = []
    let albums = []
    let playlists = []

    try {
      if (yt) {
        const [songRes, artistRes, albumRes, playlistRes] = await Promise.all([
          yt.music.search(q, { type: 'song' }).catch(() => ({ contents: [] })),
          yt.music.search(q, { type: 'artist' }).catch(() => ({ contents: [] })),
          yt.music.search(q, { type: 'album' }).catch(() => ({ contents: [] })),
          yt.music.search(q, { type: 'playlist' }).catch(() => ({ contents: [] }))
        ])

        songs = extractItems(songRes).filter(i => i.id || i.videoId).slice(0, 25).map(parseSongItem)
        artists = extractItems(artistRes).filter(i => i.id || i.name || i.title).slice(0, 10).map(parseArtistItem)
        albums = extractItems(albumRes).filter(i => i.id).slice(0, 10).map(parseAlbumItem)
        playlists = extractItems(playlistRes).filter(i => i.id).slice(0, 10).map(parsePlaylistItem)
      }
    } catch (e) {}

    // If songs is empty due to Innertube error, fallback to yt-dlp
    if (songs.length === 0) {
      songs = await searchWithYtDlp(q, 25, 'song')
    }

    // Determine Top Result / Best Match
    let topResult = null
    const lowerQ = q.toLowerCase()
    const matchedArtist = artists.find(a => a.name.toLowerCase() === lowerQ || a.name.toLowerCase().startsWith(lowerQ))
    if (matchedArtist) {
      topResult = { ...matchedArtist, isTopResult: true }
    } else if (songs.length > 0) {
      topResult = { ...songs[0], isTopResult: true }
    }

    return {
      topResult,
      songs,
      artists,
      albums,
      playlists
    }
  } catch (err) {
    console.error('youtube:search error:', err)
    const fallbackSongs = await searchWithYtDlp(query, 25, 'song')
    return {
      songs: fallbackSongs,
      artists: [],
      albums: [],
      playlists: [],
      topResult: fallbackSongs[0] || null
    }
  }
})

let cachedUserCountry = null

ipcMain.handle('youtube:getHome', async () => {
  try {
    const yt = await initYouTubeI()
    if (!yt) throw new Error('youtubei.js not initialized')

    // Resolve the user's region from the OS locale only.
    // This previously called http://ip-api.com/json — plaintext HTTP, sending the
    // user's IP to a third party with no consent, and blocking the home feed for
    // up to 1.5s before falling back to the locale anyway.
    let userCountry = cachedUserCountry || 'Regional'
    if (!cachedUserCountry) {
      try {
        const code = app.getLocaleCountryCode()
        if (code) {
          userCountry = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || 'Regional'
          cachedUserCountry = userCountry
        }
      } catch (err) {}
    }

    const fetchSongQuery = async (q) => {
      try {
        if (yt) {
          const results = await yt.music.search(q, { type: 'song' })
          let items = []
          if (results && results.contents) {
            const shelf = results.contents.find(c => c.type === 'MusicShelf')
            if (shelf) items = shelf.contents
            else items = results.contents
          }
          const valid = (items || []).filter(i => i.id || i.videoId).slice(0, 30).map(i => {
            const vId = i.id || i.videoId
            const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
            return {
              id: vId,
              videoId: vId,
              title: tText || 'Unknown Title',
              artist: i.authors?.map(a => a.name).join(', ') || i.artists?.map(a => a.name).join(', ') || (typeof i.author === 'string' ? i.author : i.author?.name) || 'Unknown Artist',
              album: i.album?.name || null,
              duration: i.duration?.seconds || 0,
              thumbnail: extractBestThumbnail(i, vId),
              type: 'Song'
            }
          })
          if (valid.length > 0) return valid
        }
      } catch (e) {}
      return searchWithYtDlp(q, 25, 'song')
    }

    const fetchPlaylistQuery = async (q) => {
      try {
        if (yt) {
          const res = await yt.music.search(q, { type: 'playlist' })
          let pItems = []
          if (res && res.contents) {
            const shelf = res.contents.find(c => c.type === 'MusicShelf')
            pItems = shelf ? shelf.contents : res.contents
          }
          const valid = (pItems || []).filter(i => i.id || i.playlist_id).slice(0, 30).map(i => {
            const vId = i.id || i.playlist_id
            const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
            return {
              id: vId,
              videoId: vId,
              title: tText || 'Unknown Title',
              artist: i.authors?.map(a => a.name).join(', ') || (typeof i.author === 'string' ? i.author : i.author?.name) || 'YouTube Music',
              album: null,
              duration: 0,
              thumbnail: extractBestThumbnail(i, vId),
              type: 'Playlist'
            }
          })
          if (valid.length > 0) return valid
        }
      } catch (e) {}
      return searchWithYtDlp(q, 20, 'playlist')
    }

    // Bounded concurrency (4) instead of 10 simultaneous searches — on a slow
    // network the unbounded version could spawn 10 concurrent yt-dlp processes.
    const homeTasks = [
      () => fetchSongQuery(`Trending Songs ${userCountry}`),
      () => fetchSongQuery('Global Top 50 Hits'),
      () => fetchPlaylistQuery('Global Top Music Playlists'),
      () => fetchSongQuery('Viral Songs Trending TikTok'),
      () => fetchSongQuery('Lofi Hip Hop Chill Music'),
      () => fetchSongQuery('Late Night Drive R&B Songs'),
      () => fetchSongQuery('Workout Motivation EDM Hits'),
      () => fetchSongQuery('Top Bollywood Songs Chartbusters'),
      () => fetchSongQuery('Slowed and Reverb Songs'),
      () => fetchPlaylistQuery('Global Top Podcasts')
    ]

    const [
      localTrending,
      globalHits,
      topPlaylists,
      viralSongs,
      chillBeats,
      nightDrive,
      workoutHits,
      bollywoodHits,
      remixes,
      podcasts
    ] = await mapWithConcurrency(homeTasks, 4, (task) => task())

    const sections = []
    if (localTrending.length > 0) {
      sections.push({ title: userCountry === 'Regional' ? 'Trending Songs' : `Trending in ${userCountry}`, query: `Trending Songs ${userCountry}`, items: localTrending })
    }
    if (globalHits.length > 0) {
      sections.push({ title: 'Global Top Hits & Charts', query: 'Global Top 50 Hits', items: globalHits })
    }
    if (topPlaylists.length > 0) {
      sections.push({ title: 'Popular Playlists & Mixes', query: 'Global Top Music Playlists', items: topPlaylists })
    }
    if (viralSongs.length > 0) {
      sections.push({ title: 'Viral & Social Trends', query: 'Viral Songs Trending TikTok', items: viralSongs })
    }
    if (chillBeats.length > 0) {
      sections.push({ title: 'Chill & Lofi Beats', query: 'Lofi Hip Hop Chill Music', items: chillBeats })
    }
    if (nightDrive.length > 0) {
      sections.push({ title: 'Late Night Drive & R&B', query: 'Late Night Drive R&B Songs', items: nightDrive })
    }
    if (workoutHits.length > 0) {
      sections.push({ title: 'Workout & Energy Booster', query: 'Workout Motivation EDM Hits', items: workoutHits })
    }
    if (bollywoodHits.length > 0) {
      sections.push({ title: 'Bollywood & Regional Hits', query: 'Top Bollywood Songs Chartbusters', items: bollywoodHits })
    }
    if (remixes.length > 0) {
      sections.push({ title: 'Slowed, Reverb & Remixes', query: 'Slowed and Reverb Songs', items: remixes })
    }
    if (podcasts.length > 0) {
      sections.push({ title: 'Top Podcasts & Audio Shows', query: 'Global Top Podcasts', items: podcasts })
    }

    return sections
  } catch (err) {
    console.error('youtube:getHome error:', err)
    return []
  }
})

// Extended category: uses algorithmic "Radio/Up Next" based on the query for songs, and continuations for playlists
ipcMain.handle('youtube:getExtendedCategory', async (_event, baseQuery, type = 'song') => {
  try {
    const yt = await initYouTubeI()
    if (!yt) throw new Error('youtubei.js not initialized')

    if (type === 'playlist') {
      const results = await yt.music.search(baseQuery, { type: 'playlist' })
      let items = []
      if (results.contents) {
        let shelf = results.contents.find(c => c.type === 'MusicShelf')
        if (shelf) {
          items = [...shelf.contents]
          try {
            if (shelf.has_continuation) {
              shelf = await shelf.getContinuation()
              items.push(...shelf.contents)
              if (shelf.has_continuation) {
                shelf = await shelf.getContinuation()
                items.push(...shelf.contents)
              }
            }
          } catch(e) {}
        } else {
          items = results.contents
        }
      }
      return items.filter(i => i.id).map(i => ({
        videoId: i.id,
        title: i.title || 'Unknown Title',
        artist: i.authors?.map(a => a.name).join(', ') || (typeof i.author === 'string' ? i.author : i.author?.name) || 'YouTube Music',
        album: null,
        duration: 0,
        thumbnail: extractBestThumbnail(i, i.id),
        type: 'Playlist'
      }))
    }

    // 1. Fetch seed songs based on the query
    const searchRes = await yt.music.search(baseQuery, { type: 'song' })
    let seedItems = []
    if (searchRes.contents) {
      const shelf = searchRes.contents.find(c => c.type === 'MusicShelf')
      seedItems = shelf ? shelf.contents : searchRes.contents
    }

    // Take top 3 seed videos
    const seedIds = seedItems.filter(i => i.id).slice(0, 3).map(i => i.id)

    // 2. Fetch algorithmic UpNext (Radio) for each seed
    const fetchUpNext = async (videoId) => {
      try {
        const upNext = await yt.music.getUpNext(videoId)
        return upNext.contents || []
      } catch (e) {
        return []
      }
    }

    const upNextResults = await Promise.all(seedIds.map(fetchUpNext))

    // 3. Merge everything (including the original seeds)
    const allItems = [...seedItems]
    for (const batch of upNextResults) {
      allItems.push(...batch)
    }

    // 4. Map the items consistently. UpNext items use `video_id` instead of `id` and `thumbnail` instead of `thumbnails`.
    const mapItem = (i) => {
      const titleStr = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      
      let artistStr = 'Unknown Artist'
      if (i.authors) artistStr = i.authors.map(a => a.name).join(', ')
      else if (i.artists) artistStr = i.artists.map(a => a.name).join(', ')
      else if (i.author) artistStr = typeof i.author === 'string' ? i.author : i.author?.name
      
      const vId = i.video_id || i.id
      
      return {
        videoId: vId,
        title: titleStr || 'Unknown Title',
        artist: artistStr,
        album: i.album?.name || null,
        duration: i.duration?.seconds || 0,
        thumbnail: extractBestThumbnail(i, vId),
        type: 'Song'
      }
    }

    // Deduplicate and filter out items without IDs
    const seen = new Set()
    const merged = []
    for (const item of allItems) {
      const mapped = mapItem(item)
      if (mapped.videoId && !seen.has(mapped.videoId)) {
        seen.add(mapped.videoId)
        merged.push(mapped)
      }
    }

    return merged
  } catch (err) {
    console.error('youtube:getExtendedCategory error:', err)
    return []
  }
})

// ─── Playlist continuation cache ──────────────────────────────────────────────
// Keyed by playlist ID. This used to be a single `global.currentPlaylistCache`,
// so opening playlist B before paging playlist A would append B's tracks to A.
const playlistContinuations = new Map()
const PLAYLIST_CONTINUATION_MAX = 5

function setPlaylistContinuation(playlistId, playlist) {
  if (!playlistId) return
  if (!playlist || !playlist.has_continuation) {
    playlistContinuations.delete(playlistId)
    return
  }
  if (playlistContinuations.size >= PLAYLIST_CONTINUATION_MAX) {
    playlistContinuations.delete(playlistContinuations.keys().next().value)
  }
  playlistContinuations.set(playlistId, playlist)
}

ipcMain.handle('youtube:getPlaylist', async (_event, playlistId) => {
  try {
    if (!playlistId) return []
    const rawListId = playlistId.startsWith('VL') ? playlistId.replace(/^VL/, '') : playlistId
    const vlListId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`

    // "Liked Music" (VLLM) is the flagship entry point from the home feed, and
    // fetching it cold paginates ~1300 rows over 8 s. The library sync already
    // holds exactly those rows, so serve them straight out of the cache.
    if ((playlistId === 'VLLM' || rawListId === 'LM') && ytLibraryCache?.likedTracks?.length) {
      return ytLibraryCache.likedTracks
    }
    
    // 1. Fast & reliable: Try youtubei.js first
    let yt = ytAuthInstance
    if (!yt) {
      const saved = loadAuthCookies('yt_cookies')
      if (saved) {
        try {
          yt = await initAuthenticatedYT(saved)
        } catch(e) {}
      }
    }
    if (!yt) yt = await initYouTubeI()

    let items = []
    let albumArtist = null
    let albumTitle = null
    let playlistArtist = null

    if (yt) {
      try {
        if (playlistId.startsWith('MPREb_')) {
          const album = await yt.music.getAlbum(playlistId)
          setPlaylistContinuation(playlistId, null)
          if (album) {
            if (album.contents) items = album.contents
            if (album.header?.artists) albumArtist = album.header.artists.map(a => a.name).join(', ')
            else if (album.header?.author) albumArtist = typeof album.header.author === 'string' ? album.header.author : (album.header.author?.name || album.header.author?.text)
            else if (album.artists) albumArtist = album.artists.map(a => a.name).join(', ')
            else if (album.author) albumArtist = typeof album.author === 'string' ? album.author : (album.author?.name || album.author?.text)
            
            albumTitle = typeof album.header?.title === 'object' ? (album.header.title.text || album.header.title.toString()) : (album.header?.title || album.title || null)
          }
        } else {
          let playlist = null
          // Try music.getPlaylist with full ID, stripped ID, and VL-prefixed ID
          try {
            playlist = await yt.music.getPlaylist(playlistId)
          } catch (e1) {
            try {
              playlist = await yt.music.getPlaylist(rawListId)
            } catch (e2) {
              try {
                playlist = await yt.music.getPlaylist(vlListId)
              } catch (e3) {
                // Fallback to yt.getPlaylist
                try {
                  playlist = await yt.getPlaylist(rawListId)
                } catch (e4) {
                  playlist = null
                }
              }
            }
          }

          setPlaylistContinuation(playlistId, playlist)
          if (playlist) {
            if (playlist.header?.artists) playlistArtist = playlist.header.artists.map(a => a.name).join(', ')
            else if (playlist.header?.author) playlistArtist = typeof playlist.header.author === 'string' ? playlist.header.author : (playlist.header.author?.name || playlist.header.author?.text)
            else if (playlist.author) playlistArtist = typeof playlist.author === 'string' ? playlist.author : (playlist.author?.name || playlist.author?.text)

            items = playlist.items || playlist.contents || playlist.videos || []
            // A radio/mix (`RD…`) never stops offering continuations — it is an
            // endless station, not a finite list. Paging it to the 2000-item cap
            // took 40 s and returned 1188 "tracks" for a My Mix. YouTube Music
            // itself shows the first ~100 and then keeps streaming on demand.
            const isRadioMix = /^VL?RD/.test(playlistId)
            const itemCap = isRadioMix ? 100 : 2000
            let rounds = 0
            while (playlist.has_continuation && items.length < itemCap && rounds < 30) {
              try {
                const more = await playlist.getContinuation()
                if (!more) break
                playlist = more
                const moreItems = more.items || more.contents || more.videos || []
                if (moreItems.length === 0) break
                items = items.concat(moreItems)
                rounds++
              } catch (e) {
                break
              }
            }
          }
        }
      } catch (ytErr) {
        console.warn('[youtube:getPlaylist] youtubei error:', ytErr.message)
      }
    }

    // 2. If youtubei returned 0 items, fallback to yt-dlp flat-playlist extraction
    if (items.length === 0) {
      try {
        const path = require('path')
        const { execFile } = require('child_process')
        let ytdlpPath = global.ytDlpPath || (app.isPackaged
          ? path.join(process.resourcesPath, 'yt-dlp.exe')
          : path.join(__dirname, '..', 'yt-dlp.exe'))

        const ytdlpOutput = await new Promise((resolve) => {
          execFile(ytdlpPath, [
            `https://www.youtube.com/playlist?list=${rawListId}`,
            '--flat-playlist',
            '--playlist-end', '2000',
            '-J',
            '--no-warnings'
          ], { maxBuffer: 50 * 1024 * 1024, timeout: 15000, windowsHide: true }, (err, stdout) => {
            if (err || !stdout) resolve(null)
            else resolve(stdout)
          })
        })

        if (ytdlpOutput) {
          const ytJson = JSON.parse(ytdlpOutput)
          const entries = ytJson.entries || []
          if (entries.length > 0) {
            return entries.map(entry => {
              const vId = entry.id || entry.url?.match(/v=([^&]+)/)?.[1]
              const thumb = entry.thumbnails?.[entry.thumbnails.length - 1]?.url || (vId ? `https://i.ytimg.com/vi/${vId}/hq720.jpg` : null)
              return {
                videoId: vId,
                title: entry.title || 'Unknown Title',
                artist: entry.uploader || entry.channel || entry.uploader_id || albumArtist || playlistArtist || 'Unknown Artist',
                album: albumTitle || null,
                duration: entry.duration || 0,
                thumbnail: upgradeThumbnailUrl(thumb, vId),
                type: 'Song'
              }
            }).filter(e => e.videoId)
          }
        }
      } catch (ytdlpErr) {
        console.error('[youtube:getPlaylist] yt-dlp error:', ytdlpErr.message)
      }
    }
    
    return items.filter(i => i.id || i.videoId || i.video_id).map(i => {
      const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      let aText = null
      if (i.authors && i.authors.length > 0) aText = i.authors.map(a => a.name || a.text || a).join(', ')
      else if (i.artists && i.artists.length > 0) aText = i.artists.map(a => a.name || a.text || a).join(', ')
      else if (i.author) aText = typeof i.author === 'string' ? i.author : (i.author?.name || i.author?.text)
      else if (i.subtitle?.runs && i.subtitle.runs.length > 0) {
        const runText = i.subtitle.runs.map(r => r.text).filter(t => t && t !== '•' && !t.includes(':')).join(', ')
        if (runText) aText = runText
      } else if (i.flex_columns?.[1]?.title?.runs) {
        const runText = i.flex_columns[1].title.runs.map(r => r.text).filter(t => t && t !== '•' && !t.includes(':')).join(', ')
        if (runText) aText = runText
      }

      if (!aText || aText === 'Unknown Artist' || aText === 'Unknown') {
        aText = albumArtist || playlistArtist || 'Unknown Artist'
      }

      const vId = i.id || i.videoId || i.video_id
      return {
        videoId: vId,
        title: tText || 'Unknown Title',
        artist: aText,
        album: i.album?.name || albumTitle || null,
        duration: i.duration?.seconds || (typeof i.duration === 'number' ? i.duration : 0),
        thumbnail: extractBestThumbnail(i, vId),
        type: 'Song'
      }
    })
  } catch (err) {
    console.error('youtube:getPlaylist error:', err)
    return []
  }
})

ipcMain.handle('youtube:getPlaylistContinuation', async (_event, playlistId) => {
  try {
    const cached = playlistId ? playlistContinuations.get(playlistId) : null
    if (!cached || !cached.has_continuation) {
      return { items: [], hasMore: false }
    }
    
    const more = await cached.getContinuation()
    setPlaylistContinuation(playlistId, more)

    const items = more.items || more.contents || []
    
    const mapped = items.filter(i => i.id || i.videoId).map(i => {
      const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      let aText = 'Unknown Artist'
      if (i.authors) aText = i.authors.map(a => a.name).join(', ')
      else if (i.artists) aText = i.artists.map(a => a.name).join(', ')
      else if (i.author) aText = typeof i.author === 'string' ? i.author : i.author?.name

      const vId = i.id || i.videoId
      return {
        videoId: vId,
        title: tText || 'Unknown Title',
        artist: aText,
        album: i.album?.name || null,
        duration: i.duration?.seconds || (typeof i.duration === 'number' ? i.duration : 0),
        thumbnail: extractBestThumbnail(i, vId),
        type: 'Song'
      }
    })

    return { items: mapped, hasMore: more.has_continuation }
  } catch (err) {
    console.error('youtube:getPlaylistContinuation error:', err)
    return { items: [], hasMore: false }
  }
})

ipcMain.handle('youtube:getUpNextBatch', async (_event, seedIds) => {
  try {
    const yt = await initYouTubeI()
    if (!yt) return []

    const validSeeds = Array.isArray(seedIds) ? seedIds.filter(Boolean) : []
    if (validSeeds.length === 0) return []

    const fetchUpNext = async (rawId) => {
      try {
        if (!rawId) return []
        let vId = typeof rawId === 'string' ? rawId.replace(/^yt:/, '').trim() : ''
        if (!vId) return []

        // If not a standard 11-char video ID (e.g. search string or title), search for it first
        if (!/^[a-zA-Z0-9_-]{11}$/.test(vId)) {
          const searchRes = await yt.music.search(vId, { type: 'song' })
          let firstItem = null
          if (searchRes?.contents) {
            const shelf = searchRes.contents.find(c => c.type === 'MusicShelf')
            firstItem = shelf?.contents?.[0] || searchRes.contents?.[0]
          }
          if (firstItem?.id) {
            vId = firstItem.id
          } else {
            const items = (searchRes?.contents?.find(c => c.type === 'MusicShelf')?.contents || searchRes?.contents || []).slice(0, 10)
            return items
          }
        }

        try {
          const upNext = await yt.music.getUpNext(vId)
          if (upNext?.contents && upNext.contents.length > 0) {
            return upNext.contents
          }
        } catch (err) {
          // getUpNext failed, fall through to search fallback
        }

        // Fallback: search similar songs if getUpNext returned empty
        const fallbackRes = await yt.music.search(vId, { type: 'song' })
        const shelf = fallbackRes?.contents?.find(c => c.type === 'MusicShelf')
        return shelf?.contents || fallbackRes?.contents || []
      } catch (e) {
        return []
      }
    }

    const upNextResults = await Promise.all(validSeeds.map(fetchUpNext))
    const allItems = []
    for (const batch of upNextResults) {
      if (Array.isArray(batch)) allItems.push(...batch)
    }

    const mapItem = (i) => {
      const titleStr = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title
      let artistStr = 'Unknown Artist'
      if (i.authors) artistStr = i.authors.map(a => a.name).join(', ')
      else if (i.artists) artistStr = i.artists.map(a => a.name).join(', ')
      else if (i.author) artistStr = typeof i.author === 'string' ? i.author : i.author?.name
      
      let type = 'Song'
      if (i.type === 'Artist' || i.subscribers) type = 'Artist'
      else if (i.type === 'Album' || i.type === 'EP' || i.type === 'Single') type = 'Album'
      else if (i.type === 'Playlist') type = 'Playlist'
      else if (i.type === 'Video') type = 'Video'

      const vId = i.video_id || i.id || i.overlay?.content?.endpoint?.payload?.videoId || i.endpoint?.payload?.videoId
      const isActualVideoId = vId && /^[a-zA-Z0-9_-]{11}$/.test(vId)

      return {
        videoId: isActualVideoId ? vId : null,
        title: titleStr || 'Unknown',
        artist: artistStr,
        album: i.album?.name || null,
        duration: i.duration?.seconds || 0,
        thumbnail: extractBestThumbnail(i, vId),
        type: type
      }
    }

    const seen = new Set()
    const merged = []
    for (const item of allItems) {
      const mapped = mapItem(item)
      // Only include valid, directly playable songs
      if (mapped.videoId && mapped.type !== 'Artist' && mapped.type !== 'Playlist' && !seen.has(mapped.videoId)) {
        seen.add(mapped.videoId)
        merged.push(mapped)
      }
    }
    return merged
  } catch(e) {
    return []
  }
})

ipcMain.handle('youtube:getSearchSuggestions', async (_event, query) => {
  try {
    const yt = await initYouTubeI()
    if (!yt || !query) return []
    const suggestions = await yt.music.getSearchSuggestions(query)
    if (!suggestions) return []
    return suggestions.map(s => s.query || s.text || '').filter(Boolean)
  } catch(e) {
    console.error('youtube:getSearchSuggestions error:', e)
    return []
  }
})

const artistInfoMemoryCache = new Map()
const ARTIST_INFO_CACHE_MAX = 80

// Every write must go through here. The fallback branch below used to call
// .set() directly, bypassing the size cap, so a session that kept falling back
// to the search path grew this map without bound.
function cacheArtistInfo(key, data) {
  if (!key) return
  artistInfoMemoryCache.delete(key)
  artistInfoMemoryCache.set(key, { data, expireAt: Date.now() + 2 * 60 * 60 * 1000 })
  while (artistInfoMemoryCache.size > ARTIST_INFO_CACHE_MAX) {
    artistInfoMemoryCache.delete(artistInfoMemoryCache.keys().next().value)
  }
}

// Seeded artist → YouTube Music browse ID. These are only a fast-path fallback
// for very common searches; everything else is resolved dynamically. This table
// is treated as static seed data — the dynamic cache below has a TTL and a size
// cap so it can't grow unbounded or serve permanently stale IDs.
const ARTIST_CHANNEL_SEED = Object.freeze({
  'the weeknd': 'UClYV6hHlupm_S_ObS1W-DYw',
  'taylor swift': 'UCPC0L1d253x-KuMNwa05TpA',
  'drake': 'UCU6cE7pdJPc6DU2jSrKEsdQ',
  'justin bieber': 'UCGvj8kfUV5Q6lzECIrGY19g',
  'billie eilish': 'UCERrDZ8oN0U_n9MphMKERcg',
  'ariana grande': 'UC0076UMUgEng8HORUw_MYHA',
  'travis scott': 'UCf_gP4AMRSgAfyzbkeS9k4g',
  'bruno mars': 'UCZn4r7heNOPY-C43YIywnVA',
  'dua lipa': 'UCzVb0SIXp9q9PeKCcFjsBtA',
  'kendrick lamar': 'UCprAFmT0C6O4X0ToEXpeFTQ',
  'post malone': 'UCyD3XWRK9ko-izf2nBSFitw',
  'ed sheeran': 'UClmXPfaYhXOYsNn_QUyheWQ',
  'coldplay': 'UCIaFw5VBEK8qaW6nRpx_qnw',
  'arijit singh': 'UCDxKh1gFWeYsqePvgVzmPoQ',
  'eminem': 'UCedvOgsKFzcK3hA5taf3KoQ',
  'sabrina carpenter': 'UCz51ZodJbYUNfkdPHOjJKKw',
  'shakira': 'UCo6JijJGA3IvIiPsawDK3Ww',
  'one direction': 'UCREhun2tPd7aQnJczZM_Mww',
  'dave': 'UCu8B46V0mU2Wqii6qUatrvw',
  'tems': 'UCXg6YtKpgC59gRKUfxQw8Fw',
  'diljit dosanjh': 'UCm9VFgmvd7b7xN35j8s3J8A',
  'karan aujla': 'UCuH_aG55b85i4d8p1Q_T7rg',
  'pritam': 'UCAEv0hfsH5W8g47g8Cgm-6Q',
  'atif aslam': 'UC2uS_8v1R5jG8K7t2Wq5Bkw',
  'lana del rey': 'UCoxN_qNnZ9E4B7q8eP0U4-w'
})

const ARTIST_CHANNEL_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const ARTIST_CHANNEL_CACHE_MAX = 200
const artistChannelIdCache = new Map() // key -> { id, expireAt }

function getCachedArtistChannelId(key) {
  const entry = artistChannelIdCache.get(key)
  if (!entry) return null
  if (entry.expireAt < Date.now()) {
    artistChannelIdCache.delete(key)
    return null
  }
  return entry.id
}

function setCachedArtistChannelId(key, id) {
  if (!key || !id) return
  if (artistChannelIdCache.size >= ARTIST_CHANNEL_CACHE_MAX) {
    artistChannelIdCache.delete(artistChannelIdCache.keys().next().value)
  }
  artistChannelIdCache.set(key, { id, expireAt: Date.now() + ARTIST_CHANNEL_TTL_MS })
}

function lookupArtistChannelId(key) {
  return getCachedArtistChannelId(key) || ARTIST_CHANNEL_SEED[key] || null
}

ipcMain.handle('youtube:getArtistInfo', async (_event, artistIdentifier) => {
  try {
    if (!artistIdentifier) return null
    const cacheKey = String(artistIdentifier).trim().toLowerCase()
    
    // 1. Fast in-memory cache check (0ms)
    const cached = artistInfoMemoryCache.get(cacheKey)
    if (cached && cached.data && cached.expireAt > Date.now()) {
      return cached.data
    }

    const yt = await initYouTubeI()
    if (!yt) return null

    let artistData = null
    let channelId = artistIdentifier

    // Helper: Dynamic search to find the true YouTube Music artist browse ID
    const resolveArtistBrowseId = async (name) => {
      try {
        const searchRes = await Promise.race([
          yt.music.search(name, { type: 'artist' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), 3000))
        ]).catch(() => null)

        let items = []
        if (searchRes?.contents) {
          const shelf = searchRes.contents.find(c => c.type === 'MusicShelf' || c.type === 'Shelf')
          items = shelf ? shelf.contents : searchRes.contents
        }
        const topArtist = items.find(i => i.id || i.browse_id || i.endpoint?.payload?.browseId) || items[0]
        if (topArtist) {
          const bId = topArtist.id || topArtist.browse_id || topArtist.endpoint?.payload?.browseId
          if (bId) {
            setCachedArtistChannelId(String(name).toLowerCase(), bId)
            return bId
          }
        }
      } catch (e) {}
      return null
    }

    // 2. Fast channel ID lookup from seed table or TTL'd dynamic cache
    if (!channelId.startsWith('UC') && !channelId.startsWith('FEmusic_library_') && !channelId.startsWith('MPREb_')) {
      const knownId = lookupArtistChannelId(cacheKey)
      if (knownId) {
        channelId = knownId
      } else {
        const foundId = await resolveArtistBrowseId(artistIdentifier)
        if (foundId) channelId = foundId
      }
    }

    // 3. Direct artist endpoint query
    if (channelId && (channelId.startsWith('UC') || channelId.startsWith('FE'))) {
      try {
        artistData = await Promise.race([
          yt.music.getArtist(channelId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('getArtist timeout')), 4000))
        ]).catch(() => null)
      } catch (e) {}
    }

    // Validate that artistData has actual content; if not, re-search dynamically
    const hasValidData = artistData && ((artistData.sections && artistData.sections.length > 0) || (artistData.header && (artistData.header.title || artistData.header.thumbnail)))
    if (!hasValidData && typeof artistIdentifier === 'string' && !artistIdentifier.startsWith('UC')) {
      const freshBrowseId = await resolveArtistBrowseId(artistIdentifier)
      if (freshBrowseId && freshBrowseId !== channelId) {
        channelId = freshBrowseId
        try {
          artistData = await Promise.race([
            yt.music.getArtist(channelId),
            new Promise((_, reject) => setTimeout(() => reject(new Error('getArtist timeout')), 4000))
          ]).catch(() => null)
        } catch (e) {}
      }
    }

    if (artistData && ((artistData.sections && artistData.sections.length > 0) || artistData.header)) {
      let headerThumb = extractBestThumbnail(artistData.header, channelId)
        || extractBestThumbnail(artistData.header?.foreground_thumbnails)
        || extractBestThumbnail(artistData.header?.thumbnails)
        || extractBestThumbnail(artistData.header?.banner)
        || extractBestThumbnail(artistData.header?.background)
        || extractBestThumbnail(artistData.visuals?.avatar)
        || extractBestThumbnail(artistData.visuals?.banner)

      const header = {
        title: artistData.header?.title?.text || artistData.header?.title || artistIdentifier,
        description: artistData.header?.description?.text || artistData.description || '',
        subscribers: artistData.header?.subscribers?.text || artistData.subscribers || '',
        thumbnail: headerThumb
      }

      const sections = []
      if (artistData.sections) {
        for (const sec of artistData.sections) {
          const secTitle = sec.title?.text || sec.header?.title?.text || (typeof sec.title === 'string' ? sec.title : (typeof sec.header?.title === 'string' ? sec.header?.title : '')) || 'Top Songs'
          const sLower = secTitle.toLowerCase()

          const secItems = (sec.contents || sec.items || []).map(i => {
            const tText = typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : (i.title || i.name)
            const vId = i.id || i.videoId || i.video_id || i.browse_id || i.overlay?.content?.endpoint?.payload?.videoId || i.endpoint?.payload?.videoId || i.endpoint?.payload?.browseId || i.play_navigation_endpoint?.watchEndpoint?.videoId

            let itemType = 'Song'
            if (sLower.includes('album')) itemType = 'Album'
            else if (sLower.includes('single') || sLower.includes('ep')) itemType = 'Single'
            else if (sLower.includes('video')) itemType = 'Video'
            else if (sLower.includes('playlist') || sLower.includes('featured')) itemType = 'Playlist'
            else if (sLower.includes('fan') || sLower.includes('similar') || sLower.includes('artist')) itemType = 'Artist'
            else if (vId && (vId.startsWith('MPREb_') || vId.startsWith('FEmusic_'))) itemType = 'Album'
            else if (vId && (vId.startsWith('VL') || vId.startsWith('PL') || vId.startsWith('RDCLAK'))) itemType = 'Playlist'
            else if (vId && vId.startsWith('UC')) itemType = 'Artist'

            let authors = null
            if (i.authors) authors = i.authors.map(a => a.name || a.text || a).join(', ')
            else if (i.artists) authors = i.artists.map(a => a.name || a.text || a).join(', ')
            else if (i.author) authors = typeof i.author === 'string' ? i.author : (i.author?.name || i.author?.text)

            return {
              videoId: vId,
              id: vId,
              title: tText || 'Unknown Title',
              artist: authors || header.title,
              album: i.album?.name || null,
              duration: i.duration?.seconds || (typeof i.duration === 'number' ? i.duration : 0),
              thumbnail: extractBestThumbnail(i, vId),
              type: itemType
            }
          }).filter(i => i.videoId)

          if (secItems.length > 0) {
            sections.push({ title: secTitle, items: secItems })
          }
        }
      }

      if (!header.thumbnail && sections.length > 0 && sections[0].items.length > 0) {
        header.thumbnail = sections[0].items[0].thumbnail
      }

      if (header.thumbnail) {
        db.saveArtistArtToDB(header.title || artistIdentifier, header.thumbnail)
        db.saveArtistArtToDB(artistIdentifier, header.thumbnail)
      }

      const finalResult = {
        name: header.title,
        headerImage: header.thumbnail,
        thumbnail: header.thumbnail,
        header,
        sections
      }

      cacheArtistInfo(cacheKey, finalResult)
      if (header.title) {
        cacheArtistInfo(header.title.toLowerCase(), finalResult)
      }

      return finalResult
    }

    // 4. Fallback: Fast parallel search for songs & albums
    const [songRes, albumRes] = await Promise.all([
      yt.music.search(`${artistIdentifier} songs`, { type: 'song' }).catch(() => ({})),
      yt.music.search(`${artistIdentifier} albums`, { type: 'album' }).catch(() => ({}))
    ])

    const extractItems = (r) => {
      let items = []
      if (r?.contents) {
        const shelf = r.contents.find(c => c.type === 'MusicShelf' || c.type === 'Shelf')
        items = shelf ? shelf.contents : r.contents
      }
      return items || []
    }

    const topSongs = extractItems(songRes).filter(i => i.id).slice(0, 25).map(i => ({
      videoId: i.id,
      title: typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title,
      artist: i.authors?.map(a => a.name).join(', ') || artistIdentifier,
      album: i.album?.name || null,
      duration: i.duration?.seconds || 0,
      thumbnail: extractBestThumbnail(i, i.id),
      type: 'Song'
    }))

    const albums = extractItems(albumRes).filter(i => i.id).slice(0, 15).map(i => ({
      videoId: i.id,
      title: typeof i.title === 'object' ? (i.title?.text || i.title?.toString()) : i.title,
      artist: artistIdentifier,
      album: null,
      duration: 0,
      thumbnail: extractBestThumbnail(i, i.id),
      type: 'Album'
    }))

    const fallbackThumb = topSongs[0]?.thumbnail || albums[0]?.thumbnail || null
    if (fallbackThumb) {
      db.saveArtistArtToDB(artistIdentifier, fallbackThumb)
    }

    const fallbackResult = {
      name: artistIdentifier,
      headerImage: fallbackThumb,
      thumbnail: fallbackThumb,
      header: {
        title: artistIdentifier,
        description: 'Artist',
        subscribers: '',
        thumbnail: fallbackThumb
      },
      sections: [
        { title: 'Top Songs', items: topSongs },
        { title: 'Albums & Singles', items: albums }
      ]
    }

    cacheArtistInfo(cacheKey, fallbackResult)
    return fallbackResult
  } catch (err) {
    console.error('youtube:getArtistInfo error:', err)
    return null
  }
})

ipcMain.handle('youtube:downloadTrack', async (_event, videoId, customFolder) => {
  try {
    const ytDlpPath = global.ytDlpPath || (app.isPackaged ? path.join(process.resourcesPath, 'yt-dlp.exe') : path.join(app.getAppPath(), 'yt-dlp.exe'))
    if (!fs.existsSync(ytDlpPath)) {
      console.error('yt-dlp.exe not found at', ytDlpPath)
      return { success: false, error: 'Downloader component missing' }
    }
    
    const cleanVideoId = safeMediaId(videoId) || ''
    if (!cleanVideoId) {
      return { success: false, error: 'Invalid video ID' }
    }

    // Refuse to create or write into a directory the user has not authorised.
    // This handler used to mkdirSync(recursive: true) wherever the renderer asked.
    let baseDir
    try {
      baseDir = resolveDownloadDir(customFolder)
    } catch {
      return { success: false, error: 'Download folder is not permitted' }
    }
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true })
    
    const url = `https://www.youtube.com/watch?v=${cleanVideoId}`
    const outTemplate = path.join(baseDir, `%(title)s [${cleanVideoId}].%(ext)s`)
    
    // Check if ffmpeg is available (next to yt-dlp or on system PATH)
    const { execFile, spawn } = require('child_process')
    let hasFFmpeg = false
    const ffmpegNextToYtdlp = path.join(path.dirname(ytDlpPath), 'ffmpeg.exe')
    if (fs.existsSync(ffmpegNextToYtdlp)) {
      hasFFmpeg = true
    } else {
      // Async probe. This used to be execFileSync with a 3s timeout, which
      // blocked the main process — and therefore the entire UI — on every
      // download whenever ffmpeg was not sitting next to yt-dlp.
      hasFFmpeg = await new Promise((resolve) => {
        execFile('ffmpeg', ['-version'], { timeout: 3000, windowsHide: true }, (err) => {
          resolve(!err)
        })
      })
    }

    // Highest audio available, never re-encoded, and with cover art.
    //
    // This used to run `-x --audio-format mp3`, which transcoded the best stream
    // down to ~130 kbps VBR MP3 — a lossy generation on top of an already lossy
    // source.
    //
    // The container is now M4A/AAC (itag 140, ~130 kbps) rather than Ogg/Opus
    // (itag 251, ~135 kbps). The bitrates are within a few percent of each other,
    // but M4A is the only one that can carry cover art *and* exit cleanly:
    // `--embed-thumbnail` on Ogg fails with "no appropriate stream found" after
    // writing the file, which the caller reports as a failed download. M4A also
    // plays on everything (Windows Media Player, car stereos) and lets Explorer
    // show a real bit rate instead of blank fields.
    const progressTemplate =
      'download:PROG|%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.speed)s|%(progress.eta)s'

    const commonArgs = [
      '--no-playlist',
      '--no-check-certificate',
      '--no-warnings',
      '--newline',
      '--progress',
      '--progress-template', progressTemplate,
      '-o', outTemplate,
      url
    ]

    // `bestaudio[ext=m4a]` asks for the AAC rendition directly — no transcode, no
    // remux. Without ffmpeg the thumbnail cannot be converted and embedded, so the
    // file keeps its tags but no artwork rather than failing the whole download.
    const args = hasFFmpeg
      ? ['-f', 'bestaudio[ext=m4a]/bestaudio', '--embed-metadata', '--embed-thumbnail', ...commonArgs]
      : ['-f', 'bestaudio[ext=m4a]/bestaudio', '--embed-metadata', '--no-post-overwrites', ...commonArgs]

    log.debug(`[Download] ffmpeg available: ${hasFFmpeg}, using ${hasFFmpeg ? 'm4a with cover art' : 'native m4a, tags only'}`)

    return new Promise((resolve) => {
      const p = spawn(ytDlpPath, args, { windowsHide: true })
      
      let errorOut = ''
      p.stderr.on('data', d => errorOut += d.toString())

      // yt-dlp reports byte-level progress on stdout via --progress-template.
      // Emit one event per whole percent so the UI can draw a real bar instead of
      // an indeterminate spinner.
      let lastPercent = -1
      const reportProgress = (percent, downloadedBytes, speed, eta) => {
        const clamped = Math.max(0, Math.min(100, percent))
        const rounded = Math.floor(clamped)
        if (rounded === lastPercent) return
        lastPercent = rounded
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download:progress', {
            videoId: cleanVideoId,
            percent: rounded,
            downloadedBytes,
            speed,
            eta
          })
        }
      }
      p.stdout.on('data', (d) => {
        for (const line of d.toString().split('\n')) {
          if (!line.startsWith('PROG|')) continue
          const [, pctStr, bytesStr, speedStr, etaStr] = line.split('|')
          const percent = parseFloat(String(pctStr).replace('%', '').trim())
          if (!Number.isFinite(percent)) continue
          reportProgress(
            percent,
            Number(bytesStr) || 0,
            Number(speedStr) || 0,
            (etaStr || '').trim() || null
          )
        }
      })
      reportProgress(0, 0, 0, null)
      
      let finished = false
      const timeoutId = setTimeout(() => {
        if (!finished) {
          finished = true
          killProcessTree(p) // kills yt-dlp AND any ffmpeg child it spawned
          resolve({ success: false, error: 'Download timed out after 5 minutes.' })
        }
      }, 300000)

      p.on('close', (code) => {
        if (finished) return
        finished = true
        clearTimeout(timeoutId)
        if (code === 0) {
          let downloadedFile = null
          try {
            if (fs.existsSync(baseDir)) {
              const files = fs.readdirSync(baseDir)
              const match = files.find(f => f.includes(`[${cleanVideoId}]`))
              if (match) downloadedFile = path.join(baseDir, match)
            }
          } catch (_) {}

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download:completed', {
              videoId: cleanVideoId,
              filePath: downloadedFile,
              baseDir
            })
          }

          resolve({ success: true, filePath: downloadedFile, message: `Saved to ${baseDir}` })
        } else {
          console.error('Download failed', errorOut)
          resolve({ success: false, error: errorOut || 'Download failed' })
        }
      })
      
      p.on('error', (err) => {
        if (finished) return
        finished = true
        clearTimeout(timeoutId)
        console.error('Spawn error', err)
        resolve({ success: false, error: err.message })
      })
    })
  } catch(e) {
    console.error('youtube:downloadTrack outer error:', e)
    return { success: false, error: e.message }
  }
})

// `file:exists` REMOVED — it was an unauthenticated existence oracle for any
// path on disk (and had no callers).

// Resolve a download directory supplied by the renderer, refusing anything the
// user has not authorised. Without this the renderer could enumerate the file
// names in any folder on the machine.
// The folder the user picked in Settings. Cached because `resolveDownloadDir` is
// called on every playback lookup, and reading preferences.json each time would be
// wasteful. Kept in sync by `preferences:save`.
let savedDownloadFolder = null

function readSavedDownloadFolder() {
  if (savedDownloadFolder) return savedDownloadFolder
  try {
    const prefPath = path.join(app.getPath('documents'), 'Glaze Music', 'preferences.json')
    if (fs.existsSync(prefPath)) {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8')) || {}
      if (typeof prefs.downloadFolder === 'string' && prefs.downloadFolder.trim()) {
        savedDownloadFolder = prefs.downloadFolder.trim()
      }
    }
  } catch {
    // Fall back to the default folder.
  }
  return savedDownloadFolder
}

function resolveDownloadDir(customFolder) {
  const explicit = (typeof customFolder === 'string' && customFolder.trim()) ? customFolder.trim() : null
  // Falling back to the *saved* folder matters for offline playback: the player
  // looks a track up by video id with no folder argument, and a custom download
  // location used to make every downloaded song invisible to that lookup.
  const baseDir = explicit || readSavedDownloadFolder() || path.join(app.getPath('music'), 'Glaze Downloads')
  assertDirAllowed(baseDir)
  return baseDir
}

ipcMain.handle('file:findDownloadedTrack', (_event, videoId, customFolder) => {
  try {
    const cleanId = safeMediaId(videoId)
    if (!cleanId) return null
    const baseDir = resolveDownloadDir(customFolder)
    if (!fs.existsSync(baseDir)) return null
    const files = fs.readdirSync(baseDir)
    const match = files.find(f => f.includes(`[${cleanId}]`))
    return match ? path.join(baseDir, match) : null
  } catch (e) {
    return null
  }
})

ipcMain.handle('file:getDownloadedVideoIds', (_event, customFolder) => {
  try {
    const baseDir = resolveDownloadDir(customFolder)
    if (!fs.existsSync(baseDir)) return []
    const files = fs.readdirSync(baseDir)
    return files.map(f => {
      const match = f.match(/\[([a-zA-Z0-9_-]{11})\]/)
      return match ? match[1] : null
    }).filter(Boolean)
  } catch (e) {
    return []
  }
})

ipcMain.handle('file:getDefaultDownloadFolder', () => {
  try {
    const baseDir = path.join(app.getPath('music'), 'Glaze Downloads')
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }
    return baseDir
  } catch (e) {
    return path.join(app.getPath('userData'), 'Downloads')
  }
})

ipcMain.handle('youtube:getLyrics', async (_event, videoId, title, artist) => {
  try {
    // 1. Try lrclib.net for synced lyrics
    if (title && artist) {
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
      const res = await net.fetch(url, { headers: { 'User-Agent': 'GlazeMusic/1.0' } })
      if (res.ok) {
        const data = await res.json()
        if (data && data.length > 0 && data[0].syncedLyrics) {
          return { type: 'synced', text: data[0].syncedLyrics }
        }
      }
    }
    
    // 2. Fallback to youtubei.js plain text lyrics (only if videoId is valid)
    if (videoId && typeof videoId === 'string' && videoId.length > 0) {
      const yt = await initYouTubeI()
      if (yt) {
        const lyrics = await yt.music.getLyrics(videoId)
        if (lyrics && lyrics.description?.text) {
          return { type: 'plain', text: lyrics.description.text }
        }
      }
    }
  } catch (e) {
    console.error('youtube:getLyrics error:', e)
  }
  return null
})

// In-memory cache for translated lyrics in main process.
// A full lyric sheet in another language is tens of KB, so this is capped —
// without a limit it grew for every track the user ever translated.
const LYRICS_TRANSLATION_CACHE_MAX = 40
const lyricsTranslationCache = new Map()
function cacheTranslatedLyrics(key, value) {
  lyricsTranslationCache.delete(key)
  lyricsTranslationCache.set(key, value)
  while (lyricsTranslationCache.size > LYRICS_TRANSLATION_CACHE_MAX) {
    lyricsTranslationCache.delete(lyricsTranslationCache.keys().next().value)
  }
}

ipcMain.handle('youtube:translateLyrics', async (_event, payload, targetLang = 'ur') => {
  try {
    if (!payload) return { success: false, error: 'Empty payload' }

    const isSynced = Array.isArray(payload)
    const rawText = isSynced ? payload.map(l => l.content || '♪').join('\n') : String(payload)
    const cacheKey = `${rawText.length}_${rawText.slice(0, 40)}_${targetLang}`

    if (lyricsTranslationCache.has(cacheKey)) {
      return { success: true, data: lyricsTranslationCache.get(cacheKey) }
    }

    // 1. Primary engine: Google dict-chrome-ex
    let translatedRaw = null
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(rawText)}`
      const res = await net.fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      })
      if (res.ok) {
        const json = await res.json()
        translatedRaw = (json[0] || []).map(x => x[0]).join('')
      }
    } catch (gErr) {
      console.warn('Google translation error, trying fallback:', gErr)
    }

    // 2. Secondary fallback engine: MyMemory
    if (!translatedRaw) {
      try {
        const fallbackUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(rawText.slice(0, 500))}&langpair=auto|${encodeURIComponent(targetLang)}`
        const fRes = await net.fetch(fallbackUrl)
        if (fRes.ok) {
          const fJson = await fRes.json()
          if (fJson?.responseData?.translatedText) {
            translatedRaw = fJson.responseData.translatedText
          }
        }
      } catch (fErr) {
        console.error('MyMemory fallback translation error:', fErr)
      }
    }

    if (!translatedRaw) {
      return { success: false, error: 'Translation failed' }
    }

    let finalData
    if (isSynced) {
      const translatedLines = translatedRaw.split('\n')
      finalData = payload.map((orig, idx) => ({
        time: orig.time,
        content: (translatedLines[idx] !== undefined && translatedLines[idx].trim() !== '') ? translatedLines[idx].trim() : orig.content,
        originalContent: orig.content
      }))
    } else {
      finalData = translatedRaw
    }

    cacheTranslatedLyrics(cacheKey, finalData)
    return { success: true, data: finalData }
  } catch (err) {
    console.error('youtube:translateLyrics handler error:', err)
    return { success: false, error: err.message }
  }
})

// ─── IPC: Authentication (OAuth Flow) ──────────────────────────────────────────
ipcMain.handle('auth:spotify', async () => {
  return new Promise((resolve) => {
    void (async () => {
      const ses = session.fromPartition('persist:spotify-auth')
    
      // Clear cookies manually to ensure sp_dc is deleted
      const allCookies = await ses.cookies.get({ domain: '.spotify.com' })
      for (const cookie of allCookies) {
        let domain = cookie.domain.replace(/^\./, '')
        let url = (cookie.secure ? 'https://' : 'http://') + domain + cookie.path;
        await ses.cookies.remove(url, cookie.name).catch(() => {});
      }
      const accountsCookies = await ses.cookies.get({ domain: 'accounts.spotify.com' })
      for (const cookie of accountsCookies) {
        let domain = cookie.domain.replace(/^\./, '')
        let url = (cookie.secure ? 'https://' : 'http://') + domain + cookie.path;
        await ses.cookies.remove(url, cookie.name).catch(() => {});
      }
    
      // As a final fallback
      await ses.clearStorageData({ storages: ['cookies'] }).catch(() => {})
    
      const authWin = new BrowserWindow({
        width: 500,
        height: 700,
        modal: true,
        parent: mainWindow,
        webPreferences: { 
          nodeIntegration: false, 
          contextIsolation: true,
          partition: 'persist:spotify-auth',
          sandbox: true
        }
      })
    
      // Load Spotify login page
      authWin.loadURL('https://accounts.spotify.com/en/login?continue=https://open.spotify.com/')
    
      let resolved = false

      const checkCookies = async () => {
        if (resolved || authWin.isDestroyed()) return
        try {
          const cookies = await authWin.webContents.session.cookies.get({ domain: '.spotify.com' })
          const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        
          if (cookieString.includes('sp_dc=')) {
            saveAuthCookies('spotify_cookies', cookies)

            global.spotifyCookie = cookieString
            spotifyLibraryCache = null // Invalidate cache on new login!
          
            // Ensure we are on open.spotify.com to avoid CORS
            const currentUrl = authWin.webContents.getURL()
            if (!currentUrl.startsWith('https://open.spotify.com')) {
              if (currentUrl !== 'https://open.spotify.com/') {
                authWin.loadURL('https://open.spotify.com/')
              }
              return // wait for did-finish-load
            }

            // The window has already passed WAF, extract the token directly!
            try {
              const tokenData = await authWin.webContents.executeJavaScript(`
                fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player')
                  .then(res => res.json())
                  .catch(err => null)
              `);
              if (tokenData && tokenData.accessToken) {
                global.spotifyAccessToken = tokenData.accessToken;
                global.spotifyTokenExpiry = Date.now() + 3600000;
                log.debug('[Spotify] Intercepted token inside auth window');
              }
            } catch (e) {}

            resolved = true
            if (!authWin.isDestroyed()) authWin.close()
            resolve({ success: true })
          }
        } catch (e) {
          console.error('Spotify Cookie capture error:', e)
        }
      }

      authWin.webContents.on('did-navigate', checkCookies)
      authWin.webContents.on('did-finish-load', checkCookies)

      const interval = setInterval(() => {
        if (resolved || authWin.isDestroyed()) {
          clearInterval(interval)
          return
        }
        checkCookies()
      }, 1000)
    
      authWin.on('closed', () => {
        clearInterval(interval)
        if (!resolved) resolve({ success: false })
      })
    })().catch((err) => {
      // Without this, a rejection inside the async body was swallowed and the
      // IPC call never settled, so the UI spinner hung forever.
      console.error('auth:spotify failed:', err)
      resolve({ success: false, error: err?.message || String(err) })
    })
  })
})

ipcMain.handle('auth:youtube', async () => {
  return new Promise((resolve) => {
    // Dynamically grab the default User-Agent and strip out "Electron/..."
    // This perfectly preserves all other system fingerprints (like Chrome version)
    const ses = session.fromPartition('persist:youtube-auth')
    const defaultUA = ses.getUserAgent()
    const cleanUA = defaultUA.replace(/Electron\/[\d.]+\s?/, '')

    ses.setUserAgent(cleanUA)

    // Also remove webdriver flag just in case
    ses.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = cleanUA;
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    const authWin = new BrowserWindow({
      width: 520,
      height: 760,
      modal: true,
      parent: mainWindow,
      title: 'Sign in to YouTube Music',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:youtube-auth',
        // Enable sandboxing to look more like a real browser
        sandbox: true
      }
    })

    // Load YouTube Music directly instead of the Google Login page.
    // Logging in from the service's own domain context often bypasses security blocks.
    authWin.loadURL('https://music.youtube.com/')

    let resolved = false
    let pollTimer = null

    const finish = (payload) => {
      if (resolved) return
      resolved = true
      if (pollTimer) clearInterval(pollTimer)
      if (!authWin.isDestroyed()) authWin.close()
      resolve(payload)
    }

    // Google's sign-in flow is a chain of redirects through accounts.google.com,
    // and an already-signed-in user never leaves music.youtube.com at all — so
    // waiting for a single `did-navigate` to a specific URL missed both cases.
    // Poll the cookie jar instead, and re-check on every load event.
    const checkAuth = async () => {
      if (resolved || authWin.isDestroyed()) return
      try {
        const cookies = await authWin.webContents.session.cookies.get({ domain: '.youtube.com' })
        const names = new Set(cookies.map(c => c.name))
        // SAPISID is the auth cookie Innertube needs; __Secure-3PSID and
        // LOGIN_INFO appear for accounts signed in with a passkey/2FA.
        const signedIn = names.has('SAPISID') || names.has('__Secure-3PSID') || names.has('LOGIN_INFO')
        if (!signedIn) return

        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ')
        saveAuthCookies('yt_cookies', cookieString)

        // Drop anything cached for a previous account before re-initialising.
        ytAuthInstance = null
        ytAuthInitPromise = null
        ytLibraryCache = null
        ytHomeCache = null
        ytHomeCacheAt = 0

        const instance = await initAuthenticatedYT(cookieString)
        if (!instance) {
          finish({ success: false, error: 'Signed in, but YouTube Music could not be initialised.' })
          return
        }
        log.info('[YouTube] Signed in')
        finish({ success: true })
      } catch (e) {
        console.error('[YouTube] Cookie capture error:', e)
      }
    }

    authWin.webContents.on('did-navigate', checkAuth)
    authWin.webContents.on('did-navigate-in-page', checkAuth)
    authWin.webContents.on('did-finish-load', checkAuth)
    pollTimer = setInterval(checkAuth, 1200)

    authWin.on('closed', () => {
      if (pollTimer) clearInterval(pollTimer)
      if (!resolved) {
        resolved = true
        resolve({ success: false, canceled: true })
      }
    })
  })
})

ipcMain.handle('youtube:disconnect', async () => {
  await resetYouTubeAuth()
  return { success: true }
})

// Cheap "am I signed in?" probe that never opens a window and never hits the
// network — used to hydrate the UI on launch without a 10 s stall.
ipcMain.handle('youtube:getAuthStatus', async () => {
  try {
    const instance = await ensureYouTubeAuth()
    return { connected: !!instance }
  } catch {
    return { connected: false }
  }
})

// ─── YouTube Music library sync ───────────────────────────────────────────────
// Everything below flattens youtubei.js parser objects into the plain shapes the
// renderer consumes. It is deliberately defensive: YT Music reshapes its
// payloads regularly and one unexpected node must never kill a whole sync.
//
// Shape notes (verified against a live account, youtubei.js 17.2.0):
//   • `music.getLibrary()` returns ONE `Grid` of mixed MusicTwoRowItem — it has
//     no `sections`, so reading `library.sections` always produced zero
//     playlists. The real lists live behind the header's ChipCloud chips
//     (`FEmusic_liked_playlists`, `FEmusic_liked_albums`,
//     `FEmusic_library_corpus_track_artists`, …).
//   • `music.getHomeFeed().sections` are `MusicCarouselShelf`s whose title is at
//     `section.header.title`, not `section.title`.

let ytLibraryCache = null
const ytLibraryCachePath = path.join(app.getPath('userData'), 'yt_library_cache.json')
try {
  if (fs.existsSync(ytLibraryCachePath)) {
    ytLibraryCache = JSON.parse(fs.readFileSync(ytLibraryCachePath, 'utf-8'))
  }
} catch (e) {}

// Parser objects are `Text` wrappers; a plain string, a `.text` field and a
// `toString()` are all possible depending on the node.
function ytText(v) {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v.text === 'string') return v.text
  if (typeof v.toString === 'function') {
    const s = v.toString()
    return s === '[object Object]' ? '' : s
  }
  return ''
}

function ytThumb(item) {
  const t = item?.thumbnails?.[0]?.url
    || item?.thumbnail?.contents?.[0]?.url
    || (Array.isArray(item?.thumbnail) ? item.thumbnail[0]?.url : null)
    || item?.thumbnail?.url
  return typeof t === 'string' ? t : null
}

// Container properties a parsed node can hide its children in. `contents` alone
// is not enough: a chip response nests as
// SingleColumnBrowseResults → tabs[] → Tab.content → SectionList.contents.
const YT_CHILD_KEYS = ['contents', 'content', 'tabs', 'items', 'sections', 'body', 'results', 'rows']

function ytWalk(node, visit, depth = 0) {
  if (!node || depth > 10) return
  if (typeof node.is_array === 'boolean') {
    if (node.is_array) {
      for (const child of node.array()) ytWalk(child, visit, depth + 1)
    } else if (node.is_node) {
      ytWalk(node.item(), visit, depth + 1)
    }
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  for (const key of YT_CHILD_KEYS) {
    const kids = node[key]
    if (!kids || typeof kids !== 'object') continue
    if (Array.isArray(kids)) {
      for (const k of kids) ytWalk(k, visit, depth + 1)
    } else {
      ytWalk(kids, visit, depth + 1)
    }
  }
}

const YT_LEAF_CLASSES = new Set(['MusicTwoRowItem', 'MusicResponsiveListItem'])

function ytCollectLeaves(root) {
  const out = []
  ytWalk(root, (node) => {
    if (YT_LEAF_CLASSES.has(node?.constructor?.name)) out.push(node)
  })
  return out
}

function ytFindContinuation(root) {
  let found = null
  ytWalk(root, (node) => {
    if (!found && node?.constructor?.name === 'ContinuationItem' && node.endpoint) found = node
  })
  return found
}

// Calls a chip / continuation endpoint and pages through its continuations.
async function ytBrowsePaged(yt, endpoint, maxRounds = 8) {
  const leaves = []
  const seenTokens = new Set()
  let node = await endpoint.call(yt.actions, { parse: true, client: 'YTMUSIC' })
  let rounds = 0

  while (node && rounds < maxRounds) {
    const collected = ytCollectLeaves(node.contents || node)
    leaves.push(...collected)
    const cont = ytFindContinuation(node.contents || node)
    if (!cont) break
    const token = JSON.stringify(cont.endpoint?.payload || {}).slice(0, 400)
    if (seenTokens.has(token)) break
    seenTokens.add(token)
    try {
      node = await cont.endpoint.call(yt.actions, { parse: true, client: 'YTMUSIC' })
    } catch (e) {
      log.debug(`[YT] Continuation stopped: ${e?.message}`)
      break
    }
    rounds++
  }
  return leaves
}

function ytArtistName(item) {
  if (Array.isArray(item?.artists) && item.artists.length) {
    const names = item.artists.map(a => ytText(a?.name) || ytText(a)).filter(Boolean)
    if (names.length) return names.join(', ')
  }
  if (Array.isArray(item?.authors) && item.authors.length) {
    const names = item.authors.map(a => ytText(a?.name) || ytText(a)).filter(Boolean)
    if (names.length) return names.join(', ')
  }
  const author = ytText(item?.author)
  if (author) return author
  // Fall back to the first meaningful segment of "Song • Artist • Album".
  const sub = ytText(item?.subtitle)
  if (sub) {
    const parts = sub.split('•').map(s => s.trim()).filter(Boolean)
    const hit = parts.find(p => !/^(song|video|album|single|ep|playlist|artist|profile|auto playlist)$/i.test(p) && !/^\d{4}$/.test(p))
    if (hit) return hit
  }
  return ''
}

function mapYtTrack(item) {
  const videoId = item?.video_id || item?.id || item?.videoId
  if (!videoId || typeof videoId !== 'string' || videoId.length < 5) return null
  if (/^(MPREb_|UC|FEmusic|VL)/.test(videoId)) return null
  const title = ytText(item?.title) || ytText(item?.name) || 'Unknown Title'
  const duration = item?.duration?.seconds ?? (typeof item?.duration === 'number' ? item.duration : 0)
  return {
    videoId,
    title,
    artist: ytArtistName(item) || 'Unknown Artist',
    album: ytText(item?.album?.name) || null,
    duration: Math.round(Number(duration) || 0),
    thumbnail: ytThumb(item) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    type: 'Song',
  }
}

// A YTM subtitle is a "·"-separated mix of useful and useless parts:
// "NoCopyrightSounds • 67M views" → keep the channel, drop the count;
// "Album • Talhah Yunus" → keep the artist, drop the type. Mixes use commas
// ("Travis Scott, Don Toliver, …") so they pass through untouched.
const YT_SUB_NOISE = /^[\d.,]+\s*[KMB]?\s*(?:views?|plays?|tracks?|songs?|videos?|items?|listeners?)$/i
// "Album" / "Single" / "EP" are kept — they are exactly what a New-releases card
// should say ("Album • Talhah Yunus"). Only the useless generic labels go.
const YT_SUB_TYPE = /^(?:playlist|auto playlist|auto-generated|song|video)$/i

function cleanYtSubtitle(raw) {
  if (!raw) return null
  const parts = String(raw).split(/\s*[•·]\s*/).map(s => s.trim()).filter(Boolean)
  const kept = parts.filter(p => !YT_SUB_NOISE.test(p) && !YT_SUB_TYPE.test(p))
  return kept.length ? kept.join(' • ') : null
}

function mapYtCollection(item, kind) {
  const rawId = item?.id || item?.playlist_id || item?.browse_id || item?.channel_id
  if (!rawId || typeof rawId !== 'string') return null
  const name = ytText(item?.title) || ytText(item?.name) || 'Untitled'
  let count = 0
  const rawCount = item?.item_count ?? item?.song_count
  if (typeof rawCount === 'number') count = rawCount
  const rawSub = ytText(item?.subtitle) || ytText(item?.second_subtitle)
  if (!count && rawSub) {
    const m = rawSub.match(/(\d[\d,]*)\s*(?:song|track|item|video|album|single|ep)/i)
    if (m) count = parseInt(m[1].replace(/,/g, ''), 10)
  }
  // Mixes carry the artists they were built from and albums carry the artist;
  // both are far more useful under the cover than a "Playlist" placeholder.
  const subtitle = cleanYtSubtitle(rawSub)
  return { id: rawId, name, thumbnail: ytThumb(item), count, kind, subtitle }
}

// Classifies a library row. `item_type` is unreliable on its own: YT Music
// reports channel profiles as `video` rows whose id starts with "UC".
function ytClassify(item) {
  const id = String(item?.id || item?.playlist_id || '')
  const type = String(item?.item_type || '').toLowerCase()
  if (type === 'artist') return 'artist'
  if (type === 'album' || type === 'ep' || type === 'single') return 'album'
  if (type === 'playlist' || type === 'library_playlist') return 'playlist'
  if (id.startsWith('UC')) return 'artist'
  if (id.startsWith('MPREb_')) return 'album'
  // `RD…` ids are radio/mix playlists ("My Mix 1", "My Supermix") — the home
  // "Mixed for you" shelf is made entirely of them.
  if (id.startsWith('VL') || id.startsWith('PL') || id.startsWith('RD')) return 'playlist'
  return null
}

// Turns one shelf leaf into either a track or a collection. Used by the extra
// home shelves, whose leaves are not always classifiable by `item_type` alone.
function mapYtLeaf(item) {
  const kind = ytClassify(item)
  if (kind && kind !== 'artist') {
    const c = mapYtCollection(item, kind)
    if (c) return { type: 'collection', value: c }
  }
  const t = mapYtTrack(item)
  if (t) return { type: 'song', value: t }
  if (kind === 'artist') {
    const c = mapYtCollection(item, 'artist')
    if (c) return { type: 'collection', value: c }
  }
  return null
}

// Browses a YTM page and returns its shelves as `{ title, leaves }`.
// The personalised home feed only carries a few sections, so "Mixed for you"
// and "New releases" are read from their own pages.
async function ytBrowseShelves(yt, browseId) {
  const root = await yt.actions.execute('/browse', { browseId, client: 'YTMUSIC', parse: true })
  const shelves = []
  ytWalk(root, (node) => {
    const cls = node?.constructor?.name
    if (cls !== 'MusicCarouselShelf' && cls !== 'Grid') return
    const leaves = ytCollectLeaves(node)
    if (!leaves.length) return
    const title = ytText(node?.header?.title) || ytText(node?.title) || ''
    shelves.push({ title, leaves })
  })
  return shelves
}

const EMPTY_YT_LIBRARY = () => ({
  connected: false,
  account: null,
  likedTracks: [],
  playlists: [],
  artists: [],
  albums: [],
  syncedAt: null,
})

ipcMain.handle('youtube:fetchLibrary', async (_event, forceRefresh = false) => {
  if (ytLibraryCache && !forceRefresh) return ytLibraryCache

  // Never silently fall back to the anonymous client here — it would return
  // public data with no liked songs and look like a successful sync.
  const yt = await ensureYouTubeAuth()
  if (!yt) return EMPTY_YT_LIBRARY()

  const result = {
    connected: true,
    account: null,
    likedTracks: [],
    playlists: [],
    artists: [],
    albums: [],
    syncedAt: Date.now(),
  }

  // ── Account identity ─────────────────────────────────────────────────────
  try {
    const info = await yt.account.getInfo()
    const raw = info?.contents?.contents || info?.contents || []
    const first = Array.isArray(raw) ? raw[0] : raw
    result.account = {
      name: ytText(first?.account_name) || 'YouTube Music',
      avatar: first?.account_photo?.[0]?.url || null,
    }
  } catch (e) {
    log.debug(`[YT] Account info unavailable: ${e?.message}`)
  }

  // ── Liked Music (VLLM) ───────────────────────────────────────────────────
  try {
    let playlist = await yt.music.getPlaylist('VLLM')
    let items = playlist?.items || []
    while (playlist?.has_continuation && items.length < 5000) {
      try {
        playlist = await playlist.getContinuation()
        items = items.concat(playlist.items || [])
      } catch {
        break
      }
    }
    result.likedTracks = items.map(mapYtTrack).filter(Boolean)
  } catch (e) {
    console.error('[YT] Liked Music failed:', e?.message)
  }

  // ── Library chips: playlists, albums, artists, profiles ──────────────────
  let chips = []
  try {
    const library = await yt.music.getLibrary()
    const chipCloud = (library?.header?.start_items || [])
      .find(n => n?.constructor?.name === 'ChipCloud')
    chips = (chipCloud?.chips || []).map(chip => ({
      label: ytText(chip?.text),
      browseId: chip?.endpoint?.payload?.commands?.[0]?.browseEndpoint?.browseId
        || chip?.endpoint?.payload?.browseEndpoint?.browseId
        || null,
      endpoint: chip?.endpoint || null,
    })).filter(c => c.browseId && c.endpoint)
  } catch (e) {
    console.error('[YT] Library header failed:', e?.message)
  }

  // Songs come from VLLM already; podcasts are out of scope.
  const WANTED = /^(playlists|albums|artists|profiles)$/i

  for (const chip of chips) {
    if (!WANTED.test(chip.label)) continue
    const kind = chip.label.toLowerCase() === 'albums' ? 'album'
      : (chip.label.toLowerCase() === 'artists' || chip.label.toLowerCase() === 'profiles') ? 'artist'
      : 'playlist'

    try {
      const leaves = await ytBrowsePaged(yt, chip.endpoint)
      for (const item of leaves) {
        const type = ytClassify(item) || kind
        if (type === 'artist') {
          const artist = mapYtCollection(item, 'artist')
          if (artist && !result.artists.some(a => a.id === artist.id)) result.artists.push(artist)
        } else if (type === 'album') {
          const album = mapYtCollection(item, 'album')
          if (album && !result.albums.some(a => a.id === album.id)) result.albums.push(album)
        } else if (type === 'playlist') {
          const pl = mapYtCollection(item, 'playlist')
          if (pl && !result.playlists.some(p => p.id === pl.id)) result.playlists.push(pl)
        }
      }
      log.debug(`[YT] ${chip.label}: ${leaves.length} rows`)
    } catch (e) {
      console.error(`[YT] ${chip.label} chip failed:`, e?.message)
    }
  }

  // Liked Music is rendered from likedTracks, not as a playlist card.
  result.playlists = result.playlists.filter(p => !['LM', 'VLLM', 'VLLLM'].includes(p.id))

  log.info(
    `[YT] Library synced: ${result.likedTracks.length} songs, ${result.playlists.length} playlists, ` +
    `${result.artists.length} artists, ${result.albums.length} albums`
  )

  ytLibraryCache = result
  try {
    await fs.promises.writeFile(ytLibraryCachePath, JSON.stringify(result))
  } catch (e) {
    log.debug(`[YT] Library cache write failed: ${e?.message}`)
  }
  return result
})


// ─── YouTube Music home feed (the recommendation algorithm) ──────────────────
let ytHomeCache = null
let ytHomeCacheAt = 0
const YT_HOME_TTL = 30 * 60 * 1000

ipcMain.handle('youtube:getMusicHome', async (_event, forceRefresh = false) => {
  if (ytHomeCache && !forceRefresh && Date.now() - ytHomeCacheAt < YT_HOME_TTL) {
    return ytHomeCache
  }

  // Signed out is fine here: the anonymous home feed still personalises by
  // region, it just is not *your* algorithm.
  const yt = (await ensureYouTubeAuth()) || (await initYouTubeI())
  if (!yt) return { shelves: [], connected: false }

  try {
    const feed = await yt.music.getHomeFeed()
    const personalised = []

    for (const section of feed?.sections || []) {
      // MusicCarouselShelf keeps its title on `header`, not on the node itself —
      // reading `section.title` is why every shelf used to render untitled.
      const title = ytText(section?.header?.title) || ytText(section?.title)
      // Podcast episodes: this app has no podcast player, so a "Shows for you"
      // row would only ever produce dead cards.
      if (/^shows for you$/i.test(title)) continue

      const items = Array.isArray(section?.contents) ? section.contents : []
      const songs = []
      const collections = []

      for (const item of items) {
        const mapped = mapYtLeaf(item)
        if (!mapped) continue
        if (mapped.type === 'collection') collections.push(mapped.value)
        else songs.push(mapped.value)
      }

      if (songs.length || collections.length) {
        personalised.push({ title: title || 'Made for you', songs, collections })
      }
      if (personalised.length >= 12) break
    }

    // The personalised payload only carries a couple of sections, so the two
    // shelves that make the page feel like YouTube Music are read from their
    // own browse pages. Both are optional — a failure just omits the shelf.
    const [mixed, newReleases] = await Promise.all([
      ytBrowseShelves(yt, 'FEmusic_mixed_for_you').catch((e) => {
        log.debug(`[YT] Mixed-for-you failed: ${e?.message}`)
        return []
      }),
      ytBrowseShelves(yt, 'FEmusic_new_releases').catch((e) => {
        log.debug(`[YT] New-releases failed: ${e?.message}`)
        return []
      }),
    ])

    const toShelf = (title, leaves, limit) => {
      const collections = []
      const songs = []
      for (const leaf of leaves.slice(0, limit)) {
        const mapped = mapYtLeaf(leaf)
        if (!mapped) continue
        if (mapped.type === 'collection') collections.push(mapped.value)
        else songs.push(mapped.value)
      }
      return collections.length || songs.length ? { title, songs, collections } : null
    }

    const shelves = []
    const mixedShelf = toShelf('Mixed for you', mixed.flatMap(s => s.leaves), 10)
    if (mixedShelf) shelves.push(mixedShelf)
    shelves.push(...personalised)
    // "New releases" returns "Albums & singles" plus a "Music videos" shelf;
    // the first one is the one that belongs on a home page.
    const newShelf = toShelf('New releases', newReleases[0]?.leaves || [], 10)
    if (newShelf) shelves.push(newShelf)

    ytHomeCache = { shelves, connected: !!ytAuthInstance }
    ytHomeCacheAt = Date.now()
    return ytHomeCache
  } catch (err) {
    console.error('[YT] Home feed failed:', err?.message)
    return ytHomeCache || { shelves: [], connected: !!ytAuthInstance }
  }
})

async function getSpotifyAccessToken() {
  // Return cached token if valid
  if (global.spotifyAccessToken && global.spotifyTokenExpiry && Date.now() < global.spotifyTokenExpiry) {
    return global.spotifyAccessToken;
  }

  // Strategy 1: Use the persist:spotify-auth session to fetch token
  // This sends cookies automatically through Chromium's session, bypassing CDN blocks
  try {
    const ses = session.fromPartition('persist:spotify-auth')
    const res = await ses.fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
      headers: {
        'App-Platform': 'WebPlayer',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    })
    if (res.ok) {
      const data = await res.json()
      if (data && data.accessToken && !data.isAnonymous) {
        log.debug('[Spotify] Got token via session.fetch')
        global.spotifyAccessToken = data.accessToken
        global.spotifyTokenExpiry = Date.now() + 3300000 // 55 minutes
        return data.accessToken
      }
    }
  } catch (e) {
    console.error('[Spotify] session.fetch failed:', e.message)
  }

  // Strategy 2: Try net.fetch with sp_dc cookie directly
  let spDc = ''
  if (global.spotifyCookie && global.spotifyCookie.includes('sp_dc=')) {
    const m = global.spotifyCookie.match(/sp_dc=([^;]+)/)
    if (m) spDc = `sp_dc=${m[1]}`
  } else {
    const stored = loadAuthCookies('spotify_cookies')
    if (Array.isArray(stored)) {
      const c = stored.find(x => x.name === 'sp_dc')
      if (c) spDc = `sp_dc=${c.value}`
    } else if (typeof stored === 'string') {
      const m = stored.match(/sp_dc=([^;]+)/)
      if (m) spDc = `sp_dc=${m[1]}`
    }
  }

  if (spDc) {
    try {
      const res = await net.fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        headers: {
          'Cookie': spDc,
          'App-Platform': 'WebPlayer',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.accessToken && !data.isAnonymous) {
          log.debug('[Spotify] Got token via net.fetch with sp_dc')
          global.spotifyAccessToken = data.accessToken
          global.spotifyTokenExpiry = Date.now() + 3300000
          return data.accessToken
        }
      }
    } catch (e) {
      console.error('[Spotify] net.fetch with sp_dc failed:', e.message)
    }
  }

  // Strategy 3: Hidden BrowserWindow as final fallback
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: 'persist:spotify-auth',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    win.loadURL('https://open.spotify.com/');
    
    let resolved = false;

    win.webContents.on('did-finish-load', async () => {
      if (resolved) return;
      try {
        const tokenData = await win.webContents.executeJavaScript(`
          fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player')
            .then(res => res.json())
            .catch(err => null)
        `);
        
        if (tokenData?.accessToken && !tokenData.isAnonymous) {
          resolved = true;
          global.spotifyAccessToken = tokenData.accessToken;
          global.spotifyTokenExpiry = Date.now() + 3300000;
          if (!win.isDestroyed()) win.close();
          log.debug('[Spotify] Got token via hidden BrowserWindow')
          resolve(tokenData.accessToken);
          return
        }
      } catch (e) {}
    });
    
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (!win.isDestroyed()) win.close();
        resolve(null);
      }
    }, 12000);
  });
}

let spotifyLibraryCache = null;
const spotifyLibraryCachePath = path.join(app.getPath('userData'), 'spotify_library_cache.json');
try {
  if (fs.existsSync(spotifyLibraryCachePath)) {
    spotifyLibraryCache = JSON.parse(fs.readFileSync(spotifyLibraryCachePath, 'utf-8'));
  }
} catch (e) {}

async function fetchSpotifyLibrary(forceRefresh = false) {
  if (spotifyLibraryCache && !forceRefresh) return spotifyLibraryCache;

  const token = await getSpotifyAccessToken()
  if (!token) return { playlists: [], likedTracks: [] }

  const headers = { 'Authorization': `Bearer ${token}` }
  
  let likedTracks = []
  try {
    let url = 'https://api.spotify.com/v1/me/tracks?limit=50'
    while (url && likedTracks.length < 2000) {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        console.error('[Spotify API] Error fetching tracks:', await res.text());
        break;
      }
      const data = await res.json()
      if (data.items) likedTracks = likedTracks.concat(data.items)
      url = data.next
    }
  } catch (e) {
    console.error('Failed to fetch Spotify liked tracks:', e)
  }

  let playlists = []
  try {
    let url = 'https://api.spotify.com/v1/me/playlists?limit=50'
    while (url) {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        console.error('[Spotify API] Error fetching playlists:', await res.text());
        break;
      }
      const data = await res.json()
      if (data.items) playlists = playlists.concat(data.items)
      url = data.next
    }
  } catch (e) {
    console.error('Failed to fetch Spotify playlists:', e)
  }

  const mappedTracks = likedTracks.map((item) => {
    const track = item.track
    if (!track) return null
    const artistName = track.artists?.map(a => a.name).join(', ') || 'Unknown Artist'
    return {
      videoId: `${track.name} ${artistName}`, // Search query format so player can stream audio via YouTube fallback
      title: track.name,
      artist: artistName,
      album: track.album?.name || null,
      duration: Math.floor(track.duration_ms / 1000),
      thumbnail: track.album?.images?.[0]?.url || null,
      type: 'Song'
    }
  }).filter(Boolean)

  const mappedPlaylists = playlists.map(p => ({
    id: p.id,
    name: p.name,
    thumbnail: p.images?.[0]?.url || null,
    count: p.tracks?.total || 0,
    type: 'spotify'
  }))

  const result = { likedTracks: mappedTracks, playlists: mappedPlaylists };
  if (mappedTracks.length > 0 || mappedPlaylists.length > 0) {
    spotifyLibraryCache = result;
    try {
      fs.writeFileSync(spotifyLibraryCachePath, JSON.stringify(spotifyLibraryCache));
    } catch (e) {}
  }
  return result;
}

ipcMain.handle('spotify:fetchLibrary', async () => {
  return fetchSpotifyLibrary()
})

ipcMain.handle('spotify:getUserProfile', async () => {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return { connected: false }
    const res = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (res.ok) {
      const data = await res.json()
      return {
        connected: true,
        name: data.display_name || data.id || 'Spotify User',
        avatar: data.images?.[0]?.url || null
      }
    }
  } catch (e) {
    console.error('Failed to fetch Spotify profile:', e)
  }
  return { connected: false }
})

ipcMain.handle('youtube:getUserProfile', async () => {
  try {
    const yt = await ensureYouTubeAuth()
    if (!yt) return { connected: false }
    try {
      const account = await yt.account.getInfo()
      const raw = account?.contents?.contents || account?.contents || []
      const first = Array.isArray(raw) ? raw[0] : raw
      return {
        connected: true,
        name: ytText(first?.account_name) || 'YouTube Music User',
        avatar: first?.account_photo?.[0]?.url || null,
      }
    } catch (e) {
      // Cookies are present but the account page failed — still connected.
      return { connected: true, name: 'YouTube Music User', avatar: null }
    }
  } catch (e) {
    console.error('Failed to fetch YouTube profile:', e)
  }
  return { connected: false }
})

ipcMain.handle('spotify:getPlaylist', async (_event, playlistId) => {
  if (playlistId === 'VLSPLIKED') {
    const lib = await fetchSpotifyLibrary()
    return lib.likedTracks
  }

  let tracks = []
  const cleanId = (playlistId || '').replace(/^VLS?/, '').replace(/^spotify:playlist:/, '')
  
  // 1. Try Spotify Web API if authenticated
  try {
    const token = await getSpotifyAccessToken()
    if (token && cleanId) {
      let url = `https://api.spotify.com/v1/playlists/${cleanId}/tracks?limit=100`
      const headers = { 'Authorization': `Bearer ${token}` }
      while (url && tracks.length < 2000) {
        const res = await fetch(url, { headers })
        if (!res.ok) break
        const data = await res.json()
        const items = data.items || []
        for (const item of items) {
          const track = item.track || item
          if (!track || !track.name) continue
          const artist = track.artists?.map(a => a.name).join(', ') || 'Unknown Artist'
          tracks.push({
            videoId: `${track.name} ${artist}`,
            title: track.name,
            artist: artist,
            album: track.album?.name || null,
            duration: track.duration_ms ? Math.floor(track.duration_ms / 1000) : (track.duration ? Math.floor(track.duration / 1000) : 0),
            thumbnail: track.album?.images?.[0]?.url || track.images?.[0]?.url || null,
            type: 'Song',
            service: 'spotify'
          })
        }
        url = data.next
      }
      if (tracks.length > 0) return tracks
    }
  } catch (e) {
    console.warn('Spotify API playlist fetch failed, trying embed fallback:', e.message)
  }

  // 2. Fallback to Spotify embed widget
  try {
    const embedRes = await net.fetch(`https://open.spotify.com/embed/playlist/${cleanId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'App-Platform': 'WebPlayer'
      }
    })
    if (embedRes.ok) {
      const html = await embedRes.text()
      const matchScript = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
      if (matchScript) {
        const embedData = JSON.parse(matchScript[1])
        const pageProps = embedData?.props?.pageProps
        const entity = pageProps?.state?.data?.entity || pageProps?.entity

        // Prefer the partner GraphQL walk — the embed's own list stops at 100.
        const accessToken = pageProps?.state?.settings?.session?.accessToken
        if (accessToken) {
          try {
            const full = await readFullSpotifyPlaylist(cleanId, accessToken)
            if (full && full.tracks.length > 0) {
              for (const t of full.tracks) {
                tracks.push({
                  videoId: `${t.title} ${t.artist}`,
                  title: t.title,
                  artist: t.artist,
                  album: t.album,
                  duration: t.duration,
                  thumbnail: t.thumbnail,
                  type: 'Song',
                  service: 'spotify'
                })
              }
            }
          } catch (pfErr) {
            console.warn('[Spotify] Pathfinder failed, using embed list:', pfErr.message)
          }
        }

        if (tracks.length === 0 && entity) {
          const rawTrackList = entity.trackList || entity.tracks?.items || pageProps?.state?.data?.tracks || []
          for (const item of rawTrackList) {
            const title = item.title || item.name
            const artist = item.subtitle || item.artists?.map(a => a.name).join(', ') || 'Unknown Artist'
            if (!title) continue
            tracks.push({
              videoId: `${title} ${artist}`,
              title: title,
              artist: artist,
              album: item.album?.name || null,
              duration: item.duration ? Math.floor(item.duration / 1000) : 0,
              thumbnail: item.thumbnail || item.albumArt || null,
              type: 'Song',
              service: 'spotify'
            })
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch Spotify playlist tracks:', e)
  }

  return tracks
})

const streamUrlMemoryCache = new Map()

function calculateStreamExpiry(url) {
  if (!url || typeof url !== 'string') return Date.now() + 15 * 60 * 1000
  const match = url.match(/expire=(\d+)/)
  if (match && match[1]) {
    const epochSec = parseInt(match[1], 10)
    if (!isNaN(epochSec) && epochSec > 0) {
      // Safe expiry: 2 minutes before CDN cutoff, capped at 45 minutes
      return Math.min(epochSec * 1000 - 120000, Date.now() + 45 * 60 * 1000)
    }
  }
  return Date.now() + 15 * 60 * 1000
}

function setCachedStreamUrl(videoId, data) {
  if (streamUrlMemoryCache.size >= 50) {
    const oldestKey = streamUrlMemoryCache.keys().next().value
    if (oldestKey) streamUrlMemoryCache.delete(oldestKey)
  }
  streamUrlMemoryCache.set(videoId, data)
}

// ─── Streaming quality ────────────────────────────────────────────────────────
// The source is YouTube, so the ceiling is Opus ~160 kbps (itag 251). There is no
// lossless stream to ask for — FLAC only exists for local files in the library.
// What these presets control is *which* rendition we request: `high` takes the
// best audio-only stream, `medium` the one nearest 128 kbps, `low` the one
// nearest 64 kbps to save data.
const STREAM_QUALITY_PRESETS = { high: null, medium: 128000, low: 64000 }
// yt-dlp picks with its own filter syntax; keep the two in step.
const YTDLP_FORMAT_BY_QUALITY = {
  high: 'bestaudio/best',
  medium: 'bestaudio[abr<=160]/bestaudio[abr<=128]/bestaudio/best',
  low: 'bestaudio[abr<=96]/bestaudio[abr<=64]/bestaudio/best'
}
let streamQuality = 'high'

// Cached URLs are tied to the quality they were resolved at, so the key must
// include it — otherwise switching quality mid-session silently reuses the old
// rendition.
function streamCacheKey(videoId) {
  return `${videoId}::${streamQuality}`
}

function bitrateOf(format) {
  return format?.bitrate || format?.averageBitrate || 0
}

function pickFormatByQuality(formats, quality = streamQuality) {
  const usable = (formats || []).filter((f) => f && f.url)
  if (!usable.length) return null
  const ranked = [...usable].sort((a, b) => bitrateOf(b) - bitrateOf(a))
  const target = STREAM_QUALITY_PRESETS[quality]
  if (!target) return ranked[0] // 'high' — best available
  return ranked.reduce(
    (best, f) => (Math.abs(bitrateOf(f) - target) < Math.abs(bitrateOf(best) - target) ? f : best),
    ranked[0]
  )
}

function describeFormat(format) {
  const mimeType = format?.mimeType || ''
  const codecString = (mimeType.match(/codecs="([^"]+)"/) || [])[1] || ''
  const codecs = codecString.split(',').map((c) => c.trim()).filter(Boolean)
  // A muxed format lists the video codec first; the audio one is what matters.
  const audioCodec = codecs.find((c) => /opus|mp4a|vorbis/i.test(c)) || codecs[0] || ''
  let codec = audioCodec
  if (/opus/i.test(audioCodec)) codec = 'Opus'
  else if (/mp4a/i.test(audioCodec)) codec = 'AAC'
  else if (/vorbis/i.test(audioCodec)) codec = 'Vorbis'
  else if (!audioCodec) codec = 'unknown'
  // For a muxed stream `bitrate` is the video+audio total, which would read as a
  // wildly inflated audio rate — report 0 and let the UI show the codec alone.
  const isMuxed = /^video\//.test(mimeType)
  return {
    itag: format?.itag ?? null,
    mimeType,
    codec,
    bitrate: isMuxed ? 0 : bitrateOf(format),
    quality: streamQuality
  }
}

function emitStreamInfo(videoId, info) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('audio:stream-info', { videoId, ...info })
    }
  } catch (_) {
    // A closed window must never break playback.
  }
}

ipcMain.handle('audio:setQuality', (_event, quality) => {
  streamQuality = Object.prototype.hasOwnProperty.call(STREAM_QUALITY_PRESETS, quality)
    ? quality
    : 'high'
  streamUrlMemoryCache.clear()
  logDebug(`[StreamUrl] Quality set to ${streamQuality}`)
  return streamQuality
})

ipcMain.handle('audio:getQuality', () => streamQuality)

// Resolve the best audio-only stream through yt-dlp.
//
// Innertube's own best rendition (Opus 251 from ANDROID_VR) is CDN-throttled to
// about 1 MB per URL, so it cannot carry a full-length track. yt-dlp negotiates a
// URL that serves arbitrary offsets, which is the only way to offer the top
// bitrate end to end. It costs a few seconds; the renderer prefetches the next
// track, so steady playback does not pay it.
function resolveBestAudioWithYtDlp(videoId) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process')
    const ytdlpPath = global.ytDlpPath || (app.isPackaged
      ? path.join(process.resourcesPath, 'yt-dlp.exe')
      : path.join(app.getAppPath(), 'yt-dlp.exe'))
    if (!fs.existsSync(ytdlpPath)) return resolve(null)

    execFile(
      ytdlpPath,
      [
        '-f', 'bestaudio/best',
        '--no-playlist', '--no-warnings', '--no-check-certificate',
        '--print', 'META|%(format_id)s|%(abr)s|%(ext)s',
        '-g',
        `https://www.youtube.com/watch?v=${videoId}`
      ],
      { timeout: 25000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const lines = stdout.trim().split('\n')
        const url = lines.find((l) => l.startsWith('http'))
        if (!url) return resolve(null)
        const meta = (lines.find((l) => l.startsWith('META|')) || '').split('|')
        const abr = Number(meta[2])
        const ext = (meta[3] || '').toLowerCase()
        resolve({
          url,
          itag: meta[1] ? Number(meta[1]) : null,
          bitrate: Number.isFinite(abr) ? Math.round(abr * 1000) : 0,
          codec: ext === 'webm' || ext === 'opus' ? 'Opus' : 'AAC'
        })
      }
    )
  })
}

ipcMain.handle('youtube:getStreamUrl', async (_event, videoId) => {
  if (!videoId) return null

  const cleanVideoId = typeof videoId === 'string' ? videoId.replace(/^yt:/, '').trim() : ''
  if (!cleanVideoId) return null

  // 1. Fast in-memory cache check (0ms)
  const cached = streamUrlMemoryCache.get(streamCacheKey(cleanVideoId))
  if (cached && cached.url && cached.expireAt > Date.now()) {
    logDebug(`[StreamUrl] Returning cached URL for ${cleanVideoId} (${streamQuality})`)
    if (cached.info) emitStreamInfo(cleanVideoId, cached.info)
    return cached.url
  }

  let targetVid = cleanVideoId
  const isStandardYtId = /^[a-zA-Z0-9_-]{11}$/.test(cleanVideoId)

  try {
    const yt = await initYouTubeI()
    if (yt && !isStandardYtId) {
      if (cleanVideoId.startsWith('MPREb_') || cleanVideoId.startsWith('PL') || cleanVideoId.startsWith('VL') || cleanVideoId.startsWith('RD') || cleanVideoId.startsWith('FEmusic_')) {
        try {
          const plData = await yt.music.getPlaylist(cleanVideoId).catch(() => null)
          const firstVid = plData?.items?.[0]?.id || plData?.items?.[0]?.videoId || plData?.contents?.[0]?.id
          if (firstVid && /^[a-zA-Z0-9_-]{11}$/.test(firstVid)) {
            targetVid = firstVid
          }
        } catch (_) {}
      } else {
        try {
          const sRes = await yt.music.search(cleanVideoId, { type: 'song' }).catch(() => null)
          const sItems = sRes?.contents?.find(c => c.type === 'MusicShelf')?.contents || sRes?.contents || []
          const topSong = sItems.find(i => i.id && /^[a-zA-Z0-9_-]{11}$/.test(i.id))
          if (topSong) {
            targetVid = topSong.id
          }
        } catch (_) {}
      }
    }

    const isTargetValid = /^[a-zA-Z0-9_-]{11}$/.test(targetVid)

    // Top tier goes through yt-dlp (see the note on resolveBestAudioWithYtDlp).
    if (streamQuality === 'high' && isStandardYtId) {
      const best = await resolveBestAudioWithYtDlp(cleanVideoId)
      if (best) {
        const info = {
          itag: best.itag,
          mimeType: '',
          codec: best.codec,
          bitrate: best.bitrate,
          quality: streamQuality,
          source: 'yt-dlp'
        }
        setCachedStreamUrl(streamCacheKey(cleanVideoId), {
          url: best.url,
          expireAt: calculateStreamExpiry(best.url),
          info
        })
        emitStreamInfo(cleanVideoId, info)
        logDebug(`[StreamUrl] ${cleanVideoId} via yt-dlp itag ${best.itag} ${best.codec} ${Math.round(best.bitrate / 1000)}kbps`)
        return best.url
      }
    }

    if (yt && isTargetValid) {
      // IOS first, and this matters more than it looks. ANDROID_VR returns a
      // slightly better Opus rendition, but its URLs are throttled by the CDN:
      // a fresh one refuses any range past ~1 MB, so playback stalls part-way
      // through and seeks are impossible. IOS URLs are plain HTTP — open ranges,
      // arbitrary offsets, no cap — so seeking works and tracks play end to end.
      for (const client of ['IOS', 'ANDROID_VR', 'ANDROID']) {
        try {
          const res = await yt.actions.execute('/player', { videoId: targetVid, client })
          const streamingData = res.data?.streamingData || {}

          // Audio-only renditions come first. Progressive formats are muxed with
          // video and cap the audio track around 96 kbps, so preferring them —
          // as this used to — made "highest quality" the worst-sounding option.
          const adaptiveAudio = (streamingData.adaptiveFormats || []).filter(
            (f) => f.url && /audio\//.test(f.mimeType || '')
          )
          const isAdaptive = adaptiveAudio.length > 0
          const chosen =
            pickFormatByQuality(adaptiveAudio) ||
            pickFormatByQuality(streamingData.formats, 'high') // muxed fallback: best only

          if (chosen && chosen.url) {
            const info = { ...describeFormat(chosen), source: isAdaptive ? 'adaptive' : 'progressive' }
            // IOS URLs are directly playable and seekable; no proxy hop.
            const playableUrl = chosen.url
            setCachedStreamUrl(streamCacheKey(cleanVideoId), {
              url: playableUrl,
              expireAt: calculateStreamExpiry(chosen.url),
              info
            })
            emitStreamInfo(cleanVideoId, info)
            logDebug(
              `[StreamUrl] ${cleanVideoId} via ${client} itag ${info.itag} ${info.codec} ` +
              `${Math.round(info.bitrate / 1000)}kbps (${streamQuality}, ${info.source})`
            )
            return playableUrl
          }
        } catch (e) {
          logDebug(`[StreamUrl] Innertube client ${client} failed: ${e.message}`)
        }
      }
    }
  } catch (err) {
    logDebug(`[StreamUrl] Innertube init or search error: ${err.message}`)
  }

  // 2. Parallel fallback: yt-dlp extraction
  try {
    const { execFile } = require('child_process')
    const path = require('path')
    let ytdlpPath = global.ytDlpPath || (app.isPackaged
      ? path.join(process.resourcesPath, 'yt-dlp.exe')
      : path.join(__dirname, '..', 'yt-dlp.exe'))

    if (fs.existsSync(ytdlpPath)) {
      const ytdlpUrl = await new Promise((resolve) => {
        execFile(ytdlpPath, [
          isStandardYtId ? `https://www.youtube.com/watch?v=${cleanVideoId}` : `ytsearch1:${cleanVideoId}`,
          '-g',
          '--no-playlist',
          '--no-check-certificate',
          '--no-warnings',
          '--no-cache-dir',
          // Match the preset: best available, <=160 kbps, or <=96 kbps.
          '--format', YTDLP_FORMAT_BY_QUALITY[streamQuality] || 'bestaudio/best'
        ], { timeout: 6000, windowsHide: true }, (error, stdout) => {
          if (error || !stdout) return resolve(null)
          const firstUrl = stdout.trim().split('\n').find(l => l.startsWith('http'))
          resolve(firstUrl || null)
        })
      })

      if (ytdlpUrl) {
        const info = { itag: null, mimeType: '', codec: 'yt-dlp', bitrate: 0, quality: streamQuality, source: 'yt-dlp' }
        setCachedStreamUrl(streamCacheKey(cleanVideoId), {
          url: ytdlpUrl,
          expireAt: calculateStreamExpiry(ytdlpUrl),
          info
        })
        emitStreamInfo(cleanVideoId, info)
        return ytdlpUrl
      }
    }
  } catch (dlpErr) {
    logDebug(`[StreamUrl] yt-dlp error for ${cleanVideoId}: ${dlpErr.message}`)
  }

  return null
})

// ─── IPC: App Version ─────────────────────────────────────────────────────────
// Single source of truth for the version string (package.json). The renderer
// used to hardcode it in the backup payload, which drifted from reality.
ipcMain.handle('app:getVersion', () => app.getVersion())

// `navigator.onLine` only knows whether a network interface is up, which stays true
// behind a dead router or a captive portal. `net.isOnline()` is Electron's own
// reachability check and is what the offline banner trusts.
ipcMain.handle('app:isOnline', () => {
  try {
    return net.isOnline()
  } catch {
    return true
  }
})

// ─── IPC: Crash / diagnostic log ──────────────────────────────────────────────
// Surfaces the on-disk log and dump locations so a user can attach them to a
// bug report. Previously there was nothing to attach.
ipcMain.handle('crash:getInfo', () => crashlog.getCrashInfo())

ipcMain.handle('crash:openLogFolder', async () => {
  if (!CRASH_LOG_FILE) return { success: false, error: 'No log file' }
  const err = await shell.openPath(path.dirname(CRASH_LOG_FILE))
  return err ? { success: false, error: err } : { success: true }
})

ipcMain.handle('crash:openDumpFolder', async () => {
  if (!CRASH_DUMP_DIR) return { success: false, error: 'No dump folder' }
  try {
    if (!fs.existsSync(CRASH_DUMP_DIR)) fs.mkdirSync(CRASH_DUMP_DIR, { recursive: true })
  } catch {
    // Fall through — openPath will report it.
  }
  const err = await shell.openPath(CRASH_DUMP_DIR)
  return err ? { success: false, error: err } : { success: true }
})

// ─── IPC: Preferences (Theme, Playlists, Favourites, Stats, Playback) ───────────
ipcMain.handle('preferences:load', () => {
  try {
    const docs = app.getPath('documents')
    const prefPath = path.join(docs, 'Glaze Music', 'preferences.json')
    let prefs = {}
    if (fs.existsSync(prefPath)) {
      const data = fs.readFileSync(prefPath, 'utf8')
      prefs = JSON.parse(data) || {}
    }

    // Fallback/merge from SQLite database if JSON missing or empty.
    //
    // "Empty" must NOT mean "missing": an empty array is a real answer — the user
    // deleted their last playlist / unfavourited everything. Treating it as
    // absent resurrected the whole set from the stale SQLite copy on the next
    // launch, which is exactly what "I deleted a playlist and it came back" was.
    // Only fall back when the key is genuinely absent (or not an array), i.e. an
    // old or partially written file.
    if (!Array.isArray(prefs.playlists)) {
      const dbPlaylists = db.getPlaylistsFromDB()
      if (dbPlaylists && dbPlaylists.length > 0) prefs.playlists = dbPlaylists
    }
    if (!Array.isArray(prefs.favourites) && !Array.isArray(prefs.streamingFavourites)) {
      const dbFavs = db.getFavouritesFromDB()
      if (dbFavs.favourites && dbFavs.favourites.length > 0) prefs.favourites = dbFavs.favourites
      if (dbFavs.streamingFavourites && dbFavs.streamingFavourites.length > 0) prefs.streamingFavourites = dbFavs.streamingFavourites
    }
    if (!Array.isArray(prefs.followedArtists)) {
      const dbFollowed = db.getFollowedArtistsFromDB()
      if (dbFollowed && dbFollowed.length > 0) prefs.followedArtists = dbFollowed
    }

    return prefs
  } catch (err) {
    console.error('Failed to load preferences:', err)
  }
  return null
})

ipcMain.handle('preferences:save', async (_event, prefs) => {
  // Serialise the whole read-modify-write. Queueing only the write would still
  // let two saves read the same stale `existing` and clobber each other.
  const run = async () => {
    try {
      const dirPath = path.join(app.getPath('documents'), 'Glaze Music')
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      const prefPath = path.join(dirPath, 'preferences.json')

      let existing = {}
      try {
        const raw = await fs.promises.readFile(prefPath, 'utf8')
        existing = JSON.parse(raw)
      } catch { /* file doesn't exist yet, start fresh */ }

      const merged = { ...existing, ...prefs }
      await atomicWriteJson(prefPath, merged)

      // Keep the cached lookup folder in step. `assertDirAllowed` still applies at
      // use time, so this cannot authorise a path — it only remembers one the user
      // already picked in Settings.
      if (typeof merged.downloadFolder === 'string' && merged.downloadFolder.trim()) {
        savedDownloadFolder = merged.downloadFolder.trim()
      }

      // NOTE: this handler deliberately does NOT widen the media allow-list.
      //
      // It used to, on the reasoning that "the renderer only reaches this handler
      // with paths the user chose in a native dialog". That reasoning is wrong:
      // a restored backup feeds arbitrary `folders` / `downloadFolder` values in
      // here, and a compromised renderer could simply call this with any path.
      // Together with `library:scan` it formed a two-step escalation — authorise a
      // directory, then read everything in it through media:// / art://.
      //
      // Authorisation now happens in exactly one kind of place: a native dialog
      // (`dialog:openFolder` / `dialog:openFiles`), which is a real user gesture,
      // plus `app:importBackup` for the folders inside a backup the user just
      // chose to import, and the startup seed reading the app's own prefs file.

      // Also persist playlists, favourites, and followed artists to SQLite DB for double redundancy
      if (Array.isArray(prefs.playlists)) {
        db.savePlaylistsToDB(prefs.playlists)
      }
      if (Array.isArray(prefs.favourites) || Array.isArray(prefs.streamingFavourites)) {
        db.saveFavouritesToDB(prefs.favourites || [], prefs.streamingFavourites || [])
      }
      if (Array.isArray(prefs.followedArtists)) {
        db.saveFollowedArtistsToDB(prefs.followedArtists)
      }

      return true
    } catch (err) {
      console.error('Failed to save preferences:', err)
      return false
    }
  }

  const result = preferencesWriteChain.then(run, run)
  // Keep the chain alive after a failed save; a rejected link would make every
  // later save skip its turn.
  preferencesWriteChain = result.then(() => {}, () => {})
  return result
})

// ─── IPC: Playback State ──────────────────────────────────────────────────────
ipcMain.handle('playback:load', () => {
  try {
    const filePath = path.join(app.getPath('userData'), 'playback_state.json')
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch (err) {
    console.error('Failed to load playback state:', err)
  }
  return null
})

ipcMain.handle('playback:save', async (_event, state) => {
  try {
    lastPlaybackState = state
    const filePath = path.join(app.getPath('userData'), 'playback_state.json')
    await fs.promises.writeFile(filePath, JSON.stringify(state), 'utf8')
    return true
  } catch (err) {
    console.error('Failed to save playback state:', err)
    return false
  }
})

// Playback position is written separately from the (large) queue blob. Persisting
// the whole queue just to record a resume timestamp re-serialised thousands of
// tracks on every volume nudge; this writes ~40 bytes on a slow tick instead.
ipcMain.handle('playback:savePosition', async (_event, currentTime) => {
  try {
    const payload = { currentTime: Number(currentTime) || 0, updatedAt: Date.now() }
    lastPlaybackPosition = payload
    const filePath = path.join(app.getPath('userData'), 'playback_position.json')
    await fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8')
    return true
  } catch (err) {
    return false
  }
})

ipcMain.handle('playback:loadPosition', () => {
  try {
    const filePath = path.join(app.getPath('userData'), 'playback_position.json')
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (parsed && typeof parsed.currentTime === 'number') return parsed
    }
  } catch (err) {
    console.error('Failed to load playback position:', err)
  }
  return null
})

// ─── IPC: Session & Navigation ────────────────────────────────────────────────
ipcMain.handle('session:load', () => {
  try {
    const filePath = path.join(app.getPath('userData'), 'session_state.json')
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    }
  } catch (err) {
    console.error('Failed to load session state:', err)
  }
  return null
})

ipcMain.handle('session:save', async (_event, state) => {
  try {
    const filePath = path.join(app.getPath('userData'), 'session_state.json')
    await fs.promises.writeFile(filePath, JSON.stringify(state), 'utf8')
    return true
  } catch (err) {
    console.error('Failed to save session state:', err)
    return false
  }
})

const logPath = path.join(app.getPath('userData'), 'glaze-debug.log')
function logDebug(msg) {
  if (process.env.DEBUG_GLAZE) {
    fs.promises.appendFile(logPath, `[${new Date().toISOString()}] ${msg}\n`).catch(() => {})
  }
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Seed the media allow-list from saved preferences + the default download dir
  seedAllowedRootsFromPrefs()
  db.pruneStaleData()

  // ── Permission hardening ──────────────────────────────────────────────────
  // Electron grants permission requests by default, so a renderer that ever got
  // compromised (or a page loaded inside the hidden auth window) could ask for the
  // camera, microphone, geolocation or notifications. This app needs none of them:
  // playback goes through <audio>, artwork through media://, and the media-session
  // API does not request a permission. Deny everything, explicitly.
  const denyPermission = (_wc, _permission, callback) => callback(false)
  session.defaultSession.setPermissionRequestHandler(denyPermission)
  session.defaultSession.setPermissionCheckHandler(() => false)
  for (const partition of ['persist:youtube-auth', 'persist:spotify-auth']) {
    const s = session.fromPartition(partition)
    s.setPermissionRequestHandler(denyPermission)
    s.setPermissionCheckHandler(() => false)
  }

  // Ensure yt-dlp is initialized in background (non-blocking)
  ensureYtDlp().catch(err => {
    logDebug('[Updater] ensureYtDlp error: ' + (err?.message || err))
  })

  // ── Scoped CORS / header handling ─────────────────────────────────────────
  // These handlers used to run on EVERY http(s) request in EVERY session,
  // stripping Origin/Referer and injecting `Access-Control-Allow-Origin: *`
  // into every response — which made the whole renderer CORS-open. They now
  // apply only to the streaming hosts the app actually needs.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.googlevideo.com/*', 'https://*.youtube.com/*', 'https://*.ytimg.com/*', 'https://*.ggpht.com/*', 'https://*.googleusercontent.com/*'] },
    (details, callback) => {
      if (!isStreamHost(details.url)) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }
      const headers = { ...details.requestHeaders }
      delete headers['Origin']
      delete headers['Referer']
      delete headers['origin']
      delete headers['referer']
      headers['User-Agent'] = DESKTOP_USER_AGENT
      callback({ requestHeaders: headers })
    }
  )

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://*.googlevideo.com/*', 'https://*.youtube.com/*', 'https://*.ytimg.com/*', 'https://*.ggpht.com/*', 'https://*.googleusercontent.com/*', 'https://*.scdn.co/*', 'https://*.spotifycdn.com/*'] },
    (details, callback) => {
      if (!isStreamHost(details.url)) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }
      const headers = { ...details.responseHeaders }

      // Strip all variations of existing CORS headers to prevent duplicate values (e.g. '*, *')
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase().startsWith('access-control-')) {
          delete headers[key]
        }
      }

      headers['Access-Control-Allow-Origin'] = ['*']
      headers['Access-Control-Allow-Headers'] = ['Range, Content-Type, Authorization']
      headers['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']
      headers['Access-Control-Expose-Headers'] = ['Content-Range, Content-Length, Accept-Ranges, Content-Type']
      callback({ responseHeaders: headers })
    }
  )

  // Fullscreen IPC handler
  ipcMain.handle('window:toggleFullScreen', () => {
    if (mainWindow) {
      const isFS = mainWindow.isFullScreen()
      mainWindow.setFullScreen(!isFS)
      return !isFS
    }
    return false
  })

  // Register the media:// protocol handler.
  // Serves local audio files with full HTTP range-request support so that
  // the audio element can seek freely (range requests → HTTP 206 responses).
  // Also proxies remote streaming URLs to bypass CORS and redirect limits.
  protocol.handle('media', async (request) => {
    // Parse protocol path safely
    let rawPath = request.url
    if (rawPath.startsWith('media:///')) {
      rawPath = rawPath.slice('media:///'.length)
    } else if (rawPath.startsWith('media://')) {
      rawPath = rawPath.slice('media://'.length)
    }
    const filePath = decodeURIComponent(rawPath)

    // Normalise remote URL
    let remoteUrl = ''
    if (filePath.startsWith('https:/') || filePath.startsWith('https://')) {
      remoteUrl = filePath.startsWith('https://') ? filePath : filePath.replace('https:/', 'https://')
    } else if (filePath.startsWith('http:/') || filePath.startsWith('http://')) {
      remoteUrl = filePath.startsWith('http://') ? filePath : filePath.replace('http:/', 'http://')
    }

    if (remoteUrl) {
      // Only proxy hosts the app actually streams from.
      if (!isStreamHost(remoteUrl)) {
        log.warn(`[media] Refused non-stream host: ${remoteUrl.slice(0, 80)}`)
        return new Response(null, { status: 403, statusText: 'Forbidden' })
      }
      const rangeHeader = request.headers.get('range')

      // Default single fetch for remote streams
      const headers = new Headers()
      if (rangeHeader) {
        headers.set('range', rangeHeader)
      }
      headers.set('User-Agent', DESKTOP_USER_AGENT)
      
      try {
        const response = await net.fetch(remoteUrl, {
          headers: headers,
          redirect: 'follow',
          bypassCustomProtocolHandlers: true
        })

        const cleanHeaders = new Headers()
        cleanHeaders.set('Accept-Ranges', 'bytes')
        
        const contentType = response.headers.get('content-type')
        if (contentType) cleanHeaders.set('Content-Type', contentType)
        
        const contentLength = response.headers.get('content-length')
        if (contentLength) cleanHeaders.set('Content-Length', contentLength)
        
        const contentRange = response.headers.get('content-range')
        if (contentRange) cleanHeaders.set('Content-Range', contentRange)

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: cleanHeaders
        })
      } catch (err) {
        log.warn(`[media] Remote fetch failed: ${err.message}`)
        return new Response(null, { status: 502, statusText: 'Bad Gateway' })
      }
    }

    // ── Local file: must be inside an authorised root or be an authorised file ──
    if (!isPathAllowed(filePath)) {
      log.warn(`[media] Refused path outside allow-list: ${filePath}`)
      return new Response(null, { status: 403, statusText: 'Forbidden' })
    }

    // Stat the file — return 404 if it doesn't exist
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      return new Response(null, { status: 404, statusText: 'File not found' })
    }

    const fileSize = stat.size
    const mimeType = getMimeType(filePath)
    const rangeHeader = request.headers.get('range')

    if (rangeHeader) {
      // Parse "bytes=start-end" or "bytes=start-"
      const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-')
      const start     = parseInt(startStr, 10)
      const end       = endStr !== '' ? parseInt(endStr, 10) : fileSize - 1
      const chunkSize = end - start + 1

      // Stream only the requested byte range
      const nodeStream = fs.createReadStream(filePath, { start, end })
      const webStream  = Readable.toWeb(nodeStream)

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges':  'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type':   mimeType,
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    // No Range header — stream the full file
    const webStream = Readable.toWeb(fs.createReadStream(filePath))

    return new Response(webStream, {
      status: 200,
      headers: {
        'Accept-Ranges':  'bytes',
        'Content-Length': String(fileSize),
        'Content-Type':   mimeType,
        'Access-Control-Allow-Origin': '*',
      },
    })
  })

  // ── avatar:// — user-uploaded profile pictures ──────────────────────────
  // Resolves a bare filename inside <userData>/avatars only. Anything with a
  // separator, a traversal segment, or an absolute path is rejected outright,
  // so this protocol cannot be used to read arbitrary files.
  protocol.handle('avatar', async (request) => {
    let name = ''
    try {
      name = decodeURIComponent(request.url.replace(/^avatar:\/{0,3}/, '').split('?')[0].split('#')[0])
    } catch { /* malformed percent-encoding */ }

    if (!name || name !== path.basename(name) || name.startsWith('.') || /[\\/]/.test(name)) {
      return new Response('Bad avatar request', { status: 400 })
    }

    const file = path.join(avatarDir(), name)
    try {
      const data = await fs.promises.readFile(file)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(file),
          // Content-addressed filename → safe to cache forever.
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      })
    } catch {
      return new Response('Avatar not found', { status: 404 })
    }
  })

  // ── LRU cache for art:// responses ──────────────────────────────────────
  // 50 was far too small for an album grid on a large library — each miss
  // re-runs parseFile (which reads the whole metadata block, expensive on FLAC).
  //
  // Bounded by **bytes, not entries**: a 600-entry cap means 600 × whatever the
  // embedded art happens to be, and a library of 1200px covers is ~600 × 300 KB
  // = 180 MB resident in the main process. 48 MB holds several hundred typical
  // covers and cannot balloon on a library of hi-res scans.
  const ART_CACHE_MAX_BYTES = 48 * 1024 * 1024
  const _artCache = new Map() // key = filePath, value = { data: Buffer, format: string }
  let _artCacheBytes = 0
  function artCacheGet(key) { if (!_artCache.has(key)) return null; const v = _artCache.get(key); _artCache.delete(key); _artCache.set(key, v); return v }
  function artCacheSet(key, val) {
    const prev = _artCache.get(key)
    if (prev) { _artCacheBytes -= prev.data.length; _artCache.delete(key) }
    _artCache.set(key, val)
    _artCacheBytes += val.data.length
    // Keep at least one entry even if a single cover exceeds the budget.
    while (_artCacheBytes > ART_CACHE_MAX_BYTES && _artCache.size > 1) {
      const oldestKey = _artCache.keys().next().value
      const oldest = _artCache.get(oldestKey)
      _artCacheBytes -= oldest.data.length
      _artCache.delete(oldestKey)
    }
  }

  // Transparent 1x1 GIF buffer to return when no embedded art is found (prevents 404 console errors in Chromium)
  const EMPTY_ART_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

  // art:// protocol handler — reconstructs Windows path from per-segment encoded URL
  protocol.handle('art', async (request) => {
    // Strip the protocol prefix — remaining string is slash-separated encoded segments
    const raw = request.url.slice('art:///'.length)

    // Decode each segment individually (preserves drive letters like "C:") 
    const segments = raw.split('/')
    const decodedSegments = segments.map(seg => { try { return decodeURIComponent(seg) } catch { return seg } })
    // Reconstruct: first segment is drive letter ("C:"), rest joined with backslash on Windows
    const filePath = decodedSegments[0].endsWith(':') 
      ? decodedSegments.join('\\') 
      : '/' + decodedSegments.join('/')

    // Return cached response if available
    const cached = artCacheGet(filePath)
    if (cached) {
      return new Response(cached.data, {
        status: 200,
        headers: { 'Content-Type': cached.format, 'Cache-Control': 'max-age=86400' },
      })
    }

    // Same allow-list as media:// — art:// used to parse ANY path on disk.
    if (!isPathAllowed(filePath)) {
      log.warn(`[art] Refused path outside allow-list: ${filePath}`)
      return new Response(EMPTY_ART_GIF, {
        status: 200,
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      })
    }

    try {
      const { parseFile } = await getMM()
      const meta = await parseFile(filePath, { duration: false, skipPostHeaders: true })
      const cover = meta.common.picture?.[0]
      if (cover) {
        artCacheSet(filePath, { data: cover.data, format: cover.format })
        return new Response(cover.data, {
          status: 200,
          headers: { 'Content-Type': cover.format, 'Cache-Control': 'max-age=86400' },
        })
      }
    } catch { /* missing art or unreadable file */ }

    // Cache negative result so we don't re-parse file repeatedly and avoid 404 console errors
    artCacheSet(filePath, { data: EMPTY_ART_GIF, format: 'image/gif' })
    return new Response(EMPTY_ART_GIF, {
      status: 200,
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'max-age=86400' },
    })
  })

  createWindow()
  createTray()
  registerMediaKeys()
  initDiscordRPC()

  // ─── Online updates ───────────────────────────────────────────────────────
  // Created once the window exists so the first `update:status` event has
  // somewhere to land. `init()` only schedules the first check ~12 s out, and
  // does nothing at all in a dev build. Update logs are written to disk even
  // when DEBUG_GLAZE is off — a packaged user has no console to read.
  updater = createUpdater({
    ipcMain,
    getWindow: () => mainWindow,
    log: {
      info: (...a) => { log.info(...a); crashlog.logToFile('info', ...a) },
      warn: (...a) => log.warn(...a),
      error: (...a) => log.error(...a),
    },
  })
  updater.init()
})

// ─── Discord Rich Presence ────────────────────────────────────────────────────
//
// CLIENT_ID must belong to a real Discord application:
//   discord.com/developers/applications → New Application → copy "Application ID"
// That application also needs three Rich Presence assets, keyed exactly:
//   glaze_icon, play_icon, pause_icon
//
// If the ID is not a live application, Discord answers the handshake with
//   {"code":4000,"message":"Invalid Client ID"}
// and closes the socket. `discord-rpc` surfaces that only as "connection closed",
// which reads exactly like "Discord is not running" — it is not. To tell the two
// apart, check for the pipe: \\.\pipe\discord-ipc-0.
const DISCORD_CLIENT_ID = process.env.GLAZE_DISCORD_CLIENT_ID || '1568359236205936680'
// The landing page, not the repo: GitHub's release pages ask a logged-out
// visitor to sign in, and the site has a download button that does not.
const SITE_URL = 'https://shami60.github.io/glaze-music/'

let discordRPC = null
let rpcConnected = false

function initDiscordRPC() {
  try {
    const DiscordRPC = require('discord-rpc')
    const CLIENT_ID = DISCORD_CLIENT_ID
    DiscordRPC.register(CLIENT_ID)
    discordRPC = new DiscordRPC.Client({ transport: 'ipc' })

    // `discord-rpc` assembles the activity from a fixed list of fields, so a
    // `type` never reaches Discord. Without type 2 (Listening) Discord renders
    // the timestamps as a static "2:24" instead of drawing the progress bar.
    // Intercept the outgoing frame rather than forking the library.
    const sendRequest = discordRPC.request.bind(discordRPC)
    discordRPC.request = (cmd, args) => {
      if (cmd === 'SET_ACTIVITY' && args && args.activity) {
        args.activity.type = 2 // Listening — the only type Discord draws a bar for
        // Makes the cover art clickable. `discord-rpc` has no field for it, and
        // Discord only honours it on the assets object, which exists whenever an
        // image key was sent.
        if (args.activity.assets) {
          args.activity.assets.large_url = SITE_URL
        }
        // A visible button is the reliable way to link out: `large_url` makes the
        // image clickable but nothing on the card hints that it is, and some
        // clients do not surface it at all.
        // The label has to do the work: nothing else on the card hints that any
        // of it is clickable. Emoji renders in RPC button labels.
        args.activity.buttons = [{ label: '🎧 What is Glaze Music?', url: SITE_URL }]
      }
      return sendRequest(cmd, args)
    }

    discordRPC.on('ready', () => {
      rpcConnected = true
      log.debug('Discord RPC connected')
      discordRPC.setActivity({
        details: 'Idle',
        state: 'Glaze Music',
        largeImageKey: 'glaze_icon',
        largeImageText: 'Glaze Music',
        instance: false,
      }).catch(() => {})
    })

    discordRPC.on('disconnected', () => {
      rpcConnected = false
      // Drop the reference. Once the transport has disconnected its socket is
      // null, and keeping the client alive means a later destroy() calls
      // socket.write() on null — that was the unhandled rejection on quit.
      discordRPC = null
    })

    discordRPC.login({ clientId: CLIENT_ID }).catch(err => {
      // Do not assume Discord is closed: a rejected application ID (code 4000)
      // arrives here as "connection closed" too.
      log.debug('Discord RPC login failed:', err.message, '| client id:', CLIENT_ID)
      rpcConnected = false
      // Same reasoning: a client that never logged in has a null socket, so it
      // must not survive to be destroyed during shutdown.
      discordRPC = null
    })
  } catch (err) {
    log.debug('Discord RPC init failed:', err.message)
    discordRPC = null
  }
}

ipcMain.handle('discord:updatePresence', (_event, data) => {
  // NOTE: the Windows thumbnail toolbar is updated by its own `thumbar:update`
  // channel. It used to be driven from here too, which meant every play/pause
  // rebuilt three nativeImages twice, and only ever worked when Discord was up.
  if (!discordRPC || !rpcConnected) return
  try {
    // Discord proxies the image itself, so it must be a real http(s) URL. Local
    // covers (art://, media://, file://) cannot be fetched and would render as a
    // broken placeholder, so those fall back to the uploaded app icon.
    const remoteArt = typeof data.art === 'string' && /^https?:\/\//i.test(data.art) ? data.art : 'glaze_icon'

    // Discord derives a progress bar from timestamps and keeps advancing it, so a
    // paused track cannot keep a frozen bar — it would lie. The position goes in
    // the subtitle instead, which is static and exact.
    const mmss = (secs) => {
      const s = Math.max(0, Math.floor(secs || 0))
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    const paused = !data.isPlaying && (data.currentTime || 0) > 0
    const subtitle = data.artist
      ? (paused ? `by ${data.artist} · paused at ${mmss(data.currentTime)}` : `by ${data.artist}`)
      : 'Listening'

    const activity = {
      details: data.title || 'Unknown Track',
      state: subtitle,
      largeImageKey: remoteArt,
      // Doubles as the third line on the card AND the hover text on the art,
      // which is the only hint that the image is clickable.
      largeImageText: 'Take me to Glaze Music',
      smallImageKey: data.isPlaying ? 'play_icon' : 'pause_icon',
      smallImageText: data.isPlaying ? 'Playing' : 'Paused',
      instance: false,
    }
    if (data.isPlaying && data.duration > 0) {
      activity.startTimestamp = Math.floor(Date.now() / 1000) - Math.floor(data.currentTime || 0)
      activity.endTimestamp = Math.floor(Date.now() / 1000) + Math.floor(data.duration - (data.currentTime || 0))
    }
    log.debug('[Discord] presence:', JSON.stringify({
      details: activity.details,
      state: activity.state,
      small: activity.smallImageKey,
      large: activity.largeImageKey,
      start: activity.startTimestamp,
      end: activity.endTimestamp,
    }))
    // setActivity returns a promise too; leaving it unhandled is the same class
    // of unhandled rejection as the shutdown crash.
    discordRPC.setActivity(activity).catch(err => {
      console.warn('Discord RPC update failed:', err.message)
    })
  } catch (err) {
    console.warn('Discord RPC update failed:', err.message)
  }
})

ipcMain.handle('discord:clearPresence', () => {
  if (!discordRPC || !rpcConnected) return
  try {
    discordRPC.clearActivity().catch(() => {})
  } catch (err) {
    console.warn('Discord RPC clear failed:', err.message)
  }
})

// ─── OS Integration: Thumbnail Toolbar (Windows) ──────────────────────────────
function getThumbarIconPath(iconName) {
  const possiblePaths = [
    path.join(__dirname, '../assets/icons', iconName),
    path.join(__dirname, '../src/assets/icons', iconName),
    path.join(process.resourcesPath, 'assets/icons', iconName),
  ]
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p
  }
  return path.join(__dirname, '../src/assets/icons', iconName)
}

function updateThumbnailToolbar(isPlaying = false) {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== 'win32') return
  try {
    const prevIconPath = getThumbarIconPath('prev.png')
    const playPauseIconPath = getThumbarIconPath(isPlaying ? 'pause.png' : 'play.png')
    const nextIconPath = getThumbarIconPath('next.png')

    const prevIcon = nativeImage.createFromPath(prevIconPath)
    const playPauseIcon = nativeImage.createFromPath(playPauseIconPath)
    const nextIcon = nativeImage.createFromPath(nextIconPath)

    if (prevIcon.isEmpty() || playPauseIcon.isEmpty() || nextIcon.isEmpty()) {
      return
    }

    const success = mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous Track',
        icon: prevIcon,
        click: () => mainWindow?.webContents.send('mediakey:prev'),
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: playPauseIcon,
        click: () => mainWindow?.webContents.send('mediakey:playpause'),
      },
      {
        tooltip: 'Next Track',
        icon: nextIcon,
        click: () => mainWindow?.webContents.send('mediakey:next'),
      },
    ])
  } catch (err) {
    console.warn('updateThumbnailToolbar failed:', err?.message)
  }
}

ipcMain.handle('thumbar:update', (_event, isPlaying) => {
  updateThumbnailToolbar(!!isPlaying)
})

app.on('window-all-closed', () => {
  if (isDev || process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (e) => {
  log.info('[Main] app before-quit triggered! Stack:\n' + new Error().stack)
  globalShortcut.unregisterAll()

  // Flush the last known playback state synchronously. The renderer throttles
  // saves, and `before-quit` is not awaited — an async write here would race the
  // process exit and could land half-written.
  try {
    const userData = app.getPath('userData')
    if (lastPlaybackState) {
      fs.writeFileSync(
        path.join(userData, 'playback_state.json'),
        JSON.stringify(lastPlaybackState),
        'utf8'
      )
    }
    if (lastPlaybackPosition) {
      fs.writeFileSync(
        path.join(userData, 'playback_position.json'),
        JSON.stringify(lastPlaybackPosition),
        'utf8'
      )
    }
  } catch (err) {
    crashlog.logToFile('warn', 'Failed to flush playback state on quit:', err)
  }

  // destroy() rejects asynchronously: transport.close() constructs a Promise
  // whose executor calls socket.write(), so a synchronous try/catch never sees
  // the failure. The rejection has to be handled on the promise itself.
  if (discordRPC && rpcConnected) {
    try { discordRPC.destroy().catch(() => {}) } catch (e) {}
  }
  // Fold the WAL back into the main DB file so no -wal/-shm files are orphaned.
  //
  // Wait for the preferences chain first. A save writes the JSON file and then
  // SQLite; closing the database underneath an in-flight save leaves JSON updated
  // while SQLite keeps the old rows, and the loader resurrects them on the next
  // launch — a deleted playlist coming back. Bounded, so a stuck write can never
  // block quitting.
  if (!quitFlushStarted) {
    quitFlushStarted = true
    e.preventDefault()
    Promise.race([
      Promise.resolve(preferencesWriteChain).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000))
    ]).finally(() => {
      try { db.closeDatabase() } catch (err) {}
      app.quit()
    })
    return
  }
  try { db.closeDatabase() } catch (e) {}
})

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})

// --- Spotify Pathfinder: full playlist without OAuth -------------------------
// The embed page is capped at 100 tracks, but carries an anonymous web-player
// token that can paginate the whole playlist through Spotify's partner GraphQL
// API. See electron/spotify-pathfinder.cjs for the details.
const {
  fetchFullSpotifyPlaylist,
  importSpotifyPlaylist
} = require('./spotify-pathfinder.cjs')

// main.cjs runs on Electron's network stack; hand it to the shared module.
const spotifyFetch = (url, opts) => net.fetch(url, opts)
const readFullSpotifyPlaylist = (id, token) => fetchFullSpotifyPlaylist(id, token, spotifyFetch)

// --- Playlist Import ---
ipcMain.handle('importPlaylist', async (event, urlStr) => {
  try {
    logDebug(`[ImportPlaylist] Triggered for URL: ${urlStr}`)
    if (!urlStr || typeof urlStr !== 'string') throw new Error('Invalid URL provided')
    
    const trimmedUrl = urlStr.trim()
    let playlistName = 'Imported Playlist'
    const tracks = []
    let spotifyTotal = 0
    let spotifySource = 'none'
    // Playlist-level artwork. Without this the imported playlist gets a null
    // thumbnail and the header renders the grey placeholder forever.
    let spotifyCover = null
    let spotifyExternalId = null

    // --- SPOTIFY PLAYLIST IMPORT ---
    if (trimmedUrl.includes('spotify.com') || trimmedUrl.includes('spotify:playlist:')) {
      const match = trimmedUrl.match(/(?:playlist\/|playlist:)([a-zA-Z0-9]+)/)
      const playlistId = match ? match[1] : null
      if (!playlistId) throw new Error('Could not parse Spotify Playlist ID from URL')

      logDebug(`[ImportPlaylist] Extracted Spotify Playlist ID: ${playlistId}`)

      // Reuse an already-cached token only. getSpotifyAccessToken() may mint one
      // by opening a hidden browser window, which would stall an import that
      // Pathfinder can satisfy on its own in about a second.
      const linkedToken =
        global.spotifyAccessToken && global.spotifyTokenExpiry > Date.now()
          ? global.spotifyAccessToken
          : null
      const result = await importSpotifyPlaylist(playlistId, {
        fetchImpl: spotifyFetch,
        accessToken: linkedToken
      })

      playlistName = result.name || playlistName
      spotifySource = result.source
      spotifyTotal = result.total || result.tracks.length
      spotifyCover = result.cover || null
      spotifyExternalId = playlistId

      for (const t of result.tracks) {
        const src = `yt:${t.title} ${t.artist}`
        tracks.push(src)
        db.cacheMetadata(src, {
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          thumbnail: t.thumbnail
        })
      }
      logDebug(`[ImportPlaylist] Spotify resolved via ${result.source}: ${tracks.length}/${spotifyTotal}`)
    }
    // --- YOUTUBE PLAYLIST IMPORT ---
    else if (trimmedUrl.includes('youtube.com') || trimmedUrl.includes('youtu.be')) {
      let listId = null
      try {
        const u = new URL(trimmedUrl)
        listId = u.searchParams.get('list')
      } catch (e) {
        const match = trimmedUrl.match(/[?&]list=([^&]+)/)
        if (match) listId = match[1]
      }

      if (!listId) throw new Error('Invalid YouTube Playlist URL (missing "list" query parameter)')

      logDebug(`[ImportPlaylist] Extracted YouTube List ID: ${listId}`)

      // 1. Try yt-dlp flat-playlist extraction (Handles YouTube & YT Music playlists 100% reliably up to 2000 tracks)
      try {
        const path = require('path')
        const { execFile } = require('child_process')
        let ytdlpPath = global.ytDlpPath || (app.isPackaged
          ? path.join(process.resourcesPath, 'yt-dlp.exe')
          : path.join(__dirname, '..', 'yt-dlp.exe'))

        const ytdlpOutput = await new Promise((resolve) => {
          execFile(ytdlpPath, [
            `https://www.youtube.com/playlist?list=${listId}`,
            '--flat-playlist',
            '--playlist-end', '2000',
            '-J',
            '--no-warnings'
          ], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) resolve(null)
            else resolve(stdout)
          })
        })

        if (ytdlpOutput) {
          const ytJson = JSON.parse(ytdlpOutput)
          playlistName = ytJson.title || playlistName
          const entries = ytJson.entries || []
          for (const entry of entries) {
            const vId = entry.id || entry.url?.match(/v=([^&]+)/)?.[1]
            if (!vId) continue
            const src = `yt:${vId}`
            tracks.push(src)

            const thumb = entry.thumbnails?.[entry.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`
            db.cacheMetadata(src, {
              title: entry.title || 'Unknown Title',
              artist: entry.uploader || entry.channel || entry.uploader_id || 'Unknown Artist',
              album: null,
              duration: entry.duration || 0,
              thumbnail: thumb
            })
          }
        }
      } catch (ytdlpErr) {
        logDebug(`[ImportPlaylist] yt-dlp import error: ${ytdlpErr.message}`)
      }

      // 2. Fallback to youtubei.js with continuation loop if yt-dlp produced 0 tracks
      if (tracks.length === 0) {
        const yt = ytAuthInstance || await initYouTubeI()
        if (yt) {
          try {
            let playlist = await yt.music.getPlaylist(listId)
            playlistName = playlist.header?.title?.text || playlist.info?.title || playlistName
            
            let allItems = playlist.items || playlist.contents || []
            while (playlist.has_continuation && allItems.length < 2000) {
              try {
                const more = await playlist.getContinuation()
                if (!more) break
                playlist = more
                allItems = allItems.concat(more.items || more.contents || [])
              } catch (e) {
                console.error('[ImportPlaylist] youtubei continuation error:', e)
                break
              }
            }

            for (const item of allItems) {
              const vId = item.id || item.videoId || item.video_id
              if (!vId) continue
              const src = `yt:${vId}`
              tracks.push(src)
              
              const tText = typeof item.title === 'object' ? (item.title?.text || item.title?.toString()) : item.title
              let aText = 'Unknown Artist'
              if (item.authors) aText = item.authors.map(a => a.name).join(', ')
              else if (item.artists) aText = item.artists.map(a => a.name).join(', ')
              else if (item.author) aText = typeof item.author === 'string' ? item.author : (item.author?.name || item.author?.text)
              
              db.cacheMetadata(src, {
                title: tText || 'Unknown Title',
                artist: aText,
                album: item.album?.name || null,
                duration: item.duration?.seconds || (typeof item.duration === 'number' ? item.duration : 0),
                thumbnail: item.thumbnails?.[0]?.url || (item.thumbnail?.contents || item.thumbnail)?.[0]?.url || null
              })
            }
          } catch (ytErr) {
            logDebug(`[ImportPlaylist] youtubei.js fallback error: ${ytErr.message}`)
          }
        }
      }
    } else {
      throw new Error('Unsupported URL format. Please paste a valid Spotify or YouTube playlist URL.')
    }

    if (tracks.length === 0) {
      throw new Error('No playable tracks found in playlist. Please verify the playlist is public.')
    }

    // Pathfinder walks the whole playlist, so `truncated` should stay false. It
    // only trips when every full-read path failed and we fell back to the embed's
    // hard-capped 100-track list — report that shortfall instead of hiding it.
    const truncated = spotifyTotal > tracks.length
    if (truncated) {
      logDebug(`[ImportPlaylist] Truncated: ${tracks.length}/${spotifyTotal} (${spotifySource})`)
    }

    logDebug(`[ImportPlaylist] Successfully imported "${playlistName}" with ${tracks.length} tracks`)
    // Always land one line in the log, regardless of DEBUG_GLAZE. "Imported 100"
    // reports are impossible to diagnose without knowing which source won.
    crashlog.logToFile(
      'info',
      `[ImportPlaylist] "${playlistName}" ${tracks.length}/${spotifyTotal || tracks.length} via ${spotifySource}${truncated ? ' TRUNCATED' : ''}`
    )
    return {
      success: true,
      name: playlistName,
      tracks,
      total: spotifyTotal || tracks.length,
      truncated,
      source: spotifySource,
      cover: spotifyCover,
      externalId: spotifyExternalId
    }
  } catch (e) {
    console.error('Import Playlist Error:', e)
    return { success: false, error: e.message }
  }
})

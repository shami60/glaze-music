'use strict'

/**
 * updater.cjs — online updates for Glaze Music.
 *
 * electron-updater + the NSIS `blockmap` that electron-builder already emits means an
 * update downloads only the blocks that actually changed, not the whole 112 MB
 * installer. `yt-dlp.exe` (23 MB) and the Electron runtime are byte-identical between
 * releases, so a code-only update is typically a few megabytes.
 *
 * Behaviour (deliberate, matches what the app asks for):
 *   - never downloads on its own — `autoDownload = false`, the user is asked first
 *   - `autoInstallOnAppQuit = true`, so "Later" still installs on the next quit
 *   - checks once shortly after launch, then every 4 h
 *   - does nothing at all in a dev build (`app.isPackaged === false`)
 *
 * The feed URL comes from `resources/app-update.yml`, which electron-builder writes
 * from the `build.publish` block in package.json. `GLAZE_UPDATE_URL` overrides it at
 * runtime so the whole loop can be proven against a local static server before any
 * hosting exists.
 */

const { app } = require('electron')

const FIRST_CHECK_DELAY_MS = 12 * 1000
const REPEAT_CHECK_MS = 4 * 60 * 60 * 1000

const INITIAL_STATE = {
  status: 'idle', // idle | disabled | checking | available | downloading | ready | up-to-date | error
  version: null,
  percent: 0,
  transferred: 0,
  total: 0,
  bytesPerSecond: 0,
  releaseNotes: '',
  error: null,
  // Only a *manual* check may surface an error to the user. The background check
  // runs every 4 h and will fail loudly on any machine without a reachable feed;
  // turning that into a popup would be a permanent nag for no benefit.
  manual: false,
  lastCheckedAt: null,
}

/** Release notes arrive as a string, an array of { version, note }, or HTML. */
function flattenNotes(notes) {
  if (!notes) return ''
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim()
  if (Array.isArray(notes)) return notes.map((n) => flattenNotes(n?.note ?? n)).filter(Boolean).join('\n\n')
  if (typeof notes === 'object') return flattenNotes(notes.note ?? notes.value ?? '')
  return ''
}

function createUpdater({ ipcMain, getWindow, log = console }) {
  let updater = null
  let state = { ...INITIAL_STATE }
  let timer = null
  let checking = false
  let downloading = false

  const snapshot = () => ({ ...state, currentVersion: app.getVersion() })

  function push(patch) {
    state = { ...state, ...patch }
    const win = getWindow?.()
    if (win && !win.isDestroyed()) win.webContents.send('update:status', snapshot())
    return snapshot()
  }

  function init() {
    // A dev build has no app-update.yml and would try to overwrite the working copy.
    if (!app.isPackaged) {
      return push({ status: 'disabled', error: 'Updates are only available in a packaged build.' })
    }

    try {
      // Required lazily: the module is only meaningful once packaged, and requiring it
      // at the top of main.cjs would break `npm run dev` for anyone without it installed.
      ;({ autoUpdater: updater } = require('electron-updater'))
    } catch (err) {
      log.info?.(`[Update] electron-updater unavailable: ${err.message}`)
      return push({ status: 'error', error: `Updater unavailable: ${err.message}` })
    }

    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = false
    updater.logger = {
      info: (m) => log.info?.(`[Update] ${m}`),
      warn: (m) => log.info?.(`[Update] ${m}`),
      error: (m) => log.info?.(`[Update] ${m}`),
      debug: () => {},
    }

    // Local proof: point a packaged build at a static server instead of the real host.
    const override = process.env.GLAZE_UPDATE_URL
    if (override) {
      log.info?.(`[Update] feed overridden by GLAZE_UPDATE_URL → ${override}`)
      try {
        updater.setFeedURL({ provider: 'generic', url: override })
      } catch (err) {
        return push({ status: 'error', error: `Bad GLAZE_UPDATE_URL: ${err.message}` })
      }
    }

    updater.on('checking-for-update', () => push({ status: 'checking', error: null }))

    updater.on('update-available', (info) => {
      push({
        status: 'available',
        version: info?.version || null,
        releaseNotes: flattenNotes(info?.releaseNotes),
        percent: 0,
        transferred: 0,
        total: 0,
        error: null,
        lastCheckedAt: Date.now(),
      })
    })

    updater.on('update-not-available', () => {
      push({ status: 'up-to-date', version: null, error: null, lastCheckedAt: Date.now() })
    })

    updater.on('download-progress', (p) => {
      push({
        status: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(p?.percent || 0))),
        transferred: p?.transferred || 0,
        total: p?.total || 0,
        bytesPerSecond: p?.bytesPerSecond || 0,
      })
    })

    updater.on('update-downloaded', (info) => {
      downloading = false
      push({ status: 'ready', version: info?.version || state.version, percent: 100 })
    })

    updater.on('error', (err) => {
      downloading = false
      const message = String(err?.message || err || 'Unknown update error')
      log.info?.(`[Update] error: ${message}`)
      push({ status: 'error', error: message, lastCheckedAt: Date.now() })
    })

    setTimeout(() => check({ manual: false }), FIRST_CHECK_DELAY_MS)
    timer = setInterval(() => check({ manual: false }), REPEAT_CHECK_MS)
    if (timer.unref) timer.unref()

    return snapshot()
  }

  async function check({ manual = false } = {}) {
    if (!updater) {
      return manual
        ? push({ status: 'disabled', error: 'Updates are only available in a packaged build.' })
        : snapshot()
    }
    if (checking) return snapshot()

    checking = true
    push({ status: 'checking', error: null, manual })
    try {
      await updater.checkForUpdates()
    } catch (err) {
      const message = String(err?.message || err)
      // The most common real-world cause is a missing/incorrect `build.publish` block,
      // which leaves no app-update.yml in resources/.
      push({
        status: 'error',
        manual,
        error: /app-update\.yml|ENOENT/i.test(message)
          ? 'No update feed configured in this build (app-update.yml missing).'
          : message,
        lastCheckedAt: Date.now(),
      })
    } finally {
      checking = false
    }
    return snapshot()
  }

  async function download() {
    if (!updater) return snapshot()
    if (downloading) return snapshot()
    downloading = true
    push({ status: 'downloading', percent: 0, error: null })
    try {
      await updater.downloadUpdate()
    } catch (err) {
      downloading = false
      push({ status: 'error', error: String(err?.message || err) })
    }
    return snapshot()
  }

  function install() {
    if (!updater) return { ok: false, error: 'Updater not available' }
    if (state.status !== 'ready') return { ok: false, error: 'No update has been downloaded yet' }
    // isSilent=false keeps the NSIS progress window; isForceRunAfter=true relaunches.
    setImmediate(() => updater.quitAndInstall(false, true))
    return { ok: true }
  }

  function dispose() {
    if (timer) clearInterval(timer)
    timer = null
  }

  // ── IPC surface ─────────────────────────────────────────────────────────────
  ipcMain.handle('update:getState', () => snapshot())
  ipcMain.handle('update:check', () => check({ manual: true }))
  ipcMain.handle('update:download', () => download())
  ipcMain.handle('update:install', () => install())

  return { init, check, download, install, getState: snapshot, dispose }
}

module.exports = { createUpdater }

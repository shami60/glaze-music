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
 *   - downloads on its own and silently — `autoDownload = true`, no prompt
 *   - installs **silently** (NSIS `/S`): the app quits, the update applies, and it
 *     comes back. No installer wizard, no Next-Next-Next. Installs are per-user
 *     (`%LOCALAPPDATA%\Programs`), so there is no UAC prompt either
 *   - "Later" still installs on the next quit, and that path is silent too
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

    // Download without asking. A patch is a blockmap diff — usually a few MB — and it
    // is applied on quit, so the user never sees a prompt, a progress bar or a wizard.
    updater.autoDownload = true
    // Deliberately false. electron-updater's built-in quit handler calls
    // quitAndInstall() with isSilent = false, which is exactly the NSIS wizard we
    // are removing. `onBeforeQuit` below takes that path over and installs silently.
    updater.autoInstallOnAppQuit = false
    app.on('before-quit', onBeforeQuit)
    updater.allowPrerelease = false
    // We ship the full NSIS package, never a web installer. Leaving this false
    // makes electron-updater carry the web-installer code path and log a warning
    // on every download for nothing.
    updater.disableWebInstaller = true
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

  // isSilent=true runs the NSIS installer with `/S`: no wizard, no clicks.
  // isForceRunAfter=true brings the app back up once it is done.
  //
  // `installing` guards the quit path: quitAndInstall() quits the app, which fires
  // before-quit again, and without the flag that would loop.
  let installing = false

  function runInstaller(forceRunAfter) {
    try {
      updater.quitAndInstall(true, forceRunAfter)
    } catch (err) {
      // Never strand the app in a half-quit: if the installer cannot start, let the
      // quit proceed normally.
      installing = false
      log.warn?.('[Update] silent install failed:', err?.message || err)
      app.quit()
    }
  }

  function install() {
    if (!updater) return { ok: false, error: 'Updater not available' }
    if (state.status !== 'ready') return { ok: false, error: 'No update has been downloaded yet' }
    if (installing) return { ok: true }
    installing = true
    // Explicit "Restart now": the app should come back up afterwards.
    //
    // The renderer shows an "Updating…" screen as soon as this resolves, so give it a
    // beat to paint before the window is torn down — otherwise the app just vanishes.
    setTimeout(() => runInstaller(true), 1100)
    return { ok: true }
  }

  // "Later" → quit → install silently. Without this the update would still be
  // applied, but through electron-updater's non-silent handler.
  function onBeforeQuit(event) {
    if (installing || !updater || state.status !== 'ready') return
    installing = true
    event.preventDefault()
    // The user asked to quit, so the installer must NOT relaunch the app.
    setImmediate(() => runInstaller(false))
  }

  function dispose() {
    if (timer) clearInterval(timer)
    timer = null
    app.removeListener('before-quit', onBeforeQuit)
  }

  // ── IPC surface ─────────────────────────────────────────────────────────────
  ipcMain.handle('update:getState', () => snapshot())
  ipcMain.handle('update:check', () => check({ manual: true }))
  ipcMain.handle('update:download', () => download())
  ipcMain.handle('update:install', () => install())

  return { init, check, download, install, getState: snapshot, dispose }
}

module.exports = { createUpdater }

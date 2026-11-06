import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Online updates — the renderer half.
 *
 * Main never downloads on its own (`autoDownload = false`), so this component owns
 * the whole conversation: "1.0.4 is available → Download?" → progress → "Restart now".
 * Choosing "Later" leaves the download installed on the next quit, because
 * `autoInstallOnAppQuit` is on.
 *
 * Everything here is inert in a dev build: main reports `status: 'disabled'`.
 */

const DISMISS_KEY = 'glaze.update.dismissed'

const mb = (bytes) => `${(Number(bytes || 0) / (1024 * 1024)).toFixed(1)} MB`

/** Subscribe to the main-process update state. */
export function useUpdateStatus() {
  const [state, setState] = useState({ status: 'idle', currentVersion: '', percent: 0 })

  useEffect(() => {
    let alive = true
    // `Promise.resolve` so a browser (no preload) resolves to undefined instead of
    // throwing on `.then` of an undefined value.
    Promise.resolve(window.electronAPI?.getUpdateState?.())
      .then((s) => {
        if (alive && s) setState(s)
      })
      .catch(() => {})
    const off = window.electronAPI?.onUpdateStatus?.((s) => {
      if (alive && s) setState(s)
    })
    return () => {
      alive = false
      off?.()
    }
  }, [])

  return state
}

function useDismissed(key) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === String(key)
    } catch {
      return false
    }
  })

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, String(key))
    } catch {
      /* private mode */
    }
  }, [key])

  // A *newer* version must be able to re-open the banner — but only when the key
  // actually changes. Resetting on mount would undo a dismissal on every remount.
  const prevKey = useRef(key)
  useEffect(() => {
    if (prevKey.current === key) return
    prevKey.current = key
    setDismissed(false)
    try {
      sessionStorage.removeItem(DISMISS_KEY)
    } catch {
      /* ignore */
    }
  }, [key])

  return [dismissed, dismiss]
}

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
    <path d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.4L11 13.6V4a1 1 0 0 1 1-1zM5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z" />
  </svg>
)

const RestartIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
    <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
  </svg>
)

/**
 * Floating card, bottom-right of the content area. Rendered once from App.jsx.
 */
export default function UpdateBanner() {
  const state = useUpdateStatus()
  const { status, version, percent, bytesPerSecond, transferred, total, error, manual, releaseNotes } =
    state
  const [dismissed, dismiss] = useDismissed(`${status}:${version || ''}`)
  const [showUpToDate, setShowUpToDate] = useState(false)
  const prevStatus = useRef(status)

  // "You're up to date" is only worth showing right after a *manual* check, so it
  // is a 4 s toast rather than a persistent panel.
  useEffect(() => {
    if (status === 'up-to-date' && manual && prevStatus.current === 'checking') {
      setShowUpToDate(true)
      const t = setTimeout(() => setShowUpToDate(false), 4000)
      prevStatus.current = status
      return () => clearTimeout(t)
    }
    prevStatus.current = status
    return undefined
  }, [status, manual])

  const visible =
    status === 'available' ||
    status === 'downloading' ||
    status === 'ready' ||
    // A failed background check must stay silent — the feed may simply not exist yet,
    // and a 4-hourly popup about it would be pure noise.
    (status === 'error' && manual) ||
    showUpToDate

  if (!visible) return null
  if (dismissed && status !== 'downloading') return null

  const dismissible = status !== 'downloading'

  return (
    // Sits above the floating player dock (bottom-2 + h-[62/68px]), not on top of it.
    <div className="fixed bottom-[88px] right-6 z-[9998] w-[380px] max-w-[calc(100vw-3rem)]">
      <div className="glass-panel rounded-2xl p-4 border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl bg-white/5">
        {/* ── Available ─────────────────────────────────────────────── */}
        {status === 'available' && (
          <>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white/80 shrink-0">
                <DownloadIcon />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white leading-tight">
                  Glaze Music {version} is available
                </p>
                <p className="text-xs text-white/60 mt-0.5">
                  You have {state.currentVersion}. It downloads in the background and only
                  installs when you restart.
                </p>
              </div>
            </div>

            {/* What's actually in the update. Comes from `releaseNotes` in latest.yml,
                written by scripts/stamp-release-notes.cjs from RELEASE-NOTES.md. */}
            {releaseNotes ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
                  What&apos;s new
                </p>
                <div className="max-h-[132px] overflow-y-auto custom-scrollbar pr-1">
                  <p className="text-[12px] leading-relaxed text-white/75 whitespace-pre-line">
                    {releaseNotes}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-2 mt-3.5">
              <button
                onClick={() => window.electronAPI?.downloadUpdate?.()}
                className="flex-1 h-9 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors cursor-pointer"
              >
                Download
              </button>
              <button
                onClick={dismiss}
                className="h-9 px-3 rounded-xl border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                Later
              </button>
            </div>
          </>
        )}

        {/* ── Downloading ───────────────────────────────────────────── */}
        {status === 'downloading' && (
          <>
            <p className="text-sm font-semibold text-white leading-tight">
              Downloading {version || 'update'}… {percent}%
            </p>
            <div className="mt-2.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-[11px] text-white/50 mt-2 tabular-nums">
              {mb(transferred)} of {mb(total)}
              {bytesPerSecond ? ` · ${mb(bytesPerSecond)}/s` : ''}
            </p>
          </>
        )}

        {/* ── Ready ─────────────────────────────────────────────────── */}
        {status === 'ready' && (
          <>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white/80 shrink-0">
                <RestartIcon />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white leading-tight">
                  Update {version} is ready
                </p>
                <p className="text-xs text-white/60 mt-0.5">
                  Restart to finish. If you pick Later it installs the next time you quit.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3.5">
              <button
                onClick={() => window.electronAPI?.installUpdate?.()}
                className="flex-1 h-9 rounded-xl bg-white text-black text-sm font-semibold hover:bg-white/90 transition-colors cursor-pointer"
              >
                Restart now
              </button>
              <button
                onClick={dismiss}
                className="h-9 px-3 rounded-xl border border-white/10 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                Later
              </button>
            </div>
          </>
        )}

        {/* ── Error ─────────────────────────────────────────────────── */}
        {status === 'error' && (
          <>
            <p className="text-sm font-semibold text-white leading-tight">
              Couldn&apos;t check for updates
            </p>
            <p className="text-xs text-white/60 mt-1 break-words">{error || 'Unknown error'}</p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => window.electronAPI?.checkForUpdates?.()}
                className="h-8 px-3 rounded-xl border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                Try again
              </button>
              <button
                onClick={dismiss}
                className="h-8 px-3 rounded-xl text-xs text-white/50 hover:text-white/80 transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </>
        )}

        {/* ── Up to date (manual check only) ────────────────────────── */}
        {showUpToDate && status === 'up-to-date' && (
          <p className="text-sm text-white/80">
            Glaze Music is up to date
            <span className="text-white/45"> · {state.currentVersion}</span>
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Inline row for Settings → About: version + a manual check.
 */
export function UpdateRow() {
  const state = useUpdateStatus()
  const { status, currentVersion, version, percent, error } = state
  const [version2, setVersion2] = useState('')

  useEffect(() => {
    let alive = true
    Promise.resolve(window.electronAPI?.getAppVersion?.())
      .then((v) => {
        if (alive) setVersion2(v || '')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const shown = currentVersion || version2
  const busy = status === 'checking' || status === 'downloading'

  let label = 'Check for updates'
  if (status === 'checking') label = 'Checking…'
  else if (status === 'downloading') label = `Downloading ${percent}%`
  else if (status === 'available') label = `Download ${version}`
  else if (status === 'ready') label = 'Restart to install'

  let detail = 'Not checked yet'
  if (status === 'checking') detail = 'Looking for a new version…'
  else if (status === 'up-to-date') detail = 'You are on the latest version'
  else if (status === 'available') detail = `${version} is available to download`
  else if (status === 'downloading') detail = `Downloading — ${percent}%`
  else if (status === 'ready') detail = 'Downloaded. Restart to finish installing.'
  else if (status === 'error') detail = error || 'Update check failed'

  const onClick = () => {
    if (status === 'available') window.electronAPI?.downloadUpdate?.()
    else if (status === 'ready') window.electronAPI?.installUpdate?.()
    else window.electronAPI?.checkForUpdates?.()
  }

  if (status === 'disabled') {
    return (
      <div className="w-full">
        <p className="text-sm font-medium text-white/85">
          Version {shown || '—'}
        </p>
        <p className="text-[11px] text-white/45 mt-0.5">
          Updates are disabled in a dev build — they work in the installed app.
        </p>
      </div>
    )
  }

  return (
    <div className="flex w-full items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/85 tabular-nums">
          Version {shown || '—'}
        </p>
        <p
          className={`text-[11px] mt-0.5 truncate ${
            status === 'error' ? 'text-red-400/80' : 'text-white/45'
          }`}
          title={detail}
        >
          {detail}
        </p>
      </div>
      <button
        onClick={onClick}
        disabled={busy}
        className="shrink-0 h-8 px-3.5 rounded-lg border border-white/10 text-[11px] font-medium text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
      >
        {label}
      </button>
    </div>
  )
}

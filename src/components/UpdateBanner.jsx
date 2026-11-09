import { useCallback, useEffect, useRef, useState } from 'react'
// Shipped inside the bundle, so the panel can say what changed in the version you are
// actually running — `releaseNotes` from the feed only describes an *incoming* update.
import bundledNotes from '../../RELEASE-NOTES.md?raw'

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

  // Nothing appears on its own. Updates download and apply in the background, so the
  // only time this banner is warranted is when the user asked for a check — then it is
  // right to tell them what it found. A failed background check stays silent: the feed
  // may simply not exist yet, and a 4-hourly popup about it would be pure noise.
  const visible =
    (manual && (status === 'available' || status === 'downloading' || status === 'ready')) ||
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
                onClick={() => startInstall(version)}
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
// Starting an install has to do two things: tell the user (the overlay) and tell main.
// Keeping it in one place means the banner and the Settings row can never drift.
export async function startInstall(version) {
  try {
    window.dispatchEvent(new CustomEvent('glaze:installing', { detail: { version } }))
  } catch {
    /* CustomEvent unavailable — the install still proceeds */
  }
  // If main refuses (no update staged, updater unavailable), the overlay must not
  // stay on screen — nothing would ever dismiss it.
  const result = await window.electronAPI?.installUpdate?.().catch(() => null)
  if (!result?.ok) {
    window.dispatchEvent(new CustomEvent('glaze:installing-cancelled'))
  }
}

function agoLabel(ts) {
  if (!ts) return 'Not yet'
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 45) return 'Just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function dateLabel(ts) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

const plain = (line) => line.replace(/\*\*/g, '').replace(/`/g, '')

function NoteLines({ text }) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  return (
    <ul className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <li key={i} className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40 pt-2">
              {line.slice(3)}
            </li>
          )
        }
        if (line.startsWith('# ')) {
          return (
            <li key={i} className="text-[11px] font-bold text-white/80">
              {plain(line.slice(2))}
            </li>
          )
        }
        if (line.startsWith('- ')) {
          return (
            <li key={i} className="flex gap-2 text-[11.5px] leading-relaxed text-white/70">
              <span className="text-white/25 select-none">•</span>
              <span>{plain(line.slice(2))}</span>
            </li>
          )
        }
        // Horizontal rules and the "keep this short" footer are for the release page.
        if (line === '---' || line.startsWith('_')) return null
        return (
          <li key={i} className="text-[11.5px] leading-relaxed text-white/60">
            {plain(line)}
          </li>
        )
      })}
    </ul>
  )
}

export function UpdateRow({ accentColor = '#ef4444' }) {
  const state = useUpdateStatus()
  const { status, currentVersion, version, percent, error, lastCheckedAt, releaseNotes } = state
  const [appVersion, setAppVersion] = useState('')
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.resolve(window.electronAPI?.getAppVersion?.())
      .then((v) => {
        if (alive) setAppVersion(v || '')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const shown = currentVersion || appVersion

  // Remember when this version first ran. There is no API for "when was I installed",
  // and the honest answer is "the first time this build was launched" — which is what
  // a user means by it anyway.
  const [installedAt, setInstalledAt] = useState(null)
  useEffect(() => {
    if (!shown) return
    try {
      const key = 'glaze.installed.' + shown
      let at = Number(localStorage.getItem(key) || 0)
      if (!at) {
        at = Date.now()
        localStorage.setItem(key, String(at))
      }
      setInstalledAt(at)
    } catch {
      /* storage unavailable */
    }
  }, [shown])

  const incoming = status === 'available' || status === 'downloading' || status === 'ready'
  const notesVersion = incoming ? version || shown : shown
  const notesText = incoming && releaseNotes ? releaseNotes : bundledNotes

  const busy = status === 'checking' || status === 'downloading'

  let pill = 'Up to date'
  let dot = 'bg-emerald-400'
  if (status === 'checking') { pill = 'Checking…'; dot = 'bg-white/40' }
  else if (status === 'available') { pill = `Update ${version} available`; dot = 'bg-amber-400' }
  else if (status === 'downloading') { pill = `Downloading ${percent}%`; dot = 'bg-amber-400' }
  else if (status === 'ready') { pill = 'Ready — installs itself'; dot = 'bg-emerald-400' }
  else if (status === 'error') { pill = 'Check failed'; dot = 'bg-red-400' }
  else if (status === 'idle') { pill = 'Not checked yet'; dot = 'bg-white/30' }
  else if (status === 'disabled') { pill = 'Updates disabled'; dot = 'bg-white/30' }

  let label = 'Check for updates'
  if (status === 'checking') label = 'Checking…'
  else if (status === 'downloading') label = `Downloading ${percent}%`
  else if (status === 'available') label = `Download ${version}`
  else if (status === 'ready') label = 'Restart now'

  const onClick = () => {
    if (status === 'available') window.electronAPI?.downloadUpdate?.()
    else if (status === 'ready') startInstall(version)
    else window.electronAPI?.checkForUpdates?.()
  }

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dot} shadow-[0_0_10px_currentColor]`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">{pill}</p>
            <p className="text-[11px] text-white/45 mt-0.5">
              Version <span className="tabular-nums text-white/70">{shown || '—'}</span> · Stable
            </p>
          </div>
        </div>
        {/* Filled, not a ghost outline: this is the one control people come here to
            press, and a low-contrast border button reads as disabled even when it is
            not. */}
        <button
          onClick={onClick}
          disabled={busy || status === 'disabled'}
          style={{ backgroundColor: accentColor }}
          className="shrink-0 h-9 px-4 rounded-xl text-white text-xs font-semibold shadow-lg shadow-black/20 flex items-center gap-2 transition-all cursor-pointer hover:brightness-110 active:scale-95 disabled:opacity-55 disabled:cursor-default disabled:hover:brightness-100 disabled:active:scale-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`}
          >
            <path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
          </svg>
          <span className="whitespace-nowrap">{label}</span>
        </button>
      </div>

      {status === 'downloading' && (
        <div className="mt-3 h-1 w-full rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-white/60 transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, percent || 0))}%` }}
          />
        </div>
      )}

      {status === 'disabled' && (
        <p className="mt-3 text-[11px] text-white/40">
          Updates only run in the installed build — a dev build has no update feed.
        </p>
      )}

      {status === 'error' && error && (
        <p className="mt-3 text-[11px] text-red-400/80">{error}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 pt-3 border-t border-white/5">
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-white/35">Last checked</dt>
          <dd className="text-[11.5px] text-white/70 mt-0.5">{agoLabel(lastCheckedAt)}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-[0.12em] text-white/35">Installed</dt>
          <dd className="text-[11.5px] text-white/70 mt-0.5">{dateLabel(installedAt)}</dd>
        </div>
      </dl>

      <button
        onClick={() => setShowNotes((v) => !v)}
        className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-white/55 hover:text-white transition-colors cursor-pointer"
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className={`w-3 h-3 transition-transform ${showNotes ? 'rotate-90' : ''}`}
        >
          <path d="M9 6l6 6-6 6z" />
        </svg>
        What changed in {notesVersion || 'this version'}
      </button>

      {showNotes && (
        <div className="mt-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
          <NoteLines text={notesText} />
        </div>
      )}
    </div>
  )
}

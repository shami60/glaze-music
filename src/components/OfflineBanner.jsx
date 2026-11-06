import { useEffect, useRef, useState } from 'react'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

/**
 * OfflineBanner — a thin strip under the title bar.
 *
 * The point is that the app never *looks broken* without a connection: your
 * downloads, playlists and library are local, so they keep working, and the only
 * thing that changes is that online-only surfaces stop pretending they will load.
 * When the connection comes back it flashes "Back online" for a moment so the
 * change is not silent.
 */
export default function OfflineBanner() {
  const online = useOnlineStatus()
  const [justReconnected, setJustReconnected] = useState(false)
  const [notice, setNotice] = useState(null)
  const wasOffline = useRef(false)

  useEffect(() => {
    const onNotice = (e) => setNotice(e.detail || 'That needs a connection.')
    window.addEventListener('glaze:offline-notice', onNotice)
    return () => window.removeEventListener('glaze:offline-notice', onNotice)
  }, [])

  // A notice is transient: it explains one refused click, then the strip goes
  // back to its standing message.
  useEffect(() => {
    if (!notice) return undefined
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setJustReconnected(false)
      return undefined
    }
    if (wasOffline.current) {
      wasOffline.current = false
      setJustReconnected(true)
      const t = setTimeout(() => setJustReconnected(false), 2600)
      return () => clearTimeout(t)
    }
    return undefined
  }, [online])

  if (online && !justReconnected) return null

  const offline = !online

  return (
    <div
      role="status"
      aria-live="polite"
      className={`glaze-strip ${offline ? 'glaze-strip--offline' : 'glaze-strip--online'} relative z-20 shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-medium select-none`}
    >
      {offline && notice ? (
        <>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
            <path d="M12 2 1 21h22L12 2zm0 5.5 6.6 11.4H5.4L12 7.5zM11 11v4h2v-4h-2zm0 5v2h2v-2h-2z" />
          </svg>
          <span>{notice}</span>
        </>
      ) : offline ? (
        <>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M3.27 2 2 3.27l2.1 2.1A11.9 11.9 0 0 0 1 9l2 2a9.9 9.9 0 0 1 3.2-2.13L8.1 10.8A7 7 0 0 0 5 12.5l2 2a5 5 0 0 1 2.4-1.35l1.5 1.5a3 3 0 0 0 2.6 2.6l5.2 5.2L20 21.27 3.27 2zM12 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
            <path d="M23 9a15.9 15.9 0 0 0-6.06-3.9l1.6 1.6A13.9 13.9 0 0 1 21 9l-2 2c-.3-.25-.62-.5-.95-.72l1.45 1.45L21 10.2 23 9z" opacity=".55" />
          </svg>
          <span>
            You&apos;re offline — downloaded songs, playlists and your library still work.
            Search and YouTube Music will resume when you reconnect.
          </span>
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M12 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM1 9l2 2a13 13 0 0 1 18 0l2-2A16 16 0 0 0 1 9zm4 4 2 2a7 7 0 0 1 10 0l2-2a10 10 0 0 0-14 0z" />
          </svg>
          <span>Back online</span>
        </>
      )}
    </div>
  )
}

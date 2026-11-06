import { useEffect, useState } from 'react'

/**
 * Announce a refused action ("that track isn't downloaded"). The OfflineBanner
 * listens for this, so there is exactly one place in the UI that speaks about
 * connectivity — a second toast would say the same thing in a different voice.
 */
export function announceOffline(message) {
  try {
    window.dispatchEvent(new CustomEvent('glaze:offline-notice', { detail: message }))
  } catch {
    /* no window (tests) — nothing to announce */
  }
}

/**
 * Network reachability, for the offline UI.
 *
 * `navigator.onLine` alone is not enough: it stays true when the machine is on a
 * LAN with no route out (captive portal, dead router). So the answer is "offline"
 * when either the browser says so, or the main process — which can actually try a
 * socket — says so. The renderer events give us instant feedback; the main-process
 * check corrects the false-positive cases when the window regains focus.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  )

  useEffect(() => {
    let alive = true

    const recheck = () => {
      if (!alive) return
      if (navigator.onLine === false) {
        setOnline(false)
        return
      }
      Promise.resolve(window.electronAPI?.isOnline?.())
        .then((v) => {
          if (alive && typeof v === 'boolean') setOnline(v)
        })
        .catch(() => {})
    }

    const goOffline = () => alive && setOnline(false)
    const goOnline = () => alive && recheck()

    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    window.addEventListener('focus', recheck)
    recheck()

    return () => {
      alive = false
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('focus', recheck)
    }
  }, [])

  return online
}

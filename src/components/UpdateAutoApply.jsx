import { useEffect, useRef } from 'react'
import { usePlayer } from '../context/usePlayer'
import { startInstall, useUpdateStatus } from './UpdateBanner'

/**
 * Applies a downloaded update on its own, once the app is idle.
 *
 * Until now an update only installed when the user quit — so the "Updating…" screen
 * never appeared and the app never came back by itself. This closes that: when an
 * update is staged and nothing is playing, it waits a short grace period, shows the
 * updating screen, installs, and the app reopens on the new version.
 *
 * The delay is deliberate. Restarting the moment a download finishes would cut off
 * whatever the user is doing; 20 s of quiet, cancelled the instant playback resumes,
 * means it lands in a gap rather than in the middle of something.
 */
const IDLE_BEFORE_APPLY_MS = 20000

export default function UpdateAutoApply() {
  const state = useUpdateStatus()
  const { isPlaying } = usePlayer()
  const timerRef = useRef(null)

  useEffect(() => {
    if (state.status !== 'ready' || isPlaying) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return undefined
    }

    if (timerRef.current) return undefined

    timerRef.current = setTimeout(() => {
      timerRef.current = null
      // Re-checked inside the timer: the user may have hit play while we waited.
      if (document.visibilityState === 'hidden') return
      startInstall(state.version)
    }, IDLE_BEFORE_APPLY_MS)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [state.status, state.version, isPlaying])

  return null
}

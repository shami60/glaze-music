import { useContext } from 'react'
import { PlayerContext, PlaybackTimeContext } from './context'

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}

/**
 * Subscribe to the playback position only.
 *
 * Use this in components that need a ticking time / progress value (seek bars,
 * synced lyrics, the mini player). It re-renders ~4x/sec, which is why it is
 * kept separate from `usePlayer()`.
 */
export function usePlaybackTime() {
  return useContext(PlaybackTimeContext)
}

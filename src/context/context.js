import { createContext } from 'react'

export const PlayerContext = createContext(null)

/**
 * High-frequency playback position, deliberately kept in its own context.
 *
 * `currentTime` updates ~4x per second while audio plays. When it lived in
 * PlayerContext, every one of the 18 `usePlayer()` consumers re-rendered 4x/sec.
 * Only the seek bar, the full-screen player, the lyrics view and the mini player
 * actually need it — they subscribe here instead.
 */
export const PlaybackTimeContext = createContext({ currentTime: 0, progress: 0, seekTo: () => {} })

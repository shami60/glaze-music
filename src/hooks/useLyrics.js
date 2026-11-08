import { useCallback, useEffect, useRef, useState } from 'react'
import { extractVideoId, parseLRC, stripTimestamps } from '../lyricsUtils'

/**
 * The one place a track's lyrics are fetched.
 *
 * There used to be three — the lyrics panel, the home dashboard card, and the
 * mini player — each deriving the video id slightly differently and each with
 * its own idea of what a failed lookup means. The mini player even kept its own
 * memory cache with no expiry and wrote "Lyrics not available" into it, so one
 * bad second on the network pinned a track for the whole session *there* while
 * the panel showed a synced sheet for the same song. That divergence is what
 * made the same track look broken at random.
 *
 * Returns `{ lyrics, isLoading, reload }` where lyrics is
 * `{ type: 'synced' | 'plain' | 'none' | null, data, canRetry? }`.
 */

const EMPTY = { type: null, data: null }
// The main process answers `{ retryable: true }` when a source is merely slow.
// One retry is enough: by then the lookup has either finished or is about to.
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 900
// When lrclib is slow, the panel is handed the static sheet from YouTube and the
// main process keeps working; its cache is upgraded to the synced one if that
// arrives. Re-asking once after a pause picks the upgrade up, so a slow track
// ends up animated instead of staying static until the panel is reopened.
const SYNCED_UPGRADE_DELAY_MS = 3000

export function useLyrics(track) {
  const [lyrics, setLyrics] = useState(EMPTY)
  const [isLoading, setIsLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  // The effect must not re-run when a metadata refresh swaps the object without
  // changing the song, so it reads the track through a ref and depends on a
  // plain string instead.
  const trackRef = useRef(track)
  trackRef.current = track
  const trackKey = track
    ? `${track.src || ''}|${track.title || ''}|${track.artist || ''}`
    : ''

  useEffect(() => {
    let active = true
    let timer = null
    const current = trackRef.current

    if (!current) {
      setLyrics(EMPTY)
      setIsLoading(false)
      return
    }

    const videoId = extractVideoId(current)
    const { title, artist } = current

    setLyrics(EMPTY)
    setIsLoading(true)

    const attempt = async (n) => {
      let result
      try {
        result = await window.electronAPI.youtubeGetLyrics(videoId, title, artist)
      } catch (err) {
        if (!active) return
        console.error('Lyrics lookup failed:', err)
        setLyrics({ type: 'none', data: 'Could not load lyrics', canRetry: true })
        setIsLoading(false)
        return
      }
      if (!active) return

      if (result?.retryable) {
        if (n + 1 < MAX_ATTEMPTS) {
          timer = setTimeout(() => attempt(n + 1), RETRY_DELAY_MS)
          return
        }
        setLyrics({ type: 'none', data: 'Lyrics service is not responding', canRetry: true })
        setIsLoading(false)
        return
      }

      if (!result) {
        setLyrics({ type: 'none', data: 'Lyrics not available' })
        setIsLoading(false)
        return
      }

      if (result.type === 'synced') {
        const parsed = parseLRC(result.text)
        if (parsed.length > 0) {
          setLyrics({ type: 'synced', data: parsed })
          setIsLoading(false)
          return
        }
        // Timestamps we cannot read would render as an empty panel with no
        // explanation, so fall through and show the sheet as plain text.
      }

      const plain = stripTimestamps(result.text)
      if (!plain) {
        setLyrics({ type: 'none', data: 'Lyrics not available' })
        setIsLoading(false)
        return
      }
      setLyrics({ type: 'plain', data: plain })
      setIsLoading(false)

      // One quiet re-check for a synced sheet that is still on its way.
      timer = setTimeout(async () => {
        try {
          const better = await window.electronAPI.youtubeGetLyrics(videoId, title, artist)
          if (!active || better?.type !== 'synced') return
          const parsed = parseLRC(better.text)
          if (parsed.length > 0) setLyrics({ type: 'synced', data: parsed })
        } catch {
          // A failed upgrade leaves the static sheet in place — nothing to report.
        }
      }, SYNCED_UPGRADE_DELAY_MS)
    }

    attempt(0)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [trackKey, reloadToken])

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  return { lyrics, isLoading, reload }
}

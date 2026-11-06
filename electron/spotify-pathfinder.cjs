'use strict'

// Spotify "Pathfinder" — read a whole playlist without asking the user to sign in.
//
// The public embed page (`open.spotify.com/embed/playlist/<id>`) is hard-capped at
// 100 tracks in `props.pageProps.state.data.entity.trackList`. But the same payload
// also carries an anonymous token at
// `props.pageProps.state.settings.session.accessToken`, and that token can call the
// partner GraphQL endpoint the Spotify web player itself uses. That endpoint
// paginates properly, so the 100-track ceiling disappears entirely.
//
// `fetchImpl` is injectable so this can be exercised outside Electron.

const SPOTIFY_WEB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SPOTIFY_PATHFINDER_URL = 'https://api-partner.spotify.com/pathfinder/v1/query'

// Persisted-query hash for `fetchPlaylist`. Spotify rotates these rarely; if it
// ever goes stale the call 400s and callers fall back to the embed list.
const SPOTIFY_FETCH_PLAYLIST_HASH =
  '8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a'

const PAGE_SIZE = 100
const MAX_PAGES = 100 // 10k tracks; guards against a runaway `totalCount`

async function spotifyPathfinder(accessToken, variables, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(SPOTIFY_PATHFINDER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/html,application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://open.spotify.com/',
      'User-Agent': SPOTIFY_WEB_UA,
    },
    body: JSON.stringify({
      variables,
      operationName: 'fetchPlaylist',
      extensions: { persistedQuery: { version: 1, sha256Hash: SPOTIFY_FETCH_PLAYLIST_HASH } },
    }),
  })
  if (!res.ok) throw new Error(`Pathfinder status ${res.status}`)
  return res.json()
}

// Pulls the anonymous web-player token out of an embed page's __NEXT_DATA__.
function extractEmbedPayload(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!m) return null
  const data = JSON.parse(m[1])
  const pageProps = data?.props?.pageProps
  const entity = pageProps?.state?.data?.entity || pageProps?.entity
  return {
    pageProps,
    entity,
    accessToken: pageProps?.state?.settings?.session?.accessToken || null,
    trackList: entity?.trackList || entity?.tracks?.items || pageProps?.state?.data?.tracks || [],
    name: entity?.name || entity?.title || pageProps?.title || null,
    totalCount: entity?.totalCount || null,
  }
}

// Returns { tracks: [{ title, artist, album, duration, thumbnail }], total }.
// Throws when the walk cannot be completed, so the caller can fall back to the
// embed list rather than quietly handing the user a partial playlist.
async function fetchFullSpotifyPlaylist(playlistId, accessToken, fetchImpl = globalThis.fetch) {
  const uri = `spotify:playlist:${playlistId}`
  const vars = (offset) => ({ uri, offset, limit: PAGE_SIZE, enableWatchFeedEntrypoint: true })

  const first = await spotifyPathfinder(accessToken, vars(0), fetchImpl)
  const content = first?.data?.playlistV2?.content
  if (!content || !Array.isArray(content.items)) return null

  const total = content.totalCount || content.items.length
  const items = content.items.slice()
  let offset = items.length
  let guard = 0

  while (offset < total && guard++ < MAX_PAGES) {
    const page = await spotifyPathfinder(accessToken, vars(offset), fetchImpl)
    const pageItems = page?.data?.playlistV2?.content?.items
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      throw new Error(`Incomplete Pathfinder playlist at offset ${offset}`)
    }
    items.push(...pageItems)
    offset += pageItems.length
  }
  if (offset < total) throw new Error(`Incomplete Pathfinder playlist (${offset}/${total})`)

  const tracks = []
  for (const it of items) {
    const t = it?.itemV2?.data || it?.item?.data || {}
    if (!t?.name) continue
    const artists = (t.albumOfTrack?.artists?.items || []).map((a) => a.profile?.name).filter(Boolean)
    const durationMs =
      t.trackDuration?.totalMilliseconds || t.duration?.totalMilliseconds || t.duration_ms
    const sources = t.albumOfTrack?.coverArt?.sources || []
    tracks.push({
      title: String(t.name).trim(),
      artist: artists.join(', ') || 'Unknown Artist',
      album: t.albumOfTrack?.name || null,
      duration: typeof durationMs === 'number' ? Math.round(durationMs / 1000) : 0,
      thumbnail: sources.length ? sources[sources.length - 1].url : null,
    })
  }
  return { tracks, total: total || tracks.length }
}

// ─── Whole-import decision tree ──────────────────────────────────────────────
// Kept here (not in main.cjs) so the fallback order can be exercised without
// booting Electron. main.cjs only maps the result onto `yt:` sources.

async function fetchSpotifyEmbed(playlistId, fetchImpl) {
  const res = await fetchImpl(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: {
      'User-Agent': SPOTIFY_WEB_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/json',
      Referer: 'https://open.spotify.com/',
      'App-Platform': 'WebPlayer',
    },
  })
  return { status: res.status, ok: res.ok, html: res.ok ? await res.text() : '' }
}

// Authenticated Web API. Only used when the app holds a real user token — an
// anonymous token is rejected here (401) and we fall through to the embed.
async function importViaWebApi(playlistId, accessToken, fetchImpl) {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const metaRes = await fetchImpl(`https://api.spotify.com/v1/playlists/${playlistId}`, { headers })
  if (!metaRes.ok) return null
  const meta = await metaRes.json()

  const tracks = []
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`
  let guard = 0
  while (url && guard++ < 100) {
    const res = await fetchImpl(url, { headers })
    if (!res.ok) break
    const data = await res.json()
    for (const item of data.items || []) {
      const t = item.track || item.item || item
      if (!t || !t.name) continue
      const sources = t.album?.images || t.images || []
      tracks.push({
        title: t.name,
        artist: (t.artists || []).map((a) => a.name).join(', ') || 'Unknown Artist',
        album: t.album?.name || null,
        duration: t.duration_ms ? Math.floor(t.duration_ms / 1000) : t.duration || 0,
        thumbnail: sources.length ? sources[0].url : null,
      })
    }
    url = data.next
  }
  if (!tracks.length) return null

  return {
    name: meta.name || null,
    cover: meta.images?.[0]?.url || tracks[0].thumbnail || null,
    tracks,
    total: meta.tracks?.total || tracks.length,
    source: 'api',
  }
}

// Resolves a playlist to a full track list, preferring completeness:
//   1. authenticated Web API  (only if a real token is supplied)
//   2. embed page -> anonymous token -> Pathfinder GraphQL  (no login needed)
//   3. embed `trackList`       (hard-capped at 100 — last resort)
async function importSpotifyPlaylist(playlistId, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch

  if (options.accessToken) {
    try {
      const viaApi = await importViaWebApi(playlistId, options.accessToken, fetchImpl)
      if (viaApi) return { ...viaApi, truncated: viaApi.total > viaApi.tracks.length }
    } catch (_) {
      // Fall through: an expired or anonymous token lands here.
    }
  }

  const embed = await fetchSpotifyEmbed(playlistId, fetchImpl)
  if (embed.status === 404) throw new Error('That Spotify playlist does not exist.')
  if (!embed.ok) throw new Error(`Spotify refused the request (${embed.status}). Try again.`)

  const payload = extractEmbedPayload(embed.html)
  if (!payload) {
    throw new Error('Could not read that Spotify playlist. It may be private.')
  }

  const coverSources = payload.entity?.coverArt?.sources || payload.entity?.images || []
  let cover = coverSources.length
    ? coverSources[coverSources.length - 1]?.url || coverSources[0]?.url || null
    : null

  if (payload.accessToken) {
    try {
      const full = await fetchFullSpotifyPlaylist(playlistId, payload.accessToken, fetchImpl)
      if (full && full.tracks.length) {
        return {
          name: payload.name,
          cover: cover || full.tracks[0]?.thumbnail || null,
          tracks: full.tracks,
          total: full.total,
          source: 'pathfinder',
          truncated: full.total > full.tracks.length,
        }
      }
    } catch (_) {
      // Persisted-query hash may have rotated, or the walk was blocked.
    }
  }

  const tracks = []
  for (const item of payload.trackList) {
    const title = (item.title || item.name || '').trim()
    if (!title) continue
    tracks.push({
      title,
      artist: (item.subtitle || '').trim() || 'Unknown Artist',
      album: item.album?.name || null,
      duration: item.duration ? Math.floor(item.duration / 1000) : 0,
      // The embed's trackList carries no artwork at all — only the playlist does.
      thumbnail: null,
    })
  }
  if (!tracks.length) throw new Error('Could not read any tracks from that playlist.')

  const total = payload.totalCount || tracks.length
  return {
    name: payload.name,
    cover: cover || null,
    tracks,
    total,
    source: 'embed',
    truncated: total > tracks.length,
  }
}

module.exports = {
  SPOTIFY_WEB_UA,
  SPOTIFY_PATHFINDER_URL,
  SPOTIFY_FETCH_PLAYLIST_HASH,
  spotifyPathfinder,
  extractEmbedPayload,
  fetchFullSpotifyPlaylist,
  importSpotifyPlaylist,
}

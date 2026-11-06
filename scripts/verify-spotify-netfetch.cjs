'use strict'

// Does the import survive Electron's `net.fetch`?
//
//   ./node_modules/electron/dist/electron.exe scripts/verify-spotify-netfetch.cjs [playlistUrlOrId]
//
// verify-spotify-import.cjs proves the module under plain Node. The app calls it
// through `net.fetch` (Chromium's network stack, its own User-Agent, its own
// proxy/cert handling), which is different enough to break a request. This runs
// the same `importSpotifyPlaylist` call the app makes, over that transport.
//
// Exit code 0 = full playlist with artwork via net.fetch.

const { app, net } = require('electron')
const { importSpotifyPlaylist } = require('../electron/spotify-pathfinder.cjs')

const out = []
const say = (...parts) => out.push(parts.join(' '))

const target = process.argv[2] || 'https://open.spotify.com/playlist/37i9dQZF1DX4o1oenSJRJd'
const id = (String(target).match(/(?:playlist\/|playlist:)([a-zA-Z0-9]{22})/) || [])[1] || target

// Exactly what main.cjs passes.
const spotifyFetch = (url, opts) => net.fetch(url, opts)

async function main() {
  say('playlist:', id)
  say('electron:', process.versions.electron, '| chrome:', process.versions.chrome)

  const r = await importSpotifyPlaylist(id, { fetchImpl: spotifyFetch, accessToken: null })

  say('name    :', r.name)
  say('source  :', r.source)
  say('cover   :', r.cover || 'MISSING')
  say('total   :', r.total)
  say('tracks  :', r.tracks.length)
  const withArt = r.tracks.filter((t) => t.thumbnail).length
  say('artwork :', `${withArt}/${r.tracks.length}`)
  if (r.tracks[0]) say('first   :', JSON.stringify(r.tracks[0]))

  const ok =
    r.source === 'pathfinder' &&
    r.tracks.length === r.total &&
    !!r.cover &&
    withArt === r.tracks.length
  say(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
  return ok ? 0 : 1
}

app.whenReady().then(async () => {
  let code = 1
  try {
    code = await main()
  } catch (e) {
    say('RESULT: FAIL — threw:', e.message)
  }
  // app.exit() does not flush piped stdout; write synchronously first.
  require('fs').writeSync(1, out.join('\n') + '\n')
  app.exit(code)
})

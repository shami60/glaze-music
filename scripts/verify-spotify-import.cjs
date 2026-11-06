'use strict'

// End-to-end check for the Spotify import path.
//
//   node scripts/verify-spotify-import.cjs [playlistUrlOrId ...]
//
// Runs the real `electron/spotify-pathfinder.cjs` module against live Spotify and
// asserts that playlists longer than the embed's 100-track cap come back complete.
// Exit code 0 = all assertions passed.

const { importSpotifyPlaylist } = require('../electron/spotify-pathfinder.cjs')

const DEFAULT_TARGETS = [
  // 150 tracks — embed caps at 100, so this is the regression case.
  'https://open.spotify.com/playlist/37i9dQZF1DX4o1oenSJRJd',
  // 50 tracks — sanity check on the short path.
  'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
]

function playlistId(input) {
  const m = String(input).match(/(?:playlist\/|playlist:)([a-zA-Z0-9]{22})/)
  return m ? m[1] : String(input).trim()
}

async function check(target) {
  const id = playlistId(target)
  console.log(`\n=== ${id} ===`)

  // Same call the app makes, minus the Electron transport (covered separately by
  // verify-spotify-netfetch.cjs).
  const result = await importSpotifyPlaylist(id)

  console.log(`  name              : ${result.name}`)
  console.log(`  source            : ${result.source}`)
  console.log(`  cover             : ${result.cover ? 'yes' : 'MISSING'}`)
  console.log(`  total             : ${result.total}`)
  console.log(`  tracks            : ${result.tracks.length}`)
  console.log(`  truncated         : ${result.truncated}`)

  const problems = []
  if (result.tracks.length !== result.total) problems.push(`got ${result.tracks.length} of ${result.total}`)
  if (result.source !== 'pathfinder' && result.source !== 'api') {
    problems.push(`fell back to the 100-track embed list (source=${result.source})`)
  }
  if (!result.cover) problems.push('no playlist cover — header would be a grey box')
  const withArt = result.tracks.filter((t) => t.thumbnail).length
  console.log(`  tracks w/ artwork : ${withArt}/${result.tracks.length}`)
  if (withArt !== result.tracks.length) problems.push(`${result.tracks.length - withArt} tracks without artwork`)
  const noArtist = result.tracks.filter((t) => !t.artist || t.artist === 'Unknown Artist').length
  if (noArtist > result.tracks.length * 0.1) problems.push(`${noArtist} tracks without artist`)
  const noDur = result.tracks.filter((t) => !t.duration).length
  if (noDur > result.tracks.length * 0.1) problems.push(`${noDur} tracks without duration`)

  for (const t of result.tracks.slice(0, 3)) console.log(`    · ${t.title} — ${t.artist} (${t.duration}s)`)
  const last = result.tracks[result.tracks.length - 1]
  if (last) console.log(`    · [last] ${last.title} — ${last.artist}`)

  if (problems.length) throw new Error(problems.join('; '))
  console.log('  RESULT            : PASS')
  return { id, total: result.total, source: result.source, cover: !!result.cover }
}

async function main() {
  const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS
  const results = []
  let failed = 0
  for (const t of targets) {
    try {
      results.push(await check(t))
    } catch (e) {
      failed++
      console.log(`  RESULT            : FAIL — ${e.message}`)
    }
  }
  console.log('\n--- summary ---')
  for (const r of results) {
    console.log(`  ${r.id}: ${r.total} tracks via ${r.source}${r.cover ? ', cover ok' : ', NO COVER'}`)
  }
  console.log(failed ? `\n${failed} target(s) failed` : '\nall targets passed')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})

'use strict'

// Exercise the real lyrics pipeline through the running app over CDP.
//
//   node scripts/probe-lyrics.cjs [port]
//
// The bug this exists to catch is not "does a lookup work" but "does the same
// song give the same answer every time". Each case is asked several times in a
// row and the answers are compared, so a first-call timeout that gets cached as
// "no lyrics" shows up as a mismatch instead of looking like a one-off.

const port = Number(process.argv[2] || 9222)

const CASES = [
  { label: 'lrclib synced', videoId: null, title: 'Soft Skin', artist: 'Timmies' },
  { label: 'lrclib synced 2', videoId: null, title: 'Sadi Sun', artist: 'Harsh Nussi' },
  { label: 'no lyrics anywhere', videoId: null, title: 'Zzzqqq Nonexistent Track', artist: 'Nobody At All' },
  // Local filenames carry decoration lrclib does not have. The raw title scores
  // zero hits; the cleaned one has to be tried or the track falls back to static
  // text for no visible reason.
  { label: 'decorated filename', videoId: null, title: 'I GET IT (Slowed Down)', artist: 'Moving in Silence, Lilaj, DaleoDaVinci' },
  // What a Spotify import looks like: a search key after `yt:`, not an id.
  { label: 'pseudo-id from import', videoId: 'Kill Bill SZA', title: 'Kill Bill', artist: 'SZA' },
  { label: 'real id + title', videoId: 'dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
]

const REPEATS = 4

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target — is the app running with --remote-debugging-port?')
    return 1
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  const call = async (c) => {
    const expr = `(async () => {
      const t0 = performance.now()
      const r = await window.electronAPI.youtubeGetLyrics(
        ${JSON.stringify(c.videoId)}, ${JSON.stringify(c.title)}, ${JSON.stringify(c.artist)}
      )
      return {
        ms: Math.round(performance.now() - t0),
        retryable: !!(r && r.retryable),
        type: r && r.type ? r.type : (r ? 'null' : 'null'),
        len: r && r.text ? r.text.length : 0
      }
    })()`
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
    return res.result.value
  }

  let failures = 0
  for (const c of CASES) {
    const seen = []
    for (let i = 0; i < REPEATS; i++) seen.push(await call(c))
    const shapes = seen.map((s) => `${s.type}${s.len ? `(${s.len})` : ''}${s.retryable ? '~retry' : ''}`)
    const unique = [...new Set(shapes)]
    const stable = unique.length === 1
    if (!stable) failures += 1
    console.log(
      `${stable ? '✓' : '✗'} ${c.label.padEnd(24)} ${shapes.join('  ')}   ` +
        `ms=${seen.map((s) => s.ms).join('/')}`
    )
  }

  ws.close()
  console.log(failures === 0 ? '\nall cases stable across repeats' : `\n${failures} case(s) inconsistent`)
  return failures === 0 ? 0 : 1
}

main().then((code) => process.exit(code))

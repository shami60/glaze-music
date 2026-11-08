'use strict'

// Map the instrumental stretches in real tracks, using the app's own detector.
//
//   node scripts/probe-instrumental.cjs [port] [howMany]
//
// The lyrics panel holds still when nobody is singing, which only reads as
// correct if the app knows where those stretches are. This loads the shipped
// `src/lyricsUtils.js` *inside the running renderer* — the same module the
// panel uses, not a copy — pulls real synced lyrics through the real IPC path,
// and walks each track at 250 ms steps.
//
// Per track it prints every stretch with the line that precedes it, so a false
// positive is visible: a "break" that opens half a second into a verse, or a
// one-line gap in the middle of a chorus, is the panel flashing "just music"
// while the singer is still going.

const port = Number(process.argv[2] || 9222)
const howMany = Number(process.argv[3] || 8)

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target')
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

  await send('Runtime.enable')

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          'evaluate failed'
      )
    }
    return res.result.value
  }

  let ready = false
  for (let i = 0; i < 40; i++) {
    ready = await evaluate(`!!(window.electronAPI && document.querySelector('#root')?.children.length)`)
    if (ready) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!ready) {
    console.log('renderer never became ready')
    return 1
  }

  const report = await evaluate(`(async () => {
    // Cache-busted: a bare dynamic import would hand back the module instance
    // the page already loaded, so an edit would measure as "no change".
    const utils = await import('/src/lyricsUtils.js?v=' + Date.now())

    // Real tracks, with real ids, straight out of the user's own favourites.
    const favs = JSON.parse(localStorage.getItem('glaze_streaming_favourites') || '[]')
    const tracks = (Array.isArray(favs) ? favs : []).slice(0, ${howMany})

    const out = []
    for (const track of tracks) {
      const videoId = utils.extractVideoId(track)
      let res = null
      try {
        res = await window.electronAPI.youtubeGetLyrics(videoId, track.title, track.artist)
      } catch (err) {
        out.push({ title: track.title, error: 'ipc: ' + err.message })
        continue
      }
      // The wire shape is { type, text } — text is raw LRC, exactly what the
      // panel hands to parseLRC before it can highlight anything.
      if (!res || res.type !== 'synced' || !res.text) {
        out.push({
          title: track.title,
          type: res && res.type,
          error: res && res.type === 'plain' ? 'plain only' : 'no synced lyrics',
        })
        continue
      }

      const timed = utils.buildTimedLines(utils.parseLRC(res.text))
      const duration = Number(track.duration) || (timed[timed.length - 1] || {}).end + 12

      const step = 0.25
      const hits = []
      for (let t = 0; t <= duration; t += step) {
        const gap = utils.findInstrumentalGap(timed, t, duration)
        if (gap) hits.push({ t, start: gap.start, end: gap.end, index: gap.index })
      }
      const stretches = []
      for (const h of hits) {
        const last = stretches[stretches.length - 1]
        if (last && Math.abs(last.start - h.start) < 0.3 && Math.abs(last.end - h.end) < 0.3) continue
        stretches.push({ ...h })
      }

      const total = stretches.reduce((a, s) => a + (s.end - s.start), 0)
      out.push({
        title: track.title,
        artist: track.artist,
        type: res && res.type,
        lines: timed.length,
        duration: Math.round(duration),
        pct: +((total / duration) * 100).toFixed(1),
        stretches: stretches.map((s) => ({
          at: +s.start.toFixed(1),
          to: +s.end.toFixed(1),
          len: +(s.end - s.start).toFixed(1),
          kind: s.index < 0 ? 'intro' : s.end >= duration - 1.5 ? 'outro' : 'break',
          after: s.index >= 0 ? String(timed[s.index].content || '').slice(0, 46) : null,
          next: timed[s.index + 1] ? String(timed[s.index + 1].content || '').slice(0, 46) : null,
        })),
      })
    }
    return { minGap: utils.INSTRUMENTAL_MIN_GAP, tracks: out }
  })()`)

  console.log(`INSTRUMENTAL_MIN_GAP = ${report.minGap}s\n`)
  for (const t of report.tracks) {
    if (t.error) {
      console.log(`— ${t.title} (${t.artist || '?'}): ${t.error}`)
      continue
    }
    console.log(
      `— ${t.title} (${t.artist || '?'}) ${t.type} · ${t.lines} lines · ${t.duration}s · ${t.pct}% instrumental · ${t.stretches.length} stretch(es)`
    )
    for (const s of t.stretches) {
      console.log(`    ${s.kind.padEnd(5)} ${String(s.at).padStart(6)}s → ${String(s.to).padStart(6)}s  (${s.len}s)`)
      if (s.after) console.log(`           after: "${s.after}"`)
      if (s.next) console.log(`           next:  "${s.next}"`)
    }
  }
  ws.close()
  return 0
}

main().then(
  (code) => process.exit(code || 0),
  (err) => {
    console.error('probe failed:', err.message)
    process.exit(1)
  }
)

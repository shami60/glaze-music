'use strict'

// Open the lyrics panel in the running app and record what it shows, over time.
//
//   node scripts/probe-lyrics-ui.cjs [port] [seconds]
//
// The lyrics bug was intermittent, so a single screenshot proves nothing. This
// clicks LYRICS, then samples the panel every 250 ms and prints a timeline:
// spinner → lyrics, or spinner → "not available" (the failure), or a flicker
// between the two. Run it across a few tracks to compare.

const port = Number(process.argv[2] || 9222)
const seconds = Number(process.argv[3] || 15)

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

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
    return res.result.value
  }

  // Two buttons read "LYRICS" on the home view — the card's inline panel and the
  // dock's. The dock's is the one that opens the full overlay.
  const opened = await evaluate(`(() => {
    const all = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().toUpperCase() === 'LYRICS')
    if (!all.length) return 'no LYRICS button'
    all[all.length - 1].click()
    return 'clicked'
  })()`)
  if (opened !== 'clicked') {
    console.log(opened)
    return 1
  }

  const sample = () => evaluate(`(() => {
    const body = document.body.innerText || ''
    const spinner = body.includes('Loading synchronized lyrics')
    const none = body.includes('Lyrics not available')
    const slow = body.includes('not responding') || body.includes('Could not load lyrics')
    // Synced lines are the only text rendered as individual word spans inside a
    // line container; plain lyrics are one big block. Counting newlines in the
    // panel region is enough to tell "has content" from "empty".
    const panelLines = [...document.querySelectorAll('div')]
      .filter(d => d.className && typeof d.className === 'string' && d.className.includes('mask-image-vertical'))
      .map(d => (d.innerText || '').split('\\n').filter(Boolean).length)[0] || 0
    return { spinner, none, slow, lines: panelLines }
  })()`)

  const timeline = []
  const start = Date.now()
  let last = null
  while (Date.now() - start < seconds * 1000) {
    let s
    try {
      s = await sample()
    } catch {
      break
    }
    const shape = s.spinner ? 'spinner' : s.none ? 'NOT-AVAILABLE' : s.slow ? 'SLOW' : s.lines > 0 ? `lyrics(${s.lines})` : 'blank'
    if (shape !== last) {
      timeline.push(`${String(Math.round((Date.now() - start) / 100) / 10).padStart(5)}s  ${shape}`)
      last = shape
    }
    if (!s.spinner && s.lines > 0) break
    await new Promise((r) => setTimeout(r, 250))
  }

  console.log(timeline.join('\n'))
  ws.close()
  return 0
}

main().then((c) => process.exit(c))

'use strict'

// Measure what the renderer is actually holding after visiting a heavy view.
//
//   node scripts/probe-memory.cjs [view] [port]
//
// The grids used to request `hq720.jpg` (1280x720) for cards drawn at ~150 px,
// which decodes to ~3.7 MB of RGBA per card. This probe reports, for every
// <img> currently in the DOM: the URL, its naturalWidth/Height, and the decoded
// bitmap cost, so the saving is measured rather than assumed.

const view = process.argv[2] || 'Explore'
const port = Number(process.argv[3] || 9222)

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target')
    return 1
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
      setTimeout(() => {
        if (pending.has(msgId)) {
          pending.delete(msgId)
          reject(new Error(`${method} timed out`))
        }
      }, 20000)
    })

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })

  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }

  await send('Performance.enable')

  // Navigate to the requested view by its sidebar button label.
  const clicked = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button, a')]
    const hit = btns.find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(view)}))
    if (!hit) return 'not found: ' + btns.map(b => (b.textContent||'').trim().slice(0,18)).join(' | ').slice(0, 300)
    hit.click()
    return 'clicked'
  })()`)
  console.log(`navigate → ${view}: ${clicked}`)

  // Give the view time to mount and its images to decode.
  await new Promise((r) => setTimeout(r, 9000))

  const imgReport = await evaluate(`(() => {
    const imgs = [...document.images]
    const byVariant = {}
    let decodedBytes = 0
    let loaded = 0
    for (const im of imgs) {
      const w = im.naturalWidth, h = im.naturalHeight
      if (!w || !h) continue
      loaded++
      const bytes = w * h * 4
      decodedBytes += bytes
      const key = w + 'x' + h
      byVariant[key] = byVariant[key] || { n: 0, mb: 0, sample: '' }
      byVariant[key].n++
      byVariant[key].mb += bytes
      if (!byVariant[key].sample) byVariant[key].sample = (im.currentSrc || im.src).slice(0, 90)
    }
    const top = Object.entries(byVariant)
      .map(([k, v]) => ({ size: k, count: v.n, mb: +(v.mb / 1048576).toFixed(1), sample: v.sample }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 12)
    return {
      totalImgs: imgs.length,
      loaded,
      decodedMB: +(decodedBytes / 1048576).toFixed(1),
      top,
    }
  })()`)

  console.log(`\n--- images on "${view}" ---`)
  console.log(`<img> in DOM: ${imgReport.totalImgs}   decoded: ${imgReport.loaded}`)
  console.log(`decoded bitmap total: ${imgReport.decodedMB} MB`)
  console.table(imgReport.top)

  const metrics = await send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.metrics.map((x) => [x.name, x.value]))
  console.log('\n--- runtime metrics ---')
  console.log(`JS heap used : ${(m.JSHeapUsedSize / 1048576).toFixed(1)} MB`)
  console.log(`JS heap total: ${(m.JSHeapTotalSize / 1048576).toFixed(1)} MB`)
  console.log(`DOM nodes    : ${m.Nodes}`)
  console.log(`Layouts      : ${m.LayoutCount}  (${(m.LayoutDuration * 1000).toFixed(0)} ms)`)
  console.log(`TaskDuration : ${m.TaskDuration.toFixed(1)} s`)

  ws.close()
  return 0
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('probe failed:', e.message)
  process.exit(1)
})

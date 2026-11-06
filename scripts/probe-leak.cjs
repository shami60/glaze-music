'use strict'

// Leak check: cycle through every top-level view several times and watch the
// three things that grow when state is retained — JS heap, DOM node count, and
// decoded image bytes. A flat line after the first lap means no leak; a
// monotonic climb means something is being kept alive per navigation.
//
//   node scripts/probe-leak.cjs [laps] [port]

const laps = Number(process.argv[2] || 3)
const port = Number(process.argv[3] || 9222)

const VIEWS = ['Home', 'Explore', 'YouTube Music', 'Favourites', 'Playlists', 'Downloads', 'Albums', 'Artists', 'All Songs']

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) return console.log('no page target'), 1

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
      setTimeout(() => pending.has(msgId) && (pending.delete(msgId), reject(new Error(method + ' timed out'))), 30000)
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
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  await send('Performance.enable')

  const snapshot = async () => {
    const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
    const imgMB = await evaluate(`(() => { let b=0; for (const im of document.images) { if (im.naturalWidth) b += im.naturalWidth*im.naturalHeight*4 } return +(b/1048576).toFixed(1) })()`)
    return {
      heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      docs: m.Documents,
      imgs: imgMB,
    }
  }

  const click = (label) =>
    evaluate(`(() => {
      const hit = [...document.querySelectorAll('button, a')].find(b => (b.textContent||'').trim().startsWith(${JSON.stringify(label)}))
      if (hit) { hit.click(); return true }
      return false
    })()`)

  const rows = []
  rows.push({ lap: 0, view: '(start)', ...(await snapshot()) })

  for (let lap = 1; lap <= laps; lap++) {
    for (const v of VIEWS) {
      const ok = await click(v)
      if (!ok) {
        rows.push({ lap, view: v + ' (MISSING)', ...(await snapshot()) })
        continue
      }
      await new Promise((r) => setTimeout(r, 1200))
      rows.push({ lap, view: v, ...(await snapshot()) })
    }
    await evaluate(`window.gc && window.gc()`)
    await new Promise((r) => setTimeout(r, 1500))
  }

  console.table(rows)

  const first = rows.find((r) => r.lap === 1 && r.view === VIEWS[VIEWS.length - 1])
  const last = rows.filter((r) => r.view === VIEWS[VIEWS.length - 1]).pop()
  if (first && last) {
    console.log(`\nlap 1 → lap ${laps} at "${VIEWS[VIEWS.length - 1]}":`)
    console.log(`  heap      ${first.heapMB} → ${last.heapMB} MB   (Δ ${(last.heapMB - first.heapMB).toFixed(1)})`)
    console.log(`  nodes     ${first.nodes} → ${last.nodes}   (Δ ${last.nodes - first.nodes})`)
    console.log(`  listeners ${first.listeners} → ${last.listeners}   (Δ ${last.listeners - first.listeners})`)
    console.log(`  documents ${first.docs} → ${last.docs}   (Δ ${last.docs - first.docs})`)
    console.log(`  images    ${first.imgs} → ${last.imgs} MB   (Δ ${(last.imgs - first.imgs).toFixed(1)})`)
  }

  ws.close()
  return 0
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('leak probe failed:', e.message)
  process.exit(1)
})

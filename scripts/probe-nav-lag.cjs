'use strict'

// Measure what a nav click costs: time to the next painted frame, long tasks
// blocked on the main thread, and the layout/style work it forced.
//
//   node scripts/probe-nav-lag.cjs [port]
//
// Clicks alternate between views and repeat, so a one-off (first mount, cold
// image decode) does not masquerade as a persistent cost.

const port = Number(process.argv[2] || 9222)
const VIEWS = ['Home', 'Explore', 'Queue', 'Favourites', 'Playlists']
const ROUNDS = 3

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id
      pending.set(msgId, resolve)
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Performance.enable')

  // Install the observer + timer once.
  await evaluate(`(() => {
    window.__lag = { long: [], last: null }
    if (!window.__lagObserver) {
      window.__lagObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__lag.long.push({ d: Math.round(e.duration), name: e.name })
      })
      try { window.__lagObserver.observe({ entryTypes: ['longtask'] }) } catch (e) {}
    }
    window.__measureClick = (label) => new Promise((resolve) => {
      const before = performance.now()
      window.__lag.long.length = 0
      const h = [...document.querySelectorAll('button, a')]
        .find(b => (b.textContent || '').trim().startsWith(label))
      if (!h) return resolve({ label, missing: true })
      h.click()
      const clickedAt = performance.now()
      let frames = 0
      const done = () => {
        const t = performance.now() - clickedAt
        const longTotal = window.__lag.long.reduce((a, x) => a + x.d, 0)
        const longMax = window.__lag.long.reduce((a, x) => Math.max(a, x.d), 0)
        resolve({
          label,
          syncMs: +(clickedAt - before).toFixed(1),
          settleMs: +t.toFixed(1),
          frames,
          longCount: window.__lag.long.length,
          longMax,
          longTotal,
        })
      }
      // Two painted frames = the click has actually reached the screen.
      const tick = () => {
        frames++
        if (frames >= 2) return done()
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      setTimeout(() => { if (frames < 2) done() }, 1500)
    })
  })()`)

  const metrics = async () => {
    const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
    return {
      layouts: m.LayoutCount,
      layoutMs: +(m.LayoutDuration * 1000).toFixed(1),
      styleMs: +(m.RecalcStyleDuration * 1000).toFixed(1),
      taskMs: +(m.TaskDuration * 1000).toFixed(0),
      nodes: m.Nodes,
    }
  }

  const results = []
  for (let round = 1; round <= ROUNDS; round++) {
    for (const v of VIEWS) {
      const a = await metrics()
      const r = await evaluate(`window.__measureClick(${JSON.stringify(v)})`)
      await sleep(900)
      const b = await metrics()
      if (r.missing) { console.log(`${v}: nav not found`); continue }
      results.push({
        round,
        view: v,
        settleMs: r.settleMs,
        longCount: r.longCount,
        longMax: r.longMax,
        layoutMs: +(b.layoutMs - a.layoutMs).toFixed(1),
        layoutCount: b.layouts - a.layouts,
        styleMs: +(b.styleMs - a.styleMs).toFixed(1),
        nodes: b.nodes,
      })
    }
  }

  console.table(results)

  // Summarise: median settle time per view, ignoring round 1 (cold mount).
  const warm = results.filter((r) => r.round > 1)
  const byView = {}
  for (const r of warm) (byView[r.view] = byView[r.view] || []).push(r.settleMs)
  const summary = Object.entries(byView).map(([v, arr]) => ({
    view: v,
    warmMedianMs: arr.sort((x, y) => x - y)[Math.floor(arr.length / 2)],
    samples: arr.length,
  }))
  console.log('\nwarm median (rounds 2+):')
  console.table(summary)

  ws.close()
}

main().catch((e) => console.error('probe failed:', e.message))

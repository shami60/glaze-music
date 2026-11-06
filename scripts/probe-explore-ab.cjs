'use strict'

// A/B the `content-visibility` shelves on the *same* DOM: toggle it off at
// runtime and re-measure the same Home → Explore switch. Removes app-state
// drift (node count differs between launches) from the comparison.
//
//   node scripts/probe-explore-ab.cjs

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await send('Performance.enable')

  await evaluate(`(() => {
    window.__measureNav = (label) => new Promise((resolve) => {
      const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith(label))
      if (!h) return resolve({ missing: true })
      const t0 = performance.now()
      h.click()
      let frames = 0
      const tick = () => {
        frames++
        if (frames >= 2) return resolve({ ms: +(performance.now() - t0).toFixed(1), frames })
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      setTimeout(() => resolve({ ms: +(performance.now() - t0).toFixed(1), frames, timedOut: frames < 2 }), 2000)
    })
    window.__cvOff = () => {
      let s = document.getElementById('__cvoff')
      if (!s) {
        s = document.createElement('style'); s.id = '__cvoff'
        s.textContent = '.deferred-shelves > section { content-visibility: visible !important; contain-intrinsic-size: none !important; }'
        document.head.appendChild(s)
      }
    }
    window.__cvOn = () => { const s = document.getElementById('__cvoff'); if (s) s.remove() }
  })()`)

  const metrics = async () => {
    const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
    return { layout: m.LayoutCount, layoutMs: +(m.LayoutDuration * 1000).toFixed(1), styleMs: +(m.RecalcStyleDuration * 1000).toFixed(1), nodes: m.Nodes }
  }

  const run = async (label) => {
    await evaluate(`window.__measureNav('Home')`)
    await sleep(700)
    const a = await metrics()
    const r = await evaluate(`window.__measureNav('Explore')`)
    await sleep(700)
    const b = await metrics()
    return {
      mode: label,
      ms: r.ms,
      layoutCount: b.layout - a.layout,
      layoutMs: +(b.layoutMs - a.layoutMs).toFixed(1),
      styleMs: +(b.styleMs - a.styleMs).toFixed(1),
      nodes: b.nodes,
    }
  }

  const rows = []
  for (let i = 0; i < 3; i++) {
    await evaluate(`window.__cvOff()`)
    rows.push(await run('content-visibility OFF'))
    await evaluate(`window.__cvOn()`)
    rows.push(await run('content-visibility ON '))
  }
  console.table(rows)

  const avg = (mode) => {
    const r = rows.filter((x) => x.mode === mode)
    const m = (k) => +(r.reduce((a, x) => a + x[k], 0) / r.length).toFixed(1)
    return { mode, ms: m('ms'), layoutCount: m('layoutCount'), layoutMs: m('layoutMs'), styleMs: m('styleMs') }
  }
  console.log('\nmean:')
  console.table([avg('content-visibility OFF'), avg('content-visibility ON ')])

  await evaluate(`window.__cvOn()`)
  ws.close()
}

main().catch((e) => console.error('probe failed:', e.message))

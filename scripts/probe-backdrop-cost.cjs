'use strict'

// Measure what opening Settings → Backdrop costs: long tasks, style/layout work
// and image decode. Run against a page already on the app.

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const long = []
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
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text }
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await send('Performance.enable')

  await evaluate(`(() => {
    window.__long = []
    if (!window.__lo) {
      window.__lo = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)) })
      try { window.__lo.observe({ entryTypes: ['longtask'] }) } catch (e) {}
    }
  })()`)

  const metrics = async () => {
    const m = Object.fromEntries((await send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
    return { layoutMs: m.LayoutDuration * 1000, styleMs: m.RecalcStyleDuration * 1000, taskMs: m.TaskDuration * 1000, nodes: m.Nodes }
  }

  // Go to Settings first, then measure only the Backdrop section appearing.
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Settings')
    if (b) b.click()
  })()`)
  await sleep(2500)

  const before = await metrics()
  const t0 = Date.now()
  await evaluate(`(() => {
    const h = [...document.querySelectorAll('h3')].find(x => x.textContent.trim() === 'Backdrop')
    if (!h) return 'no heading'
    let el = h.parentElement
    while (el) {
      const st = getComputedStyle(el)
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        el.scrollTop = h.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 20
        return 'scrolled'
      }
      el = el.parentElement
    }
    return 'no scroller'
  })()`)
  // wait for the tiles' images to decode
  await sleep(1800)
  const after = await metrics()

  const longs = await evaluate('window.__long')
  const imgs = await evaluate(`(() => {
    const h = [...document.querySelectorAll('h3')].find(x => x.textContent.trim() === 'Backdrop')
    const sec = h && h.closest('section')
    if (!sec) return null
    return [...sec.querySelectorAll('img')].map(i => ({
      w: i.naturalWidth, h: i.naturalHeight,
      blur: getComputedStyle(i).filter,
      src: (i.currentSrc || i.src || '').split('/').pop().slice(0, 30),
    }))
  })()`)

  console.log('Backdrop section images:')
  console.table(imgs)
  console.log('\nlong tasks while opening (ms):', JSON.stringify(longs))
  console.log('elapsed:', Date.now() - t0, 'ms')
  console.log('delta  layout:', (after.layoutMs - before.layoutMs).toFixed(1), 'ms',
    ' style:', (after.styleMs - before.styleMs).toFixed(1), 'ms',
    ' task:', (after.taskMs - before.taskMs).toFixed(0), 'ms')

  ws.close()
}

main().catch((e) => console.error(e.message))

'use strict'

// Inspect the dock (bottom player) thumbnail: what URL did it request, did it
// load, and did the network actually fail? Also re-tests each candidate size
// inside the renderer so header/cache differences from curl are included.

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const netlog = []
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
      return
    }
    if (msg.method === 'Network.responseReceived' && msg.params.type === 'Image') {
      const u = msg.params.response.url
      netlog.push(`${msg.params.response.status} ${u.slice(0, 110)}`)
    }
    if (msg.method === 'Network.loadingFailed' && msg.params.type === 'Image') {
      netlog.push(`FAIL ${msg.params.errorText} blocked=${msg.params.blockedReason ?? '-'}`)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Network.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text }
    return r.result.value
  }

  // The dock thumbnail lives in the bottom bar; find imgs near the viewport bottom.
  const dock = await evaluate(`(() => {
    const vh = window.innerHeight
    return [...document.images]
      .filter((im) => im.getBoundingClientRect().top > vh - 90)
      .map((im) => ({
        src: (im.getAttribute('src') || '').slice(0, 150),
        currentSrc: (im.currentSrc || '').slice(0, 150),
        complete: im.complete,
        naturalW: im.naturalWidth,
        naturalH: im.naturalHeight,
        opacity: im.style.opacity,
        w: Math.round(im.getBoundingClientRect().width),
      }))
  })()`)

  console.log('--- dock images ---')
  console.log(JSON.stringify(dock, null, 1))

  // Re-request the same URL and each candidate size inside the renderer.
  const src = dock?.[0]?.currentSrc || dock?.[0]?.src || ''
  if (src) {
    const probe = await evaluate(`(async () => {
      const base = ${JSON.stringify(src)}
      const variants = [base]
      if (/i\\.ytimg\\.com/.test(base)) {
        variants.push(base.replace(/\\/(hq720|hqdefault|mqdefault|sddefault|maxresdefault)\\.jpg/, '/mqdefault.jpg'))
        variants.push(base.replace(/\\?(.*)$/, '').replace(/\\/(hq720|hqdefault|mqdefault|sddefault|maxresdefault)\\.jpg/, '/mqdefault.jpg'))
      }
      const out = []
      for (const v of [...new Set(variants)]) {
        const res = await new Promise((r) => {
          const im = new Image()
          im.onload = () => r({ ok: true, w: im.naturalWidth, h: im.naturalHeight })
          im.onerror = () => r({ ok: false })
          im.src = v
        })
        out.push({ url: v.slice(0, 150), ...res })
      }
      return out
    })()`)
    console.log('\n--- renderer image() tests ---')
    for (const p of probe) console.log(`  ${p.ok ? 'OK  ' : 'FAIL'} ${p.w || '-'}x${p.h || '-'}  ${p.url}`)
  }

  await new Promise((r) => setTimeout(r, 1500))
  if (netlog.length) {
    console.log('\n--- image network ---')
    for (const l of netlog.slice(-12)) console.log('  ' + l)
  }

  ws.close()
}

main().catch((e) => console.error(e.message))

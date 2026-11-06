'use strict'

// Is the one broken <img> a bad URL, or a stale failed state in an existing
// element? Load the same URL through a fresh Image() and report.

const URL_UNDER_TEST =
  'https://i.ytimg.com/pl_c/PLgzTt0k8mXzEk586ze4BjvDXR7c-TUSnx/studio_square_thumbnail.jpg?sqp=CIiEs9cG-oaymwEKCMAWENQMIABIWqLzl_8DBgiCj9TLBg&rs=AMzJL3kDtHGG6M8mj1HttfyIhTiTYkFStQ'

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

  const expr = `new Promise((res) => {
    const im = new Image()
    im.onload = () => res({ ok: true, w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => res({ ok: false })
    im.src = ${JSON.stringify(URL_UNDER_TEST)}
  })`

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log('fresh Image() load in renderer:', JSON.stringify(r.result.value))

  // How many elements reference this URL, and what are their attrs?
  const info = await send('Runtime.evaluate', {
    expression: `(() => {
      const hits = [...document.images].filter(i => (i.currentSrc || i.src || '').includes('PLgzTt0k8mXzEk586ze4BjvDXR7c-TUSnx'))
      return hits.map(i => ({
        src: (i.getAttribute('src') || '').slice(0, 60),
        loading: i.getAttribute('loading'),
        complete: i.complete,
        w: i.naturalWidth,
        cls: (i.className || '').slice(0, 50),
      }))
    })()`,
    returnByValue: true,
  })
  console.log('elements:', JSON.stringify(info.result.value, null, 1))

  ws.close()
}

main().catch((e) => console.error(e.message))

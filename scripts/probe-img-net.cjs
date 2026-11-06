'use strict'

// Capture the real HTTP outcome for the failing playlist-cover request.
// curl gets 200; the renderer's Image() fails. This shows the status the
// renderer actually sees, with the cache disabled.

const NEEDLE = 'PLgzTt0k8mXzEk586ze4BjvDXR7c-TUSnx'

const SIGNED =
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
      return
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.url.includes(NEEDLE)) {
      const r = msg.params.response
      console.log(`response: ${r.status} ${r.statusText}  mime=${r.mimeType}  fromDiskCache=${r.fromDiskCache}`)
      console.log(`  corsError: ${r.corsErrorStatus ? JSON.stringify(r.corsErrorStatus) : 'none'}`)
    }
    if (msg.method === 'Network.loadingFailed' && msg.params.type === 'Image') {
      console.log(`loadingFailed: ${msg.params.errorText}  blockedReason=${msg.params.blockedReason ?? 'none'}  cors=${msg.params.corsErrorStatus ? JSON.stringify(msg.params.corsErrorStatus) : 'none'}`)
    }
  })

  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })

  const expr = `new Promise((res) => {
    const im = new Image()
    im.onload = () => res({ ok: true, w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => res({ ok: false })
    im.src = ${JSON.stringify(SIGNED)}
  })`

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log('result (unsigned URL, cache off):', JSON.stringify(r.result.value))

  await new Promise((res) => setTimeout(res, 2500))
  ws.close()
}

main().catch((e) => console.error(e.message))

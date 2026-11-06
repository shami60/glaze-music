'use strict'

// Inspect a running Electron app over the Chrome DevTools Protocol.
//
//   node scripts/probe-renderer.cjs [port]
//
// Answers the questions a blank window raises: is the window on-screen, is the
// React root actually populated, and did the renderer throw before painting.

const port = Number(process.argv[2] || 9222)

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target. targets:', targets.map((t) => t.type).join(', '))
    return 1
  }
  console.log('target:', page.url)

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
      }, 8000)
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
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text }
    return r.result.value
  }

  // Window geometry — the usual reason for "runs but nothing visible".
  try {
    const win = await send('Browser.getWindowForTarget', { targetId: page.targetId })
    console.log('window bounds:', JSON.stringify(win.bounds))
  } catch (e) {
    console.log('window bounds: unavailable —', e.message)
  }

  const info = await evaluate(`(() => {
    const root = document.getElementById('root')
    return {
      readyState: document.readyState,
      title: document.title,
      url: location.href,
      bodyText: (document.body.innerText || '').trim().slice(0, 300),
      bodyLength: document.body.innerHTML.length,
      rootExists: !!root,
      rootChildren: root ? root.children.length : -1,
      rootHtmlLength: root ? root.innerHTML.length : -1,
      rootFirstClass: root && root.firstElementChild ? root.firstElementChild.className : null,
      api: typeof window.electronAPI,
      viewport: [window.innerWidth, window.innerHeight],
      visibility: document.visibilityState,
      theme: document.documentElement.dataset.theme || null,
    }
  })()`)
  console.log('renderer:', JSON.stringify(info, null, 2))

  // React errors are swallowed by the ErrorBoundary but still surface here.
  const err = await evaluate(`(window.__glazeError || window.__lastError || null)`)
  if (err) console.log('captured error:', JSON.stringify(err))

  ws.close()
  return 0
}

main()
  .then((c) => process.exit(c || 0))
  .catch((e) => {
    console.error('probe failed:', e.message)
    process.exit(1)
  })

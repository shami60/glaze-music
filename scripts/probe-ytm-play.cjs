'use strict'

// Reproduce: YouTube Music → open a playlist → play a track → inspect the dock
// thumbnail. Reports the requested URL, whether it decoded, and the network
// status the renderer actually saw.

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const net = []
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
      net.push({ status: msg.params.response.status, url: msg.params.response.url })
    }
    if (msg.method === 'Network.loadingFailed' && msg.params.type === 'Image') {
      net.push({ status: 'FAIL:' + msg.params.errorText, url: '' })
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Network.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text }
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (label) =>
    evaluate(`(() => {
      const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}))
      if (h) { h.click(); return true }
      return false
    })()`)

  console.log('→ YouTube Music:', await click('YouTube Music'))
  await sleep(6000)

  // Open the first playlist tile / row in the view.
  const opened = await evaluate(`(() => {
    const cand = [...document.querySelectorAll('button, a, [role="button"]')]
      .filter(el => {
        const t = (el.textContent || '').trim()
        const r = el.getBoundingClientRect()
        return t.length > 2 && t.length < 60 && r.width > 90 && r.height > 60 && r.top > 120
      })
    if (!cand.length) return 'none'
    cand[0].click()
    return 'opened: ' + (cand[0].textContent || '').trim().slice(0, 40)
  })()`)
  console.log('→ open playlist:', opened)
  await sleep(6000)

  // Play the first track row.
  const played = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('button')].filter(b => {
      const t = (b.textContent || '').trim()
      return t.length > 4 && b.querySelector('img')
    })
    if (!rows.length) return 'no rows'
    rows[0].click()
    return 'played: ' + (rows[0].textContent || '').trim().slice(0, 45)
  })()`)
  console.log('→ play:', played)
  await sleep(7000)

  const dock = await evaluate(`(() => {
    const vh = window.innerHeight
    const im = [...document.images].filter(i => i.getBoundingClientRect().top > vh - 80)
    return im.map(i => ({
      src: (i.getAttribute('src') || '').slice(0, 160),
      complete: i.complete,
      nw: i.naturalWidth,
      nh: i.naturalHeight,
      opacity: i.style.opacity,
      boxW: Math.round(i.getBoundingClientRect().width),
    }))
  })()`)
  console.log('\n--- dock imgs ---')
  console.log(JSON.stringify(dock, null, 1))

  const title = await evaluate(`(() => {
    const m = navigator.mediaSession && navigator.mediaSession.metadata
    return m ? { title: m.title, artist: m.artist, state: navigator.mediaSession.playbackState } : null
  })()`)
  console.log('\nnow playing:', JSON.stringify(title))

  const failed = net.filter((n) => n.status === 404 || String(n.status).startsWith('FAIL'))
  console.log('\nimage failures during this run:', failed.length)
  for (const f of failed.slice(0, 10)) console.log('  ' + f.status + ' ' + f.url.slice(0, 120))

  ws.close()
}

main().catch((e) => console.error(e.message))

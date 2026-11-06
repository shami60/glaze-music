'use strict'

// Verify: (1) opening something from YouTube Music keeps the sidebar on
// YouTube Music instead of highlighting Explore, and (2) a large playlist only
// renders a window of rows.

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
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text }
    return r.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    require('fs').writeFileSync(`C:/Users/Admin/AppData/Local/Temp/${n}.png`, Buffer.from(r.data, 'base64'))
  }

  const activeNav = () =>
    evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect()
        return r.left < 210 && r.width > 80 && r.height < 50
      })
      const hit = btns.filter(b => {
        const c = (b.className || '').toString()
        return c.includes('active') || c.includes('bg-white text-black')
      })
      return hit.map(b => (b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24))
    })()`)

  console.log('→ YouTube Music')
  await evaluate(`(() => {
    const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith('YouTube Music'))
    if (h) h.click()
  })()`)
  await sleep(7000)
  console.log('  active nav:', JSON.stringify(await activeNav()))

  // Open the first playlist-ish tile in the view.
  const opened = await evaluate(`(() => {
    const cands = [...document.querySelectorAll('button, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect()
      const t = (el.textContent || '').trim()
      return r.top > 150 && r.width > 110 && r.height > 70 && t.length > 1 && t.length < 70 && el.querySelector('img')
    })
    if (!cands.length) return 'no tiles'
    cands[0].click()
    return (cands[0].textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50)
  })()`)
  console.log('→ opened:', opened)
  await sleep(9000)

  console.log('  active nav:', JSON.stringify(await activeNav()))
  const info = await evaluate(`(() => {
    const count = n => { let c = 1; for (const ch of n.children || []) c += count(ch); return c }
    const txt = document.body.innerText
    const m = txt.match(/(\\d[\\d,]*)\\s*songs?/)
    const rows = [...document.querySelectorAll('img')].filter(i => {
      const r = i.getBoundingClientRect()
      return Math.abs(r.width - 44) < 3 && Math.abs(r.height - 44) < 3
    })
    return {
      headerCount: m ? m[1] : '?',
      renderedRows: rows.length,
      lazyRows: rows.filter(i => i.getAttribute('loading') === 'lazy').length,
      sampleSrc: rows[0] ? (rows[0].getAttribute('src') || '').slice(0, 80) : '',
      rootNodes: count(document.getElementById('root')),
    }
  })()`)
  console.log('  detail:', JSON.stringify(info))
  await shot('yt_playlist_after')

  ws.close()
}

main().catch((e) => console.error(e.message))

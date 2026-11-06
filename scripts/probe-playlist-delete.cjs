'use strict'

// Delete a playlist through the real UI, then report what actually hit disk.
// Usage: node scripts/probe-playlist-delete.cjs

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
  const click = (label) =>
    evaluate(`(() => {
      const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}))
      if (!h) return false
      h.click()
      return true
    })()`)

  console.log('→ Playlists:', await click('Playlists'))
  await sleep(3000)

  // Open the first playlist card.
  const opened = await evaluate(`(() => {
    const c = [...document.querySelectorAll('button, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect()
      const t = (el.textContent || '').trim()
      return r.top > 120 && r.width > 100 && r.height > 80 && t.length > 1 && el.querySelector('img')
    })
    if (!c.length) return 'none'
    c[0].click()
    return (c[0].textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
  })()`)
  console.log('→ opened:', opened)
  await sleep(3000)

  const del = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === 'Delete')
    if (!b) return 'no Delete button'
    b.click()
    return 'clicked Delete'
  })()`)
  console.log('→', del)
  await sleep(1200)

  const confirmed = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => {
      const t = (b.textContent || '').trim()
      return /^(Delete|Yes|Confirm|Delete playlist)$/i.test(t)
    })
    // The modal's confirm is the last matching button (the page-level Delete opened it).
    if (!btns.length) return 'no confirm'
    btns[btns.length - 1].click()
    return 'confirmed via: ' + (btns[btns.length - 1].textContent || '').trim()
  })()`)
  console.log('→', confirmed)
  await sleep(2500)

  const after = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('button, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect()
      const t = (el.textContent || '').trim()
      return r.top > 120 && r.width > 100 && r.height > 80 && t.length > 1 && el.querySelector('img')
    })
    return { visibleCards: cards.length, text: (document.body.innerText || '').slice(0, 120).replace(/\\n/g, ' | ') }
  })()`)
  console.log('→ after delete:', JSON.stringify(after))

  ws.close()
}

main().catch((e) => console.error(e.message))

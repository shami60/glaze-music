'use strict'

// Which thumbnail tiers is the DOM actually using? Confirms the size tiers are
// being exercised rather than silently skipped (e.g. by a non-matching URL shape).

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

  const expr = `(() => {
    const tests = [
      ['google s120 (thumb)', '=s120'],
      ['google w120 (thumb)', '=w120-'],
      ['google s320 (card)',  '=s320'],
      ['google w320 (card)',  '=w320-'],
      ['google w800 (large)', '=w800-'],
      ['yt hq720 (large)',    'hq720'],
      ['yt mqdefault (card)', 'mqdefault'],
      ['local art://',        'art://'],
    ]
    const counts = tests.map(([label, needle]) => ({ label, n: 0 }))
    let total = 0
    for (const im of document.images) {
      total++
      const u = im.currentSrc || im.src || ''
      const hit = counts.find((c) => {
        const needle = tests.find(([l]) => l === c.label)[1]
        return u.includes(needle)
      })
      if (hit) hit.n++
    }
    return { total, counts }
  })()`

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r.exceptionDetails) return console.error('eval error:', r.exceptionDetails.text)
  console.log(`total <img>: ${r.result.value.total}`)
  console.table(r.result.value.counts)
  ws.close()
}

main().catch((e) => console.error(e.message))

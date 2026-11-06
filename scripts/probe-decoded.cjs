'use strict'

// Honest decoded-bitmap accounting: dedupe by URL, because Chromium shares one
// decoded bitmap per distinct image URL. Summing <img> elements over-counts.
//
//   node scripts/probe-decoded.cjs

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
    const seen = new Map()
    for (const im of document.images) {
      if (!im.naturalWidth || !im.naturalHeight) continue
      const u = im.currentSrc || im.src
      if (!u || seen.has(u)) continue
      seen.set(u, { w: im.naturalWidth, h: im.naturalHeight })
    }
    const groups = {}
    let total = 0
    for (const [u, d] of seen) {
      const bytes = d.w * d.h * 4
      total += bytes
      const k = d.w + 'x' + d.h
      if (!groups[k]) groups[k] = { size: k, n: 0, mb: 0, sample: '' }
      groups[k].n++
      groups[k].mb += bytes
      if (!groups[k].sample) groups[k].sample = u.slice(0, 100)
    }
    const top = Object.values(groups)
      .map((g) => ({ size: g.size, n: g.n, mb: +(g.mb / 1048576).toFixed(1), sample: g.sample }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 8)
    return { unique: seen.size, elements: document.images.length, mb: +(total / 1048576).toFixed(1), top }
  })()`

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  if (r.exceptionDetails) {
    console.error('eval error:', r.exceptionDetails.text, r.exceptionDetails.exception?.description)
    ws.close()
    return
  }
  const v = r.result.value
  console.log(`unique decoded images: ${v.unique}  (across ${v.elements} <img> elements)`)
  console.log(`total decoded bitmap : ${v.mb} MB`)
  console.table(v.top)
  ws.close()
}

main().catch((e) => console.error(e.message))

'use strict'

// A/B the thumbnail strategy on the *same* DOM, so the saving is measured
// rather than inferred.
//
//   node scripts/probe-thumb-ab.cjs [port]
//
// Phase A: measure decoded bitmap bytes as the app currently renders them.
// Phase B: rewrite every YouTube thumbnail back to `hq720` and every Google
//          avatar back to `=w800-h800` (the pre-optimisation behaviour), clear
//          `loading="lazy"`, force a reload of each image, and measure again.
// The delta is the memory the size-aware thumbnails + lazy decoding reclaim.

const port = Number(process.argv[2] || 9222)

async function main() {
  const res = await fetch(`http://127.0.0.1:${port}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) return console.log('no page target'), 1

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
      setTimeout(() => pending.has(msgId) && (pending.delete(msgId), reject(new Error(method + ' timed out'))), 60000)
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
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  const measure = () =>
    evaluate(`(() => {
      const imgs = [...document.images]
      let bytes = 0, loaded = 0
      for (const im of imgs) {
        if (!im.naturalWidth || !im.naturalHeight) continue
        loaded++
        bytes += im.naturalWidth * im.naturalHeight * 4
      }
      return { total: imgs.length, loaded, mb: +(bytes / 1048576).toFixed(1) }
    })()`)

  const before = await measure()
  console.log(`phase A — current build:  ${before.loaded}/${before.total} decoded, ${before.mb} MB`)

  // Rewrite to the legacy variants and un-lazy everything.
  const rewritten = await evaluate(`(() => {
    let n = 0
    for (const im of document.images) {
      const raw = im.getAttribute('src') || ''
      let next = null
      if (/i\\.ytimg\\.com|img\\.youtube\\.com/.test(raw)) {
        next = raw.replace(/\\/(hq720|hqdefault|sddefault|mqdefault|maxresdefault|default)\\.jpg/, '/hq720.jpg')
      } else if (/googleusercontent\\.com|ggpht\\.com/.test(raw)) {
        next = raw
          .replace(/=w\\d+-h\\d+[^?#]*/g, '=w800-h800-l90-rj')
          .replace(/=s\\d+[^?#]*/g, '=s800')
      }
      if (next && next !== raw) { im.removeAttribute('loading'); im.src = next; n++ }
      else if (im.getAttribute('loading') === 'lazy') { im.removeAttribute('loading'); n++ }
    }
    return n
  })()`)
  console.log(`rewrote ${rewritten} <img> to legacy variants, waiting for decode…`)

  await new Promise((r) => setTimeout(r, 14000))

  const after = await measure()
  console.log(`phase B — legacy variants: ${after.loaded}/${after.total} decoded, ${after.mb} MB`)

  const delta = after.mb - before.mb
  console.log(`\nsaving: ${delta.toFixed(1)} MB  (${before.mb} MB vs ${after.mb} MB)`)
  console.log(`ratio : ${(after.mb / Math.max(before.mb, 0.1)).toFixed(1)}x less decoded bitmap now`)

  ws.close()
  return 0
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('ab failed:', e.message)
  process.exit(1)
})

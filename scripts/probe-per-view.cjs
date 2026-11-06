'use strict'

// Attribute decoded-bitmap memory per view.
//
// Views are mounted keep-alive (so scroll/tab state survives navigation), which
// means every view you visit adds its thumbnails to the same pool and they are
// never released. This measures the incremental cost of each view on a fresh
// reload, deduped by URL (Chromium shares one decoded bitmap per URL).
//
//   node scripts/probe-per-view.cjs

const VIEWS = ['Home', 'Explore', 'YouTube Music', 'Favourites', 'Playlists', 'Downloads', 'Albums', 'Artists', 'All Songs']

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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const stats = () =>
    evaluate(`(() => {
      const seen = new Set()
      const sizes = {}
      let bytes = 0
      for (const im of document.images) {
        if (!im.naturalWidth || !im.naturalHeight) continue
        const u = im.currentSrc || im.src
        if (!u || seen.has(u)) continue
        seen.add(u)
        const b = im.naturalWidth * im.naturalHeight * 4
        bytes += b
        const k = im.naturalWidth + 'x' + im.naturalHeight
        sizes[k] = (sizes[k] || 0) + 1
      }
      const biggest = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]
      return { unique: seen.size, mb: +(bytes / 1048576).toFixed(1), biggest: biggest ? biggest[0] + ' x' + biggest[1] : '-' }
    })()`)

  await send('Page.enable')
  await send('Page.reload', { ignoreCache: false })
  await sleep(6000)

  const rows = []
  let prev = await stats()
  rows.push({ view: '(fresh load)', unique: prev.unique, mb: prev.mb, deltaMB: 0, biggest: prev.biggest })

  for (const v of VIEWS) {
    const ok = await evaluate(`(() => {
      const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(v)}))
      if (!h) return false
      h.click()
      return true
    })()`)
    if (!ok) {
      rows.push({ view: v + ' (missing)', unique: '-', mb: '-', deltaMB: '-', biggest: '-' })
      continue
    }
    await sleep(3500)
    const now = await stats()
    rows.push({
      view: v,
      unique: now.unique,
      mb: now.mb,
      deltaMB: +(now.mb - prev.mb).toFixed(1),
      biggest: now.biggest,
    })
    prev = now
  }

  console.table(rows)
  console.log(`\ntotal after visiting every view: ${prev.mb} MB of decoded thumbnails`)

  ws.close()
}

main().catch((e) => console.error(e.message))

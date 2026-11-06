'use strict'

// Collect renderer console errors/exceptions over a short browsing session,
// and confirm the transport still works (play → currentTime advances).

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const problems = []

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
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
      if (!/YOUTUBEJS|ParsingError|Type mismatch/.test(text)) problems.push(`[${msg.params.type}] ${text.slice(0, 200)}`)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      problems.push(`[exception] ${d.text} ${(d.exception?.description || '').slice(0, 200)}`)
    }
  })

  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __err: r.exceptionDetails.text }
    return r.result.value
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Walk every view.
  for (const v of ['Home', 'Explore', 'YouTube Music', 'Favourites', 'Playlists', 'Downloads', 'Albums', 'Artists', 'All Songs']) {
    await evaluate(`(() => {
      const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(v)}))
      if (h) h.click()
    })()`)
    await sleep(1500)
  }

  // Transport check: play the first track in All Songs and watch the clock.
  const t0 = await evaluate(`(() => {
    const play = [...document.querySelectorAll('button')].find(b => /play/i.test(b.getAttribute('aria-label') || '') || b.querySelector('svg'))
    const rows = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().length > 3)
    const audio = document.querySelector('audio')
    return { hasAudio: !!audio, paused: audio ? audio.paused : null, src: audio ? (audio.currentSrc || '').slice(0, 50) : '' }
  })()`)
  console.log('transport before:', JSON.stringify(t0))

  await evaluate(`(() => {
    const btns = [...document.querySelectorAll('button')]
    const row = btns.find(b => b.className && b.className.includes('group') && b.querySelector('img'))
    if (row) row.click()
  })()`)
  await sleep(4000)

  const t1 = await evaluate(`(() => {
    const a = document.querySelector('audio')
    return a ? { paused: a.paused, t: +a.currentTime.toFixed(2), src: (a.currentSrc || '').slice(0, 50) } : null
  })()`)
  console.log('transport after :', JSON.stringify(t1))

  console.log(`\nconsole problems (excluding known ytjs spam): ${problems.length}`)
  for (const p of problems.slice(0, 15)) console.log('  ' + p)

  ws.close()
}

main().catch((e) => console.error(e.message))

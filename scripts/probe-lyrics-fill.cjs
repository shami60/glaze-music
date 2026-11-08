'use strict'

// Time the word-by-word fill against the line it belongs to.
//
//   node scripts/probe-lyrics-fill.cjs [port] [track] [seconds]
//
// The bug this exists to catch: a lyric line's words filled in a fraction of the
// time the singer took, then the line sat fully lit until the next one. Measured
// on Talking to the Moon it was 37% of the line — the highlight sprints, freezes,
// and reads as "the lyrics run ahead of the artist".
//
// For each line it prints how long the fill took against how long the line was on
// screen. A healthy sheet sits near 1.0; anything much below means the words are
// being paced over an estimate rather than the line's real window.

const port = Number(process.argv[2] || 9222)
const TRACK = process.argv[3] || 'All The Stars'
const SECONDS = Number(process.argv[4] || 45)

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) {
    console.log('no page target')
    return 1
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text)
    }
    return res.result.value
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  await send('Page.reload', { ignoreCache: false })
  await sleep(3500)
  for (let i = 0; i < 60; i++) {
    const ok = await evaluate(`!!(window.electronAPI && document.querySelector('#root')?.children.length)`)
    if (ok) break
    await sleep(250)
  }
  await sleep(1500)

  await evaluate(`(() => {
    const el = [...document.querySelectorAll('div, button, [role="button"]')]
      .filter(e => (e.textContent || '').trim().startsWith('All Songs')).pop()
    if (el) el.click()
    return !!el
  })()`)

  let played = null
  for (let i = 0; i < 40; i++) {
    played = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')]
        .filter(e => typeof e.className === 'string' && e.className.includes('group relative flex flex-col'))
      if (cards.length < 20) return 'grid not ready'
      const card = cards.find(e => (e.textContent || '').includes(${JSON.stringify(TRACK)}))
      if (!card) return 'card not found'
      const btn = card.querySelector('button[title="Play"]')
      if (!btn) return 'no play button'
      btn.click()
      return 'clicked'
    })()`)
    if (played === 'clicked') break
    await sleep(250)
  }
  if (played !== 'clicked') {
    console.log(played)
    return 1
  }

  // Duration from the dock itself, not from the whole body — the home hero tile
  // renders its own times and lyrics, and picking "the last m:ss on the page"
  // silently reads the wrong one.
  let duration = 0
  for (let i = 0; i < 80; i++) {
    duration = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')]
        .filter(b => (b.textContent || '').trim().toUpperCase() === 'LYRICS').pop()
      if (!btn) return 0
      // The dock is the nearest ancestor that also holds the two times.
      let el = btn
      for (let d = 0; d < 8 && el; d++) {
        const times = [...(el.innerText || '').matchAll(/(\\d+):(\\d{2})/g)]
          .map(m => Number(m[1]) * 60 + Number(m[2]))
        if (times.length >= 2) return times[times.length - 1]
        el = el.parentElement
      }
      return 0
    })()`)
    if (duration) break
    await sleep(250)
  }
  if (!duration) {
    console.log('track never reported a duration')
    return 1
  }

  await evaluate(`(() => {
    [...document.querySelectorAll('button')]
      .filter(b => (b.textContent || '').trim().toUpperCase() === 'LYRICS')
      .forEach(b => b.click())
    return true
  })()`)

  let count = 0
  for (let i = 0; i < 100; i++) {
    count = await evaluate(`[...document.querySelectorAll('div')].filter(d => d.style && d.style.opacity !== '').length`)
    if (count > 3) break
    await sleep(250)
  }
  if (!count) {
    console.log('no synced lines')
    return 1
  }
  console.log(`"${TRACK}" ${duration}s · ${count} lines\n`)

  // A line is "filling" while one of its word spans carries the sung text-shadow
  // — that style is applied only to the active line.
  //
  // Everything is scoped to the overlay that owns the seek bar. The home hero
  // tile renders a second lyrics panel with the same inline-opacity lines, so an
  // unscoped query mixes two songs together and measures nonsense.
  const sample = () => evaluate(`(() => {
    const bar = document.querySelector('input.lyrics-seek-bar')
    if (!bar) return null
    let overlay = bar
    while (overlay && getComputedStyle(overlay).position !== 'fixed') overlay = overlay.parentElement
    const scope = overlay || document.body
    const lines = [...scope.querySelectorAll('div')]
      .filter(d => d.style && d.style.opacity !== '')
      .filter(d => (d.innerText || '').trim())
    for (const el of lines) {
      const spans = [...el.querySelectorAll('span')]
      if (!spans.length) continue
      const lit = spans.filter(s => {
        const sh = getComputedStyle(s).textShadow
        return sh && sh !== 'none'
      }).length
      if (lit > 0) {
        return { text: (el.innerText || '').replace(/\\n/g, ' ').trim().slice(0, 40), lit, total: spans.length }
      }
    }
    return null
  })()`)

  const records = []
  let current = null
  const started = Date.now()
  while (Date.now() - started < SECONDS * 1000) {
    let s = null
    try {
      s = await sample()
    } catch {
      break
    }
    const now = (Date.now() - started) / 1000
    if (s) {
      if (!current || current.text !== s.text) {
        if (current) records.push(current)
        current = { text: s.text, start: now, fullAt: null, lit: s.lit, total: s.total }
      }
      current.lit = s.lit
      current.total = s.total
      if (current.fullAt === null && s.lit >= s.total) current.fullAt = now
    }
    await sleep(120)
  }
  if (current) records.push(current)
  const end = (Date.now() - started) / 1000

  console.log('line                                     on screen   fill   ratio  vs ideal')
  let sumFill = 0
  let sumSpan = 0
  let sumIdeal = 0
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    const next = records[i + 1]
    const span = (next ? next.start : end) - r.start
    const fill = r.fullAt === null ? span : r.fullAt - r.start
    if (span < 0.5) continue
    // The fill is "complete" when the last word lights, which with n words spread
    // over the window happens at (n-1)/n of it. That is the ceiling this pacing
    // can reach — comparing against it is the only fair test.
    const ideal = span * ((Math.max(r.total, 1) - 1) / Math.max(r.total, 1))
    sumFill += fill
    sumSpan += span
    sumIdeal += ideal
    console.log(
      r.text.padEnd(40),
      String(span.toFixed(2)).padStart(9),
      String(fill.toFixed(2)).padStart(6),
      String((fill / span).toFixed(2)).padStart(6),
      String((fill / ideal).toFixed(2)).padStart(9)
    )
  }
  if (sumSpan > 0) {
    console.log(
      `\noverall fill/line = ${(sumFill / sumSpan).toFixed(2)}` +
        `   fill/ideal = ${(sumFill / sumIdeal).toFixed(2)}` +
        `   (1.00 = words paced over the whole line)`
    )
  }

  ws.close()
  return 0
}

main().then(
  (c) => process.exit(c || 0),
  (e) => {
    console.error('probe failed:', e.message)
    process.exit(1)
  }
)

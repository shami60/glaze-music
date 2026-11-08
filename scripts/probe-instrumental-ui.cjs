'use strict'

// Watch the lyrics panel while nobody is singing.
//
//   node scripts/probe-instrumental-ui.cjs [port] [track] [seekSeconds] [seconds]
//
// Plays a local track that opens with a long instrumental intro, drags the
// panel's seek bar into the middle of it, and samples what is actually on
// screen: is the "just music" pill up, which line is lit, which is dimmed, which
// is lifted. Then it screenshots the panel.
//
// The point is to catch what the offline maths cannot — the pill rendering
// behind the fade mask, the wrong line dimming, or the indicator flashing as the
// vocal comes back in.
//
// Three things are deliberately not guessed at:
//   * the card is played through its own Play button; clicking the card or its
//     title does nothing at all;
//   * lyric lines are found by their inline `style.opacity`, which only the
//     synced renderer sets, so no container class has to be matched;
//   * every LYRICS button is clicked, because the home hero tile has one of its
//     own and clicking it only toggles the inline panel.

const port = Number(process.argv[2] || 9222)
const TRACK = process.argv[3] || 'All The Stars'
const SEEK_AT = Number(process.argv[4] || 9)
const SECONDS = Number(process.argv[5] || 16)

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

  // A known starting state, so the view and the queue are predictable.
  await send('Page.reload', { ignoreCache: false })
  await sleep(3500)
  for (let i = 0; i < 60; i++) {
    const ok = await evaluate(`!!(window.electronAPI && document.querySelector('#root')?.children.length)`)
    if (ok) break
    await sleep(250)
  }
  await sleep(1500)

  // 1. Library → All Songs. Optional: the app may already be on it.
  await evaluate(`(() => {
    const el = [...document.querySelectorAll('div, button, [role="button"]')]
      .filter(e => (e.textContent || '').trim().startsWith('All Songs'))
      .pop()
    if (el) el.click()
    return !!el
  })()`)

  // 2. Wait for the grid, then play the card.
  let played = null
  for (let i = 0; i < 40; i++) {
    played = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('div')]
        .filter(e => typeof e.className === 'string' && e.className.includes('group relative flex flex-col'))
      if (cards.length < 20) return 'grid not ready (' + cards.length + ')'
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

  // 3. Wait for the dock to report a duration. The dock prints the two times on
  //    separate lines with no separator, so take the last m:ss in the body —
  //    which is the total.
  let duration = 0
  for (let i = 0; i < 80; i++) {
    duration = await evaluate(`(() => {
      const times = [...(document.body.innerText || '').matchAll(/(\\d+):(\\d{2})/g)]
        .map(m => Number(m[1]) * 60 + Number(m[2]))
      return times.length >= 2 ? times[times.length - 1] : 0
    })()`)
    if (duration) break
    await sleep(250)
  }
  if (!duration) {
    console.log('track never reported a duration')
    return 1
  }

  // 4. Open the full overlay. Clicking the home tile's button too is harmless.
  const opened = await evaluate(`(() => {
    const all = [...document.querySelectorAll('button')]
      .filter(b => (b.textContent || '').trim().toUpperCase() === 'LYRICS')
    all.forEach(b => b.click())
    return all.length
  })()`)
  if (!opened) {
    console.log('no LYRICS button')
    return 1
  }

  // 5. Wait for a synced sheet: every line carries an inline opacity.
  const lineCount = () =>
    evaluate(`[...document.querySelectorAll('div')].filter(d => d.style && d.style.opacity !== '').length`)
  let count = 0
  for (let i = 0; i < 100; i++) {
    count = await lineCount()
    if (count > 3) break
    await sleep(250)
  }
  console.log(`"${TRACK}" ${duration}s · ${count} synced lines`)
  if (!count) {
    console.log('no synced lines — cannot test the indicator')
    return 1
  }

  // 6. Seek into the intro. The panel's bar is 0..100 (percent) and is the only
  //    one with the `lyrics-seek-bar` class — the dock's is normalised to 0..1,
  //    and grabbing that one silently moves nothing. A controlled React input
  //    ignores a plain `.value =`, so go through the native setter and then walk
  //    the same events the component listens for: mousedown → change → mouseup,
  //    because the commit (and therefore the actual seek) is on mouseup.
  const seek = await evaluate(`(() => {
    const bar = document.querySelector('input.lyrics-seek-bar')
    if (!bar) return 'no lyrics seek bar'
    const value = (${SEEK_AT} / ${duration}) * 100
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(bar, String(value))
    bar.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    bar.dispatchEvent(new Event('input', { bubbles: true }))
    bar.dispatchEvent(new Event('change', { bubbles: true }))
    bar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return { max: bar.max, value: +value.toFixed(2) }
  })()`)
  console.log(`seek → ${SEEK_AT}s`, JSON.stringify(seek))
  await sleep(900)

  const sample = () => evaluate(`(() => {
    const pill = document.querySelector('[data-instrumental]')
    const lines = [...document.querySelectorAll('div')]
      .filter(d => d.style && d.style.opacity !== '')
      .map(d => ({
        text: (d.innerText || '').replace(/\\n/g, ' ').trim().slice(0, 38),
        o: +Number(d.style.opacity).toFixed(2),
      }))
      // The backdrop layers also carry an inline opacity — one of them literally
      // "var(--backdrop-opacity)", which sorts as NaN and would win the ranking.
      // A lyric line always has text; those never do.
      .filter(l => l.text && Number.isFinite(l.o))
    const times = [...(document.body.innerText || '').matchAll(/(\\d+):(\\d{2})/g)].map(m => m[0])
    // The two strongest lines, with their real opacity — a fixed bucket would
    // go stale the moment the ladder is tuned.
    const top = lines.slice().sort((a, b) => b.o - a.o).slice(0, 2)
    return {
      clock: times.length >= 2 ? times[times.length - 2] : '?',
      pill: !!pill,
      box: pill ? (r => Math.round(r.width) + '×' + Math.round(r.height))(pill.getBoundingClientRect()) : null,
      top,
    }
  })()`)

  const timeline = []
  let last = null
  let pillShot = false
  const started = Date.now()
  while (Date.now() - started < SECONDS * 1000) {
    let s
    try {
      s = await sample()
    } catch {
      break
    }
    // Grab the frame while the pill is actually up — a screenshot taken after
    // the loop ends always lands after the vocal has come back.
    if (s.pill && !pillShot) {
      pillShot = true
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      require('fs').writeFileSync(
        'F:/Music Streaming/.probe-instrumental-pill.png',
        Buffer.from(shot.data, 'base64')
      )
    }
    const shape =
      `pill=${s.pill ? 'YES ' + (s.box || '') : 'no  '}` +
      ` strongest=${s.top.map(l => l.o + ' "' + l.text + '"').join(' / ') || '—'}`
    if (shape !== last) {
      timeline.push(`${s.clock.padStart(5)}  ${shape}`)
      last = shape
    }
    await sleep(250)
  }
  console.log(timeline.join('\n'))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const out = 'F:/Music Streaming/.probe-instrumental.png'
  require('fs').writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('screenshot:', out)

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

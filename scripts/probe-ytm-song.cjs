'use strict'

// Play a track from YouTube Music → Songs and inspect the dock thumbnail.
// Steps are explicit and screenshotted so a wrong click is obvious.

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
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    require('fs').writeFileSync(`C:/Users/Admin/AppData/Local/Temp/${name}.png`, Buffer.from(r.data, 'base64'))
  }

  // 1. YouTube Music
  await evaluate(`(() => {
    const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith('YouTube Music'))
    if (h) h.click()
  })()`)
  await sleep(6000)

  // 2. The Songs tab
  const tab = await evaluate(`(() => {
    const h = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'Songs')
    if (!h) return 'no Songs tab'
    h.click()
    return 'clicked Songs'
  })()`)
  console.log('tab:', tab)
  await sleep(6000)
  await shot('ytm_songs')

  // 3. First song row: a row that has an <img> and a duration-looking label.
  const row = await evaluate(`(() => {
    const cands = [...document.querySelectorAll('button, div[role="button"], [tabindex]')]
      .filter((el) => {
        const t = (el.textContent || '').trim()
        const r = el.getBoundingClientRect()
        return el.querySelector('img') && t.length > 6 && r.height > 40 && r.height < 90 && r.top > 150
      })
    if (!cands.length) return 'no rows'
    const el = cands[0]
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    el.click()
    return 'clicked: ' + (el.textContent || '').trim().slice(0, 50)
  })()`)
  console.log('row:', row)
  await sleep(8000)
  await shot('ytm_playing')

  const state = await evaluate(`(() => {
    const vh = window.innerHeight
    const imgs = [...document.images].filter((i) => i.getBoundingClientRect().top > vh - 80)
    const m = navigator.mediaSession && navigator.mediaSession.metadata
    return {
      nowPlaying: m ? { title: m.title, artist: m.artist, state: navigator.mediaSession.playbackState } : null,
      dock: imgs.map((i) => ({
        src: (i.getAttribute('src') || '').slice(0, 150),
        nw: i.naturalWidth,
        nh: i.naturalHeight,
        boxW: Math.round(i.getBoundingClientRect().width),
      })),
    }
  })()`)
  console.log(JSON.stringify(state, null, 1))

  ws.close()
}

main().catch((e) => console.error(e.message))

'use strict'

// Watch the dock play/pause button and the console for the first ~20 s after
// launch. A rapid icon flip means `isPlaying` is oscillating; the stream-refresh
// warnings in the console tell us whether the audio error path is looping.

async function main() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const logs = []
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
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      if (/Audio|Stream|playback|error|refresh|retry/i.test(text)) {
        logs.push({ t: Date.now(), type: msg.params.type, text: text.slice(0, 160) })
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      logs.push({ t: Date.now(), type: 'exception', text: (msg.params.exceptionDetails.text || '').slice(0, 160) })
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  await send('Runtime.enable')

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.text }
    return r.result.value
  }

  // Read the dock play/pause glyph. Play triangle vs pause bars have distinct paths.
  const readIcon = () =>
    evaluate(`(() => {
      const vh = window.innerHeight
      const btns = [...document.querySelectorAll('button')].filter(b => {
        const r = b.getBoundingClientRect()
        return r.top > vh - 90 && r.width > 28 && r.width < 60
      })
      const out = []
      for (const b of btns) {
        const path = b.querySelector('svg path')
        const d = path ? (path.getAttribute('d') || '') : ''
        let kind = '?'
        if (/v14l11-7|M8 5v14/.test(d)) kind = 'PLAY'
        else if (/V5H6v14|M6 19h4V5/.test(d)) kind = 'PAUSE'
        out.push(kind + ':' + Math.round(b.getBoundingClientRect().width))
      }
      return out.join(' ')
    })()`)

  const samples = []
  const start = Date.now()
  let last = ''
  for (let i = 0; i < 120; i++) {
    const icon = await readIcon()
    if (icon !== last) {
      samples.push({ ms: Date.now() - start, icon })
      last = icon
    }
    await new Promise((r) => setTimeout(r, 150))
  }

  console.log('icon transitions:', samples.length)
  for (const s of samples.slice(0, 30)) console.log(`  +${String(s.ms).padStart(5)}ms  ${s.icon}`)

  console.log('\nconsole (audio-related):', logs.length)
  for (const l of logs.slice(0, 15)) console.log(`  [${l.type}] ${l.text}`)

  const state = await evaluate(`(() => {
    const m = navigator.mediaSession && navigator.mediaSession.metadata
    return { title: m && m.title, state: navigator.mediaSession.playbackState }
  })()`)
  console.log('\nmediaSession:', JSON.stringify(state))

  ws.close()
}

main().catch((e) => console.error(e.message))

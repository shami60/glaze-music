'use strict'

// Reproduce the reported flow exactly:
//   YouTube Music → open a playlist → switch to Home → click Explore
// and assert Explore shows the *explore feed*, not the YouTube Music playlist.

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
  const shot = async (n) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    require('fs').writeFileSync(`C:/Users/Admin/AppData/Local/Temp/${n}.png`, Buffer.from(r.data, 'base64'))
  }
  const click = (label) =>
    evaluate(`(() => {
      const h = [...document.querySelectorAll('button, a')].find(b => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}))
      if (!h) return false
      h.click()
      return true
    })()`)

  // What is on screen? The detail view has a "Back to list" button and a
  // playlist header; the explore feed has the search box + category chips.
  const surface = () =>
    evaluate(`(() => {
      const txt = document.body.innerText
      const hasBack = [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim().startsWith('Back to list'))
      const nav = [...document.querySelectorAll('button')]
        .filter(b => { const r = b.getBoundingClientRect(); return r.left < 210 && r.width > 80 && r.height < 50 })
        .filter(b => { const c = (b.className || '').toString(); return c.includes('active') || c.includes('bg-white text-black') })
        .map(b => (b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20))
      return {
        activeNav: nav,
        hasBackToDetail: hasBack,
        hasPlaylistHeader: /PLAYLIST\\s*·/.test(txt),
        hasSearchBox: !!document.querySelector('input[placeholder*="Search" i]'),
        looksLikeExploreFeed: /Artists In Your Orbit|Made For You|Trending/i.test(txt),
      }
    })()`)

  console.log('1) → YouTube Music:', await click('YouTube Music'))
  await sleep(6000)

  const opened = await evaluate(`(() => {
    const c = [...document.querySelectorAll('button, [role="button"]')].filter(el => {
      const r = el.getBoundingClientRect()
      const t = (el.textContent || '').trim()
      return r.top > 150 && r.width > 110 && r.height > 70 && t.length > 1 && t.length < 70 && el.querySelector('img')
    })
    if (!c.length) return 'none'
    c[0].click()
    return (c[0].textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
  })()`)
  console.log('2) → opened playlist:', opened)
  await sleep(8000)
  console.log('   in detail:', JSON.stringify(await surface()))
  await shot('flow_1_detail')

  console.log('3) → Home:', await click('Home'))
  await sleep(4000)
  console.log('   on home:', JSON.stringify(await surface()))

  console.log('4) → Explore:', await click('Explore'))
  await sleep(4500)
  const after = await surface()
  console.log('   on explore:', JSON.stringify(after))
  await shot('flow_2_explore')

  console.log('\nVERDICT:')
  console.log('  sidebar tab       :', after.activeNav.join(', ') || '(none)')
  console.log('  playlist leaked?  :', after.hasPlaylistHeader ? 'YES — BUG' : 'no')
  console.log('  detail back btn?  :', after.hasBackToDetail ? 'YES — BUG' : 'no')
  console.log('  shows feed?       :', after.looksLikeExploreFeed ? 'yes' : 'no')

  ws.close()
}

main().catch((e) => console.error(e.message))

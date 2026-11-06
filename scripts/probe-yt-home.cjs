'use strict'

// Dump the signed-in user's YouTube Music home feed structure.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/probe-yt-home.cjs
//
// Prints, per section: the class name, the title, and the class names + counts
// of its children. This is what tells you whether a missing shelf ("Mixed for
// you", "New releases") is absent from the payload or filtered out by our mapper.

const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

const text = (v) => {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v.text === 'string') return v.text
  try { return String(v) } catch { return '' }
}

async function main() {
  app.setPath('userData', path.join(app.getPath('appData'), 'glaze-music'))
  await app.whenReady()

  const cookiePath = path.join(app.getPath('userData'), 'yt_cookies.enc')
  if (!fs.existsSync(cookiePath)) {
    console.log('No yt_cookies.enc — sign in to YouTube Music first.')
    app.quit(); return
  }

  let cookies = ''
  try {
    cookies = safeStorage.isEncryptionAvailable()
      ? JSON.parse(safeStorage.decryptString(fs.readFileSync(cookiePath)))
      : JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
  } catch (err) {
    console.log('Could not read cookies:', err.message)
    app.quit(); return
  }
  if (Array.isArray(cookies)) cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const { Innertube, UniversalCache, Platform } = await import('youtubei.js')
  const vm = require('vm')
  Platform.shim.eval = (code, env) => {
    const script = typeof code === 'string' ? code : code.output
    try { return new Function(...Object.keys(env || {}), script)(...Object.values(env || {})) }
    catch { return vm.runInNewContext(script, env || {}) }
  }

  const yt = await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true, cookie: cookies })

  const feed = await yt.music.getHomeFeed()
  const sections = feed?.sections || []
  console.log('SECTION COUNT:', sections.length)

  sections.forEach((s, i) => {
    const cls = s?.constructor?.name
    const title = text(s?.header?.title) || text(s?.title) || '(untitled)'
    const kids = Array.isArray(s?.contents) ? s.contents : []
    const classes = {}
    for (const k of kids) {
      const n = k?.constructor?.name || typeof k
      classes[n] = (classes[n] || 0) + 1
    }
    console.log(`\n[${i}] ${cls} "${title}" children=${kids.length}`, JSON.stringify(classes))
    // Show the first child's useful fields so we can see what a "My Mix" tile is.
    const first = kids[0]
    if (first) {
      const kind = first.item_type || first.type || ''
      const id = first.id || first.playlist_id || first.video_id || first.browse_id || ''
      console.log(`     first: item_type=${kind} id=${String(id).slice(0, 40)} title="${text(first.title).slice(0, 50)}"`)
      const sub = text(first.subtitle) || text(first.second_subtitle)
      if (sub) console.log(`     subtitle: "${sub.slice(0, 90)}"`)
      if (first.thumbnail || first.thumbnails) console.log('     has thumbnail: yes')
    }
  })

  app.quit()
}

main().catch((e) => { console.error('probe failed:', e.message); app.quit() })

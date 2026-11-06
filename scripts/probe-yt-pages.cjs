'use strict'

// Probe several YouTube Music browse pages and report their shelf titles.
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/probe-yt-pages.cjs
//
// Used to decide which extra home shelves can be composed from real endpoints
// when the personalised home payload only carries a few sections.

const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

const PAGES = [
  'FEmusic_new_releases',
  'FEmusic_charts',
  'FEmusic_moods_and_moments',
  'FEmusic_mixed_for_you',
  'FEmusic_home',
  'FEmusic_library_corpus_artists',
  'FEmusic_liked_playlists',
]

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
  let cookies = ''
  try {
    cookies = safeStorage.isEncryptionAvailable()
      ? JSON.parse(safeStorage.decryptString(fs.readFileSync(cookiePath)))
      : JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
  } catch (err) { console.log('cookies:', err.message); app.quit(); return }
  if (Array.isArray(cookies)) cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const { Innertube, UniversalCache, Platform } = await import('youtubei.js')
  const vm = require('vm')
  Platform.shim.eval = (code, env) => {
    const script = typeof code === 'string' ? code : code.output
    try { return new Function(...Object.keys(env || {}), script)(...Object.values(env || {})) }
    catch { return vm.runInNewContext(script, env || {}) }
  }

  const yt = await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true, cookie: cookies })

  for (const id of PAGES) {
    try {
      const res = await yt.actions.execute('/browse', { browseId: id, client: 'YTMUSIC' })
      const data = res?.data
      const shelves = []
      const collect = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) { node.forEach(collect); return }
        if (node.musicCarouselShelfRenderer) {
          const s = node.musicCarouselShelfRenderer
          const t = s.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text
            || s.header?.musicCarouselShelfBasicHeaderRenderer?.title?.simpleText || '(untitled)'
          shelves.push({ t, n: (s.contents || []).length, kind: Object.keys(s.contents?.[0] || {})[0] || '' })
        }
        if (node.gridRenderer) {
          const items = node.gridRenderer.items || []
          shelves.push({ t: '(grid)', n: items.length, kind: Object.keys(items[0] || {})[0] || '' })
        }
        if (node.musicShelfRenderer) {
          const s = node.musicShelfRenderer
          shelves.push({ t: text(s.title) || '(shelf)', n: (s.contents || []).length, kind: 'responsive' })
        }
        for (const k of Object.keys(node)) { const v = node[k]; if (v && typeof v === 'object') collect(v) }
      }
      collect(data)
      console.log(`\n=== ${id} → ${shelves.length} shelf(s)`)
      shelves.slice(0, 8).forEach((s, i) => console.log(`   [${i}] "${s.t}" n=${s.n} ${s.kind}`))
      if (!shelves.length) {
        const err = data?.alerts?.map(a => text(a?.alertRenderer?.text)).join(' | ')
        console.log('   (no shelves)', err ? 'alert: ' + err : '')
      }
    } catch (e) {
      console.log(`\n=== ${id} → FAILED: ${e.message}`)
    }
  }

  app.quit()
}

main().catch((e) => { console.error('probe failed:', e.message); app.quit() })

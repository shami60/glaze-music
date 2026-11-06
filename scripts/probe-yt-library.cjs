'use strict'

// Dump the shape of the signed-in user's YouTube Music library.
//
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-yt-library.cjs
//
// Prints the library header chips, then walks each chip's browse response and
// prints the node tree (class names + counts). This is what tells you whether a
// sync returning "0 playlists" is a filtering bug or a payload shape change.

const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

const text = (v) => {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v.text === 'string') return v.text
  try { return String(v) } catch { return '' }
}

function walk(node, depth, visit, maxDepth = 8) {
  if (!node || depth > maxDepth) return
  if (typeof node.is_array === 'boolean') {
    console.log(`${'  '.repeat(depth)}<SuperParsedResult array=${node.is_array} node=${node.is_node}>`)
    if (node.is_array) node.array().forEach(n => walk(n, depth + 1, visit, maxDepth))
    else if (node.is_node) walk(node.item(), depth + 1, visit, maxDepth)
    return
  }
  if (typeof node !== 'object') return
  visit(node, depth)
  for (const key of ['contents', 'content', 'tabs', 'items', 'sections', 'body', 'results', 'rows']) {
    const kids = node[key]
    if (!kids || typeof kids !== 'object') continue
    if (Array.isArray(kids)) kids.forEach(k => walk(k, depth + 1, visit, maxDepth))
    else walk(kids, depth + 1, visit, maxDepth)
  }
}

async function main() {
  app.setPath('userData', path.join(app.getPath('appData'), 'glaze-music'))
  await app.whenReady()

  const cookiePath = path.join(app.getPath('userData'), 'yt_cookies.enc')
  if (!fs.existsSync(cookiePath)) {
    console.log('No yt_cookies.enc — sign in to YouTube Music first.')
    app.quit()
    return
  }

  let cookies = ''
  try {
    cookies = safeStorage.isEncryptionAvailable()
      ? JSON.parse(safeStorage.decryptString(fs.readFileSync(cookiePath)))
      : JSON.parse(fs.readFileSync(cookiePath, 'utf8'))
  } catch (err) {
    console.log('Could not read cookies:', err.message)
    app.quit()
    return
  }
  if (Array.isArray(cookies)) cookies = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const { Innertube, UniversalCache, Platform } = await import('youtubei.js')
  const vm = require('vm')
  Platform.shim.eval = (code, env) => {
    const script = typeof code === 'string' ? code : code.output
    try {
      const fn = new Function(...Object.keys(env || {}), script)
      return fn(...Object.values(env || {}))
    } catch {
      return vm.runInNewContext(script, env || {})
    }
  }

  const yt = await Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    cookie: cookies,
  })

  const lib = await yt.music.getLibrary()
  const chipCloud = (lib?.header?.start_items || []).find(n => n?.constructor?.name === 'ChipCloud')
  const chips = (chipCloud?.chips || []).map(chip => ({
    label: text(chip?.text),
    endpoint: chip?.endpoint,
  }))

  for (const chip of chips) {
    if (!/playlist|album|artist|profile/i.test(chip.label)) continue
    console.log(`\n===== CHIP "${chip.label}" =====`)
    try {
      const res = await chip.endpoint.call(yt.actions, { parse: true, client: 'YTMUSIC' })
      let leaves = 0
      walk(res?.contents, 0, (node, depth) => {
        const cls = node?.constructor?.name
        const isLeaf = cls === 'MusicTwoRowItem' || cls === 'MusicResponsiveListItem'
        if (isLeaf) leaves++
        if (depth < 4 || isLeaf) {
          const n = Array.isArray(node?.contents) ? node.contents.length : '-'
          console.log(`${'  '.repeat(depth)}${cls} type=${node?.item_type} children=${n} title="${text(node?.title).slice(0, 40)}"`)
        }
      })
      console.log('LEAVES:', leaves)
    } catch (e) {
      console.log('chip failed:', e.message)
    }
  }

  app.quit()
}

main().catch((err) => {
  console.error('probe failed:', err)
  app.quit()
})

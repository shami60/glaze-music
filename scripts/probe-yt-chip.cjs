'use strict'

// Dump the raw structure of one YouTube Music library chip.
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-yt-chip.cjs "FEmusic_liked_albums"

const { app, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')

const want = process.argv[2] || 'FEmusic_liked_albums'

async function main() {
  app.setPath('userData', path.join(app.getPath('appData'), 'glaze-music'))
  await app.whenReady()

  const cookiePath = path.join(app.getPath('userData'), 'yt_cookies.enc')
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

  const res = await yt.actions.execute('/browse', {
    browseId: want,
    client: 'YTMUSIC',
  })
  const json = res?.data
  console.log(JSON.stringify(json, null, 1).slice(0, 6000))
  app.quit()
}

main().catch((e) => { console.error('probe failed:', e.message); app.quit() })

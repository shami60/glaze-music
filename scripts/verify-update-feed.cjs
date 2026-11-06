'use strict'

/**
 * verify-update-feed.cjs — prove the whole update loop without any hosting.
 *
 *   node scripts/verify-update-feed.cjs            # validate + serve on :8081
 *   node scripts/verify-update-feed.cjs --check    # validate only
 *
 * It does two things:
 *
 *   1. Validates `dist-electron/latest.yml` against the files actually on disk —
 *      a wrong `size` or `sha512` makes electron-updater reject the download with
 *      a checksum error that looks like a network failure.
 *   2. Serves `dist-electron` over HTTP **with Range support**, because the NSIS
 *      blockmap downloader fetches byte ranges. A plain static server that ignores
 *      `Range` makes every update a full 112 MB download (or fails outright), which
 *      is the single most common way a self-hosted feed "almost works".
 *
 * Then launch the *installed* build pointed at this server:
 *
 *   GLAZE_UPDATE_URL=http://127.0.0.1:8081/ "C:\Users\...\Glaze Music.exe"
 *
 * and raise the version in package.json to see it offer an update.
 */

const fs = require('fs')
const http = require('http')
const path = require('path')
const crypto = require('crypto')

const ROOT = process.env.RELEASE_DIR
  ? path.resolve(process.env.RELEASE_DIR)
  : path.join(__dirname, '..', 'dist-electron')
const PORT = Number(process.env.PORT || 8081)
const CHECK_ONLY = process.argv.includes('--check')

/** Just enough YAML for electron-builder's `latest.yml`. */
function parseFeed(text) {
  const out = { files: [] }
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line || line.startsWith('#')) continue

    const item = line.match(/^\s*-\s+url:\s*(.+)$/)
    if (item) {
      current = { url: item[1].trim().replace(/^['"]|['"]$/g, '') }
      out.files.push(current)
      continue
    }

    const kv = line.match(/^(\s*)([A-Za-z][\w]*):\s*(.*)$/)
    if (!kv) continue
    const [, indent, key, value] = kv
    const clean = value.trim().replace(/^['"]|['"]$/g, '')
    if (!clean) continue

    if (indent.length > 0 && current) {
      if (key === 'sha512') current.sha512 = clean
      else if (key === 'size') current.size = Number(clean)
      else if (key === 'blockMapSize') current.blockMapSize = Number(clean)
    } else if (key === 'version') out.version = clean
    else if (key === 'path') out.path = clean
    else if (key === 'sha512') out.sha512 = clean
    else if (key === 'releaseDate') out.releaseDate = clean
  }
  return out
}

function sha512Of(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
}

function fail(msg) {
  console.error(`  ✗ ${msg}`)
  process.exitCode = 1
}

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function validate() {
  const feedFile = path.join(ROOT, 'latest.yml')
  if (!fs.existsSync(feedFile)) {
    console.error(`No latest.yml in ${ROOT}.\nRun: npm run release`)
    process.exit(1)
  }

  const feed = parseFeed(fs.readFileSync(feedFile, 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))

  console.log(`\nlatest.yml → version ${feed.version || '(missing)'}  (package.json: ${pkg.version})`)

  if (!feed.version) fail('latest.yml has no version')
  else if (feed.version !== pkg.version) fail(`version mismatch: feed ${feed.version} vs package.json ${pkg.version}`)
  else ok(`version matches package.json (${feed.version})`)

  if (!feed.files.length) fail('latest.yml lists no files')
  for (const f of feed.files) {
    const file = path.join(ROOT, f.url)
    if (!fs.existsSync(file)) {
      fail(`missing artifact: ${f.url}`)
      continue
    }
    const size = fs.statSync(file).size
    if (f.size !== size) fail(`${f.url}: size ${f.size} in feed, ${size} on disk`)
    else ok(`${f.url} — ${(size / (1024 * 1024)).toFixed(1)} MB`)

    if (f.sha512 && sha512Of(file) !== f.sha512) fail(`${f.url}: sha512 mismatch (rebuild, do not hand-edit)`)
    else if (f.sha512) ok('sha512 matches')

    const blockmap = `${file}.blockmap`
    if (!fs.existsSync(blockmap)) {
      fail(`missing ${path.basename(blockmap)} — without it every update re-downloads the full installer`)
    } else {
      ok(`blockmap present (${(fs.statSync(blockmap).size / 1024).toFixed(0)} KB) — differential updates will work`)
    }
  }

  return feed
}

function contentType(file) {
  if (file.endsWith('.yml')) return 'text/yaml; charset=utf-8'
  if (file.endsWith('.exe')) return 'application/octet-stream'
  if (file.endsWith('.blockmap')) return 'application/octet-stream'
  return 'application/octet-stream'
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
    const file = path.join(ROOT, rel)

    // No traversal outside the release folder.
    if (!path.resolve(file).startsWith(path.resolve(ROOT)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found')
      return
    }

    const size = fs.statSync(file).size
    const range = req.headers.range

    if (range) {
      // This is the part that matters: the block downloader requests slices.
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (!m) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
        return
      }
      res.writeHead(206, {
        'Content-Type': contentType(file),
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      })
      fs.createReadStream(file, { start, end }).pipe(res)
      return
    }

    res.writeHead(200, {
      'Content-Type': contentType(file),
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    fs.createReadStream(file).pipe(res)
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\nServing ${ROOT}`)
    console.log(`  http://127.0.0.1:${PORT}/latest.yml\n`)
    console.log('Launch the INSTALLED app against it:')
    console.log(`  GLAZE_UPDATE_URL=http://127.0.0.1:${PORT}/ "…\\Glaze Music.exe"\n`)
    console.log('Then: Settings → About → Check for updates.')
    console.log('Ctrl+C to stop.\n')
  })
}

const feed = validate()
if (process.exitCode) {
  console.error('\nFeed is not usable — fix the errors above.\n')
  process.exit(1)
}
if (!CHECK_ONLY) {
  console.log('')
  serve()
} else {
  console.log('\nFeed looks good.\n')
}

// Verify that a published GitHub release actually serves the build in `dist-gh`.
//
//   node scripts/verify-hosted-release.mjs
//   RELEASE_DIR=dist-electron node scripts/verify-hosted-release.mjs
//
// Checks the things that silently break updates and are invisible from the
// GitHub UI: the release being a draft or a pre-release (the updater has
// `allowPrerelease = false`, so neither is ever found), an asset whose size does
// not match what was built, a `latest.yml` that points at a different filename
// than the uploaded asset, and a host that refuses Range requests — without
// those, differential updates fall back to a full 115 MB download every time.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const RELEASE_DIR = path.resolve(ROOT, process.env.RELEASE_DIR || 'dist-electron')

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const { version } = pkg
const publish = (pkg.build?.publish || [])[0] || {}
const owner = publish.owner
const repo = publish.repo

if (publish.provider !== 'github' || !owner || !repo) {
  console.error('build.publish is not a github provider with owner/repo — nothing to verify.')
  process.exit(1)
}

const tag = `v${version}`
const api = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`

let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => { failures++; console.log(`  ✗ ${m}`) }

const get = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'glaze-release-check' } })
  return res
}

console.log(`\n${owner}/${repo} → ${tag}\n`)

// ── 1. Release metadata ──────────────────────────────────────────────────────
const rel = await get(api)
if (!rel.ok) {
  console.log(`  ✗ no release tagged ${tag} (HTTP ${rel.status})`)
  process.exit(1)
}
const release = await rel.json()

release.draft ? bad('release is a DRAFT — the updater cannot see it') : ok('release is published (not a draft)')
release.prerelease ? bad('release is a PRE-RELEASE — updater has allowPrerelease = false') : ok('release is not a pre-release')

// ── 2. Assets ────────────────────────────────────────────────────────────────
const localExe = path.join(RELEASE_DIR, `Glaze-Music-${version}.exe`)
const localBlockmap = `${localExe}.blockmap`
const localYml = path.join(RELEASE_DIR, 'latest.yml')

for (const [file, label] of [[localExe, 'installer'], [localBlockmap, 'blockmap'], [localYml, 'latest.yml']]) {
  if (!fs.existsSync(file)) { bad(`local ${label} missing: ${file}`); }
}

const byName = new Map(release.assets.map((a) => [a.name, a]))

for (const [file, label] of [[localExe, 'installer'], [localBlockmap, 'blockmap'], [localYml, 'latest.yml']]) {
  if (!fs.existsSync(file)) continue
  const name = path.basename(file)
  const asset = byName.get(name)
  if (!asset) { bad(`${label} "${name}" is not attached to the release`); continue }
  const localSize = fs.statSync(file).size
  if (asset.size !== localSize) bad(`${name} size ${asset.size} ≠ local ${localSize}`)
  else ok(`${name} — ${(localSize / 1048576).toFixed(1)} MB, matches`)
}

// ── 3. Hosted latest.yml points at the uploaded asset, with the right hash ───
if (byName.has('latest.yml') && fs.existsSync(localExe)) {
  const ymlRes = await get(`https://github.com/${owner}/${repo}/releases/download/${tag}/latest.yml`)
  const hostedYml = await ymlRes.text()

  const hostedUrl = hostedYml.match(/url:\s*(\S+)/)?.[1]
  if (hostedUrl !== path.basename(localExe)) {
    bad(`latest.yml url "${hostedUrl}" ≠ uploaded asset "${path.basename(localExe)}"`)
  } else ok(`latest.yml points at ${hostedUrl}`)

  const hostedSha = hostedYml.match(/sha512:\s*(\S+)/)?.[1]
  const localSha = crypto.createHash('sha512').update(fs.readFileSync(localExe)).digest('base64')
  hostedSha === localSha
    ? ok('sha512 matches the local installer')
    : bad('sha512 MISMATCH — the uploaded exe is not the one that was built')

  const hostedVer = hostedYml.match(/version:\s*(\S+)/)?.[1]
  hostedVer === version
    ? ok(`feed version ${hostedVer} matches package.json`)
    : bad(`feed version ${hostedVer} ≠ package.json ${version}`)
}

// ── 4. Range support (differential updates) ──────────────────────────────────
if (byName.has(path.basename(localExe))) {
  const url = `https://github.com/${owner}/${repo}/releases/download/${tag}/${path.basename(localExe)}`
  const res = await fetch(url, { headers: { Range: 'bytes=0-1023', 'User-Agent': 'glaze-release-check' } })
  const buf = Buffer.from(await res.arrayBuffer())
  if (res.status === 206 && buf.length === 1024) ok('host serves Range requests (206) — differential updates work')
  else bad(`Range request returned ${res.status} / ${buf.length} bytes — updates would be full downloads`)
}

console.log(failures === 0 ? '\nrelease is good.\n' : `\n${failures} problem(s) — updates will not work.\n`)
process.exit(failures === 0 ? 0 : 1)

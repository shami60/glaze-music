'use strict'

/**
 * stamp-release-notes.cjs — put the changelog into the update feed.
 *
 *   node scripts/stamp-release-notes.cjs            # uses RELEASE-NOTES.md
 *   node scripts/stamp-release-notes.cjs notes.md   # or any file
 *
 * electron-builder writes `latest.yml` (version, url, sha512, size) but has no idea
 * what changed. electron-updater reads a `releaseNotes` field from that same file and
 * hands it to the renderer, which is what the "What's new" box in the update prompt
 * displays. This rewrites the field in place — it never touches the hashes.
 *
 * Run it after `electron-builder`, before uploading.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const FEED = path.join(
  process.env.RELEASE_DIR ? path.resolve(process.env.RELEASE_DIR) : path.join(ROOT, 'dist-electron'),
  'latest.yml'
)
const NOTES_FILE = path.resolve(ROOT, process.argv[2] || 'RELEASE-NOTES.md')

if (!fs.existsSync(FEED)) {
  console.error(`No latest.yml at ${FEED}. Run "npm run release" first.`)
  process.exit(1)
}
if (!fs.existsSync(NOTES_FILE)) {
  console.error(`No notes file at ${NOTES_FILE}. Create it, or pass a path.`)
  process.exit(1)
}

const notes = fs.readFileSync(NOTES_FILE, 'utf8').replace(/\r\n/g, '\n').trimEnd()
if (!notes.trim()) {
  console.error(`${path.basename(NOTES_FILE)} is empty — nothing to stamp.`)
  process.exit(1)
}

// Drop any previous releaseNotes block (everything from the key to the end of the
// literal block, i.e. until a line that is not blank and not indented).
const lines = fs.readFileSync(FEED, 'utf8').replace(/\r\n/g, '\n').split('\n')
const kept = []
let skipping = false
for (const line of lines) {
  if (/^releaseNotes:/.test(line)) {
    skipping = true
    continue
  }
  if (skipping) {
    if (line === '' || /^\s/.test(line)) continue
    skipping = false
  }
  kept.push(line)
}

const body = notes
  .split('\n')
  .map((l) => (l.trim() ? `  ${l}` : ''))
  .join('\n')

const out = `${kept.join('\n').replace(/\n+$/, '')}\nreleaseNotes: |\n${body}\n`
fs.writeFileSync(FEED, out)

const version = (out.match(/^version:\s*(.+)$/m) || [])[1] || '?'
console.log(`Stamped ${notes.split('\n').length} lines of release notes into latest.yml (version ${version})`)

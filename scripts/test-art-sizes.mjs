// Assert the thumbnail tier mapping. Run with: node scripts/test-art-sizes.mjs
//
// Catches the failure mode that a live sweep cannot: a URL shape the regex
// silently ignores, so a 44 px row keeps requesting an 800x800 bitmap.

import assert from 'node:assert/strict'
import { getSizedArtURL, getHighQualityArtURL, onArtLoad } from '../src/utils.js'

const YT_BARE = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg'
const YT_SIGNED = 'https://i.ytimg.com/vi/abc123/hqdefault.jpg?sqp=xyz&rs=abc'
const YT_HQ = 'https://i.ytimg.com/vi/abc123/hq720.jpg?sqp=xyz'
const GOOG_W = 'https://yt3.googleusercontent.com/AAA=w800-h800-l90-rj'
const GOOG_S = 'https://lh3.googleusercontent.com/BBB=s176-c-k-c0x00ffffff-no-rj'
const GOOG_BARE = 'https://yt3.googleusercontent.com/CCC'
const LOCAL = 'art:///C:/Music/track.mp3'

const cases = [
  // [input, size, expected]
  [YT_BARE, 'thumb', 'https://i.ytimg.com/vi/abc123/mqdefault.jpg'],
  [YT_BARE, 'card', 'https://i.ytimg.com/vi/abc123/mqdefault.jpg'],
  [YT_BARE, 'large', 'https://i.ytimg.com/vi/abc123/hq720.jpg'],
  [YT_HQ, 'card', 'https://i.ytimg.com/vi/abc123/mqdefault.jpg?sqp=xyz'],
  // Query string must survive the variant swap, or the signature breaks.
  [YT_SIGNED, 'card', 'https://i.ytimg.com/vi/abc123/mqdefault.jpg?sqp=xyz&rs=abc'],
  // The `=w…-h…` vs `=s…` form is preserved deliberately: the trailing `-l90-rj`
  // (and any `-c` crop) changes what Google returns, so only the size is swapped.
  [GOOG_W, 'thumb', 'https://yt3.googleusercontent.com/AAA=w120-h120-l90-rj'],
  [GOOG_W, 'card', 'https://yt3.googleusercontent.com/AAA=w320-h320-l90-rj'],
  [GOOG_W, 'large', 'https://yt3.googleusercontent.com/AAA=w800-h800-l90-rj'],
  [GOOG_S, 'thumb', 'https://lh3.googleusercontent.com/BBB=s120'],
  [GOOG_BARE, 'card', 'https://yt3.googleusercontent.com/CCC=w320-h320-l90-rj'],
  // Local art must pass through byte-identical.
  [LOCAL, 'thumb', LOCAL],
  [LOCAL, 'card', LOCAL],
  [LOCAL, 'large', LOCAL],
  ['', 'card', ''],
  [null, 'card', ''],
]

let failed = 0
for (const [input, size, expected] of cases) {
  const actual = getSizedArtURL(input, size)
  const ok = actual === expected
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${size.padEnd(5)} ${String(input).slice(0, 52).padEnd(54)} → ${actual}`)
  if (!ok) console.log(`      expected: ${expected}`)
}

// getHighQualityArtURL must still mean 'large' for every existing caller.
for (const input of [YT_BARE, GOOG_W, LOCAL]) {
  assert.equal(getHighQualityArtURL(input), getSizedArtURL(input, 'large'))
}
console.log('\ngetHighQualityArtURL === getSizedArtURL(…, "large")  ✓')

// 'yt:<id>' shorthand
assert.equal(getSizedArtURL('yt:abc123', 'card'), 'https://i.ytimg.com/vi/abc123/mqdefault.jpg')
assert.equal(getSizedArtURL('yt:abc123', 'large'), 'https://i.ytimg.com/vi/abc123/hq720.jpg')
console.log('yt: shorthand  ✓')

// ── onArtLoad: YouTube answers a missing variant with HTTP 404 *and* a valid
// 120x90 grey placeholder JPEG, so `error` never fires. Only the decoded size
// reveals it.
const fakeImg = (w, h, src) => ({ naturalWidth: w, naturalHeight: h, currentSrc: src, src, dataset: {} })

// The placeholder (120x90) must be swapped for hqdefault, keeping the signature.
const ph = fakeImg(120, 90, 'https://i.ytimg.com/vi/X/hq720.jpg?sqp=s&rs=r')
onArtLoad({ currentTarget: ph })
assert.equal(ph.src, 'https://i.ytimg.com/vi/X/hqdefault.jpg?sqp=s&rs=r', 'placeholder should step down to hqdefault')
assert.equal(ph.dataset.artFallback, '1')
console.log('onArtLoad: 120x90 placeholder → hqdefault  ✓')

// Guard must not loop: a second call is a no-op.
const before = ph.src
onArtLoad({ currentTarget: ph })
assert.equal(ph.src, before)
console.log('onArtLoad: idempotent  ✓')

// Real artwork must never be touched.
for (const [w, h] of [[320, 180], [480, 360], [1280, 720], [800, 800]]) {
  const good = fakeImg(w, h, 'https://i.ytimg.com/vi/X/hq720.jpg?sig')
  onArtLoad({ currentTarget: good })
  assert.equal(good.src, 'https://i.ytimg.com/vi/X/hq720.jpg?sig', `${w}x${h} must be left alone`)
}
console.log('onArtLoad: real artwork untouched  ✓')

// A genuine small local cover (art://) has nothing to step down to — no crash.
const local = fakeImg(100, 100, 'art:///C:/Music/cover.mp3')
onArtLoad({ currentTarget: local })
assert.equal(local.src, 'art:///C:/Music/cover.mp3')
console.log('onArtLoad: local art untouched  ✓')

console.log(failed ? `\n${failed} FAILED` : '\nall assertions passed')
process.exit(failed ? 1 : 0)
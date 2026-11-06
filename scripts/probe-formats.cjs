'use strict'

// Diagnostic: which Innertube clients still return audio-only renditions?
//
//   node scripts/probe-formats.cjs [videoId]
//
// The app used to read `streamingData.formats` (muxed with video) and prefer it,
// which caps audio around 96 kbps. This prints what each client actually offers
// so the quality presets can be built on real adaptive audio streams.

const videoId = process.argv[2] || 'dQw4w9WgXcQ'

const CLIENTS = ['ANDROID', 'IOS', 'WEB', 'MWEB', 'TV', 'TV_EMBEDDED', 'ANDROID_VR', 'WEB_EMBEDDED']

async function main() {
  const { Innertube, UniversalCache } = await import('youtubei.js')
  const yt = await Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true })
  console.log('innertube ready\n')

  for (const client of CLIENTS) {
    try {
      const res = await yt.actions.execute('/player', { videoId, client })
      const sd = res.data?.streamingData || {}
      const adaptive = (sd.adaptiveFormats || []).filter((f) => f.url && /audio\//.test(f.mimeType || ''))
      const progressive = (sd.formats || []).filter((f) => f.url)
      const status = res.data?.playabilityStatus?.status

      console.log(`${client.padEnd(14)} status=${status} adaptiveAudio=${adaptive.length} progressive=${progressive.length}`)
      for (const f of adaptive.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))) {
        const codec = (f.mimeType.match(/codecs="([^"]+)"/) || [])[1]
        console.log(`   itag ${String(f.itag).padEnd(4)} ${String(codec).padEnd(12)} ${Math.round((f.bitrate || 0) / 1000)} kbps`)
      }
      if (!adaptive.length && progressive.length) {
        for (const f of progressive) {
          const codec = (f.mimeType.match(/codecs="([^"]+)"/) || [])[1]
          console.log(`   itag ${String(f.itag).padEnd(4)} ${String(codec).padEnd(12)} ${Math.round((f.bitrate || 0) / 1000)} kbps (muxed)`)
        }
      }
    } catch (e) {
      console.log(`${client.padEnd(14)} ERROR ${e.message}`)
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})

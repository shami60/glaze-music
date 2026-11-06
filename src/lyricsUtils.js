/**
 * lyricsUtils.js — Centralized lyrics helpers, text direction (RTL/LTR) detection,
 * and live translation integration for Glaze Music.
 */

// Common translation targets
export const TRANSLATION_LANGUAGES = [
  { code: 'ur', label: 'Urdu (اردو)', isRTL: true },
  { code: 'en', label: 'English', isRTL: false },
  { code: 'hi', label: 'Hindi (हिंदी)', isRTL: false },
  { code: 'es', label: 'Spanish (Español)', isRTL: false },
  { code: 'pa', label: 'Punjabi (ਪੰਜਾਬੀ)', isRTL: false },
  { code: 'ar', label: 'Arabic (العربية)', isRTL: true },
  { code: 'bn', label: 'Bengali (বাংলা)', isRTL: false },
  { code: 'tr', label: 'Turkish (Türkçe)', isRTL: false },
]

/**
 * Turn `{ time, content }` LRC lines into lines carrying per-word timings.
 *
 * The source only timestamps whole lines, so word times have to be derived.
 * Splitting a line's duration evenly across its words drifts badly: "I" and
 * "extraordinary" were each given the same slot, so the highlight ran ahead on
 * short words and trailed on long ones. Weighting by characters (plus one for
 * the space that follows) tracks sung speech closely enough that the drift
 * stops being visible.
 */
/** Rough syllable count — good enough to pace a lyric line. */
function countSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 1
  const groups = w.match(/[aeiouy]+/g)
  let n = groups ? groups.length : 1
  // A silent trailing "e" ("love", "time") does not get its own beat.
  if (n > 1 && /[^aeiouy]e$/.test(w)) n -= 1
  return Math.max(1, n)
}

export function buildTimedLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((line, i) => {
    const next = lines[i + 1]
    const end = next ? next.time : line.time + 5
    const duration = Math.max(0.2, end - line.time)
    const text = (line.content || '').trim()
    const words = text ? text.split(/\s+/) : []
    if (!words.length) return { ...line, end, words: [] }

    // Pace by syllables, not characters: "extraordinary" is five beats and
    // "strength" is one, however many letters they carry. Splitting by length
    // made long words hog the line and short ones flash past, which reads as the
    // highlight running away from the vocal.
    const weights = words.map(w => countSyllables(w))
    const total = weights.reduce((a, b) => a + b, 0) || 1

    // How long the line plausibly takes to *sing*. LRC only gives the gap until
    // the next line, and that gap often contains an instrumental break — spreading
    // the words across the whole gap made the highlight crawl on for seconds after
    // the singer stopped. Words lay out over the sung part; the last one holds.
    const spoken = words.reduce((sum, w) => sum + 0.09 + 0.2 * countSyllables(w), 0)
    const span = Math.min(duration, Math.max(0.6, spoken))

    let acc = 0
    const timed = words.map((w, idx) => {
      const start = line.time + (acc / total) * span
      acc += weights[idx]
      return { text: w, start }
    })
    return { ...line, end, words: timed, sungUntil: line.time + span }
  })
}

/**
 * Parse `rgb(r, g, b)` / `#rrggbb` into 0-255 components.
 */
function parseColor(input) {
  const str = String(input || '').trim()
  const rgb = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] }
  const hex = str.replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    }
  }
  return null
}

/**
 * Lift a colour into something that can actually tint a dark background.
 *
 * `accentColor` is sampled from the cover, so a near-black sleeve yields a
 * near-black accent — the drifting backdrop then rendered as flat black and
 * looked like it was not there at all. Raising saturation and pinning lightness
 * gives a wash that reads on any cover without becoming a neon slab.
 */
export function vividAccent(color, { s = 64, l = 46 } = {}) {
  const rgb = parseColor(color)
  if (!rgb) return color
  const rn = rgb.r / 255, gn = rgb.g / 255, bn = rgb.b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const light = (max + min) / 2
  let h = 0
  let sat = 0
  if (max !== min) {
    const d = max - min
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  // Keep the cover's hue, but guarantee enough chroma and a mid lightness.
  // A near-grey cover has an essentially arbitrary hue — forcing saturation on it
  // turned a black sleeve into a blue backdrop. Below ~20% source saturation the
  // colour is treated as neutral and only lifted a little.
  const srcS = sat * 100
  const outS = srcS < 20 ? 14 : Math.max(srcS, s)
  const outL = srcS < 20 ? 34 : l
  const c = (1 - Math.abs(2 * outL / 100 - 1)) * outS / 100
  const hp = (((h * 360) % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rr = 0, gg = 0, bb = 0
  if (hp < 1) [rr, gg, bb] = [c, x, 0]
  else if (hp < 2) [rr, gg, bb] = [x, c, 0]
  else if (hp < 3) [rr, gg, bb] = [0, c, x]
  else if (hp < 4) [rr, gg, bb] = [0, x, c]
  else if (hp < 5) [rr, gg, bb] = [x, 0, c]
  else [rr, gg, bb] = [c, 0, x]
  const m = outL / 100 - c / 2
  return `rgb(${Math.round((rr + m) * 255)}, ${Math.round((gg + m) * 255)}, ${Math.round((bb + m) * 255)})`
}

/**
 * Checks if a string contains Right-To-Left (RTL) characters
 * (Arabic, Urdu, Persian, Pashto, Hebrew, Sindhi, etc.)
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isRTL(text) {
  if (!text || typeof text !== 'string') return false
  // Matches Arabic, Urdu, Persian (\u0600-\u06FF, \u0750-\u077F, \u08A0-\u08FF, \uFB50-\uFDFF, \uFE70-\uFEFF)
  // and Hebrew (\u0590-\u05FF, \uFB1D-\uFB4F)
  const rtlRegex = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/
  return rtlRegex.test(text)
}

/**
 * Parse standard LRC format string into an array of { time, content } objects.
 *
 * @param {string} text
 * @returns {Array<{ time: number, content: string }>}
 */
export function parseLRC(text) {
  if (!text || typeof text !== 'string') return []
  const lines = text.split('\n')
  const result = []
  for (const line of lines) {
    const match = line.match(/\[\d{2}:\d{2}\.\d{2,3}\]/g)
    if (match) {
      const content = line.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim()
      match.forEach(t => {
        const min = parseInt(t.slice(1, 3), 10)
        const sec = parseFloat(t.slice(4, -1))
        result.push({ time: min * 60 + sec, content })
      })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

// In-memory cache for translations: key = `${content_hash}_${targetLang}`
// Bounded — each entry holds a whole translated lyric sheet, so an uncapped map
// grows for the entire session as the user browses tracks.
const TRANSLATION_CACHE_MAX = 40
const translationCache = new Map()

function cacheTranslation(key, value) {
  translationCache.delete(key)
  translationCache.set(key, value)
  while (translationCache.size > TRANSLATION_CACHE_MAX) {
    translationCache.delete(translationCache.keys().next().value)
  }
}

function getCacheKey(payload, targetLang) {
  if (Array.isArray(payload)) {
    const preview = payload.slice(0, 5).map(l => l.content).join('|')
    return `${payload.length}_${preview}_${targetLang}`
  }
  return `${String(payload).slice(0, 50)}_${targetLang}`
}

/**
 * Translates either synced LRC lines array or plain text lyrics.
 * Uses Electron IPC `youtube:translateLyrics` when available, with a browser fallback.
 *
 * @param {Array<{ time: number, content: string }> | string} payload
 * @param {string} targetLang - e.g. 'ur', 'en', 'hi'
 * @returns {Promise<{ type: 'synced' | 'plain', data: any, isRTL: boolean }>}
 */
export async function translateLyrics(payload, targetLang = 'ur') {
  if (!payload) return null
  const cacheKey = getCacheKey(payload, targetLang)
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)
  }

  const isSynced = Array.isArray(payload)

  // 1. Try Electron IPC
  if (window.electronAPI?.youtubeTranslateLyrics) {
    try {
      const res = await window.electronAPI.youtubeTranslateLyrics(payload, targetLang)
      if (res && res.success) {
        const result = {
          type: isSynced ? 'synced' : 'plain',
          data: res.data,
          isRTL: isSynced 
            ? (res.data.some(l => isRTL(l.content)) || isRTL(res.data[0]?.content))
            : isRTL(res.data)
        }
        cacheTranslation(cacheKey, result)
        return result
      }
    } catch (err) {
      console.warn('Electron translation IPC failed, attempting fallback...', err)
    }
  }

  // 2. Direct browser fallback using Google dict-chrome-ex client
  try {
    let rawText = ''
    if (isSynced) {
      rawText = payload.map(l => l.content || '♪').join('\n')
    } else {
      rawText = String(payload)
    }

    const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(rawText)}`
    const fetchRes = await fetch(url)
    if (fetchRes.ok) {
      const json = await fetchRes.json()
      const translatedRaw = (json[0] || []).map(x => x[0]).join('')
      
      if (isSynced) {
        const translatedLines = translatedRaw.split('\n')
        const syncedData = payload.map((orig, idx) => ({
          time: orig.time,
          content: (translatedLines[idx] !== undefined && translatedLines[idx].trim() !== '') ? translatedLines[idx].trim() : orig.content,
          originalContent: orig.content
        }))
        const result = {
          type: 'synced',
          data: syncedData,
          isRTL: syncedData.some(l => isRTL(l.content))
        }
        cacheTranslation(cacheKey, result)
        return result
      } else {
        const result = {
          type: 'plain',
          data: translatedRaw,
          isRTL: isRTL(translatedRaw)
        }
        cacheTranslation(cacheKey, result)
        return result
      }
    }
  } catch (e) {
    console.error('Fallback translation error:', e)
  }

  return null
}

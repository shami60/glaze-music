// Track titles come straight from YouTube, and uploaders are inconsistent:
// "DICE AND ROLL" sits next to "Hum" in the same grid. Only fully-uppercase
// titles are re-cased for display; anything already mixed-case is left alone,
// because guessing at stylised names (LXNGVX, lliinnee, reverie) does more harm
// than good.
//
// Display-only — the stored title is never modified.

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into',
  'nor', 'of', 'on', 'onto', 'or', 'over', 'the', 'to', 'up', 'vs', 'with'
])

export function displayTitle(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return raw

  const letters = raw.replace(/[^A-Za-z]/g, '')
  if (!letters) return raw

  const uppercaseCount = raw.replace(/[^A-Z]/g, '').length
  // 0.9 rather than 1 so "FUNK ABNORMAL (SLOWED)" still qualifies when a stray
  // lowercase letter sneaks in.
  if (uppercaseCount / letters.length < 0.9) return raw

  const words = raw.toLowerCase().match(/[\p{L}']+/gu) || []
  let position = 0
  return raw.toLowerCase().replace(/[\p{L}']+/gu, (word) => {
    const index = position++
    const isLast = index === words.length - 1
    // Small words stay lowercase, except when they open or close the title.
    if (!isLast && index > 0 && SMALL_WORDS.has(word)) return word
    return word.charAt(0).toUpperCase() + word.slice(1)
  })
}

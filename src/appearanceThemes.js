/**
 * Appearance themes.
 *
 * These are *full* themes — canvas, surfaces, borders, glass, shadows and
 * accent — not wallpaper swaps. The actual colour values live in
 * `src/index.css` under `[data-theme="<id>"]`; this file is only the metadata
 * the picker needs to render a preview.
 *
 * `swatch` is [canvas, surface, accent] and is used to draw the preview tile.
 * Keep it in sync with index.css if you change a theme's palette.
 */

export const APPEARANCE_THEMES = [
  {
    id: 'liquid-glass',
    name: 'Liquid Glass',
    description: 'The original — frosted panels over blurred album art.',
    mode: 'dark',
    swatch: ['#080808', '#1a1a24', '#8b5cf6'],
  },
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'Light, cool neutral. For bright rooms.',
    mode: 'light',
    swatch: ['#eceef3', '#ffffff', '#2563eb'],
  },
  {
    id: 'sandstone',
    name: 'Sandstone',
    description: 'Light and warm, paper-like.',
    mode: 'light',
    swatch: ['#f0e9dd', '#fffdf8', '#b45309'],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Pick any colour — the whole palette is built around it.',
    mode: 'custom',
    // Placeholder only; the picker renders live colours from the user's choice.
    swatch: ['#0b0812', '#1e1729', '#8b5cf6'],
  },
]

export const DEFAULT_APPEARANCE = 'liquid-glass'

export function getAppearance(id) {
  return APPEARANCE_THEMES.find((t) => t.id === id) || APPEARANCE_THEMES[0]
}

/**
 * A theme id that is guaranteed to exist.
 *
 * Users who had one of the retired themes (Obsidian, Midnight, Forest, Nord,
 * Neon, Graphite) still have that id saved in preferences and localStorage.
 * Writing it to `data-theme` would match no CSS block and leave the app on the
 * un-themed defaults, so anything unknown resolves to the default instead.
 */
export function normalizeAppearance(id) {
  return APPEARANCE_THEMES.some((t) => t.id === id) ? id : DEFAULT_APPEARANCE
}

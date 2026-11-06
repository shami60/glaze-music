/**
 * Custom appearance theme.
 *
 * The other themes are static `[data-theme="…"]` blocks in index.css. This one
 * can't be: the colour comes from the user at runtime. So we derive a full
 * palette (canvas, surfaces, hairlines, glass, accent) from a single picked
 * colour and write the same tokens as inline custom properties on <html>.
 *
 * Inline properties beat the stylesheet, which is exactly what we want — the
 * `data-theme="custom"` block in index.css only provides the fallback.
 */

const DARK_SHADOW =
  '0 4px 20px -2px rgba(0, 0, 0, 0.2), inset 0 1px 1px 0 rgba(255, 255, 255, 0.08)'
const DARK_SHADOW_HOVER =
  '0 8px 30px -4px rgba(0, 0, 0, 0.35), inset 0 1px 1px 0 rgba(255, 255, 255, 0.16)'

function hexToRgb(hex) {
  let h = String(hex || '').trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 139, g: 92, b: 246 } // violet fallback
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const hsl = (h, s, l) => `hsl(${Math.round(h)} ${clamp(s, 0, 100).toFixed(1)}% ${clamp(l, 0, 100).toFixed(1)}%)`

function hslToRgb(h, s, l) {
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = ln - c / 2
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

/**
 * Build the token map for a picked colour.
 *
 * The canvas is tinted *toward* the hue rather than painted with it — a fully
 * saturated window is unusable for hours of listening. Saturation on surfaces
 * stays in the 12–35% band; only the accent is allowed to be vivid.
 */
export function buildCustomTheme(hex, mode = 'dark') {
  const { h } = rgbToHsl(hexToRgb(hex))
  const light = mode === 'light'

  // Keep the accent distinguishable from the canvas. A near-black pick on a
  // dark canvas (or white on a light one) would otherwise disappear.
  const picked = rgbToHsl(hexToRgb(hex))
  const accentL = clamp(picked.l, light ? 32 : 46, light ? 62 : 74)
  const accent = hsl(h, picked.s, accentL)
  // Derive the RGB triplet from the *adjusted* accent, not the raw pick. It used
  // to keep the picked RGB, so on a light canvas a pale colour produced a dark
  // `--theme-accent` but a pale `--theme-accent-rgb` — every glow, ring and tint
  // built from the triplet stayed washed out while the accent itself did not.
  const accentRgb = hslToRgb(h, picked.s, accentL)

  const vars = light
    ? {
        '--app-bg': hsl(h, 22, 94),
        '--surface-0': hsl(h, 20, 89),
        '--surface-1': hsl(h, 28, 97),
        '--surface-2': hsl(h, 34, 100),
        '--surface-dock': hsl(h, 30, 100),
        '--surface-menu': hsl(h, 30, 100),
        '--color-white': hsl(h, 18, 9),
        '--ink-rgb': '18, 17, 22',
        '--glass-blur': '24px',
        '--glass-saturate': '120%',
        '--dock-blur': '24px',
        '--menu-alpha': '86%',
        '--backdrop-opacity': '0.1',
        '--backdrop-blur': '26px',
        '--hairline': `color-mix(in srgb, var(--color-white) 13%, transparent)`,
        '--hairline-strong': `color-mix(in srgb, var(--color-white) 26%, transparent)`,
        '--hairline-soft': `color-mix(in srgb, var(--color-white) 9%, transparent)`,
        '--shadow-card':
          '0 2px 10px -2px rgba(20, 18, 30, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.9)',
        '--shadow-card-hover':
          '0 8px 24px -6px rgba(20, 18, 30, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95)',
      }
    : {
        '--app-bg': hsl(h, 26, 5),
        '--surface-0': hsl(h, 24, 7),
        '--surface-1': hsl(h, 22, 10),
        '--surface-2': hsl(h, 20, 14),
        '--surface-dock': hsl(h, 24, 8),
        '--surface-menu': hsl(h, 26, 7),
        '--color-white': hsl(h, 14, 96),
        '--ink-rgb': '245, 243, 250',
        '--glass-blur': '40px',
        '--glass-saturate': '180%',
        '--dock-blur': '60px',
        '--menu-alpha': '45%',
        '--backdrop-opacity': '0.34',
        '--backdrop-blur': '20px',
        '--hairline': `color-mix(in srgb, var(--color-white) 8%, transparent)`,
        '--hairline-strong': `color-mix(in srgb, var(--color-white) 20%, transparent)`,
        '--hairline-soft': `color-mix(in srgb, var(--color-white) 5%, transparent)`,
        '--shadow-card': DARK_SHADOW,
        '--shadow-card-hover': DARK_SHADOW_HOVER,
      }

  vars['--theme-accent'] = accent
  vars['--theme-accent-rgb'] = `${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}`
  vars['color-scheme'] = light ? 'light' : 'dark'

  return vars
}

/** Keys buildCustomTheme() writes, so they can be removed when switching away. */
export const CUSTOM_VAR_KEYS = [
  '--app-bg', '--surface-0', '--surface-1', '--surface-2', '--surface-dock',
  '--surface-menu', '--color-white', '--ink-rgb', '--glass-blur',
  '--glass-saturate', '--dock-blur', '--menu-alpha', '--backdrop-opacity',
  '--backdrop-blur', '--hairline', '--hairline-strong', '--hairline-soft',
  '--shadow-card', '--shadow-card-hover', '--theme-accent',
  '--theme-accent-rgb', 'color-scheme',
]

/** Three colours for the picker's preview tile: canvas, surface, accent. */
export function customSwatch(hex, mode) {
  const v = buildCustomTheme(hex, mode)
  return [v['--app-bg'], v['--surface-2'], v['--theme-accent']]
}

/**
 * The accent that is actually in use, after the per-mode lightness clamp.
 *
 * Components must use this rather than the raw pick. The clamp exists so the
 * accent stays legible on its canvas; handing the raw value to play buttons,
 * progress bars and glows meant a pale pick vanished on a light theme (and a
 * near-black pick vanished on a dark one) — the colour "had no light version".
 */
export function customAccentColor(hex, mode = 'dark') {
  return buildCustomTheme(hex, mode)['--theme-accent']
}

export const CUSTOM_PRESETS = [
  '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981',
  '#eab308', '#f97316', '#ef4444', '#ec4899',
  '#a855f7', '#14b8a6', '#64748b', '#e2b04a',
]

export const DEFAULT_CUSTOM_ACCENT = '#8b5cf6'

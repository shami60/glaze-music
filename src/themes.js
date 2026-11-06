/**
 * Backdrop presets (the image behind the glass).
 *
 * These are NOT the appearance themes in `appearanceThemes.js` — those are colour
 * palettes. This file only picks the picture.
 *
 * The source art is 1024 px wide, but it is only ever drawn as a ~250 px blurred
 * tile in Settings or as a full-screen layer under a 20–28 px blur. A 320 px
 * preview is indistinguishable in both places and far smaller on the wire — 17 KB
 * for all five instead of 1.25 MB — so that is what ships. The originals stay in
 * this folder in case a future UI wants the detail.
 */
import goldenHourImg from './assets/themes/previews/golden-hour.webp'
import neonBlueImg   from './assets/themes/previews/neon-blue.webp'
import infernoImg    from './assets/themes/previews/inferno.webp'
import cyberpunkImg  from './assets/themes/previews/cyberpunk.webp'
import nightDriveImg from './assets/themes/previews/night-drive.webp'

export const THEMES = [
  { id: 'dynamic',     name: 'Dynamic',     img: null },
  { id: 'golden-hour', name: 'Golden Hour', img: goldenHourImg },
  { id: 'neon-blue',   name: 'Neon Blue',   img: neonBlueImg },
  { id: 'inferno',     name: 'Inferno',     img: infernoImg },
  { id: 'cyberpunk',   name: 'Cyberpunk',   img: cyberpunkImg },
  { id: 'night-drive', name: 'Night Drive', img: nightDriveImg },
]

const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

app.whenReady().then(async () => {
  try {
    const root = path.resolve(__dirname, '..')
    const iconPngPath = path.join(root, 'assets', 'icon.png')
    const buildDir = path.join(root, 'build')

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true })
    }

    const iconImg = nativeImage.createFromPath(iconPngPath)

    // ── Helper to create 24-bit BMP Buffer from 2D pixel generator ─────────────
    function create24BitBMP(width, height, getRGB) {
      const rowSize = Math.floor((width * 3 + 3) / 4) * 4
      const imageSize = rowSize * height
      const fileSize = 54 + imageSize

      const buf = Buffer.alloc(fileSize)

      // Bitmap File Header (14 bytes)
      buf.write('BM', 0)
      buf.writeUInt32LE(fileSize, 2)
      buf.writeUInt16LE(0, 6)
      buf.writeUInt16LE(0, 8)
      buf.writeUInt32LE(54, 10)

      // DIB Header (BITMAPINFOHEADER - 40 bytes)
      buf.writeUInt32LE(40, 14)
      buf.writeInt32LE(width, 18)
      buf.writeInt32LE(height, 22) // bottom-up
      buf.writeUInt16LE(1, 26)     // planes
      buf.writeUInt16LE(24, 28)    // 24 bits per pixel
      buf.writeUInt32LE(0, 30)     // BI_RGB (uncompressed)
      buf.writeUInt32LE(imageSize, 34)
      buf.writeInt32LE(2835, 38)   // 72 DPI
      buf.writeInt32LE(2835, 42)
      buf.writeUInt32LE(0, 46)
      buf.writeUInt32LE(0, 50)

      // Pixels (bottom-up)
      for (let y = 0; y < height; y++) {
        // BMP is bottom-up: y=0 is bottom row
        const sourceY = height - 1 - y
        const rowOffset = 54 + y * rowSize
        for (let x = 0; x < width; x++) {
          const [r, g, b] = getRGB(x, sourceY)
          const pxOffset = rowOffset + x * 3
          buf[pxOffset] = Math.max(0, Math.min(255, b))     // Blue
          buf[pxOffset + 1] = Math.max(0, Math.min(255, g)) // Green
          buf[pxOffset + 2] = Math.max(0, Math.min(255, r)) // Red
        }
      }

      return buf
    }

    // ── 1. Create Installer Sidebar BMP (164 x 314) ────────────────────────────
    // Cozy dark violet/purple mesh gradient with the new icon in center
    const iconSize = 96
    const iconResized = iconImg.resize({ width: iconSize, height: iconSize, quality: 'best' })
    const iconBitmap = iconResized.toBitmap() // BGRA

    const sidebarW = 164
    const sidebarH = 314
    const iconStartX = Math.floor((sidebarW - iconSize) / 2)
    const iconStartY = 60

    const sidebarBMP = create24BitBMP(sidebarW, sidebarH, (x, y) => {
      // Base cozy dark gradient (top #1e112a -> bottom #0d0c18)
      const t = y / sidebarH
      let bgR = Math.round(30 * (1 - t) + 12 * t)
      let bgG = Math.round(16 * (1 - t) + 10 * t)
      let bgB = Math.round(48 * (1 - t) + 24 * t)

      // Subtle warm pink glow around icon
      const dx = x - (sidebarW / 2)
      const dy = y - (iconStartY + iconSize / 2)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 80) {
        const glow = Math.pow(1 - dist / 80, 2) * 0.35
        bgR += Math.round(230 * glow)
        bgG += Math.round(60 * glow)
        bgB += Math.round(180 * glow)
      }

      // Check if inside icon bounds
      if (x >= iconStartX && x < iconStartX + iconSize && y >= iconStartY && y < iconStartY + iconSize) {
        const ix = x - iconStartX
        const iy = y - iconStartY
        const offset = (iy * iconSize + ix) * 4
        const b = iconBitmap[offset]
        const g = iconBitmap[offset + 1]
        const r = iconBitmap[offset + 2]
        const a = iconBitmap[offset + 3] / 255

        const outR = Math.round(r * a + bgR * (1 - a))
        const outG = Math.round(g * a + bgG * (1 - a))
        const outB = Math.round(b * a + bgB * (1 - a))
        return [outR, outG, outB]
      }

      return [bgR, bgG, bgB]
    })

    fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBMP)
    fs.writeFileSync(path.join(buildDir, 'uninstallerSidebar.bmp'), sidebarBMP)
    console.log('[Assets] Created installerSidebar.bmp & uninstallerSidebar.bmp')

    // ── 2. Create Installer Header BMP (150 x 57) ─────────────────────────────
    const headerIconSize = 44
    const headerIconResized = iconImg.resize({ width: headerIconSize, height: headerIconSize, quality: 'best' })
    const headerIconBitmap = headerIconResized.toBitmap()

    const headerW = 150
    const headerH = 57
    const hIconX = headerW - headerIconSize - 10
    const hIconY = Math.floor((headerH - headerIconSize) / 2)

    const headerBMP = create24BitBMP(headerW, headerH, (x, y) => {
      // Header background #161522
      let bgR = 22
      let bgG = 21
      let bgB = 34

      // Draw mini icon on the right
      if (x >= hIconX && x < hIconX + headerIconSize && y >= hIconY && y < hIconY + headerIconSize) {
        const ix = x - hIconX
        const iy = y - hIconY
        const offset = (iy * headerIconSize + ix) * 4
        const b = headerIconBitmap[offset]
        const g = headerIconBitmap[offset + 1]
        const r = headerIconBitmap[offset + 2]
        const a = headerIconBitmap[offset + 3] / 255

        const outR = Math.round(r * a + bgR * (1 - a))
        const outG = Math.round(g * a + bgG * (1 - a))
        const outB = Math.round(b * a + bgB * (1 - a))
        return [outR, outG, outB]
      }

      return [bgR, bgG, bgB]
    })

    fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), headerBMP)
    console.log('[Assets] Created installerHeader.bmp')

    app.quit()
  } catch (err) {
    console.error('[Assets] Error:', err)
    process.exit(1)
  }
})

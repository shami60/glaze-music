// LEGACY logo pipeline — superseded by the current artwork.
// These wrote assets/icon.png, icon-256.png and tray-icon.png from a square
// source image with no transparency, which is why the icons now ship from
// `assets/icon-source.png` instead (a pre-masked, transparent 1024px master).
// Running one of these will overwrite the shipped icons with a square version.
const { app, nativeImage } = require('electron')
const fs = require('fs')
const path = require('path')

app.whenReady().then(async () => {
  try {
    // Source image comes from the command line — never bake a machine path in
    // here, this file is published.
    const inputPath = process.argv[2]
    if (!inputPath) {
      console.error('Usage: electron ' + path.relative(process.cwd(), __filename) + ' <source-image>')
      process.exit(1)
    }
    const root = path.resolve(__dirname, '..')
    const assetsDir = path.join(root, 'assets')
    const buildDir = path.join(root, 'build')
    const publicDir = path.join(root, 'public')

    const rawImg = nativeImage.createFromPath(inputPath)
    const { width, height } = rawImg.getSize()
    const bitmap = rawImg.toBitmap()
    const cx = width / 2
    const cy = height / 2

    // The circle outer boundary
    const outerRadius = (width / 2) * 0.916
    const innerRadius = outerRadius - 2.5

    const outputBitmap = Buffer.alloc(bitmap.length)

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        const b = bitmap[offset]
        const g = bitmap[offset + 1]
        const r = bitmap[offset + 2]

        const dist = Math.hypot(x - cx, y - cy)

        let alpha = 255

        if (dist > outerRadius) {
          alpha = 0
        } else if (dist > innerRadius) {
          const t = (outerRadius - dist) / (outerRadius - innerRadius)
          alpha = Math.round(255 * Math.max(0, Math.min(1, t)))

          // If near the edge and has white background component, remove white
          if (r > 200 && g > 200 && b > 200) {
            const whiteness = Math.min(r, Math.min(g, b)) / 255
            alpha = Math.round(alpha * (1 - whiteness * 0.95))
          }
        } else {
          alpha = 255
        }

        outputBitmap[offset] = b
        outputBitmap[offset + 1] = g
        outputBitmap[offset + 2] = r
        outputBitmap[offset + 3] = alpha
      }
    }

    const processedImg = nativeImage.createFromBitmap(outputBitmap, { width, height })
    
    // 512x512 Master PNG
    const png512 = processedImg.resize({ width: 512, height: 512, quality: 'best' }).toPNG()
    // 256x256 Icon PNG
    const png256 = processedImg.resize({ width: 256, height: 256, quality: 'best' }).toPNG()

    fs.writeFileSync(path.join(assetsDir, 'icon.png'), png512)
    fs.writeFileSync(path.join(assetsDir, 'icon-256.png'), png256)
    fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), png256)
    fs.writeFileSync(path.join(publicDir, 'icon.png'), png512)

    console.log('[Logo Processing] Saved crisp transparent PNGs!')

    // ── Generate Installer BMP Theme Graphics with the new Logo ───────────────
    function create24BitBMP(bmpW, bmpH, getRGB) {
      const rowSize = Math.floor((bmpW * 3 + 3) / 4) * 4
      const imageSize = rowSize * bmpH
      const fileSize = 54 + imageSize
      const buf = Buffer.alloc(fileSize)

      buf.write('BM', 0)
      buf.writeUInt32LE(fileSize, 2)
      buf.writeUInt16LE(0, 6)
      buf.writeUInt16LE(0, 8)
      buf.writeUInt32LE(54, 10)

      buf.writeUInt32LE(40, 14)
      buf.writeInt32LE(bmpW, 18)
      buf.writeInt32LE(bmpH, 22)
      buf.writeUInt16LE(1, 26)
      buf.writeUInt16LE(24, 28)
      buf.writeUInt32LE(0, 30)
      buf.writeUInt32LE(imageSize, 34)
      buf.writeInt32LE(2835, 38)
      buf.writeInt32LE(2835, 42)
      buf.writeUInt32LE(0, 46)
      buf.writeUInt32LE(0, 50)

      for (let y = 0; y < bmpH; y++) {
        const sourceY = bmpH - 1 - y
        const rowOffset = 54 + y * rowSize
        for (let x = 0; x < bmpW; x++) {
          const [r, g, b] = getRGB(x, sourceY)
          const pxOffset = rowOffset + x * 3
          buf[pxOffset] = Math.max(0, Math.min(255, b))
          buf[pxOffset + 1] = Math.max(0, Math.min(255, g))
          buf[pxOffset + 2] = Math.max(0, Math.min(255, r))
        }
      }
      return buf
    }

    // 1. Sidebar BMP (164x314)
    const sideIconSize = 136
    const sideIcon = processedImg.resize({ width: sideIconSize, height: sideIconSize, quality: 'best' })
    const sideBitmap = sideIcon.toBitmap()
    const sideW = 164
    const sideH = 314
    const sideX = Math.floor((sideW - sideIconSize) / 2)
    const sideY = 46

    const sidebarBMP = create24BitBMP(sideW, sideH, (x, y) => {
      const t = y / sideH
      let bgR = Math.round(28 * (1 - t) + 10 * t)
      let bgG = Math.round(14 * (1 - t) + 8 * t)
      let bgB = Math.round(44 * (1 - t) + 20 * t)

      const dx = x - (sideW / 2)
      const dy = y - (sideY + sideIconSize / 2)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 90) {
        const glow = Math.pow(1 - dist / 90, 2) * 0.4
        bgR += Math.round(210 * glow)
        bgG += Math.round(50 * glow)
        bgB += Math.round(190 * glow)
      }

      if (x >= sideX && x < sideX + sideIconSize && y >= sideY && y < sideY + sideIconSize) {
        const ix = x - sideX
        const iy = y - sideY
        const offset = (iy * sideIconSize + ix) * 4
        const b = sideBitmap[offset]
        const g = sideBitmap[offset + 1]
        const r = sideBitmap[offset + 2]
        const a = sideBitmap[offset + 3] / 255

        const outR = Math.round(r * a + bgR * (1 - a))
        const outG = Math.round(g * a + bgG * (1 - a))
        const outB = Math.round(b * a + bgB * (1 - a))
        return [outR, outG, outB]
      }

      return [bgR, bgG, bgB]
    })

    fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBMP)
    fs.writeFileSync(path.join(buildDir, 'uninstallerSidebar.bmp'), sidebarBMP)

    // 2. Header BMP (150x57)
    const headIconSize = 46
    const headIcon = processedImg.resize({ width: headIconSize, height: headIconSize, quality: 'best' })
    const headBitmap = headIcon.toBitmap()
    const headW = 150
    const headH = 57
    const headX = headW - headIconSize - 8
    const headY = Math.floor((headH - headIconSize) / 2)

    const headerBMP = create24BitBMP(headW, headH, (x, y) => {
      let bgR = 18
      let bgG = 17
      let bgB = 28

      if (x >= headX && x < headX + headIconSize && y >= headY && y < headY + headIconSize) {
        const ix = x - headX
        const iy = y - headY
        const offset = (iy * headIconSize + ix) * 4
        const b = headBitmap[offset]
        const g = headBitmap[offset + 1]
        const r = headBitmap[offset + 2]
        const a = headBitmap[offset + 3] / 255

        const outR = Math.round(r * a + bgR * (1 - a))
        const outG = Math.round(g * a + bgG * (1 - a))
        const outB = Math.round(b * a + bgB * (1 - a))
        return [outR, outG, outB]
      }

      return [bgR, bgG, bgB]
    })

    fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), headerBMP)
    console.log('[Logo Processing] Re-created installer graphics cleanly!')

    app.quit()
  } catch (err) {
    console.error('[Logo Processing] Error:', err)
    process.exit(1)
  }
})

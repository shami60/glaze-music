#!/usr/bin/env python3
"""Regenerate every shipped icon from one square piece of artwork.

    python scripts/build-icons.py [source-image]

Defaults to `design/icon-artwork.jpg`. The transparent master it derives is kept
in `design/` rather than `assets/` on purpose: `assets/` is copied verbatim into
the packaged app via `extraResources`, so a 700 KB master parked there would ship
with every install and never be read.

Why a script: the icon has to exist in six places (window, taskbar, tray, ICO,
renderer, installer) and they must never drift apart. It also documents the two
non-obvious steps below, which is the part that is easy to get wrong by hand.

Two things this handles that a plain resize does not:

1. **The artwork arrives on a black background.** Keying out black by luminance
   would punch holes in the music note, which is itself black — so the alpha
   comes from a geometric circle fitted to the disc instead.
2. **The rim picks up a black fringe** where the source blends into that
   background. The mask is eroded ~3px so the cut lands inside the fringe;
   otherwise the icon shows a dark outline on light backgrounds.

Requires Pillow:  python -m pip install pillow
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICON_BOLD = Path(r"C:\Windows\Fonts\seguisb.ttf")

# The disc occupies most of the frame but not all of it, and it is not perfectly
# centred — so the circle is measured, not assumed. Values are for the 1254px
# master artwork; they are scaled if the source differs.
MASTER_SIZE = 1254
DISC_BBOX = (72, 57, 1179, 1162)
RIM_ERODE = 3.0
PADDING = 0.035      # breathing room around the disc, matching the old icons
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def build_master(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGB")
    scale = im.width / MASTER_SIZE
    x0, y0, x1, y1 = (v * scale for v in DISC_BBOX)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r = max(x1 - x0, y1 - y0) / 2 - RIM_ERODE * scale

    # Supersample the mask so the edge is clean at 16px as well as 512px.
    s = 4
    mask = Image.new("L", (im.width * s, im.height * s), 0)
    ImageDraw.Draw(mask).ellipse(
        [(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s], fill=255
    )

    icon = im.convert("RGBA")
    icon.putalpha(mask.resize(im.size, Image.LANCZOS))

    # Crop square around the disc, keeping the disc radius (not the eroded one)
    # so the padding stays constant regardless of RIM_ERODE.
    full = max(x1 - x0, y1 - y0) / 2
    pad = full * 2 * PADDING
    icon = icon.crop(
        (int(cx - full - pad), int(cy - full - pad), int(cx + full + pad), int(cy + full + pad))
    )
    return icon.resize((1024, 1024), Image.LANCZOS)


def vgrad(size, top, bottom):
    w, h = size
    strip = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        strip.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return strip.resize((w, h), Image.BILINEAR)


def tracked(draw, text, font, y, fill, tracking, width):
    widths = [draw.textlength(ch, font=font) for ch in text]
    x = (width - (sum(widths) + tracking * (len(text) - 1))) / 2
    for ch, w in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += w + tracking


def build_installer(master: Image.Image) -> None:
    # NSIS header strip: flat panel, icon on the right.
    hdr = Image.new("RGB", (150, 57), (18, 17, 28))
    ic = master.resize((46, 46), Image.LANCZOS)
    hdr.paste(ic, (99, 5), ic)
    hdr.save(ROOT / "build/installerHeader.bmp")

    # NSIS sidebar: the same vertical gradient as before, icon + wordmark.
    side = vgrad((164, 314), (26, 14, 44), (10, 8, 20)).convert("RGBA")
    cy, size = 104, 132
    glow = Image.new("RGBA", side.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([82 - 64, cy - 64, 82 + 64, cy + 64], fill=(120, 90, 255, 78))
    side.alpha_composite(glow.filter(ImageFilter.GaussianBlur(20)))
    ic = master.resize((size, size), Image.LANCZOS)
    side.alpha_composite(ic, (82 - size // 2, cy - size // 2))

    d = ImageDraw.Draw(side)
    tracked(d, "GLAZE", ImageFont.truetype(str(ICON_BOLD), 21), 208, (240, 238, 250, 255), 3.4, 164)
    tracked(d, "MUSIC", ImageFont.truetype(str(ICON_BOLD), 9), 237, (170, 160, 208, 255), 3.0, 164)

    for name in ("installerSidebar.bmp", "uninstallerSidebar.bmp"):
        side.convert("RGB").save(ROOT / "build" / name)


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "design/icon-artwork.jpg"
    if not src.exists():
        print(__doc__)
        print(f"missing artwork: {src}")
        return 1

    master = build_master(src)
    master.save(ROOT / "design/icon-source.png")

    for size, rel in [
        (512, "assets/icon.png"),
        (256, "assets/icon-256.png"),
        (256, "assets/tray-icon.png"),
        (512, "public/icon.png"),
    ]:
        master.resize((size, size), Image.LANCZOS).save(ROOT / rel)

    master.save(ROOT / "assets/icon.ico", format="ICO", sizes=ICO_SIZES)
    build_installer(master)

    print("wrote:")
    for rel in ("design/icon-source.png", "assets/icon.png", "assets/icon-256.png",
                "assets/tray-icon.png", "assets/icon.ico", "public/icon.png",
                "build/installerHeader.bmp", "build/installerSidebar.bmp",
                "build/uninstallerSidebar.bmp"):
        print("  " + rel)
    return 0


if __name__ == "__main__":
    sys.exit(main())

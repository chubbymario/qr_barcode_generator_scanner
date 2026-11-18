"""Draw the app icons (favicon.svg plus PNGs for the installable app).

Run with: python3 scripts/make-icons.py   (needs Pillow: pip install pillow)
The mark is a tiny QR-like glyph on the app's ink colour with a magenta corner tick.
"""

from pathlib import Path
from PIL import Image, ImageDraw

INK = (27, 42, 65)
PAPER = (255, 255, 255)
MARK = (200, 31, 99)
OUT = Path(__file__).resolve().parent.parent / "public"

# Glyph on a 24-unit grid: (x, y, w, h), drawn in paper colour.
SOLID = [(3, 3, 7, 7), (14, 3, 7, 7), (3, 14, 7, 7)]
HOLES = [(5, 5, 3, 3), (16, 5, 3, 3), (5, 16, 3, 3)]
BITS = [(14, 14, 2, 2), (18, 14, 3, 2), (14, 18, 2, 3), (17, 17, 2, 2), (19, 19, 2, 2)]


def svg() -> str:
    rects = []
    for x, y, w, h in SOLID + BITS:
        rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#fff"/>')
    for x, y, w, h in HOLES:
        rects.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#1b2a41"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30">'
        '<rect x="-3" y="-3" width="30" height="30" rx="6" fill="#1b2a41"/>'
        + "".join(rects)
        + '<path d="M22.5 25.5h3v-3" fill="none" stroke="#ff5c99" stroke-width="1.2"/>'
        "</svg>\n"
    )


def png(size: int, padding: float, rounded: bool) -> Image.Image:
    scale = 4  # supersample, then shrink for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.2), fill=INK)
    else:
        d.rectangle((0, 0, s, s), fill=INK)
    inner = s * (1 - 2 * padding)
    unit = inner / 24
    off = s * padding

    def box(r, colour):
        x, y, w, h = r
        d.rectangle((off + x * unit, off + y * unit, off + (x + w) * unit - 1, off + (y + h) * unit - 1), fill=colour)

    for r in SOLID + BITS:
        box(r, PAPER)
    for r in HOLES:
        box(r, INK)
    t = max(2, int(unit * 1.2))
    cx, cy = off + 24 * unit, off + 24 * unit
    d.rectangle((cx - 3 * unit, cy - t / 2, cx, cy + t / 2), fill=MARK)
    d.rectangle((cx - t / 2, cy - 3 * unit, cx + t / 2, cy), fill=MARK)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "favicon.svg").write_text(svg(), encoding="utf-8")
    png(192, 0.12, True).save(OUT / "pwa-192.png")
    png(512, 0.12, True).save(OUT / "pwa-512.png")
    png(512, 0.22, False).save(OUT / "pwa-maskable-512.png")
    png(180, 0.14, False).save(OUT / "apple-touch-icon.png")
    print("Icons written to", OUT)


if __name__ == "__main__":
    main()

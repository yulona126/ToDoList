#!/usr/bin/env python3
"""Regenerate every static brand asset for the ToDoList PWA.

Deterministic, offline, font-independent: the logo is drawn from primitives
(rounded rectangle + two thick round-capped line segments), never from a glyph.

Run with the bundled interpreter (Pillow is preinstalled):

    /Users/yulon/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3 \
        frontend/scripts/generate-icons.py

Design: monochrome black & white, "a good tool, not a product" (design-system.md).
  * icon-192 / icon-512      rounded black square, transparent margin, white check
  * maskable-512             full-bleed opaque black, glyph inside the 80% safe zone
  * apple-touch-icon         full-bleed opaque black (iOS applies its own mask)
  * favicon.svg              hand-written SVG of the same mark
  * robots.txt               crawl policy (API/admin/settings are not public pages)
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

# --- geometry constants (shared with public/favicon.svg) ---------------------
MARGIN_RATIO = 0.08  # transparent margin around the rounded square
RADIUS_RATIO = 0.22  # corner radius, relative to the square side
STROKE_RATIO = 0.14  # check-mark stroke width, relative to the square side
# Check-mark joints, normalised inside the (square) glyph box.
CHECK_POINTS = ((0.30, 0.53), (0.44, 0.68), (0.73, 0.32))

BLACK = (10, 10, 10, 255)
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)

SUPERSAMPLE = 4  # draw big, downscale with LANCZOS → antialiased edges

FRONTEND_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = FRONTEND_DIR / "public"
ICONS_DIR = PUBLIC_DIR / "icons"

# Raster icons live in `public/icons/` only — that is the canonical path used by
# the web app manifest (vite.config.ts) and by index.html's apple-touch-icon.
RASTER_TARGET_DIRS = (ICONS_DIR,)


def draw_check(
    draw: ImageDraw.ImageDraw,
    box: tuple[float, float, float, float],
    colour: tuple[int, int, int, int],
) -> None:
    """Draw a bold, round-capped check mark inside `box` (x0, y0, x1, y1)."""
    x0, y0, x1, y1 = box
    side = min(x1 - x0, y1 - y0)
    width = STROKE_RATIO * side
    points = [
        (x0 + px * (x1 - x0), y0 + py * (y1 - y0)) for px, py in CHECK_POINTS
    ]
    draw.line(points, fill=colour, width=int(round(width)), joint="curve")
    # Pillow's line() has butt caps: add discs at every joint for round caps.
    radius = width / 2
    for cx, cy in points:
        draw.ellipse(
            (cx - radius, cy - radius, cx + radius, cy + radius), fill=colour
        )


def rounded_icon(size: int) -> Image.Image:
    """Rounded black square with a transparent margin + white check."""
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), TRANSPARENT)
    draw = ImageDraw.Draw(image)

    inset = MARGIN_RATIO * canvas
    side = canvas - 2 * inset
    radius = RADIUS_RATIO * side
    draw.rounded_rectangle(
        (inset, inset, inset + side, inset + side),
        radius=radius,
        fill=BLACK,
    )

    glyph_side = side * 0.62
    offset = (canvas - glyph_side) / 2
    draw_check(
        draw,
        (offset, offset, offset + glyph_side, offset + glyph_side),
        WHITE,
    )
    return image.resize((size, size), Image.LANCZOS)


def full_bleed_icon(size: int, glyph_ratio: float) -> Image.Image:
    """Opaque, edge-to-edge black square with a centred white check.

    `glyph_ratio` is the glyph box width relative to the canvas: <= 0.6 keeps it
    inside the maskable safe zone (80% central area).
    """
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), BLACK)
    draw = ImageDraw.Draw(image)

    glyph_side = canvas * glyph_ratio
    offset = (canvas - glyph_side) / 2
    draw_check(
        draw,
        (offset, offset, offset + glyph_side, offset + glyph_side),
        WHITE,
    )
    return image.resize((size, size), Image.LANCZOS)


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="ToDoList">
  <title>ToDoList</title>
  <rect x="2" y="2" width="28" height="28" rx="6.2" fill="#0a0a0a"/>
  <path d="M9.9 16.6 14.3 21.3 22.7 10.7" fill="none" stroke="#ffffff" stroke-width="3.9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""

ROBOTS_TXT = """User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /settings
"""


def write_png(image: Image.Image, filename: str) -> list[Path]:
    written: list[Path] = []
    for directory in RASTER_TARGET_DIRS:
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / filename
        image.save(path, format="PNG", optimize=True)
        written.append(path)
    return written


def main() -> int:
    jobs: list[tuple[str, Image.Image]] = [
        ("icon-192.png", rounded_icon(192)),
        ("icon-512.png", rounded_icon(512)),
        ("maskable-512.png", full_bleed_icon(512, glyph_ratio=0.50)),
        ("apple-touch-icon.png", full_bleed_icon(180, glyph_ratio=0.56)),
    ]

    written: list[Path] = []
    for filename, image in jobs:
        written.extend(write_png(image, filename))

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    favicon = PUBLIC_DIR / "favicon.svg"
    favicon.write_text(FAVICON_SVG, encoding="utf-8")
    written.append(favicon)

    robots = PUBLIC_DIR / "robots.txt"
    robots.write_text(ROBOTS_TXT, encoding="utf-8")
    written.append(robots)

    for path in written:
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

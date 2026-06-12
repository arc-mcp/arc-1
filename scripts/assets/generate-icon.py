#!/usr/bin/env python3
"""Generate icon.png for the ARC-1 MCPB bundle and Claude Code plugin listing.

Renders a rounded SAP-blue tile with a white "ARC-1" wordmark at 512x512, using 4x
supersampling for crisp anti-aliased edges. Requires Pillow (`pip install pillow`).

Run from the repo root:  python3 scripts/assets/generate-icon.py
"""

import os

from PIL import Image, ImageDraw, ImageFont

SIZE = 512
SS = 4  # supersample factor
W = SIZE * SS

TOP = (10, 110, 209)  # SAP blue #0A6ED1
BOTTOM = (5, 59, 107)  # deeper blue for subtle depth

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(px: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    # No bundled candidate font on this host. ImageFont.load_default() ignores `px` and would
    # render a ~10px wordmark on the 2048px canvas — an effectively blank icon, committed with no
    # error. Fail loudly instead: install one of the fonts above (e.g. DejaVu Sans Bold) and re-run.
    raise SystemExit(f"generate-icon: no usable font found. Install one of: {', '.join(FONT_CANDIDATES)}")


def main() -> None:
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # vertical gradient background
    for y in range(W):
        t = y / (W - 1)
        draw.line(
            [(0, y), (W, y)],
            fill=(
                round(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
                round(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
                round(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
                255,
            ),
        )

    # rounded-corner alpha mask
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=round(W * 0.22), fill=255)
    img.putalpha(mask)

    # centered "ARC-1" wordmark, shrunk to fit width with margin
    draw = ImageDraw.Draw(img)
    text = "ARC-1"
    margin = round(W * 0.13)
    size = round(W * 0.30)
    font = load_font(size)
    while size > 12:
        box = draw.textbbox((0, 0), text, font=font)
        if (box[2] - box[0]) <= W - 2 * margin:
            break
        size -= 8
        font = load_font(size)

    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x = (W - tw) // 2 - box[0]
    y = (W - th) // 2 - box[1]
    draw.text((x + SS * 2, y + SS * 3), text, font=font, fill=(0, 0, 0, 70))  # soft shadow
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))

    out = img.resize((SIZE, SIZE), Image.LANCZOS)
    dest = os.path.join(os.getcwd(), "icon.png")
    out.save(dest)
    print(f"wrote {dest} ({out.size[0]}x{out.size[1]})")


if __name__ == "__main__":
    main()

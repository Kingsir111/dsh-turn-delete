"""Prepare the generated chibi mascot: key the flat white backdrop out, recolour
the drawn "?" to the plugin's blue, feather the edge, save a transparent PNG.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(__file__).resolve().parents[1] / "docs" / "design" / "moss-lora-a.png"
OUT = Path(__file__).resolve().parents[1] / "docs" / "design" / "mascot.png"

WHITE_TOLERANCE = 14
BLUE = np.array([77, 107, 254], dtype=np.uint8)

image = Image.open(SRC).convert("RGB")
w, h = image.size

# Flood the connected white background from the border. Interior whites (apron,
# headdress) are enclosed by the dark lineart, so they survive.
work = image.copy()
MAGIC = (255, 0, 255)
for x in range(0, w, 4):
    for y in (0, h - 1):
        if work.getpixel((x, y)) != MAGIC:
            ImageDraw.floodfill(work, (x, y), MAGIC, thresh=WHITE_TOLERANCE)
for y in range(0, h, 4):
    for x in (0, w - 1):
        if work.getpixel((x, y)) != MAGIC:
            ImageDraw.floodfill(work, (x, y), MAGIC, thresh=WHITE_TOLERANCE)

pixels = np.array(image)
is_bg = np.all(np.array(work) == np.array(MAGIC), axis=-1)

# The "?" is drawn in warm yellow; move it into the blue theme.
r, g, b = pixels[..., 0].astype(int), pixels[..., 1].astype(int), pixels[..., 2].astype(int)
is_warm = (r > 150) & (g > 100) & (b < 140) & ((r - b) > 55)
pixels[is_warm] = BLUE

alpha = np.where(is_bg, 0, 255).astype(np.uint8)
alpha_image = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.1))

rgba = Image.fromarray(pixels, "RGB").convert("RGBA")
rgba.putalpha(alpha_image)

bbox = rgba.getbbox()
if bbox is not None:
    rgba = rgba.crop(bbox)

rgba.save(OUT)
print(f"keyed {100 * is_bg.mean():.1f}% background · recoloured {100 * is_warm.mean():.2f}% pixels")
print(f"mascot: {OUT} ({rgba.size[0]}x{rgba.size[1]}, {OUT.stat().st_size / 1024:.1f} KB)")


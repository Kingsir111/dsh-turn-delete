"""Turn the whale-girl reference into a clean die-cut sticker for the dialog.

Steps: estimate the flat backdrop colour from the crop border, key every pixel
close to it (so pockets between hair strands go too), feather the edge, then add
a white sticker outline so any residual fringe reads as intentional.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path(
    r"C:\Users\HP\.dsh\attachments\v1\objects\5a"
    r"\5aeabe2b79ef74bce0a2c7cef92fe22600e43b951f1c33fb42dd8a18c7bef476"
)
OUT = Path(__file__).resolve().parents[1] / "docs" / "design" / "mascot-peek.png"

BOX = (120, 10, 660, 520)   # head, shoulders, hair spread
DIST = 34                    # colour distance that still counts as backdrop
OUTLINE = 9                  # white sticker rim, in pixels

image = Image.open(SRC).convert("RGB").crop(BOX)
pixels = np.asarray(image).astype(np.int16)
h, w, _ = pixels.shape

border = np.concatenate([
    pixels[0, :, :], pixels[-1, :, :], pixels[:, 0, :], pixels[:, -1, :],
])
backdrop = np.median(border, axis=0)
distance = np.sqrt(((pixels - backdrop) ** 2).sum(axis=-1))
is_backdrop = distance < DIST

alpha = np.where(is_backdrop, 0, 255).astype(np.uint8)
alpha_image = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(1.4))

rgba = image.convert("RGBA")
rgba.putalpha(alpha_image)

# White sticker rim: dilate the alpha, paint it white behind the character.
rim = alpha_image.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 1))
sticker = Image.new("RGBA", rgba.size, (255, 255, 255, 0))
white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
sticker.paste(white, (0, 0), rim)
sticker.alpha_composite(rgba)

bbox = sticker.getbbox()
if bbox is not None:
    sticker = sticker.crop(bbox)

sticker.save(OUT)
print(f"backdrop median {tuple(int(v) for v in backdrop)}  keyed {100 * is_backdrop.mean():.1f}% of pixels")
print(f"mascot: {OUT} ({sticker.size[0]}x{sticker.size[1]}, {OUT.stat().st_size / 1024:.1f} KB)")

"""Clip the whale-girl head into a round sticker badge for the dialog corner.

A gradient backdrop cannot be keyed cleanly out of a flat illustration, and the
requested "peeking + pointing" pose needs the image model (currently offline), so
the layout uses a round badge while placement is agreed on.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SRC = Path(
    r"C:\Users\HP\.dsh\attachments\v1\objects\5a"
    r"\5aeabe2b79ef74bce0a2c7cef92fe22600e43b951f1c33fb42dd8a18c7bef476"
)
OUT = Path(__file__).resolve().parents[1] / "docs" / "design" / "mascot-badge.png"

HEAD = (196, 40, 556, 400)   # face + headdress + hair frame
SIZE = 420                   # output square
RING = 10                    # white ring width

image = Image.open(SRC).convert("RGB").crop(HEAD).resize((SIZE, SIZE), Image.LANCZOS)
rgba = image.convert("RGBA")

mask = Image.new("L", (SIZE, SIZE), 0)
draw = ImageDraw.Draw(mask)
draw.ellipse((RING, RING, SIZE - RING, SIZE - RING), fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.2))
rgba.putalpha(mask)

badge = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
white = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
ring = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(ring).ellipse((0, 0, SIZE - 1, SIZE - 1), fill=255)
badge.paste(white, (0, 0), ring)
badge.alpha_composite(rgba)

badge = badge.crop(badge.getbbox())
badge.save(OUT)
print(f"badge: {OUT} ({badge.size[0]}x{badge.size[1]}, {OUT.stat().st_size / 1024:.1f} KB)")

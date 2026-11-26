"""Build the storefront assets required by the awesome-dsh-plugin list.

The list refuses vector icons, so the shipped icon.svg is redrawn here as a
512x512 PNG, and two stills are lifted from the demo GIF for screenshots.json.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

S = 4  # supersample factor
BOX = 512

BG = (238, 242, 255)
BAR1 = (199, 210, 254)
BAR2 = (165, 180, 252)
ACCENT = (59, 63, 216)


def icon():
    image = Image.new("RGBA", (BOX * S, BOX * S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def p(value):
        return value * S

    draw.rounded_rectangle((0, 0, p(BOX), p(BOX)), radius=p(112), fill=BG)
    # three conversation rows, each shorter than the last
    for index, (width, color) in enumerate([(288, BAR1), (200, BAR2), (128, BAR2)]):
        top = 132 + index * 76
        draw.rounded_rectangle((p(96), p(top), p(96 + width), p(top + 52)), radius=p(26), fill=color)
    # trash glyph in the lower right, matching icon.svg
    stroke = p(12)
    draw.line((p(300), p(300), p(444), p(300)), fill=ACCENT, width=stroke)
    draw.line((p(350), p(280), p(394), p(280)), fill=ACCENT, width=stroke)
    draw.line((p(322), p(300), p(330), p(404)), fill=ACCENT, width=stroke)
    draw.line((p(422), p(300), p(414), p(404)), fill=ACCENT, width=stroke)
    draw.line((p(330), p(404), p(414), p(404)), fill=ACCENT, width=stroke)
    out = ASSETS / "icon-512.png"
    image.resize((BOX, BOX), Image.LANCZOS).save(out)
    return out


def screenshots():
    gif_path = ROOT / "docs" / "demo.gif"
    gif = Image.open(gif_path)
    written = []
    for index, number in ((0, 1), (3, 2)):
        gif.seek(index)
        out = ASSETS / f"screenshot-{number}.png"
        gif.convert("RGB").save(out)
        written.append(out)
    return written


if __name__ == "__main__":
    icon_path = icon()
    print(f"icon: {icon_path} ({icon_path.stat().st_size / 1024:.1f} KB)")
    for path in screenshots():
        print(f"shot: {path} ({path.stat().st_size / 1024:.1f} KB)")

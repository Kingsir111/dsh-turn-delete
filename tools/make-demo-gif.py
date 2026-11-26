"""Redraw docs/demo.gif for the 0.9.x flow: trash → pick floors → confirm → gone.

Frames are drawn from primitives (no screen capture), so the GIF stays small and
never leaks a real session.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "docs" / "demo.gif"
W, H = 760, 470
SCALE = 2  # draw at 2x, downscale for smoother text

FONT = "C:/Windows/Fonts/msyh.ttc"
BOLD = "C:/Windows/Fonts/msyhbd.ttc"


def font(size, bold=False):
    try:
        return ImageFont.truetype(BOLD if bold else FONT, size * SCALE)
    except OSError:
        return ImageFont.load_default()


BLUE = (77, 107, 254)
BLUE_SOFT = (201, 216, 255)
INK = (22, 32, 74)
MUTED = (107, 118, 153)
BG = (246, 249, 255)
CARD = (255, 255, 255)
LINE = (227, 233, 248)


def card(draw, box, radius=12, fill=CARD, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw, xy, content, size=13, color=INK, bold=False, anchor="la"):
    draw.text(xy, content, font=font(size, bold), fill=color, anchor=anchor)


def bubble(draw, x, y, content, mine=False, width=None):
    pad = 12
    f = font(13)
    w = width if width is not None else int(draw.textlength(content, font=f)) + pad * 2 + 2 * SCALE
    h = 30 * SCALE
    box = [x, y, x + w, y + h]
    card(draw, box, radius=14, fill=(232, 239, 255) if mine else (243, 246, 255))
    text(draw, (x + pad, y + h // 2), content, 13, (42, 53, 96), anchor="lm")
    return box


def trash(draw, cx, cy, color=MUTED):
    draw.line([(cx - 6 * SCALE, cy - 5 * SCALE), (cx + 6 * SCALE, cy - 5 * SCALE)], fill=color, width=2 * SCALE)
    draw.line([(cx - 4 * SCALE, cy - 5 * SCALE), (cx - 3 * SCALE, cy + 6 * SCALE)], fill=color, width=2 * SCALE)
    draw.line([(cx + 4 * SCALE, cy - 5 * SCALE), (cx + 3 * SCALE, cy + 6 * SCALE)], fill=color, width=2 * SCALE)
    draw.line([(cx - 3 * SCALE, cy + 6 * SCALE), (cx + 3 * SCALE, cy + 6 * SCALE)], fill=color, width=2 * SCALE)


FLOOR_HEIGHT = 96  # label + two chat lines + gap


def floor(draw, y, label, lines, mine=False, picked=False, hovered=False):
    """One chat floor in device pixels: turn label, user line, assistant line."""
    if picked:
        card(draw, [14 * SCALE, y - 4 * SCALE, (W - 14) * SCALE, y + 88 * SCALE], radius=12,
             fill=(238, 243, 255), outline=BLUE, width=2 * SCALE)
    text(draw, (30 * SCALE, y + 4 * SCALE), label, 11, MUTED)
    first = bubble(draw, (300 if mine else 34) * SCALE, y + 20 * SCALE, lines[0], mine=mine)
    bubble(draw, 34 * SCALE, y + 56 * SCALE, lines[1], mine=False)
    if hovered:
        trash(draw, first[2] - 16 * SCALE, y + 35 * SCALE, BLUE)
    return y + FLOOR_HEIGHT * SCALE


def bottom_bar(draw, count):
    top = (H - 52) * SCALE
    card(draw, [0, top, W * SCALE, H * SCALE], radius=0, fill=(255, 255, 255))
    draw.line([(0, top), (W * SCALE, top)], fill=LINE, width=SCALE)
    text(draw, (22 * SCALE, top + 26 * SCALE), f"已选 {count} 轮", 13, BLUE, bold=True, anchor="lm")
    text(draw, (110 * SCALE, top + 26 * SCALE), "点任意一轮选中，再点取消；可多选", 11, MUTED, anchor="lm")
    for label, right, primary in (("确认删除", 22, True), ("退出", 108, False)):
        f = font(12)
        w = int(draw.textlength(label, font=f)) + 26 * SCALE
        x2 = (W - right) * SCALE
        box = [x2 - w, top + 12 * SCALE, x2, top + 40 * SCALE]
        card(draw, box, radius=9, fill=BLUE if primary else (255, 255, 255),
             outline=None if primary else LINE, width=SCALE)
        text(draw, ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), label, 12,
             (255, 255, 255) if primary else (58, 70, 116), anchor="mm")


def dialog(draw, count):
    draw.rectangle([0, 0, W * SCALE, H * SCALE], fill=(206, 216, 240))
    w, h = 420 * SCALE, 190 * SCALE
    x = (W * SCALE - w) // 2
    y = (H * SCALE - h) // 2
    card(draw, [x, y, x + w, y + h], radius=16, fill=(255, 255, 255), outline=BLUE_SOFT, width=2 * SCALE)
    text(draw, (x + 22 * SCALE, y + 24 * SCALE), f"删除 {count} 轮对话？", 16, INK, bold=True)
    body = ["这些轮次会从后续模型上下文中移除，Session、标题与", "之后的轮次都保留。原始日志仍可审计、可回放。"]
    for index, line_text in enumerate(body):
        text(draw, (x + 22 * SCALE, y + (56 + index * 20) * SCALE), line_text, 12, (58, 70, 116))
    tags = "  ".join(f"第 {n} 轮" for n in (2, 4))
    text(draw, (x + 22 * SCALE, y + 104 * SCALE), tags, 11, BLUE)
    text(draw, (x + 22 * SCALE, y + 130 * SCALE), "不可撤销 · 只影响上下文，不改写日志", 11, MUTED)
    for label, right, primary in (("删除 2 轮", 22, True), ("取消", 116, False)):
        f = font(12)
        bw = int(draw.textlength(label, font=f)) + 28 * SCALE
        x2 = x + w - right * SCALE
        box = [x2 - bw, y + h - 46 * SCALE, x2, y + h - 16 * SCALE]
        card(draw, box, radius=9, fill=BLUE if primary else (255, 255, 255),
             outline=None if primary else LINE, width=SCALE)
        text(draw, ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2), label, 12,
             (255, 255, 255) if primary else (58, 70, 116), anchor="mm")


def frame(step):
    image = Image.new("RGB", (W * SCALE, H * SCALE), BG)
    draw = ImageDraw.Draw(image)
    card(draw, [10 * SCALE, 10 * SCALE, (W - 10) * SCALE, (H - 10) * SCALE], radius=16, fill=(250, 252, 255))

    lines = [
        ("第 1 轮", ["继续聊聊 A 的细节", "好的，A 的第一步是…"], False),
        ("第 2 轮", ["B 那个游戏的文件怎么清", "先看存档目录，然后…"], True),
        ("第 3 轮", ["那 A 的第三步呢", "第三步是…"], True),
        ("第 4 轮", ["顺手问了句 B 的存档", "存档在 AppData 下面"], False),
    ]

    y = 20 * SCALE
    picked_turns = {2: step >= 3, 4: step >= 4}
    for index, (label, content, mine) in enumerate(lines, start=1):
        if step >= 5 and index in (2, 3):
            continue
        picked = picked_turns.get(index, False) and step < 5
        hovered = step == 1 and index == 2
        y = floor(draw, y, label, content, mine=mine, picked=picked, hovered=hovered)

    if step >= 2:
        bottom_bar(draw, 0 if step == 2 else (1 if step == 3 else 2))
    if step == 4:
        dialog(draw, 2)
    return image.resize((W, H), Image.LANCZOS)


def main():
    frames = [frame(step) for step in (1, 2, 3, 4, 5)]
    durations = [900, 800, 800, 1500, 1800]
    frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, optimize=True, disposal=2)
    print(f"{OUT}  {OUT.stat().st_size / 1024:.1f} KB  frames={len(frames)}  {W}x{H}")


if __name__ == "__main__":
    main()




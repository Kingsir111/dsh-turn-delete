"""Render a reconstructed demo GIF for the README.

Mirrors the real interaction: action row -> confirm pill -> row replaced by a
"deleted from context" chip. Redrawn mockup, not a screen recording.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 760, 470
S = 2

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]

BG = (246, 247, 251)
CARD = (255, 255, 255)
BORDER = (228, 231, 238)
TEXT = (26, 30, 40)
MUTED = (124, 132, 148)
ACCENT = (60, 64, 214)
DANGER = (219, 38, 38)
CHIP_BG = (236, 240, 255)
CHIP_FG = (62, 68, 176)
BUBBLE = (242, 244, 250)


def font(size):
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size * S)
    return ImageFont.load_default()


F_BODY = font(15)
F_SMALL = font(12)
F_TIP = font(13)


def px(value):
    return value * S


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(tuple(px(v) for v in box), radius=px(radius), fill=fill, outline=outline, width=px(width))


def text(draw, xy, value, fnt=F_BODY, fill=TEXT):
    draw.text((px(xy[0]), px(xy[1])), value, font=fnt, fill=fill)


def measure(draw, value, fnt):
    return draw.textlength(value, font=fnt) / S


def icon(draw, x, y, kind, color=MUTED, active=False):
    size = 22
    if active:
        rounded(draw, (x - 4, y - 4, x + size + 4, y + size + 4), 12, (238, 240, 252))
    cx, cy = x + size / 2, y + size / 2
    if kind == "thumb":
        draw.ellipse((px(cx - 6), px(cy - 6), px(cx + 6), px(cy + 6)), outline=color, width=S)
    elif kind == "copy":
        draw.rectangle((px(cx - 6), px(cy - 5), px(cx + 3), px(cy + 6)), outline=color, width=S)
        draw.rectangle((px(cx - 3), px(cy - 8), px(cx + 6), px(cy + 3)), outline=color, width=S)
    elif kind == "share":
        for dx, dy in ((-6, -5), (6, 0), (-6, 5)):
            draw.ellipse((px(cx + dx - 2), px(cy + dy - 2), px(cx + dx + 2), px(cy + dy + 2)), fill=color)
        draw.line((px(cx - 4), px(cy - 4), px(cx + 4), px(cy)), fill=color, width=S)
        draw.line((px(cx - 4), px(cy + 4), px(cx + 4), px(cy)), fill=color, width=S)
    elif kind == "trash":
        c = ACCENT if active else color
        draw.line((px(cx - 7), px(cy - 6), px(cx + 7), px(cy - 6)), fill=c, width=S)
        draw.line((px(cx - 2), px(cy - 9), px(cx + 2), px(cy - 9)), fill=c, width=S)
        draw.line((px(cx - 4.5), px(cy - 6), px(cx - 3.5), px(cy + 8)), fill=c, width=S)
        draw.line((px(cx + 4.5), px(cy - 6), px(cx + 3.5), px(cy + 8)), fill=c, width=S)
        draw.line((px(cx - 3.5), px(cy + 8), px(cx + 3.5), px(cy + 8)), fill=c, width=S)


def bubble(draw, top, value, right=True):
    height = 38
    top_left = (W - 44 - 300, top) if right else (44, top)
    rounded(draw, (top_left[0], top, top_left[0] + 300, top + height), 12, BUBBLE)
    text(draw, (top_left[0] + 16, top + 10), value)


def tooltip(draw, x, y, value):
    width = measure(draw, value, F_TIP) + 20
    rounded(draw, (x, y, x + width, y + 27), 6, (31, 35, 47))
    text(draw, (x + 10, y + 6), value, F_TIP, (255, 255, 255))


def pill(draw, x, y):
    rounded(draw, (x, y, x + 96, y + 27), 13, CARD, BORDER, 1)
    text(draw, (x + 14, y + 6), "删除", F_TIP, DANGER)
    text(draw, (x + 58, y + 6), "取消", F_TIP, MUTED)


def chip(draw, x, y, value="此轮已从上下文删除"):
    width = measure(draw, value, F_SMALL) + 26
    rounded(draw, (x, y, x + width, y + 25), 12, CHIP_BG)
    text(draw, (x + 13, y + 5), value, F_SMALL, CHIP_FG)


ROW_Y = 300  # action row top of the target turn
TARGET_TOP = 196


def render(step):
    image = Image.new("RGB", (W * S, H * S), BG)
    draw = ImageDraw.Draw(image)
    rounded(draw, (16, 16, W - 16, H - 16), 16, CARD, BORDER, 1)
    text(draw, (38, 34), "会话 · 三轮", F_SMALL, MUTED)
    draw.line((px(16), px(58), px(W - 16), px(58)), fill=BORDER, width=S)

    # turn 1
    text(draw, (44, 74), "第 1 轮 · 聊 A", F_SMALL, MUTED)
    bubble(draw, 94, "继续聊聊 A 的细节")
    text(draw, (44, 148), "好的，A 的关键点有三个：…")

    deleted = step >= 4

    if not deleted:
        # turn 2 (target)
        text(draw, (44, TARGET_TOP - 20), "第 2 轮 · 顺手问了 B（要删掉的）", F_SMALL, MUTED)
        bubble(draw, TARGET_TOP, "B 那个游戏的文件怎么清")
        text(draw, (44, TARGET_TOP + 52), "已确认无进程占用，robocopy 镜像清空，")
        text(draw, (44, TARGET_TOP + 74), "最终残留 0 项。")

        icon_x = 44
        for kind in ("thumb", "copy", "share"):
            icon(draw, icon_x, ROW_Y, kind)
            icon_x += 34

        if step == 1:
            icon(draw, icon_x, ROW_Y, "trash", active=True)
            tooltip(draw, icon_x - 46, ROW_Y + 30, "从上下文删除这一轮")
        elif step == 2:
            pill(draw, icon_x - 4, ROW_Y + 2)
        elif step == 3:
            text(draw, (icon_x - 4, ROW_Y + 6), "删除中…", F_TIP, MUTED)
            icon(draw, icon_x, ROW_Y + 30, "trash")

        text(draw, (44, 374), "第 3 轮 · 之后的对话", F_SMALL, MUTED)
        bubble(draw, 392, "那 A 的第三步呢")
    else:
        # turn 2 collapsed into a marker, turn 3 moves up
        chip(draw, 44, TARGET_TOP + 8)
        text(draw, (44, TARGET_TOP + 48), "模型上下文：这一轮已不存在", F_SMALL, MUTED)
        text(draw, (44, TARGET_TOP + 90), "第 3 轮 · 之后的对话", F_SMALL, MUTED)
        bubble(draw, TARGET_TOP + 108, "那 A 的第三步呢")
        text(draw, (44, TARGET_TOP + 164), "好的，接着 A 说：…")

    return image.resize((W, H), Image.LANCZOS)


frames = [(render(1), 1600), (render(2), 1300), (render(3), 900), (render(4), 2800)]
out = Path(__file__).resolve().parents[1] / "docs" / "demo.gif"
frames[0][0].save(
    out,
    save_all=True,
    append_images=[item[0] for item in frames[1:]],
    duration=[item[1] for item in frames],
    loop=0,
    optimize=True,
    disposal=2,
)
print(f"wrote {out} ({out.stat().st_size / 1024:.1f} KB, {len(frames)} frames, {W}x{H})")


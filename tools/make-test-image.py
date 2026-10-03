#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make-test-image.py — 生成测试素材
1) samples/test-photo.png   : 一张有渐变/多种颜色的测试图（模拟照片）
2) samples/test-pixel.png   : 一张像素画（模拟表情包/logo，硬边缘）
3) samples/raw.json         : test-photo 的原始 RGBA 数据，供 Node 端到端测试用
用法: python tools/make-test-image.py
"""
import json
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), "samples")
os.makedirs(OUT, exist_ok=True)

W, H = 160, 160

# ---------- 1. 模拟照片：天空渐变 + 太阳 + 山 + 水 ----------
img = Image.new("RGB", (W, H))
px = img.load()
for y in range(H):
    for x in range(W):
        # 天空渐变（上深蓝 -> 下暖橙）
        t = y / (H - 1)
        r = int(30 + 200 * t ** 1.5)
        g = int(60 + 120 * t ** 1.8)
        b = int(120 - 40 * t)
        px[x, y] = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))

d = ImageDraw.Draw(img)
# 太阳
d.ellipse([104, 22, 140, 58], fill=(255, 236, 140))
d.ellipse([110, 28, 134, 52], fill=(255, 214, 70))
# 山（两层）
d.polygon([(0, 118), (44, 62), (86, 118)], fill=(58, 86, 68))
d.polygon([(60, 118), (104, 48), (152, 118)], fill=(38, 62, 50))
d.polygon([(104, 48), (128, 82), (86, 96)], fill=(74, 104, 82))
# 水面
d.rectangle([0, 118, W, H], fill=(28, 62, 96))
for i in range(0, W, 8):
    d.line([(i, 122 + (i % 24)), (i + 5, 122 + (i % 24))], fill=(120, 170, 210), width=2)
# 一个红色小房子（测试纯色块还原）
d.rectangle([18, 96, 46, 118], fill=(196, 84, 62))
d.polygon([(14, 96), (32, 82), (50, 96)], fill=(120, 44, 40))
d.rectangle([28, 104, 36, 118], fill=(250, 236, 200))
img.save(os.path.join(OUT, "test-photo.png"))

# 导出 RGBA 原始数据（Node 端到端测试用）
rgba = img.convert("RGBA").tobytes()
with open(os.path.join(OUT, "raw.json"), "w", encoding="utf-8") as f:
    json.dump({"width": W, "height": H, "data": list(rgba)}, f)
print("test-photo.png + raw.json  (%dx%d, rgba %d bytes)" % (W, H, len(rgba)))

# ---------- 2. 像素画（硬边缘 + 透明背景） ----------
P = 16  # 16x16 像素
palette = {
    ".": (0, 0, 0, 0),          # 透明
    "K": (32, 30, 34, 255),     # 黑
    "W": (250, 250, 250, 255),  # 白
    "R": (226, 62, 62, 255),    # 红
    "O": (240, 150, 60, 255),   # 橙
    "Y": (250, 214, 74, 255),   # 黄
    "G": (86, 176, 96, 255),    # 绿
    "B": (66, 130, 210, 255),   # 蓝
    "P": (170, 110, 200, 255),  # 紫
    "S": (232, 196, 168, 255),  # 肤色
}
art = [
    "................",
    ".....KKKKKK.....",
    "....KRRRRRRK....",
    "...KRRRRRRRRK...",
    "..KRRWKRRKWRRK..",
    "..KRRWKRRKWRRK..",
    "..KRRRRRRRRRRK..",
    "..KRRKKRRKKRRK..",
    "..KRRKRRRRKRRK..",
    "...KRRRRRRRRK...",
    "....KKKKKKKK....",
    ".....KWWWWK.....",
    "...KKGGGGGGKK...",
    "..KGGGGGGGGGGK..",
    ".KGGKGGGGGGKGGK.",
    ".KKK.KKKKKK.KKK.",
]
pim = Image.new("RGBA", (P, P), (0, 0, 0, 0))
ppx = pim.load()
for y, row in enumerate(art):
    for x, ch in enumerate(row):
        ppx[x, y] = palette[ch]
pim = pim.resize((P * 8, P * 8), Image.NEAREST)
pim.save(os.path.join(OUT, "test-pixel.png"))
print("test-pixel.png  (%dx%d, 8x nearest upscale)" % (P * 8, P * 8))

# ---------- 3. 颜色复杂度参考（供调参时对照） ----------
colors = img.convert("RGB").getcolors(maxcolors=1 << 24)
print("test-photo 唯一颜色数：", len(colors) if colors else ">16M")

#!/usr/bin/env node
/* =========================================================================
 * test-core.js — 核心逻辑自测（Node 直接跑，不需要浏览器）
 *   node tools/test-core.js
 * ========================================================================= */
'use strict';
const path = require('path');
const fs = require('fs');

const SRC = path.resolve(__dirname, '..', 'src');
require(path.join(SRC, 'core', 'color.js'));
require(path.join(SRC, 'core', 'palette.js'));
require(path.join(SRC, 'core', 'sampler.js'));
require(path.join(SRC, 'core', 'quantizer.js'));
require(path.join(SRC, 'core', 'pattern.js'));
require(path.join(SRC, 'data', 'palettes.js'));

const C = globalThis.PindouColor;
const Pal = globalThis.PindouPalette;
const Sampler = globalThis.PindouSampler;
const Q = globalThis.PindouQuantizer;
const PatternMod = globalThis.PindouPattern;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${name}\n`); }
  else {
    fail++; failures.push(name + (extra ? ' :: ' + extra : ''));
    process.stdout.write(`  ✗ ${name}${extra ? '  -> ' + extra : ''}\n`);
  }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }
function section(t) { process.stdout.write(`\n${t}\n`); }

/* ==================== 1. 色彩数学 ==================== */
section('1. 色彩科学');
{
  const labWhite = C.rgbToLab(255, 255, 255);
  ok('白色 Lab ≈ (100,0,0)', near(labWhite[0], 100, 0.02) && near(labWhite[1], 0, 0.02) && near(labWhite[2], 0, 0.02),
    JSON.stringify(labWhite));
  const labBlack = C.rgbToLab(0, 0, 0);
  ok('黑色 Lab = (0,0,0)', near(labBlack[0], 0, 1e-9) && near(labBlack[1], 0, 1e-9) && near(labBlack[2], 0, 1e-9));

  // ciede2000 标准测试数据（Sharma 数据集经典用例，官方期望值）
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0000],
    [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0000],
    [[50, 2.4900, -0.0010], [50, -2.4900, 0.0009], 7.1792],
    [[50, 2.5000, 0.0000], [50, 0.0000, -2.5000], 4.3065],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.2630],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  ];
  let maxErr = 0, worst = '';
  for (const [a, b, expected] of cases) {
    const got = C.ciede2000(a, b);
    if (Math.abs(got - expected) > maxErr) { maxErr = Math.abs(got - expected); worst = `${JSON.stringify(a)} vs ${JSON.stringify(b)}: 期望 ${expected} 得到 ${got.toFixed(4)}`; }
  }
  ok('CIEDE2000 与 Sharma 标准数据集一致 (误差<1e-3)', maxErr < 1e-3, 'maxErr=' + maxErr.toExponential(2) + ' | ' + worst);

  // 灰色对：ΔE00 应等于 ΔL'/SL（手算可验证）
  {
    const g1 = C.rgbToLab(255, 255, 255), g2 = C.rgbToLab(128, 128, 128);
    const dL = g2[0] - g1[0], Lbar = (g1[0] + g2[0]) / 2;
    const SL = 1 + (0.015 * Math.pow(Lbar - 50, 2)) / Math.sqrt(20 + Math.pow(Lbar - 50, 2));
    ok('灰阶对的 ΔE00 = ΔL/SL（解析解）', near(C.ciede2000(g1, g2), Math.abs(dL) / SL, 1e-9),
      `${C.ciede2000(g1, g2).toFixed(6)} vs ${(Math.abs(dL) / SL).toFixed(6)}`);
  }
  ok('同色 ΔE00 = 0', C.ciede2000(C.rgbToLab(12, 200, 90), C.rgbToLab(12, 200, 90)) < 1e-12);
  ok('ΔE00 对称', (() => {
    for (const [a, b] of cases) if (Math.abs(C.ciede2000(a, b) - C.ciede2000(b, a)) > 1e-9) return false;
    return true;
  })());

  ok('hex 解析 #ABC 简写', JSON.stringify(C.hexToRgb('#ABC')) === JSON.stringify([170, 187, 204]));
  ok('hex 解析带 alpha 时忽略 alpha', JSON.stringify(C.hexToRgb('#FFFFFF00')) === JSON.stringify([255, 255, 255]));
  ok('非法 hex 返回 null', C.hexToRgb('zzz') === null);
  ok('rgbToHex 补零正确', C.rgbToHex(1, 2, 3) === '#010203');
  ok('浅色配黑字', C.contrastText(255, 255, 255) === '#000000');
  ok('深色配白字', C.contrastText(0, 0, 0) === '#FFFFFF');
  ok('中灰配白字(对比度优先)', C.contrastText(70, 70, 72) === '#FFFFFF');
}

/* ==================== 2. 色卡与最近色 ==================== */
section('2. 色卡 / 最近色查找');
Pal.registerAll(globalThis.PindouPaletteData);
const palettes = Pal.list();
{
  ok('注册了 9 套色卡', palettes.length === 9, 'got ' + palettes.length);
  ok('MARD 221 色数 = 221', Pal.get('mard-221').size() === 221, 'got ' + Pal.get('mard-221').size());
  ok('MARD 291 色数 = 291', Pal.get('mard-291').size() === 291);
  ok('Artkal 418 色数 = 418', Pal.get('artkal-418').size() === 418);
  ok('Perler 117 色数 = 117', Pal.get('perler').size() === 117);
  ok('Hama 92 色数 = 92', Pal.get('hama').size() === 92);
  ok('MARD 221 是 291 的子集', (() => {
    const big = new Set(Pal.get('mard-291').colors.map(c => c.code));
    return Pal.get('mard-221').colors.every(c => big.has(c.code));
  })());
  ok('色号唯一（每套色卡内）', palettes.every(p => {
    const s = new Set(p.colors.map(c => c.code));
    return s.size === p.colors.length;
  }));

  const mard = Pal.get('mard-221');
  // 精确匹配（带记忆）必须精确回到颜色本身
  let selfHit = 0, total = 0, worstDe = 0, worstCode = '';
  for (const c of mard.colors) {
    total++;
    const e = mard.nearestCached(c.r, c.g, c.b);
    if (e === c.index) selfHit++;
    else {
      const other = mard.colors[e];
      const de = C.ciede2000(c.lab, other.lab);
      // 色卡里存在几乎重复的颜色，回到「等价的另一个色号」是可接受的
      if (de > worstDe) { worstDe = de; worstCode = `${c.code}(${c.hex}) -> ${other.code}(${other.hex}) ΔE=${de.toFixed(2)}`; }
    }
  }
  ok('精确匹配全部回到自身或 ΔE<1 的等价色', worstDe < 1.0, `${selfHit}/${total} 精确自匹配；最差 ${worstCode}`);

  // 5bit 反查表只作为提示：误差应很小（记录在案）
  {
    let fastHit = 0, worstFastDe = 0;
    for (const c of mard.colors) {
      const f = mard.nearestFast(c.r, c.g, c.b);
      if (f === c.index) fastHit++;
      else worstFastDe = Math.max(worstFastDe, C.ciede2000(c.lab, mard.colors[f].lab));
    }
    ok('5bit 反查表近似误差 ΔE < 5（仅供粗筛；精确匹配走 nearestCached）', worstFastDe < 5, `自匹配 ${fastHit}/${total}，最差 ΔE=${worstFastDe.toFixed(2)}`);
  }

  // 精确匹配必须单调：更近的颜色优先
  const pal = Pal.get('coco-291');
  const samples = [[13, 13, 13], [250, 250, 240], [128, 64, 200], [0, 128, 255], [255, 200, 100]];
  let monotone = true;
  for (const [r, g, b] of samples) {
    const idx = pal.nearestExact(r, g, b);
    const lab = C.rgbToLab(r, g, b);
    const best = Math.min(...pal.colors.map(c => C.labDist2(lab, c.lab)));
    if (C.labDist2(lab, pal.colors[idx].lab) > best + 1e-9) monotone = false;
  }
  ok('精确最近色 = 全局最优（kd-tree 正确）', monotone);
}

/* ==================== 3. 采样 ==================== */
section('3. 图片采样');
{
  // 造一张 8x8 的图：左半红、右半蓝
  const W = 8, H = 8, data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const red = x < 4;
    data[i] = red ? 255 : 0; data[i + 1] = 0; data[i + 2] = red ? 0 : 255; data[i + 3] = 255;
  }
  const img = { data, width: W, height: H };
  const s = Sampler.sample(img, 2, 2, { method: 'area', fit: 'fill' });
  ok('2x2 采样得到 4 格', s.rgb.length === 12);
  ok('左格是红色', s.rgb[0] > 240 && s.rgb[1] < 20 && s.rgb[2] < 20, `${s.rgb[0]},${s.rgb[1]},${s.rgb[2]}`);
  ok('右格是蓝色', s.rgb[3] < 20 && s.rgb[4] < 20 && s.rgb[5] > 240);
  ok('没有空格子', Array.from(s.empty).every(v => v === 0));

  // 透明 -> 空
  const data2 = Uint8ClampedArray.from(data);
  for (let y = 0; y < H; y++) for (let x = 4; x < W; x++) data2[(y * W + x) * 4 + 3] = 0;
  const s2 = Sampler.sample({ data: data2, width: W, height: H }, 2, 2, { method: 'area', fit: 'fill' });
  ok('右侧透明 -> 标记为空格', s2.empty[1] === 1 && s2.empty[0] === 0);

  // contain 保持比例：8x4 图 -> 4x4 格，内容占 4x2，上下各留白 1 行
  const W2 = 8, H2 = 4, d3 = new Uint8ClampedArray(W2 * H2 * 4);
  for (let i = 0; i < W2 * H2; i++) { d3[i * 4] = 0; d3[i * 4 + 1] = 255; d3[i * 4 + 2] = 0; d3[i * 4 + 3] = 255; }
  const r3 = Sampler.computeRect(8, 4, 4, 4, 'contain');
  ok('contain: 8x4 图 -> 采样区 8x4（内容按格留白，不裁内容）', r3.w === 8 && r3.h === 4 && r3.x === 0 && r3.y === 0, JSON.stringify(r3));
  const r4 = Sampler.computeRect(8, 4, 4, 4, 'cover');
  ok('cover: 8x4 图 -> 裁成 4x4', r4.w === 4 && r4.h === 4 && r4.x === 2, JSON.stringify(r4));
  const rFill = Sampler.computeRect(8, 4, 4, 4, 'fill');
  ok('fill: 不做任何裁剪', rFill.w === 8 && rFill.h === 4, JSON.stringify(rFill));
  const rCrop = Sampler.computeRect(8, 4, 4, 4, 'fill', { x: 0.25, y: 0, w: 0.5, h: 1 });
  ok('crop 归一化裁剪生效', rCrop.x === 2 && rCrop.w === 4 && rCrop.h === 4, JSON.stringify(rCrop));

  // contain 采样后应出现留白格子（上下）
  const sc = Sampler.sample({ data: d3, width: W2, height: H2 }, 4, 4, { method: 'area', fit: 'contain' });
  let padTop = 0, padBottom = 0, padMid = 0;
  for (let i = 0; i < 16; i++) {
    const y = (i / 4) | 0;
    if (sc.empty[i]) { if (y === 0) padTop++; else if (y === 3) padBottom++; }
    else padMid++;
  }
  ok('contain 采样：上下留白、中间有内容', padTop === 4 && padBottom === 4 && padMid === 8,
    `上${padTop} 下${padBottom} 内容${padMid}`);

  // 最近邻保留硬边
  const s5 = Sampler.sample(img, 4, 1, { method: 'nearest', fit: 'fill' });
  ok('nearest 保留纯色边界', s5.rgb[0] === 255 && s5.rgb[3] === 255 && s5.rgb[9] === 255 && s5.rgb[11] === 255);

  // 自动裁边
  const W3 = 6, H3 = 6, d6 = new Uint8ClampedArray(W3 * H3 * 4).fill(255);
  for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) {
    const i = (y * W3 + x) * 4; d6[i] = 255; d6[i + 1] = 0; d6[i + 2] = 0; d6[i + 3] = 255;
  }
  const t = Sampler.autoTrim({ data: d6, width: W3, height: H3 }, { tolerance: 8 });
  ok('自动裁边找到 2x2 内容', t.x === 2 && t.y === 2 && t.w === 2 && t.h === 2, JSON.stringify(t));
}

/* ==================== 4. 量化 ==================== */
section('4. 颜色量化');
{
  const pal = Pal.get('mard-221');
  // 纯色圆：中心应是同一色号，且用色很少
  const N = 16;
  const rgb = new Float32Array(N * N * 3);
  const empty = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 3;
    const dx = x - N / 2 + 0.5, dy = y - N / 2 + 0.5;
    const inside = dx * dx + dy * dy <= (N / 2 - 1) * (N / 2 - 1);
    if (!inside) { empty[y * N + x] = 1; rgb[i] = rgb[i + 1] = rgb[i + 2] = 255; continue; }
    rgb[i] = 250; rgb[i + 1] = 20; rgb[i + 2] = 30;   // 红
  }
  const q = Q.quantize({ cols: N, rows: N, rgb, empty }, pal, { dither: 'none' });
  const usedSet = new Set();
  for (let i = 0; i < q.cells.length; i++) if (q.cells[i] >= 0) usedSet.add(q.cells[i]);
  ok('纯色圆只用到 1 种豆', usedSet.size === 1, '用了 ' + usedSet.size + ' 种');
  ok('圆外是空格', q.cells[0] === -1 && q.cells[N - 1] === -1);
  ok('圆内不是空格', q.cells[(N / 2) * N + N / 2] >= 0);
  // 结果应该是红色系
  const bead = pal.colors[q.cells[(N / 2) * N + N / 2]];
  ok('匹配到红色系豆子 (R 明显最大)', bead.r > bead.g + 60 && bead.r > bead.b + 60, bead.code + ' ' + bead.hex);

  // 抖动应产生更多颜色（用渐变测试）
  const rgb2 = new Float32Array(N * N * 3);
  const empty2 = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 3;
    const v = (x / (N - 1)) * 128 + 60;
    rgb2[i] = v; rgb2[i + 1] = v; rgb2[i + 2] = v;
  }
  const flat = Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'none' });
  const dith = Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'floyd' });
  const uniq = a => new Set(Array.from(a.cells).filter(v => v >= 0)).size;
  ok('无抖动：平滑渐变用色很少（≤8）', uniq(flat) <= 8, '用了 ' + uniq(flat));
  ok('Floyd 抖动：用色明显增多', uniq(dith) > uniq(flat), `抖动 ${uniq(dith)} vs 无抖动 ${uniq(flat)}`);
  // 抖动不改变平均亮度太多
  const meanOf = (res) => {
    let s = 0, n = 0;
    for (let i = 0; i < res.cells.length; i++) {
      const c = pal.colors[res.cells[i]]; if (!c) continue;
      s += 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; n++;
    }
    return s / n;
  };
  ok('抖动后平均亮度接近原图（±12）', Math.abs(meanOf(dith) - meanOf(flat)) < 12,
    `flat=${meanOf(flat).toFixed(1)} dith=${meanOf(dith).toFixed(1)}`);

  // 限制用色数
  const limited = Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'none', maxColors: 2 });
  ok('maxColors=2 时用色 ≤ 2', uniq(limited) <= 2, '用了 ' + uniq(limited));

  // 白名单（「只用我手上的豆子」）
  const codes = ['F5', 'H7'];
  const wl = Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'none', allowedCodes: codes });
  const wlUsed = new Set(Array.from(wl.cells).filter(v => v >= 0).map(i => pal.colors[i].code));
  ok('白名单内只用指定色号', wlUsed.size > 0 && Array.from(wlUsed).every(c => codes.includes(c)), Array.from(wlUsed).join(','));
  const wl2 = Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'floyd', allowedCodes: codes });
  const wlUsed2 = new Set(Array.from(wl2.cells).filter(v => v >= 0).map(i => pal.colors[i].code));
  ok('白名单 + 抖动也只用指定色号', wlUsed2.size > 0 && Array.from(wlUsed2).every(c => codes.includes(c)), Array.from(wlUsed2).join(','));
  const wl3 = Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'none', allowedCodes: codes, maxColors: 1 });
  const wlUsed3 = new Set(Array.from(wl3.cells).filter(v => v >= 0).map(i => pal.colors[i].code));
  ok('白名单 + 限制 1 色 => 只剩 1 色且在名单内', wlUsed3.size === 1 && Array.from(wlUsed3).every(c => codes.includes(c)), Array.from(wlUsed3).join(','));
  let threw = false;
  try { Q.quantize({ cols: N, rows: N, rgb: rgb2, empty: empty2 }, pal, { dither: 'none', allowedCodes: ['不存在的色号'] }); }
  catch (e) { threw = true; }
  ok('空白名单会抛出明确错误', threw);

  // 孤立小块合并
  const N3 = 12;
  const rgb3 = new Float32Array(N3 * N3 * 3), em3 = new Uint8Array(N3 * N3);
  for (let i = 0; i < N3 * N3; i++) { rgb3[i * 3] = 250; rgb3[i * 3 + 1] = 250; rgb3[i * 3 + 2] = 250; }
  // 中心一个孤立黑点
  const ci = 6 * N3 + 6; rgb3[ci * 3] = 0; rgb3[ci * 3 + 1] = 0; rgb3[ci * 3 + 2] = 0;
  const noMerge = Q.quantize({ cols: N3, rows: N3, rgb: rgb3, empty: em3 }, pal, { dither: 'none' });
  const merged = Q.quantize({ cols: N3, rows: N3, rgb: rgb3, empty: em3 }, pal, { dither: 'none', removeIsolated: 2 });
  ok('合并前：孤立点保留（用色 2 种）', uniq(noMerge) === 2, '用了 ' + uniq(noMerge));
  ok('合并后：孤立点被并入周围色（用色 1 种）', uniq(merged) === 1, '用了 ' + uniq(merged));

  // 易混色提示
  const pairs = Q.confusingPairs(pal, pal.colors.map(c => c.index), 1.5);
  ok('能算出易混色对且按 ΔE 升序', pairs.length > 0 && pairs.every((p, i) => i === 0 || pairs[i - 1].deltaE <= p.deltaE),
    pairs.length + ' 对');
}

/* ==================== 5. 图纸 / 进度 / 序列化 ==================== */
section('5. 图纸数据模型');
{
  const pal = Pal.get('mard-221');
  const cols = 5, rows = 4;
  const cells = new Int16Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = i < 10 ? 10 : (i < 15 ? 20 : -1);
  const pat = new PatternMod.Pattern({ cols, rows, paletteId: pal.id, palette: pal, cells });

  const st = pat.stats();
  ok('总豆数 = 15', st.beadsTotal === 15, 'got ' + st.beadsTotal);
  ok('空格数 = 5', st.emptyTotal === 5);
  ok('用色 2 种', st.colorsUsed === 2);
  ok('统计按数量降序', st.list[0].count >= st.list[1].count);

  ok('勾选一个格子成功', pat.setDone(0, 0, true) === true);
  ok('重复勾选返回 false', pat.setDone(0, 0, true) === false);
  ok('勾选后进度 1/15', pat.progress().done === 1);
  ok('空格子不能勾选', pat.setDone(0, 3, true) === false);
  ok('切换勾选', pat.toggleDone(0, 0) === true && pat.progress().done === 0);

  ok('整色号标记完成', pat.setColorDone(10, true) === 10 && pat.progress().done === 10);
  ok('统计里该色号 remaining=0', pat.stats().byIndex[10].remaining === 0);

  // 导航：从 (0,0) 找下一个未勾选的
  const next = pat.nextCell(0, 0, { order: 'row' });
  ok('nextCell 跳到下一个未拼格子（同色 20 的第一个）', next && next.index === 20, JSON.stringify(next));
  // 全部勾完 -> null
  pat.markAll();
  ok('全部完成后 nextCell 返回 null', pat.nextCell(0, 0, { order: 'row' }) === null);
  pat.clearProgress();
  ok('清空进度', pat.progress().done === 0);

  // 逐列 / 蛇形 / 按色号
  const n1 = pat.nextCell(0, 0, { order: 'col' });
  ok('逐列顺序第二个是 (0,1)', n1 && n1.x === 0 && n1.y === 1, JSON.stringify(n1));
  const n2 = pat.nextCell(0, 0, { order: 'row-serpentine' });
  ok('蛇形顺序第二个仍是 (1,0)', n2 && n2.x === 1 && n2.y === 0, JSON.stringify(n2));
  const n3 = pat.nextCell(-1, 0, { order: 'color' });
  ok('按色号顺序：第一个是数量最多的色号', n3 && n3.index === pat.stats().list[0].index, JSON.stringify(n3));

  ok('行剩余统计', pat.rowRemaining(0) === 5 && pat.rowRemaining(3) === 0);

  // 分板
  const boards = pat.boards(3, 3, 0);
  ok('5x4 图用 3x3 板 => (2x2)=4 块', boards.length === 4, 'got ' + boards.length);
  ok('分板尺寸正确', boards[0].w === 3 && boards[0].h === 3 && boards[3].w === 2 && boards[3].h === 1,
    JSON.stringify(boards.map(b => [b.x, b.y, b.w, b.h])));

  // 序列化往返
  pat.setDone(0, 0, true); pat.setDone(2, 1, true);
  const ser = pat.serialize({ embedPalette: true });
  const back = PatternMod.Pattern.deserialize(JSON.parse(JSON.stringify(ser)));
  let same = back.cells.length === pat.cells.length;
  for (let i = 0; i < pat.cells.length && same; i++) if (back.cells[i] !== pat.cells[i]) same = false;
  ok('序列化往返（内嵌色卡）：格子一致', same);
  let doneSame = true;
  for (let i = 0; i < pat.done.length; i++) if (back.done[i] !== pat.done[i]) doneSame = false;
  ok('序列化往返：进度一致', doneSame, JSON.stringify(ser.done));
  ok('序列化（不内嵌色卡）体积合理（20 格 < 400 字节）', JSON.stringify(pat.serialize({})).length < 400,
    JSON.stringify(pat.serialize({})).length + ' 字节');
  ok('内嵌色卡后体积随色卡大小增长（便于分享项目）', JSON.stringify(ser).length > 5000,
    JSON.stringify(ser).length + ' 字节');

  // 不内嵌色卡时必须能用 id 找回色卡
  const ser2 = pat.serialize({ embedPalette: false });
  let threwPal = false;
  try { PatternMod.Pattern.deserialize(ser2); } catch (e) { threwPal = true; }
  ok('未内嵌色卡时，找不到色卡要报错（而不是画错）', threwPal);
  const back2 = PatternMod.Pattern.deserialize(ser2, id => Pal.get(id));
  ok('用色卡注册表可以正常还原', back2.cells.every((v, i) => v === pat.cells[i]) && back2.palette.size() === pal.size());

  // 位图（进度）编解码：必须逐位无损
  {
    const bits = new Uint8Array(200);
    for (let i = 0; i < bits.length; i++) bits[i] = (i * 37 + (i % 5)) % 2;
    const enc = PatternMod.encodeBits(bits);
    const dec = PatternMod.decodeBits(enc, bits.length);
    let bad = -1;
    for (let i = 0; i < bits.length; i++) if (dec[i] !== bits[i]) { bad = i; break; }
    ok('进度位图编解码逐位无损（含大小写混淆回归测试）', bad === -1, bad >= 0 ? '第 ' + bad + ' 位不一致' : '');
  }

  // 大图压缩率：真实图纸是「成片同色 + 少量手工修改」
  const BW = 100, BH = 100, bigN = BW * BH;
  const bigCells = new Int16Array(bigN);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    // 16x16 的色块 + 少量空格子，模拟照片转换结果
    const blk = ((y / 16) | 0) * 7 + ((x / 16) | 0);
    bigCells[y * BW + x] = (blk % 11 === 0 && (x % 3 === 0)) ? -1 : (blk % 23);
  }
  // 再手工改 200 个格子
  for (let i = 0; i < 200; i++) bigCells[(i * 97) % bigN] = (i % 23) + 1;
  const packed = PatternMod.packCells(bigCells);
  const jsonSize = JSON.stringify(packed).length;
  const rawSize = bigN * 2;
  ok('格子数据压缩率 > 3x（成片同色）', rawSize / jsonSize > 3, `原始 ${rawSize} 字节 -> ${jsonSize} 字符 (${(rawSize / jsonSize).toFixed(1)}x)`);
  const unpacked = PatternMod.unpackCells(packed, bigN);
  ok('压缩往返无损（含手工修改的格子）', unpacked.every((v, i) => v === bigCells[i]));
  // 100x100 图纸的完整项目文件应远小于 100KB（不含内嵌色卡）
  const bigPat = new PatternMod.Pattern({ cols: BW, rows: BH, paletteId: pal.id, palette: pal, cells: bigCells });
  ok('100x100 项目文件（不内嵌色卡）< 20KB', JSON.stringify(bigPat.serialize({})).length < 20000,
    JSON.stringify(bigPat.serialize({})).length + ' 字节');

  // 采购清单
  const shop = pat.shoppingList(1000);
  ok('采购清单按包取整', shop.every(s => s.packs === Math.ceil(s.count / 1000)));
  ok('采购清单包数 ≥ 1', shop.every(s => s.packs >= 1));
}

/* ==================== 6. 真图端到端（可选，有 PNG 就跑） ==================== */
section('6. 端到端（用真实图片数据，如果存在）');
{
  const p = path.resolve(__dirname, '..', '..', 'samples', 'raw.json');
  if (!fs.existsSync(p)) {
    process.stdout.write('  - 跳过：没有 samples/raw.json（可用 tools/make-test-image.py 生成）\n');
  } else {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const img = { data: Uint8ClampedArray.from(raw.data), width: raw.width, height: raw.height };
    const pal = Pal.get('mard-221');
    const t0 = Date.now();
    const s = Sampler.sample(img, 48, 48, { method: 'area', fit: 'cover' });
    const q = Q.quantize(s, pal, { dither: 'none' });
    const ms = Date.now() - t0;
    const pat = new PatternMod.Pattern({ cols: 48, rows: 48, paletteId: pal.id, palette: pal, cells: q.cells });
    const st = pat.stats();
    ok('48x48 转换在 3 秒内完成', ms < 3000, ms + 'ms');
    ok('用色数在 3-80 之间（合理范围）', st.colorsUsed >= 3 && st.colorsUsed <= 80, st.colorsUsed + ' 种');
    ok('总豆数 = 2304（无透明区）', st.beadsTotal === 48 * 48, 'got ' + st.beadsTotal);
    process.stdout.write(`    · 图片 ${raw.width}x${raw.height} -> 48x48，用色 ${st.colorsUsed} 种，耗时 ${ms}ms\n`);
    process.stdout.write(`    · 用量前 5：` + st.list.slice(0, 5).map(e => `${e.code}×${e.count}`).join(', ') + '\n');
  }
}

/* ==================== 汇总 ==================== */
process.stdout.write(`\n${'='.repeat(52)}\n`);
process.stdout.write(`通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail) {
  process.stdout.write('失败列表：\n' + failures.map(f => '  - ' + f).join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('全部通过 ✓\n');

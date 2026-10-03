/* =========================================================================
 * color.js — 色彩空间与最近色查找
 * 纯逻辑，无 DOM 依赖：桌面版 / Android(WebView) / Node 测试 共用。
 * ========================================================================= */
(function (root) {
  'use strict';

  /* ---------- sRGB <-> linear ---------- */
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    var v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    v = Math.round(v * 255);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /* ---------- sRGB -> XYZ(D65) -> CIE Lab ---------- */
  var XN = 0.95047, YN = 1.00000, ZN = 1.08883;
  function labF(t) {
    return t > 0.008856451679035631 ? Math.cbrt(t) : (903.2962962962963 * t + 16) / 116;
  }
  function rgbToLab(r, g, b) {
    var R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    var X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / XN;
    var Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / YN;
    var Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / ZN;
    var fx = labF(X), fy = labF(Y), fz = labF(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /* ---------- CIEDE2000 ---------- */
  var DEG = Math.PI / 180;
  function ciede2000(lab1, lab2) {
    var L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    var L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    var C1 = Math.sqrt(a1 * a1 + b1 * b1);
    var C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cbar = (C1 + C2) / 2;
    var Cbar7 = Math.pow(Cbar, 7);
    var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))); // 25^7
    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1);
    var C2p = Math.sqrt(a2p * a2p + b2 * b2);
    var h1p = (C1p === 0) ? 0 : Math.atan2(b1, a1p) / DEG; if (h1p < 0) h1p += 360;
    var h2p = (C2p === 0) ? 0 : Math.atan2(b2, a2p) / DEG; if (h2p < 0) h2p += 360;
    var dLp = L2 - L1;
    var dCp = C2p - C1p;
    var dhp;
    if (C1p * C2p === 0) dhp = 0;
    else {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * DEG);
    var Lbarp = (L1 + L2) / 2;
    var Cbarp = (C1p + C2p) / 2;
    var hbarp;
    if (C1p * C2p === 0) hbarp = h1p + h2p;
    else {
      var d = Math.abs(h1p - h2p);
      if (d <= 180) hbarp = (h1p + h2p) / 2;
      else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
      else hbarp = (h1p + h2p - 360) / 2;
    }
    var T = 1
      - 0.17 * Math.cos((hbarp - 30) * DEG)
      + 0.24 * Math.cos((2 * hbarp) * DEG)
      + 0.32 * Math.cos((3 * hbarp + 6) * DEG)
      - 0.20 * Math.cos((4 * hbarp - 63) * DEG);
    var dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    var Cbarp7 = Math.pow(Cbarp, 7);
    var RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625));
    var SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
    var SC = 1 + 0.045 * Cbarp;
    var SH = 1 + 0.015 * Cbarp * T;
    var RT = -Math.sin(2 * dTheta * DEG) * RC;
    var tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
  }

  /* ---------- 常用小工具 ---------- */
  function hexToRgb(hex) {
    var h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 8) h = h.slice(0, 6);           // 忽略 alpha（透明豆另有标记）
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
  }
  /** 相对亮度（WCAG），用于决定格子上写黑字还是白字 */
  function relLuminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }
  function contrastText(r, g, b) {
    var L = relLuminance(r, g, b);
    var onBlack = L + 0.05;
    var onWhite = 1.05 / (L + 0.05);
    // 对比度取大者；同分时选黑字（浅色豆更常见）
    return onBlack >= onWhite ? '#000000' : '#FFFFFF';
  }
  /** 感知亮度（0-255），用于判断是否需要给色块加描边 */
  function perceivedLuma(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b);
  }

  /* ---------- 最近色加速结构（Lab 空间 k-d tree） ---------- */
  function KdTree(labs, indexMap) {
    this.labs = labs;                 // Float64Array 扁平: [L,a,b, L,a,b, ...]
    this.n = labs.length / 3;
    this.map = indexMap || null;      // 可选：内部下标 -> 原始下标
    var idx = new Array(this.n);
    for (var i = 0; i < this.n; i++) idx[i] = i;
    this.root = this._build(idx, 0);
  }
  KdTree.prototype._build = function (idx, depth) {
    if (!idx.length) return null;
    var axis = depth % 3, labs = this.labs;
    idx.sort(function (p, q) { return labs[p * 3 + axis] - labs[q * 3 + axis]; });
    var mid = idx.length >> 1;
    return {
      i: idx[mid], axis: axis,
      left: this._build(idx.slice(0, mid), depth + 1),
      right: this._build(idx.slice(mid + 1), depth + 1)
    };
  };
  /** 返回 {index, dist}；index 是 map 之后的原始下标 */
  KdTree.prototype.nearest = function (L, a, b) {
    var labs = this.labs, best = -1, bestD = Infinity, bestAxisVal = 0;
    var stack = [this.root];
    while (stack.length) {
      var node = stack.pop();
      if (!node) continue;
      var i3 = node.i * 3;
      var dL = L - labs[i3], da = a - labs[i3 + 1], db = b - labs[i3 + 2];
      var d = dL * dL + da * da + db * db;
      if (d < bestD) { bestD = d; best = node.i; }
      var v = (node.axis === 0 ? L : node.axis === 1 ? a : b);
      var split = labs[i3 + node.axis];
      var diff = v - split;
      var near = diff < 0 ? node.left : node.right;
      var far = diff < 0 ? node.right : node.left;
      if (far && diff * diff < bestD) stack.push(far);
      if (near) stack.push(near);
      bestAxisVal = split;
    }
    void bestAxisVal;
    return { index: this.map ? this.map[best] : best, dist: Math.sqrt(bestD) };
  };

  /* ---------- 平方欧氏距离（Lab）快速近似，用于粗筛 ---------- */
  function labDist2(l1, l2) {
    var a = l1[0] - l2[0], b = l1[1] - l2[1], c = l1[2] - l2[2];
    return a * a + b * b + c * c;
  }

  root.PindouColor = {
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    rgbToLab: rgbToLab,
    ciede2000: ciede2000,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    relLuminance: relLuminance,
    contrastText: contrastText,
    perceivedLuma: perceivedLuma,
    KdTree: KdTree,
    labDist2: labDist2
  };
})(typeof window !== 'undefined' ? window : globalThis);

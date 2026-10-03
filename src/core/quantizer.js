/* =========================================================================
 * quantizer.js — 颜色量化：把每格代表色映射到色卡，可抖动、可限制用色数
 * 依赖: color.js, palette.js
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.PindouColor;

  /* ---------------- 有序抖动矩阵 ---------------- */
  var BAYER8 = (function () {
    var m = [[0]];
    for (var s = 1; s <= 3; s++) {
      var n = m.length, r = n * 2, out = [];
      for (var y = 0; y < r; y++) out.push(new Array(r));
      for (var y2 = 0; y2 < n; y2++) {
        for (var x = 0; x < n; x++) {
          var v = m[y2][x] * 4;
          out[y2][x] = v;
          out[y2][x + n] = v + 2;
          out[y2 + n][x] = v + 3;
          out[y2 + n][x + n] = v + 1;
        }
      }
      m = out;
    }
    return m;
  })();

  /* ---------------- 误差扩散核 ---------------- */
  var KERNELS = {
    floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
    atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
    sierra: { div: 16, taps: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] }
  };

  /* ---------------- 工具 ---------------- */
  function uniqueWeighted(rgb, empty, maxCells) {
    // 量化到 4bit/通道 归并，保证统计数量可控
    var map = Object.create(null), list = [];
    var n = empty ? empty.length : rgb.length / 3;
    for (var i = 0; i < n; i++) {
      if (empty && empty[i]) continue;
      var r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var e = map[key];
      if (e) { e.w++; e.r += r; e.g += g; e.b += b; }
      else { e = map[key] = { w: 1, r: r, g: g, b: b }; list.push(e); }
    }
    // 若种类过多，退化为均匀抽样（性能保护）
    if (list.length > maxCells) {
      list.sort(function (a, b) { return b.w - a.w; });
      list = list.slice(0, maxCells);
    }
    return list;
  }

  function kmeansLab(points, k, iterations) {
    // points: [{r,g,b,w}]，返回 [[r,g,b], ...]
    var labs = points.map(function (p) { return C.rgbToLab(p.r, p.g, p.b); });
    var n = points.length;
    if (k >= n) return points.map(function (p) { return [p.r, p.g, p.b]; });
    // k-means++ 初始化（带权重）
    var totalW = 0;
    for (var i = 0; i < n; i++) totalW += points[i].w;
    var centroids = [];
    // 第一个：最重的点
    var first = 0;
    for (var i2 = 1; i2 < n; i2++) if (points[i2].w > points[first].w) first = i2;
    centroids.push(labs[first].slice());
    var d2 = new Float64Array(n);
    for (var c = 1; c < k; c++) {
      var sum = 0;
      for (var i3 = 0; i3 < n; i3++) {
        var best = Infinity;
        for (var j = 0; j < centroids.length; j++) {
          var dd = C.labDist2(labs[i3], centroids[j]);
          if (dd < best) best = dd;
        }
        d2[i3] = best;
        sum += best * points[i3].w;
      }
      var target = Math.random() * sum, acc = 0, pick = n - 1;
      for (var i4 = 0; i4 < n; i4++) {
        acc += d2[i4] * points[i4].w;
        if (acc >= target) { pick = i4; break; }
      }
      centroids.push(labs[pick].slice());
    }
    // Lloyd 迭代
    var assign = new Int32Array(n);
    for (var it = 0; it < (iterations || 12); it++) {
      var changed = false;
      for (var i5 = 0; i5 < n; i5++) {
        var bi = 0, bd = Infinity;
        for (var j2 = 0; j2 < centroids.length; j2++) {
          var d3 = C.labDist2(labs[i5], centroids[j2]);
          if (d3 < bd) { bd = d3; bi = j2; }
        }
        if (assign[i5] !== bi) { assign[i5] = bi; changed = true; }
      }
      var sumL = new Float64Array(k * 3), sumW = new Float64Array(k);
      for (var i6 = 0; i6 < n; i6++) {
        var a = assign[i6], w = points[i6].w, lab = labs[i6];
        sumL[a * 3] += lab[0] * w; sumL[a * 3 + 1] += lab[1] * w; sumL[a * 3 + 2] += lab[2] * w;
        sumW[a] += w;
      }
      for (var c2 = 0; c2 < k; c2++) {
        if (sumW[c2] > 0) {
          centroids[c2][0] = sumL[c2 * 3] / sumW[c2];
          centroids[c2][1] = sumL[c2 * 3 + 1] / sumW[c2];
          centroids[c2][2] = sumL[c2 * 3 + 2] / sumW[c2];
        }
      }
      if (!changed && it > 2) break;
    }
    // Lab 质心 -> RGB（近似逆变换：用 sRGB 搜索最近更麻烦，这里用逆 Lab）
    return centroids.map(function (lab) { return labToRgb(lab); });
  }

  function labToRgb(lab) {
    var L = lab[0], a = lab[1], b = lab[2];
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function inv(t) { var t3 = t * t * t; return t3 > 0.008856451679035631 ? t3 : (116 * t - 16) / 903.2962962962963; }
    var X = inv(fx) * 0.95047, Y = inv(fy) * 1.0, Z = inv(fz) * 1.08883;
    var r = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
    var g = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560;
    var bl = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
    return [C.linearToSrgb(r), C.linearToSrgb(g), C.linearToSrgb(bl)];
  }

  /* ---------------- 主入口 ---------------- */

  /**
   * 大图分片量化：把逐行处理拆成一批一批，每批之间用 await 让出主线程，
   * 界面不会卡死（大图约 100~400ms，可分 8 批完成）。
   * @returns {Promise<{cells,used,subMap,cols,rows}>}
   */
  async function quantizeAsync(sampled, palette, opt, onProgress) {
    var cols = sampled.cols, rows = sampled.rows;
    var n = cols * rows;
    var chunk = Math.max(1, Math.ceil(rows / 8));
    var out = new Int16Array(n);
    var lastUsed = [];
    for (var y0 = 0; y0 < rows; y0 += chunk) {
      var y1 = Math.min(rows, y0 + chunk);
      var sub = {
        cols: cols, rows: y1 - y0,
        rgb: sampled.rgb.subarray(y0 * cols * 3, y1 * cols * 3),
        empty: sampled.empty ? sampled.empty.subarray(y0 * cols, y1 * cols) : null
      };
      var res = quantize(sub, palette, opt);
      out.set(res.cells, y0 * cols);
      lastUsed = res.used;
      if (onProgress) onProgress(y1 / rows);
      if (y1 < rows) await new Promise(function (r) { setTimeout(r, 0); });
    }
    return { cells: out, used: lastUsed, subMap: null, cols: cols, rows: rows };
  }

  /**
   * @param {{cols,rows,rgb:Float32Array,empty:Uint8Array}} sampled
   * @param {Palette} palette
   * @param {Object} opt
   *   dither: 'none'|'floyd'|'atkinson'|'sierra'|'bayer'
   *   ditherStrength: 0-1.5 (默认 1)
   *   serpentine: bool
   *   maxColors: 0 = 不限制（直接匹配色卡）；>0 = 先聚类到 N 色再吸附到色卡
   *   allowedCodes: 可选的色号白名单（"只用我有的豆子"）
   *   removeIsolated: 0 = 关闭；>=1 = 把面积小于该值的同色小块并入邻色
   *   keepEmpty: bool 是否保留空格子
   * @returns {{cells:Int16Array, used:number[], matrix:Int16Array|null}}
   */
  function quantize(sampled, palette, opt) {
    opt = opt || {};
    var cols = sampled.cols, rows = sampled.rows;
    var n = cols * rows;
    var empty = sampled.empty;
    var srcRgb = sampled.rgb;

    var allowed = null;
    if (opt.allowedCodes && opt.allowedCodes.length) {
      allowed = Object.create(null);
      for (var i = 0; i < opt.allowedCodes.length; i++) allowed[String(opt.allowedCodes[i]).toUpperCase()] = 1;
    }
    function colorOK(c) { return !allowed || allowed[c.code.toUpperCase()]; }

    var cells = new Int16Array(n);
    var dither = opt.dither || 'none';
    var strength = opt.ditherStrength == null ? 1 : opt.ditherStrength;
    var maxColors = opt.maxColors || 0;

    /* --- 白名单（「只用我现有的豆子」）：必须在匹配阶段就生效 --- */
    var matchPalette = palette;
    var subMap = null;
    if (allowed) {
      var allowedIdx = [];
      for (var ai = 0; ai < palette.size(); ai++) if (colorOK(palette.colors[ai])) allowedIdx.push(ai);
      if (allowedIdx.length === 0) throw new Error('白名单里没有任何可用色号');
      if (allowedIdx.length < palette.size()) {
        matchPalette = new root.PindouPalette.Palette({
          id: palette.id + '-wl',
          title: palette.title,
          colors: allowedIdx.map(function (ix) {
            var b = palette.colors[ix];
            return { code: b.code, hex: b.hex, group: b.group, name: b.name, rgb: [b.r, b.g, b.b] };
          })
        });
        subMap = Int32Array.from(allowedIdx);
      }
    }

    /* --- 情况 A：限制用色数（聚类到 N 色，再把 N 个质心吸附到真实色卡） --- */
    var restricted = null;
    if (maxColors > 0 && maxColors < matchPalette.size()) {
      var pts = uniqueWeighted(srcRgb, empty, 20000);
      var k = Math.min(maxColors, Math.max(1, pts.length));
      var centroids = kmeansLab(pts, k, 14);
      var chosen = [], seen = Object.create(null);
      for (var ci = 0; ci < centroids.length; ci++) {
        var cc = centroids[ci];
        var idx = matchPalette.nearestExact(cc[0], cc[1], cc[2]);
        if (seen[idx]) continue;
        seen[idx] = 1;
        chosen.push(idx);
      }
      if (chosen.length) {
        var outerMap = subMap;
        subMap = Int32Array.from(chosen.map(function (ix) { return outerMap ? outerMap[ix] : ix; }));
        matchPalette = new root.PindouPalette.Palette({
          id: palette.id + '-k',
          title: palette.title,
          colors: chosen.map(function (ix) {
            var b = matchPalette.colors[ix];
            return { code: b.code, hex: b.hex, group: b.group, name: b.name, rgb: [b.r, b.g, b.b] };
          })
        });
        restricted = chosen;
      }
    }
    void restricted;

    var exact = (dither !== 'none') || !!subMap;

    // 误差缓冲（线性光空间，避免暗部噪点）
    var buf = new Float32Array(n * 3);
    for (var p = 0; p < n; p++) {
      if (empty && empty[p]) continue;
      buf[p * 3] = Math.pow(srcRgb[p * 3] / 255, 2.2);
      buf[p * 3 + 1] = Math.pow(srcRgb[p * 3 + 1] / 255, 2.2);
      buf[p * 3 + 2] = Math.pow(srcRgb[p * 3 + 2] / 255, 2.2);
    }

    function assignAt(x, y, errR, errG, errB) {
      var p = y * cols + x;
      var lr = buf[p * 3] + errR, lg = buf[p * 3 + 1] + errG, lb = buf[p * 3 + 2] + errB;
      lr = lr < 0 ? 0 : lr > 1 ? 1 : lr;
      lg = lg < 0 ? 0 : lg > 1 ? 1 : lg;
      lb = lb < 0 ? 0 : lb > 1 ? 1 : lb;
      var r = Math.round(Math.pow(lr, 1 / 2.2) * 255);
      var g = Math.round(Math.pow(lg, 1 / 2.2) * 255);
      var b = Math.round(Math.pow(lb, 1 / 2.2) * 255);
      // 无抖动且无子色卡时直接用整张色卡（并记住结果，避免重复 kd-tree 查找）
      var base = (!subMap && dither === 'none') ? palette : matchPalette;
      var mi = base.nearestCached(r, g, b);
      var bead = base.colors[mi];
      cells[p] = subMap ? subMap[mi] : mi;
      // 误差按最终落到的那颗豆计算（线性光空间）
      return [lr - Math.pow(bead.r / 255, 2.2), lg - Math.pow(bead.g / 255, 2.2), lb - Math.pow(bead.b / 255, 2.2)];
    }

    if (dither === 'bayer') {
      for (var y = 0; y < rows; y++) {
        for (var x = 0; x < cols; x++) {
          var q = y * cols + x;
          if (empty && empty[q]) { cells[q] = -1; continue; }
          var t = (BAYER8[y & 7][x & 7] / 64) - 0.5;         // -0.5..0.5
          var amp = 24 * strength;                            // 抖动幅度（0-255 空间的 ±）
          var rr = srcRgb[q * 3] + t * amp;
          var gg = srcRgb[q * 3 + 1] + t * amp;
          var bb = srcRgb[q * 3 + 2] + t * amp;
          var mi = matchPalette.nearestCached(
            rr < 0 ? 0 : rr > 255 ? 255 : rr | 0,
            gg < 0 ? 0 : gg > 255 ? 255 : gg | 0,
            bb < 0 ? 0 : bb > 255 ? 255 : bb | 0);
          cells[q] = subMap ? subMap[mi] : mi;
        }
      }
    } else if (dither === 'none') {
      for (var y2 = 0; y2 < rows; y2++) {
        for (var x2 = 0; x2 < cols; x2++) {
          var q2 = y2 * cols + x2;
          if (empty && empty[q2]) { cells[q2] = -1; continue; }
          var e = assignAt(x2, y2, 0, 0, 0);
          void e;
        }
      }
    } else {
      var kern = KERNELS[dither] || KERNELS.floyd;
      var serp = !!opt.serpentine;
      for (var y3 = 0; y3 < rows; y3++) {
        var reverse = serp && (y3 % 2 === 1);
        for (var xi = 0; xi < cols; xi++) {
          var x3 = reverse ? (cols - 1 - xi) : xi;
          var q3 = y3 * cols + x3;
          if (empty && empty[q3]) { cells[q3] = -1; continue; }
          var err = assignAt(x3, y3, 0, 0, 0);
          for (var t2 = 0; t2 < kern.taps.length; t2++) {
            var tap = kern.taps[t2];
            var tx = x3 + (reverse ? -tap[0] : tap[0]);
            var ty = y3 + tap[1];
            if (tx < 0 || tx >= cols || ty < 0 || ty >= rows) continue;
            var tp = ty * cols + tx;
            if (empty && empty[tp]) continue;
            var f = (tap[2] / kern.div) * strength;
            buf[tp * 3] += err[0] * f;
            buf[tp * 3 + 1] += err[1] * f;
            buf[tp * 3 + 2] += err[2] * f;
          }
        }
      }
    }

    /* --- 后处理：去掉/合并孤立小块（减少豆子种类、避免碎点） --- */
    if (opt.removeIsolated && opt.removeIsolated >= 1) {
      cells = mergeSmallRegions(cells, cols, rows, opt.removeIsolated, palette.size());
    } else {
      // 至少要把「空格子」标成 -1
      for (var z = 0; z < n; z++) if (empty && empty[z]) cells[z] = -1;
    }

    /* --- 统计实际用到的颜色 --- */
    var counts = new Int32Array(palette.size());
    for (var k2 = 0; k2 < n; k2++) if (cells[k2] >= 0) counts[cells[k2]]++;
    var used = [];
    for (var u = 0; u < counts.length; u++) if (counts[u] > 0) used.push(u);

    return { cells: cells, used: used, subMap: subMap, cols: cols, rows: rows };
  }

  /**
   * 把面积小于 minSize 的同色连通块并入相邻的主要颜色
   * 这是拼豆很实用的清理：避免为了 1-2 颗豆单独买一包
   */
  function mergeSmallRegions(cells, cols, rows, minSize, paletteSize) {
    var out = Int16Array.from(cells);
    var n = cols * rows;
    var visited = new Uint8Array(n);
    var stack = new Int32Array(n);
    var queue = [];
    for (var start = 0; start < n; start++) {
      if (visited[start] || out[start] < 0) continue;
      var color = out[start];
      var sp = 0, region = [];
      stack[sp++] = start;
      visited[start] = 1;
      while (sp > 0) {
        var p = stack[--sp];
        region.push(p);
        var x = p % cols, y = (p / cols) | 0;
        if (x > 0) { var l = p - 1; if (!visited[l] && out[l] === color) { visited[l] = 1; stack[sp++] = l; } }
        if (x < cols - 1) { var r = p + 1; if (!visited[r] && out[r] === color) { visited[r] = 1; stack[sp++] = r; } }
        if (y > 0) { var u2 = p - cols; if (!visited[u2] && out[u2] === color) { visited[u2] = 1; stack[sp++] = u2; } }
        if (y < rows - 1) { var d2 = p + cols; if (!visited[d2] && out[d2] === color) { visited[d2] = 1; stack[sp++] = d2; } }
      }
      if (region.length >= minSize) continue;
      // 统计邻接色
      var votes = Object.create(null), bestColor = -1, bestVotes = 0;
      for (var i = 0; i < region.length; i++) {
        var pp = region[i], xx = pp % cols, yy = (pp / cols) | 0;
        var neigh = [];
        if (xx > 0) neigh.push(pp - 1);
        if (xx < cols - 1) neigh.push(pp + 1);
        if (yy > 0) neigh.push(pp - cols);
        if (yy < rows - 1) neigh.push(pp + cols);
        for (var j = 0; j < neigh.length; j++) {
          var nc = out[neigh[j]];
          if (nc < 0 || nc === color) continue;
          votes[nc] = (votes[nc] || 0) + 1;
          if (votes[nc] > bestVotes) { bestVotes = votes[nc]; bestColor = nc; }
        }
      }
      if (bestColor >= 0) {
        queue.push([region, bestColor]);
      }
    }
    for (var qi = 0; qi < queue.length; qi++) {
      var reg = queue[qi][0], bc = queue[qi][1];
      for (var ri = 0; ri < reg.length; ri++) out[reg[ri]] = bc;
    }
    void paletteSize;
    return out;
  }

  /* ---------------- 相邻色差异（色号易混提示） ---------------- */
  /**
   * 找出用到的颜色里两两非常接近的组合（人眼容易拿错豆）
   * @returns [{a:index,b:index,deltaE:number}]
   */
  function confusingPairs(palette, used, threshold) {
    threshold = threshold || 2.5;
    var out = [];
    for (var i = 0; i < used.length; i++) {
      for (var j = i + 1; j < used.length; j++) {
        var A = palette.colors[used[i]], B = palette.colors[used[j]];
        var de = C.ciede2000(A.lab, B.lab);
        if (de < threshold) out.push({ a: A.index, b: B.index, deltaE: de });
      }
    }
    out.sort(function (p, q) { return p.deltaE - q.deltaE; });
    return out;
  }

  root.PindouQuantizer = {
    quantize: quantize,
    quantizeAsync: quantizeAsync,
    confusingPairs: confusingPairs,
    labToRgb: labToRgb,
    KERNELS: KERNELS,
    BAYER8: BAYER8
  };
})(typeof window !== 'undefined' ? window : globalThis);

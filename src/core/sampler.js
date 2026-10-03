/* =========================================================================
 * sampler.js — 图片重采样：把任意图片按目标格数（横竖格数）降采样
 * 纯逻辑：输入 ImageData-like {data,width,height}，输出每格代表色。
 * 无 DOM 依赖，Node 可直接测试。
 * ========================================================================= */
(function (root) {
  'use strict';

  /* ---------------- 常用几何：按目标格数计算采样区域 ---------------- */

  /**
   * 计算 source 上的采样矩形
   * @param {number} sw 源宽
   * @param {number} sh 源高
   * @param {number} cols 目标列数
   * @param {number} rows 目标行数
   * @param {string} fit 'fill'|'contain'|'cover'
   * @param {{x:number,y:number,w:number,h:number}} [crop] 归一化(0-1)裁剪框
   */
  function computeRect(sw, sh, cols, rows, fit, crop) {
    var sx = 0, sy = 0, sWidth = sw, sHeight = sh;
    if (crop && crop.w > 0 && crop.h > 0) {
      sx = Math.round(crop.x * sw);
      sy = Math.round(crop.y * sh);
      sWidth = Math.max(1, Math.round(crop.w * sw));
      sHeight = Math.max(1, Math.round(crop.h * sh));
      if (sx + sWidth > sw) sWidth = sw - sx;
      if (sy + sHeight > sh) sHeight = sh - sy;
    }
    var targetRatio = cols / rows;
    var srcRatio = sWidth / sHeight;
    var rx = sx, ry = sy, rw = sWidth, rh = sHeight;

    if (fit === 'cover') {
      // 铺满：裁掉多余的一边（宁可裁掉，也不留白）
      if (srcRatio > targetRatio) {
        var wNeed = Math.min(sWidth, Math.round(sHeight * targetRatio));   // 图太宽 -> 裁左右
        rx = sx + Math.floor((sWidth - wNeed) / 2);
        rw = wNeed;
      } else if (srcRatio < targetRatio) {
        var hNeed = Math.min(sHeight, Math.round(sWidth / targetRatio));   // 图太高 -> 裁上下
        ry = sy + Math.floor((sHeight - hNeed) / 2);
        rh = hNeed;
      }
    } else if (fit === 'contain') {
      // 完整放入：缩放后居中，多余方向留白（letterbox）
      if (srcRatio > targetRatio) {
        rh = Math.max(1, Math.min(sHeight, Math.round(sWidth / targetRatio)));
        ry = sy + Math.floor((sHeight - rh) / 2);
      } else if (srcRatio < targetRatio) {
        rw = Math.max(1, Math.min(sWidth, Math.round(sHeight * targetRatio)));
        rx = sx + Math.floor((sWidth - rw) / 2);
      }
    }
    // fit === 'fill'：直接拉伸，不做任何裁剪
    return { x: rx, y: ry, w: rw, h: rh };
  }

  /* ---------------- 自动裁掉统一/透明边框 ---------------- */

  function autoTrim(img, opts) {
    opts = opts || {};
    var w = img.width, h = img.height, d = img.data;
    var tolerance = opts.tolerance == null ? 12 : opts.tolerance;
    var useAlpha = !!opts.useAlpha;
    function px(x, y) {
      var i = (y * w + x) * 4;
      return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    }
    var bg = px(0, 0);
    // 四角投票决定背景色（更稳）
    var corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    var same = corners.every(function (c) {
      return Math.abs(c[0] - bg[0]) <= tolerance && Math.abs(c[1] - bg[1]) <= tolerance && Math.abs(c[2] - bg[2]) <= tolerance;
    });
    if (same) {
      var sum = [0, 0, 0];
      corners.forEach(function (c) { sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; });
      bg = [Math.round(sum[0] / 4), Math.round(sum[1] / 4), Math.round(sum[2] / 4), corners[0][3]];
    }
    function isBg(x, y) {
      var c = px(x, y);
      if (c[3] < 8) return true;                       // 透明算背景
      if (useAlpha) return false;
      return Math.abs(c[0] - bg[0]) <= tolerance && Math.abs(c[1] - bg[1]) <= tolerance && Math.abs(c[2] - bg[2]) <= tolerance;
    }
    var top = 0, bottom = h - 1, left = 0, right = w - 1;
    outer1: for (; top < bottom; top++) { for (var x = left; x <= right; x++) if (!isBg(x, top)) break outer1; }
    outer2: for (; bottom > top; bottom--) { for (var x2 = left; x2 <= right; x2++) if (!isBg(x2, bottom)) break outer2; }
    outer3: for (; left < right; left++) { for (var y = top; y <= bottom; y++) if (!isBg(left, y)) break outer3; }
    outer4: for (; right > left; right--) { for (var y2 = top; y2 <= bottom; y2++) if (!isBg(right, y2)) break outer4; }
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }

  /* ---------------- 主降采样 ---------------- */

  /**
   * @param {{data:Uint8ClampedArray,width:number,height:number}} img
   * @param {number} cols
   * @param {number} rows
   * @param {Object} [opt]
   *   method: 'area' | 'nearest' | 'dominant'   (默认 area)
   *   fit:    'fill' | 'contain' | 'cover'      (默认 fill)
   *   crop:   {x,y,w,h} 归一化
   *   alphaThreshold: 0-255 视为空的 alpha 阈值 (默认 16)
   *   background: '#rrggbb' | null 额外把接近该色的格子标记为空
   *   backgroundTolerance: 0-255
   * @returns {{cols,rows,rgb:Float32Array,empty:Uint8Array,rect,mixed:Float32Array}}
   */
  function sample(img, cols, rows, opt) {
    opt = opt || {};
    var method = opt.method || 'area';
    var fit = opt.fit || 'fill';
    var rect = computeRect(img.width, img.height, cols, rows, fit, opt.crop);
    var d = img.data, iw = img.width;
    var alphaT = opt.alphaThreshold == null ? 16 : opt.alphaThreshold;
    var bgRgb = opt.background ? root.PindouColor.hexToRgb(opt.background) : null;
    var bgTol = opt.backgroundTolerance == null ? 24 : opt.backgroundTolerance;

    var rgb = new Float32Array(cols * rows * 3);
    var empty = new Uint8Array(cols * rows);
    var mixed = new Float32Array(cols * rows);   // 0-1，格内颜色复杂度（用于「细节过密」提示）

    /* contain：按原图比例算出「内容占几格几行」，再在网格里居中，四周留白。
       （fit='fill' 铺满；fit='cover' 已由 computeRect 裁成目标比例，也铺满。） */
    var letterbox = (fit === 'contain');
    var contentCols = cols, contentRows = rows, offX = 0, offY = 0;
    if (letterbox) {
      var srcRatio2 = rect.w / rect.h, gridRatio = cols / rows;
      if (srcRatio2 > gridRatio) {
        contentCols = cols;
        contentRows = Math.max(1, Math.min(rows, Math.round(cols / srcRatio2)));
      } else if (srcRatio2 < gridRatio) {
        contentRows = rows;
        contentCols = Math.max(1, Math.min(cols, Math.round(rows * srcRatio2)));
      }
      offX = Math.floor((cols - contentCols) / 2);
      offY = Math.floor((rows - contentRows) / 2);
    }

    var cw = rect.w / contentCols, ch = rect.h / contentRows;

    for (var cy = 0; cy < rows; cy++) {
      var iy0c, iy1c;
      if (letterbox) {
        iy0c = cy - offY; iy1c = cy - offY + 1;
      } else {
        iy0c = rect.y + cy * ch; iy1c = rect.y + (cy + 1) * ch;
      }
      var iy0 = Math.max(0, Math.floor(iy0c)), iy1 = Math.min(img.height, Math.ceil(iy1c));
      if (iy1 <= iy0) iy1 = Math.min(img.height, Math.max(0, iy0 + 1));
      for (var cx = 0; cx < cols; cx++) {
        var ix0c, ix1c;
        if (letterbox) {
          ix0c = cx - offX; ix1c = cx - offX + 1;
        } else {
          ix0c = rect.x + cx * cw; ix1c = rect.x + (cx + 1) * cw;
        }
        var ix0 = Math.max(0, Math.floor(ix0c)), ix1 = Math.min(iw, Math.ceil(ix1c));
        if (ix1 <= ix0) ix1 = Math.min(iw, Math.max(0, ix0 + 1));

        var idx = cy * cols + cx;

        // contain：留白区域直接标空
        if (letterbox && (cy < offY || cy >= offY + contentRows || cx < offX || cx >= offX + contentCols)) {
          empty[idx] = 1;
          rgb[idx * 3] = rgb[idx * 3 + 1] = rgb[idx * 3 + 2] = 255;
          continue;
        }

        var r, g, b, aSum = 0, n = 0;

        if (method === 'nearest') {
          var px = Math.min(iw - 1, Math.max(0, Math.floor((ix0 + ix1) / 2)));
          var py = Math.min(img.height - 1, Math.max(0, Math.floor((iy0 + iy1) / 2)));
          var ii = (py * iw + px) * 4;
          r = d[ii]; g = d[ii + 1]; b = d[ii + 2]; aSum = d[ii + 3]; n = 1;
        } else if (method === 'dominant') {
          var hist = Object.create(null), best = null, bestN = 0, cnt = 0;
          for (var y = iy0; y < iy1; y++) {
            for (var x = ix0; x < ix1; x++) {
              var j = (y * iw + x) * 4;
              if (d[j + 3] < alphaT) continue;
              aSum += d[j + 3]; cnt++;
              var key = ((d[j] >> 3) << 10) | ((d[j + 1] >> 3) << 5) | (d[j + 2] >> 3);
              var e = hist[key];
              if (e) { e[3]++; }
              else { e = hist[key] = [d[j], d[j + 1], d[j + 2], 1]; }
              if (e[3] > bestN) { bestN = e[3]; best = e; }
            }
          }
          if (best) { r = best[0]; g = best[1]; b = best[2]; n = cnt; }
          else { r = 255; g = 255; b = 255; n = 0; }
        } else { // area (加权平均，按 alpha 加权)
          var rs = 0, gs = 0, bs = 0, wsum = 0;
          for (var yy = iy0; yy < iy1; yy++) {
            for (var xx = ix0; xx < ix1; xx++) {
              var k = (yy * iw + xx) * 4;
              var al = d[k + 3];
              aSum += al;
              if (al < alphaT) continue;
              var wgt = al / 255;
              // 用线性光空间平均更接近视觉（避免暗部偏亮）
              rs += Math.pow(d[k] / 255, 2.2) * wgt;
              gs += Math.pow(d[k + 1] / 255, 2.2) * wgt;
              bs += Math.pow(d[k + 2] / 255, 2.2) * wgt;
              wsum += wgt;
            }
          }
          n = (iy1 - iy0) * (ix1 - ix0);
          if (wsum > 0) {
            r = Math.pow(rs / wsum, 1 / 2.2) * 255;
            g = Math.pow(gs / wsum, 1 / 2.2) * 255;
            b = Math.pow(bs / wsum, 1 / 2.2) * 255;
          } else { r = 255; g = 255; b = 255; }
        }

        // 透明度 -> 空
        var isTransparent = n > 0 ? (aSum / Math.max(1, (iy1 - iy0) * (ix1 - ix0)) < alphaT) : true;
        if (isTransparent) {
          empty[idx] = 1;
          rgb[idx * 3] = rgb[idx * 3 + 1] = rgb[idx * 3 + 2] = 255;
          continue;
        }
        // 背景色 -> 空
        if (bgRgb && method !== 'dominant') {
          if (Math.abs(r - bgRgb[0]) <= bgTol && Math.abs(g - bgRgb[1]) <= bgTol && Math.abs(b - bgRgb[2]) <= bgTol) {
            empty[idx] = 1;
            rgb[idx * 3] = rgb[idx * 3 + 1] = rgb[idx * 3 + 2] = 255;
            continue;
          }
        }
        rgb[idx * 3] = r; rgb[idx * 3 + 1] = g; rgb[idx * 3 + 2] = b;

        // 格内复杂度：抽样对比格内极值
        if (method === 'area' && n > 4) {
          var lo = 1e9, hi = -1e9, samples = 0;
          var stepX = Math.max(1, Math.floor((ix1 - ix0) / 6)), stepY = Math.max(1, Math.floor((iy1 - iy0) / 6));
          for (var syy = iy0; syy < iy1; syy += stepY) {
            for (var sxx = ix0; sxx < ix1; sxx += stepX) {
              var m = (syy * iw + sxx) * 4;
              if (d[m + 3] < alphaT) continue;
              var lum = 0.299 * d[m] + 0.587 * d[m + 1] + 0.114 * d[m + 2];
              if (lum < lo) lo = lum;
              if (lum > hi) hi = lum;
              samples++;
            }
          }
          if (samples > 2 && hi > lo) mixed[idx] = Math.min(1, (hi - lo) / 128);
        }
      }
    }
    return { cols: cols, rows: rows, rgb: rgb, empty: empty, mixed: mixed, rect: rect };
  }

  root.PindouSampler = {
    sample: sample,
    computeRect: computeRect,
    autoTrim: autoTrim
  };
})(typeof window !== 'undefined' ? window : globalThis);

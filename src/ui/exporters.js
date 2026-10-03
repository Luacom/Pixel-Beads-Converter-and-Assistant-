/* =========================================================================
 * exporters.js — 分享/保存：图纸 PNG、图例 PNG、CSV、项目文件、打印视图
 * 依赖: render.js, pattern.js
 * ========================================================================= */
(function (root) {
  'use strict';

  var MAX_PIXELS = 268435456;   // 浏览器 canvas 面积上限保护（约 16384x16384）

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  function downloadText(text, filename, mime) {
    downloadBlob(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }), filename);
  }

  /** 手机/平板上是否可以用系统分享面板（可以直接「存到相册」） */
  function canShareFiles() {
    try {
      if (!navigator.canShare || !navigator.share) return false;
      var probe = new File([new Blob(['x'])], 'x.png', { type: 'image/png' });
      return navigator.canShare({ files: [probe] });
    } catch (e) { return false; }
  }

  /**
   * 保存/分享画布：
   *  - 手机：优先弹系统分享面板（可存到相册、发微信），不行再退回下载
   *  - 电脑：直接下载
   * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
   */
  function saveCanvas(canvas, filename, type) {
    return canvasToBlob(canvas, type || 'image/png').then(function (blob) {
      if (canShareFiles()) {
        var file = new File([blob], filename, { type: blob.type || 'image/png' });
        return navigator.share({ files: [file], title: filename }).then(function () {
          return 'shared';
        }).catch(function (err) {
          if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return 'cancelled';
          downloadBlob(blob, filename);
          return 'downloaded';
        });
      }
      downloadBlob(blob, filename);
      return 'downloaded';
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('导出失败')); }, type || 'image/png', quality);
      } else {
        try {
          var dataUrl = canvas.toDataURL(type || 'image/png', quality);
          var bin = atob(dataUrl.split(',')[1]);
          var arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: type || 'image/png' }));
        } catch (e) { reject(e); }
      }
    });
  }

  function safeName(s) {
    return String(s || 'pindou').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
  }

  /** 渲染整张图纸（含统计表）并返回 canvas */
  function renderSheetCanvas(pat, opt) {
    var m = root.PindouRender.measureSheet(pat, opt);
    if (m.width * m.height > MAX_PIXELS) {
      throw new Error('图纸太大（' + m.width + '×' + m.height + ' 像素），请调小「单格像素」再导出');
    }
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(m.width);
    cv.height = Math.ceil(m.height);
    var ctx = cv.getContext('2d');
    root.PindouRender.renderSheet(ctx, pat, opt);
    return cv;
  }

  function renderLegendCanvas(pat, opt) {
    var m = root.PindouRender.measureLegend(pat, opt);
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(m.width);
    cv.height = Math.ceil(m.height);
    root.PindouRender.renderLegend(cv.getContext('2d'), pat, opt);
    return cv;
  }

  /* ---------------- CSV ---------------- */
  function statsCsv(pat, packSize) {
    var pal = pat.palette;
    var rows = [['色号', '名称', '分组', 'HEX', 'R', 'G', 'B', '颗数', '包数(' + packSize + '/包)', '已拼', '剩余']];
    pat.stats().list.forEach(function (e) {
      var c = pal.colors[e.index];
      rows.push([e.code, e.name || '', c.group || '', e.hex, c.r, c.g, c.b,
        e.count, Math.ceil(e.count / packSize), e.done, e.remaining]);
    });
    rows.push([]);
    rows.push(['总计', '', '', '', '', '', '', pat.stats().beadsTotal, '', pat.stats().doneTotal, '']);
    rows.push(['图纸尺寸', pat.cols + 'x' + pat.rows, '色卡', pal.title, '用色数', pat.stats().colorsUsed]);
    return '\uFEFF' + rows.map(function (r) {
      return r.map(function (v) {
        var s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /** 只含坐标的「逐颗清单」：按色号分组，列出每颗豆的位置（方便核对 / 二次开发） */
  function positionsCsv(pat) {
    var pal = pat.palette;
    var rows = [['色号', 'HEX', '列', '行', '已拼']];
    var st = pat.stats();
    var order = st.list.map(function (e) { return e.index; });
    order.forEach(function (ci) {
      var code = pal.colors[ci].code, hex = pal.colors[ci].hex;
      for (var y = 0; y < pat.rows; y++) {
        for (var x = 0; x < pat.cols; x++) {
          var i = y * pat.cols + x;
          if (pat.cells[i] !== ci) continue;
          rows.push([code, hex, x + 1, y + 1, pat.done[i] ? '是' : '']);
        }
      }
    });
    return '\uFEFF' + rows.map(function (r) { return r.join(','); }).join('\r\n');
  }

  /* ---------------- 打印 ---------------- */
  /**
   * 生成打印用的页面：第 1 页总图 + 统计；之后按「每页 N 块板」分块。
   * 用 canvas 按纸面宽度自适应缩放，保证看得清。
   */
  function buildPrintPages(pat, opt, opts) {
    opts = opts || {};
    var host = document.getElementById('printArea');
    host.innerHTML = '';
    var pages = [];

    function addPage(canvas, title, note) {
      var page = document.createElement('div');
      page.className = 'print-page';
      if (title) {
        var h = document.createElement('div');
        h.style.cssText = 'font:600 13px sans-serif;margin:0 0 6px';
        h.textContent = title;
        page.appendChild(h);
      }
      canvas.style.cssText = 'width:100%;height:auto;display:block';
      page.appendChild(canvas);
      if (note) {
        var n = document.createElement('div');
        n.style.cssText = 'font:11px sans-serif;color:#555;margin-top:4px';
        n.textContent = note;
        page.appendChild(n);
      }
      host.appendChild(page);
      pages.push(page);
      return page;
    }

    // 第 1 页：总图 + 用量统计
    var sheetOpt = {};
    for (var k in opt) sheetOpt[k] = opt[k];
    sheetOpt.showStats = true;
    sheetOpt.cell = Math.max(9, Math.min(28, Math.floor(1400 / Math.max(pat.cols, pat.rows))));
    addPage(renderSheetCanvas(pat, sheetOpt), null, null);

    // 后续页：按拼豆板分块（每页最多 4 块，2x2）
    if (opts.boardW && opts.boardH) {
      var boards = pat.boards(opts.boardW, opts.boardH, opts.overlap || 0);
      if (boards.length > 1) {
        var perPage = 4;
        for (var i = 0; i < boards.length; i += perPage) {
          var slice = boards.slice(i, i + perPage);
          var colsPerRow = slice.length > 1 ? 2 : 1;
          var cell = 26;
          var gap = 14;
          var boardPx = opts.boardW * cell, boardPxH = opts.boardH * cell;
          var rowsN = Math.ceil(slice.length / colsPerRow);
          var W = colsPerRow * boardPx + (colsPerRow + 1) * gap;
          var H = rowsN * (boardPxH + 26) + (rowsN + 1) * gap;
          var cv = document.createElement('canvas');
          cv.width = W; cv.height = H;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          slice.forEach(function (b, idx) {
            var bx = gap + (idx % colsPerRow) * (boardPx + gap);
            var by = gap + Math.floor(idx / colsPerRow) * (boardPxH + 26 + gap) + 18;
            ctx.fillStyle = '#111';
            ctx.font = '600 13px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('第 ' + (b.x + 1) + '–' + (b.x + b.w) + ' 列 / 第 ' + (b.y + 1) + '–' + (b.y + b.h) + ' 行' +
              '（板 ' + (Math.floor(b.y / (opts.boardH - (opts.overlap || 0))) + 1) + ' 行 ' +
              (Math.floor(b.x / (opts.boardW - (opts.overlap || 0))) + 1) + ' 列）', bx, by - 5);
            // 局部渲染
            var sub = document.createElement('canvas');
            sub.width = b.w * cell; sub.height = b.h * cell;
            var sctx = sub.getContext('2d');
            drawSubPattern(sctx, pat, b, cell, opt);
            ctx.drawImage(sub, bx, by);
          });
          addPage(cv, '分板图纸（对着板子拼）', '每块板标注了它在整张图里的行列范围；拼完一块再拼下一块。');
        }
      }
    }
    return pages;
  }

  /** 在指定 ctx 上画图纸的一个子区域（含色号与网格） */
  function drawSubPattern(ctx, pat, box, cell, opt) {
    var o = root.PindouRender.mergeDefaults(opt);
    o.cell = cell;
    var pal = pat.palette;
    var stats = pat.stats();
    var axis = o.showCoords ? Math.max(14, Math.min(cell, 18)) : 0;

    // 底色
    ctx.fillStyle = root.PindouRender.STYLE.emptyFill;
    ctx.fillRect(axis, axis, box.w * cell, box.h * cell);

    for (var y = 0; y < box.h; y++) {
      for (var x = 0; x < box.w; x++) {
        var sx = box.x + x, sy = box.y + y;
        if (sx >= pat.cols || sy >= pat.rows) continue;
        var i = sy * pat.cols + sx;
        var ci = pat.cells[i];
        if (ci < 0) continue;
        var col = pal.colors[ci];
        var px = axis + x * cell, py = axis + y * cell;
        ctx.fillStyle = col.hex;
        ctx.fillRect(px, py, cell, cell);
        if (o.showCodes && cell >= 11) {
          var entry = stats.byIndex[ci];
          var text = o.codeMode === 'number' ? String(entry ? entry.legendNo || (ci + 1) : ci + 1)
            : o.codeMode === 'symbol' ? root.PindouRender.symbolFor(ci)
              : col.code;
          var fs = Math.max(6, Math.min(cell * 0.44, cell - 3));
          ctx.font = '600 ' + fs.toFixed(1) + 'px Arial,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(1.4, fs / 5);
          ctx.strokeStyle = 'rgba(0,0,0,.35)';
          ctx.strokeText(text, px + cell / 2, py + cell / 2);
          ctx.fillStyle = root.PindouColor.contrastText(col.r, col.g, col.b);
          ctx.fillText(text, px + cell / 2, py + cell / 2);
        }
      }
    }
    // 网格
    var bold = o.boldEvery > 0 ? o.boldEvery : 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath();
    for (var gx = 0; gx <= box.w; gx++) {
      var gxp = axis + gx * cell;
      if (bold && (box.x + gx) % bold === 0) continue;
      ctx.moveTo(gxp + 0.5, axis); ctx.lineTo(gxp + 0.5, axis + box.h * cell);
    }
    for (var gy = 0; gy <= box.h; gy++) {
      var gyp = axis + gy * cell;
      if (bold && (box.y + gy) % bold === 0) continue;
      ctx.moveTo(axis, gyp + 0.5); ctx.lineTo(axis + box.w * cell, gyp + 0.5);
    }
    ctx.stroke();
    if (bold) {
      ctx.lineWidth = Math.max(1.5, cell / 10);
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.beginPath();
      for (var gx2 = 0; gx2 <= box.w; gx2++) {
        if ((box.x + gx2) % bold !== 0) continue;
        var x2 = axis + gx2 * cell;
        ctx.moveTo(x2 + 0.5, axis); ctx.lineTo(x2 + 0.5, axis + box.h * cell);
      }
      for (var gy2 = 0; gy2 <= box.h; gy2++) {
        if ((box.y + gy2) % bold !== 0) continue;
        var y2 = axis + gy2 * cell;
        ctx.moveTo(axis, y2 + 0.5); ctx.lineTo(axis + box.w * cell, y2 + 0.5);
      }
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(2, cell / 9);
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeRect(axis + 0.5, axis + 0.5, box.w * cell, box.h * cell);

    // 坐标（标注整张图里的真实行列号）
    if (axis) {
      var fs2 = Math.max(7, Math.min(cell * 0.4, 12));
      ctx.font = '600 ' + fs2.toFixed(1) + 'px Arial,sans-serif';
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var cx2 = 0; cx2 < box.w; cx2++) {
        if ((box.x + cx2 + 1) % (o.coordEvery || 1) !== 0) continue;
        ctx.fillText(String(box.x + cx2 + 1), axis + cx2 * cell + cell / 2, axis / 2);
      }
      for (var cy2 = 0; cy2 < box.h; cy2++) {
        if ((box.y + cy2 + 1) % (o.coordEvery || 1) !== 0) continue;
        ctx.fillText(String(box.y + cy2 + 1), axis / 2, axis + cy2 * cell + cell / 2);
      }
    }
  }

  root.PindouExport = {
    downloadBlob: downloadBlob,
    downloadText: downloadText,
    canvasToBlob: canvasToBlob,
    canShareFiles: canShareFiles,
    saveCanvas: saveCanvas,
    safeName: safeName,
    renderSheetCanvas: renderSheetCanvas,
    renderLegendCanvas: renderLegendCanvas,
    statsCsv: statsCsv,
    positionsCsv: positionsCsv,
    buildPrintPages: buildPrintPages,
    drawSubPattern: drawSubPattern
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================================
 * render.js — 绘制：画布视图 + 图纸导出（网格/坐标/色号/统计表）
 * 依赖: color.js, pattern.js
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.PindouColor;

  /* ==================== 样式 ==================== */
  var STYLE = {
    emptyFill: '#F2F3F5',
    emptyStroke: '#DDE0E4',
    gridLight: 'rgba(0,0,0,0.28)',
    gridBold: 'rgba(0,0,0,0.62)',
    gridOuter: 'rgba(0,0,0,0.85)',
    axisFill: '#FFFFFF',
    axisStroke: 'rgba(0,0,0,0.55)',
    axisText: '#20242B',
    axisTextBold: '#000000',
    codeDark: '#111418',
    codeLight: '#FFFFFF',
    codeHalo: 'rgba(255,255,255,0.72)',
    doneOverlay: 'rgba(255,255,255,0.62)',
    doneMark: '#16A34A',
    dimOverlay: 'rgba(244,246,248,0.80)',
    cursor: '#FF3B30',
    selected: '#0A84FF',
    canvasBg: '#FFFFFF'
  };

  var DEFAULTS = {
    cell: 22,                 // 每格像素
    showGrid: true,
    boldEvery: 5,             // 每 N 格一条粗线；0 = 关闭
    showCoords: true,         // 行/列坐标
    coordEvery: 1,            // 坐标数字每隔几格标一次（1=每格）
    showCodes: true,          // 格内显示色号
    codeMode: 'code',         // 'code' | 'symbol' | 'number'
    showDoneMark: true,       // 已拼格子打勾/变淡
    dimDone: true,            // 已拼格子变淡
    showStats: true,          // 下方统计表（导出用）
    statsPerRow: 0,           // 0 = 自动
    showTitle: true,
    title: '',
    subtitle: '',
    showLegendNumbers: true,  // 统计表里的序号，与格内数字对应
    showBoardLines: 0,        // 每 N 格画分板粗线（0=关）
    boardStepX: 29,
    boardStepY: 29,
    isolateColor: -1,         // >=0 时只高亮该色号
    markColorIndex: -1,       // >=0 时高亮所有该色号格子
    cursor: null,             // {x,y}
    selection: null,          // {x0,y0,x1,y1}
    maxCodeCells: 20000,      // 超过这个格数就不画色号（防止糊成一团）
    watermark: ''
  };

  function mergeDefaults(opt) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    for (var k2 in (opt || {})) if (opt[k2] !== undefined) o[k2] = opt[k2];
    return o;
  }

  /* ==================== 符号：高对比度阅读（黑白打印 / 色弱） ==================== */
  var SYMBOLS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%&*+=?!';
  function symbolFor(i) {
    if (i < SYMBOLS.length) return SYMBOLS[i];
    return SYMBOLS[i % SYMBOLS.length] + Math.floor(i / SYMBOLS.length);
  }

  /* ==================== 网格几何 ==================== */
  function createFrame(pat, opt) {
    opt = mergeDefaults(opt);
    var cell = opt.cell;
    var bold = opt.boldEvery > 0 ? opt.boldEvery : 0;
    // 坐标区宽度/高度需要按数字长度算
    var maxDigits = Math.max(String(pat.cols).length, String(pat.rows).length);
    var axisSize = opt.showCoords ? Math.round(Math.max(14, Math.min(cell, 11 + maxDigits * 1.2))) : 0;
    var boardX = pat.cols * cell + axisSize;
    var boardY = pat.rows * cell + axisSize;
    void bold;
    return {
      opt: opt, axisSize: axisSize,
      boardX: boardX, boardY: boardY,
      x0: axisSize, y0: axisSize
    };
  }

  /** 把画布坐标换算成格子坐标（视图用，含平移缩放） */
  function hitTest(frame, view, px, py) {
    var opt = frame.opt;
    var gx = (px - view.offsetX - frame.x0 * view.scale) / (opt.cell * view.scale);
    var gy = (py - view.offsetY - frame.y0 * view.scale) / (opt.cell * view.scale);
    return { x: Math.floor(gx), y: Math.floor(gy), fx: gx, fy: gy };
  }

  /* ==================== 基础绘制：单个格子 ==================== */
  function cellTextInfo(pat, index, entry, opt) {
    var col = pat.palette.colors[index];
    var text;
    if (opt.codeMode === 'symbol') text = symbolFor(entry && entry.symbolIndex != null ? entry.symbolIndex : index);
    else if (opt.codeMode === 'number') text = String((entry && entry.legendNo) || (index + 1));
    else text = col.code;
    return { text: text, color: C.contrastText(col.r, col.g, col.b), col: col };
  }

  function drawCell(ctx, px, py, size, color, text, textColor, o) {
    o = o || {};
    ctx.fillStyle = color;
    ctx.fillRect(px, py, size, size);
    if (size >= 7 && text) {
      var fs = o.fontSize || Math.max(5, Math.min(size * 0.46, size - 3));
      ctx.font = (o.fontWeight || '600') + ' ' + fs.toFixed(1) + 'px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (o.halo) {
        ctx.lineWidth = Math.max(1.5, fs / 5);
        ctx.strokeStyle = textColor === '#FFFFFF' ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.65)';
        ctx.strokeText(text, px + size / 2, py + size / 2 + fs * 0.04);
      }
      ctx.fillStyle = textColor;
      ctx.fillText(text, px + size / 2, py + size / 2 + fs * 0.04);
    }
  }

  function drawDoneMark(ctx, px, py, size) {
    var c = size / 2, r = size * 0.30;
    ctx.beginPath();
    ctx.moveTo(px + c - r, py + c - r * 0.05);
    ctx.lineTo(px + c - r * 0.2, py + c + r * 0.62);
    ctx.lineTo(px + c + r * 1.05, py + c - r * 0.75);
    ctx.lineWidth = Math.max(1.4, size * 0.11);
    ctx.strokeStyle = STYLE.doneMark;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  /** 在已铺好底色的画布上画网格线（分块绘制，减少 path 数量） */
  function drawGridLines(ctx, frame, pat, opt, clip) {
    if (!opt.showGrid) return;
    var cell = opt.cell;
    var x0 = frame.x0 + (clip ? clip.x0 : 0) * cell;
    var y0 = frame.y0 + (clip ? clip.y0 : 0) * cell;
    var x1 = frame.x0 + (clip ? clip.x1 : pat.cols) * cell;
    var y1 = frame.y0 + (clip ? clip.y1 : pat.rows) * cell;
    var bold = opt.boldEvery > 0 ? opt.boldEvery : 0;
    var board = opt.showBoardLines > 0 ? opt.showBoardLines : 0;
    var i;

    ctx.lineWidth = 1;
    ctx.strokeStyle = STYLE.gridLight;
    ctx.beginPath();
    var sx = clip ? Math.max(clip.x0, 0) : 0, ex = clip ? clip.x1 : pat.cols;
    var sy = clip ? Math.max(clip.y0, 0) : 0, ey = clip ? clip.y1 : pat.rows;
    for (i = sx; i <= ex; i++) {
      if (bold && i % bold === 0) continue;
      if (board && i % board === 0) continue;
      var vx = Math.round(frame.x0 + i * cell) + 0.5;
      ctx.moveTo(vx, y0); ctx.lineTo(vx, y1);
    }
    for (i = sy; i <= ey; i++) {
      if (bold && i % bold === 0) continue;
      if (board && i % board === 0) continue;
      var vy = Math.round(frame.y0 + i * cell) + 0.5;
      ctx.moveTo(x0, vy); ctx.lineTo(x1, vy);
    }
    ctx.stroke();

    if (bold) {
      ctx.lineWidth = Math.max(1.6, cell / 10);
      ctx.strokeStyle = STYLE.gridBold;
      ctx.beginPath();
      for (i = sx; i <= ex; i += 1) {
        if (i % bold !== 0) continue;
        if (board && i % board === 0) continue;
        var bx = Math.round(frame.x0 + i * cell) + 0.5;
        ctx.moveTo(bx, y0); ctx.lineTo(bx, y1);
      }
      for (i = sy; i <= ey; i += 1) {
        if (i % bold !== 0) continue;
        if (board && i % board === 0) continue;
        var by = Math.round(frame.y0 + i * cell) + 0.5;
        ctx.moveTo(x0, by); ctx.lineTo(x1, by);
      }
      ctx.stroke();
    }
    if (board) {
      ctx.lineWidth = Math.max(2.4, cell / 6);
      ctx.strokeStyle = '#E4572E';
      ctx.beginPath();
      for (i = sx; i <= ex; i++) {
        if (i % board !== 0) continue;
        var px2 = Math.round(frame.x0 + i * cell) + 0.5;
        ctx.moveTo(px2, y0); ctx.lineTo(px2, y1);
      }
      for (i = sy; i <= ey; i++) {
        if (i % board !== 0) continue;
        var py2 = Math.round(frame.y0 + i * cell) + 0.5;
        ctx.moveTo(x0, py2); ctx.lineTo(x1, py2);
      }
      ctx.stroke();
    }
    // 外框
    ctx.lineWidth = Math.max(2, cell / 9);
    ctx.strokeStyle = STYLE.gridOuter;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
  }

  /** 画坐标数字（每 N 格一个，粗线处加粗） */
  function drawCoords(ctx, frame, pat, opt) {
    if (!opt.showCoords) return;
    var cell = opt.cell, A = frame.axisSize;
    var fs = Math.max(7, Math.min(cell * 0.42, 13));

    // 先铺左上角空白，再写字，避免盖住第一个坐标
    ctx.fillStyle = '#FAFAFB';
    ctx.fillRect(0, 0, A, A);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(A + 0.5, 0); ctx.lineTo(A + 0.5, A);
    ctx.moveTo(0, A + 0.5); ctx.lineTo(A, A + 0.5);
    ctx.stroke();

    ctx.font = '500 ' + fs.toFixed(1) + 'px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var every = Math.max(1, opt.coordEvery | 0);
    var bold = opt.boldEvery > 0 ? opt.boldEvery : 5;
    var x, i;

    // 顶部坐标
    for (i = 0; i < pat.cols; i++) {
      if (i % every !== 0) continue;
      x = frame.x0 + i * cell + cell / 2;
      var isBold = (i % bold === 0);
      ctx.font = (isBold ? '700 ' : '500 ') + (isBold ? fs * 1.02 : fs).toFixed(1) + 'px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillStyle = isBold ? STYLE.axisTextBold : STYLE.axisText;
      ctx.fillText(String(i + 1), x, A / 2);
    }
    // 左侧坐标
    for (i = 0; i < pat.rows; i++) {
      if (i % every !== 0) continue;
      var y = frame.y0 + i * cell + cell / 2;
      var isBold2 = (i % bold === 0);
      ctx.font = (isBold2 ? '700 ' : '500 ') + (isBold2 ? fs * 1.02 : fs).toFixed(1) + 'px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillStyle = isBold2 ? STYLE.axisTextBold : STYLE.axisText;
      ctx.fillText(String(i + 1), A / 2, y);
    }
  }

  /* ==================== 视图渲染（交互画布） ==================== */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Pattern} pat
   * @param {Object} view {width,height,scale,offsetX,offsetY,dpr}
   * @param {Object} opt  显示选项（见 DEFAULTS）
   */
  function renderView(ctx, pat, view, opt) {
    var o = mergeDefaults(opt);
    var frame = createFrame(pat, o);
    var cell = o.cell;

    ctx.save();
    ctx.setTransform(view.dpr || 1, 0, 0, view.dpr || 1, 0, 0);
    ctx.fillStyle = STYLE.canvasBg;
    ctx.fillRect(0, 0, view.width, view.height);

    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    // 可见格子范围（带 1 格余量）
    var invScale = 1 / view.scale;
    var vx0 = Math.max(0, Math.floor((-view.offsetX) * invScale / cell) - 1);
    var vy0 = Math.max(0, Math.floor((-view.offsetY) * invScale / cell) - 1);
    var vx1 = Math.min(pat.cols, Math.ceil((view.width - view.offsetX) * invScale / cell) + 1);
    var vy1 = Math.min(pat.rows, Math.ceil((view.height - view.offsetY) * invScale / cell) + 1);
    var stats = pat.stats();
    var canCode = o.showCodes && (pat.cols * pat.rows <= o.maxCodeCells || cell * view.scale >= 15);
    var showCodeNow = o.showCodes && canCode;

    // 底色（空格子）
    if (o.isolateColor >= 0) {
      ctx.fillStyle = STYLE.dimOverlay;
      ctx.fillRect(frame.x0 + vx0 * cell, frame.y0 + vy0 * cell, (vx1 - vx0) * cell, (vy1 - vy0) * cell);
    } else {
      ctx.fillStyle = STYLE.emptyFill;
      ctx.fillRect(frame.x0 + vx0 * cell, frame.y0 + vy0 * cell, (vx1 - vx0) * cell, (vy1 - vy0) * cell);
    }

    // 格子
    for (var y = vy0; y < vy1; y++) {
      for (var x = vx0; x < vx1; x++) {
        var i = y * pat.cols + x;
        var ci = pat.cells[i];
        if (ci < 0) {
          if (o.showGrid) {
            // 空格子画一个浅色点，便于分辨（用不着，跳过）
          }
          continue;
        }
        var col = pat.palette.colors[ci];
        var px = frame.x0 + x * cell, py = frame.y0 + y * cell;
        var isIsolated = (o.isolateColor >= 0 && ci !== o.isolateColor);
        var entry = stats.byIndex[ci];

        ctx.fillStyle = col.hex;
        ctx.fillRect(px, py, cell, cell);

        if (isIsolated) {
          ctx.fillStyle = STYLE.dimOverlay;
          ctx.fillRect(px, py, cell, cell);
        } else if (showCodeNow && cell * view.scale >= 8) {
          var ti = cellTextInfo(pat, ci, entry, o);
          drawCell(ctx, px, py, cell, col.hex, ti.text, ti.color, { halo: true });
        }

        // 已拼标记
        if (pat.done[i]) {
          if (o.dimDone) {
            ctx.fillStyle = STYLE.doneOverlay;
            ctx.fillRect(px, py, cell, cell);
          }
          if (o.showDoneMark && cell > 6) drawDoneMark(ctx, px, py, cell);
        }
        // 目标色号高亮（正在拼的颜色）
        if (o.markColorIndex >= 0 && ci === o.markColorIndex && !isIsolated) {
          ctx.strokeStyle = '#FFB020';
          ctx.lineWidth = Math.max(1.2, cell * 0.09);
          ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
        }
      }
    }

    drawGridLines(ctx, frame, pat, o, { x0: vx0, y0: vy0, x1: vx1, y1: vy1 });
    drawCoords(ctx, frame, pat, o);

    // 光标（当前要拼的格子）
    if (o.cursor && o.cursor.x >= 0 && o.cursor.x < pat.cols && o.cursor.y >= 0 && o.cursor.y < pat.rows) {
      var cxp = frame.x0 + o.cursor.x * cell, cyp = frame.y0 + o.cursor.y * cell;
      ctx.lineWidth = Math.max(2, cell * 0.14);
      ctx.strokeStyle = STYLE.cursor;
      ctx.strokeRect(cxp - ctx.lineWidth / 2, cyp - ctx.lineWidth / 2, cell + ctx.lineWidth, cell + ctx.lineWidth);
      // 十字辅助线
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(frame.x0, cyp + cell / 2); ctx.lineTo(frame.boardX, cyp + cell / 2);
      ctx.moveTo(cxp + cell / 2, frame.y0); ctx.lineTo(cxp + cell / 2, frame.boardY);
      ctx.strokeStyle = STYLE.cursor;
      ctx.stroke();
      ctx.restore();
    }

    // 框选
    if (o.selection) {
      var s = o.selection;
      var rx = frame.x0 + Math.min(s.x0, s.x1) * cell;
      var ry = frame.y0 + Math.min(s.y0, s.y1) * cell;
      var rw = (Math.abs(s.x1 - s.x0) + 1) * cell;
      var rh = (Math.abs(s.y1 - s.y0) + 1) * cell;
      ctx.fillStyle = 'rgba(10,132,255,0.14)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = STYLE.selected;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    ctx.restore();
    return frame;
  }

  /* ==================== 导出：完整图纸（含统计表） ==================== */
  /**
   * 量算导出画布尺寸（先算后画，避免超大画布）
   * 版式：标题 / 网格 / 色号统计（多列自适应）/ 页脚
   */
  function measureSheet(pat, opt) {
    var o = mergeDefaults(opt);
    var frame = createFrame(pat, o);
    var stats = pat.stats();
    var n = stats.list.length;

    // 每个统计项大约需要的宽度（色块 + 色号 + 颗数）
    var itemMinW = 128;
    var perRow = o.statsPerRow > 0
      ? o.statsPerRow
      : Math.max(3, Math.min(10, Math.floor((frame.boardX - 24) / itemMinW)));
    perRow = Math.min(perRow, Math.max(1, n));

    var rowsOfStats = Math.ceil(n / perRow);
    var itemH = 34;
    var headH = o.showTitle ? 74 : 16;
    var statsH = o.showStats ? (rowsOfStats * itemH + 82) : 16;
    var footerH = 34;

    // 统计区不要比网格还宽；网格很宽时统计按上限分列，右侧留白
    var statsWidth = o.showStats ? Math.min(frame.boardX - 24, perRow * 150 + 24) : 0;
    var width = Math.max(frame.boardX + 24, statsWidth + 24);
    var height = headH + frame.boardY + 20 + statsH + footerH;

    return {
      o: o, frame: frame, stats: stats, perRow: perRow,
      rowsOfStats: rowsOfStats, itemH: itemH,
      headH: headH, statsH: statsH, footerH: footerH,
      width: width,
      height: height,
      itemW: (o.showStats ? Math.min(frame.boardX, perRow * 150) : frame.boardX) / perRow
    };
  }

  function renderSheet(ctx, pat, opt) {
    var m = measureSheet(pat, opt);
    var o = m.o, frame = m.frame, stats = m.stats;
    var pad = 12;
    var W = m.width;

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, m.height);

    /* ---- 标题区 ---- */
    var yCur = 0;
    if (o.showTitle) {
      ctx.fillStyle = '#12161C';
      ctx.font = '700 26px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      var title = o.title || (pat.meta && pat.meta.title) || '拼豆图纸';
      ctx.fillText(title, pad, 36);
      ctx.font = '400 13px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#5B6470';
      var sub = o.subtitle || buildSubtitle(pat, stats);
      ctx.fillText(sub, pad, 58);
      ctx.strokeStyle = '#E3E6EA';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad, 66.5); ctx.lineTo(W - pad, 66.5); ctx.stroke();
      yCur = m.headH;
    } else {
      yCur = 16;
    }

    /* ---- 网格区 ---- */
    ctx.save();
    ctx.translate(pad, yCur);
    // 底色
    ctx.fillStyle = STYLE.emptyFill;
    ctx.fillRect(frame.x0, frame.y0, pat.cols * o.cell, pat.rows * o.cell);
    // 画格子
    var canCode = o.showCodes && (o.cell >= 9 || pat.cols * pat.rows <= 12000);
    for (var y = 0; y < pat.rows; y++) {
      for (var x = 0; x < pat.cols; x++) {
        var i = y * pat.cols + x;
        var ci = pat.cells[i];
        if (ci < 0) continue;
        var col = pat.palette.colors[ci];
        var px = frame.x0 + x * o.cell, py = frame.y0 + y * o.cell;
        var entry = stats.byIndex[ci];
        if (canCode) {
          var ti = cellTextInfo(pat, ci, entry, o);
          drawCell(ctx, px, py, o.cell, col.hex, ti.text, ti.color, { halo: true });
        } else {
          ctx.fillStyle = col.hex;
          ctx.fillRect(px, py, o.cell, o.cell);
        }
      }
    }
    drawGridLines(ctx, frame, pat, o, null);
    drawCoords(ctx, frame, pat, o);
    ctx.restore();
    yCur += frame.boardY + 20;

    /* ---- 统计表 ---- */
    if (o.showStats) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#12161C';
      ctx.font = '700 17px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillText('色号统计 / 用量清单', pad, yCur + 18);
      ctx.font = '400 12px "Inter","Helvetica Neue",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#5B6470';
      ctx.fillText('共 ' + stats.colorsUsed + ' 种颜色 · ' + stats.beadsTotal + ' 颗豆（不含空格 ' + stats.emptyTotal + ' 格）',
        pad + 190, yCur + 18);
      yCur += 32;

      var itemW = m.itemW;
      var sw = Math.min(26, itemW * 0.16);
      for (var k = 0; k < stats.list.length; k++) {
        var e = stats.list[k];
        var r = Math.floor(k / m.perRow), c = k % m.perRow;
        var ix = pad + c * itemW, iy = yCur + r * m.itemH;
        // 色块
        ctx.fillStyle = e.hex;
        ctx.fillRect(ix, iy + 3, sw, sw * 0.82);
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(ix + 0.5, iy + 3.5, sw - 1, sw * 0.82 - 1);
        // 序号
        if (o.showLegendNumbers) {
          ctx.fillStyle = C.contrastText(e.r, e.g, e.b);
          ctx.font = '700 ' + (sw * 0.42).toFixed(1) + 'px Arial,sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(k + 1), ix + sw / 2, iy + 3 + sw * 0.41);
        }
        // 色号 + 数量
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#12161C';
        ctx.font = '700 ' + Math.max(11, Math.min(14, itemW * 0.075)).toFixed(1) + 'px "Inter",Arial,"Microsoft YaHei",sans-serif';
        var codeTxt = e.code + (e.name ? ' ' + e.name : '');
        ctx.fillText(clipText(ctx, codeTxt, itemW - sw - 12), ix + sw + 6, iy + 13);
        ctx.font = '600 ' + Math.max(11, Math.min(14, itemW * 0.075)).toFixed(1) + 'px "Inter",Arial,"Microsoft YaHei",sans-serif';
        ctx.fillStyle = '#0A6CD4';
        ctx.fillText(e.count + ' 颗', ix + sw + 6, iy + 29);
        // 已拼进度
        if (e.done > 0) {
          ctx.font = '500 11px "Inter",Arial,sans-serif';
          ctx.fillStyle = e.remaining === 0 ? '#16A34A' : '#8A6D1F';
          ctx.fillText(e.remaining === 0 ? '✓已完成' : ('已拼 ' + e.done), ix + sw + 6 + Math.min(64, itemW * 0.42), iy + 29);
        }
      }
      yCur += m.rowsOfStats * m.itemH + 20;

      // 已完成进度条
      if (stats.doneTotal > 0) {
        var barW = frame.boardX - 24;
        ctx.fillStyle = '#EDEFF2';
        ctx.fillRect(pad, yCur, barW, 12);
        ctx.fillStyle = '#16A34A';
        ctx.fillRect(pad, yCur, barW * stats.doneRatio, 12);
        ctx.fillStyle = '#3B424B';
        ctx.font = '500 12px "Inter",Arial,"Microsoft YaHei",sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('拼豆进度 ' + stats.doneTotal + ' / ' + stats.beadsTotal + '（' + Math.round(stats.doneRatio * 100) + '%）', pad, yCur + 30);
        yCur += 44;
      }
    }

    /* ---- 页脚 ---- */
    ctx.strokeStyle = '#E3E6EA';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, m.height - m.footerH + 0.5); ctx.lineTo(W - pad, m.height - m.footerH + 0.5); ctx.stroke();
    ctx.fillStyle = '#7A838F';
    ctx.font = '400 11px "Inter",Arial,"Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    var pal = pat.palette;
    ctx.fillText('色卡：' + (pal ? pal.title : '') + '　格子：' + pat.cols + ' × ' + pat.rows + '　每 ' + o.boldEvery + ' 格粗线',
      pad, m.height - 12);
    if (o.watermark) {
      ctx.textAlign = 'right';
      ctx.fillText(o.watermark, W - pad, m.height - 12);
    }
    ctx.restore();
    return m;
  }

  function buildSubtitle(pat, stats) {
    var pal = pat.palette;
    var parts = [];
    parts.push('色卡 ' + (pal ? pal.title + '（' + pal.size() + '色）' : ''));
    parts.push('尺寸 ' + pat.cols + '×' + pat.rows + ' 格');
    parts.push('用色 ' + stats.colorsUsed + ' 种');
    parts.push('豆子 ' + stats.beadsTotal + ' 颗');
    parts.push(new Date().toLocaleDateString('zh-CN'));
    return parts.join(' · ');
  }

  function clipText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  /** 只导出统计表（采购清单） */
  function measureLegend(pat, opt) {
    var o = mergeDefaults(opt);
    var stats = pat.stats();
    var perRow = o.statsPerRow > 0 ? o.statsPerRow : 4;
    var rows = Math.ceil(stats.list.length / perRow);
    var itemH = 40;
    return {
      o: o, stats: stats, perRow: perRow, rows: rows, itemH: itemH,
      width: 1000, height: 120 + rows * itemH + 60
    };
  }
  function renderLegend(ctx, pat, opt) {
    var m = measureLegend(pat, opt);
    var stats = m.stats, W = m.width;
    ctx.save();
    ctx.fillStyle = '#FFF';
    ctx.fillRect(0, 0, W, m.height);
    var pal = pat.palette;
    ctx.fillStyle = '#12161C';
    ctx.font = '700 26px "Inter",Arial,"Microsoft YaHei",sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('拼豆采购清单', 24, 44);
    ctx.font = '400 13px "Inter",Arial,"Microsoft YaHei",sans-serif';
    ctx.fillStyle = '#5B6470';
    ctx.fillText((pal ? pal.title : '') + ' · 共 ' + stats.colorsUsed + ' 色 · ' + stats.beadsTotal + ' 颗（按 1000 颗/包估算）', 24, 68);
    var itemW = (W - 48) / m.perRow;
    var y0 = 96;
    for (var k = 0; k < stats.list.length; k++) {
      var e = stats.list[k];
      var r = Math.floor(k / m.perRow), c = k % m.perRow;
      var ix = 24 + c * itemW, iy = y0 + r * m.itemH;
      ctx.fillStyle = e.hex;
      ctx.fillRect(ix, iy + 4, 30, 24);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.strokeRect(ix + 0.5, iy + 4.5, 29, 23);
      ctx.fillStyle = C.contrastText(e.r, e.g, e.b);
      ctx.font = '700 11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(String(k + 1), ix + 15, iy + 20);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#12161C';
      ctx.font = '700 15px "Inter",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillText(e.code, ix + 38, iy + 16);
      ctx.font = '500 12px "Inter",Arial,"Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#3B424B';
      ctx.fillText(e.count + ' 颗 · ' + Math.ceil(e.count / 1000) + ' 包', ix + 38, iy + 33);
    }
    ctx.restore();
    return m;
  }

  root.PindouRender = {
    STYLE: STYLE,
    DEFAULTS: DEFAULTS,
    SYMBOLS: SYMBOLS,
    symbolFor: symbolFor,
    mergeDefaults: mergeDefaults,
    createFrame: createFrame,
    hitTest: hitTest,
    renderView: renderView,
    renderSheet: renderSheet,
    measureSheet: measureSheet,
    renderLegend: renderLegend,
    measureLegend: measureLegend,
    drawGridLines: drawGridLines,
    drawCoords: drawCoords
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================================
 * ui.js — 界面：画布视图、鼠标/键盘交互、用量清单、色卡、分板、检查
 * 依赖: render.js, pattern.js, exporters.js, app.js（通过 root.PindouApp 回调）
 * ========================================================================= */
(function (root) {
  'use strict';
  var R = root.PindouRender;
  var PAT = root.PindouPattern;

  var $ = function (id) { return document.getElementById(id); };
  var el = {};

  /* ==================== 视图状态 ==================== */
  var view = {
    scale: 1,
    minScale: 0.05,
    maxScale: 40,
    offsetX: 0,
    offsetY: 0,
    width: 0,
    height: 0,
    dpr: 1
  };
  var display = {
    cell: 22, showGrid: true, boldEvery: 5, showCoords: true, coordEvery: 1,
    showCodes: true, codeMode: 'code', showDoneMark: true, dimDone: true,
    isolateColor: -1, markColorIndex: -1, cursor: null, selection: null,
    showBoardLines: 0, boardStepX: 29, boardStepY: 29, showBoardLinesOn: false,
    showTitle: true, title: '', subtitle: '', showStats: true, showLegendNumbers: true
  };
  var redrawQueued = false;
  var hover = null;
  var drag = null;         // {mode:'paint'|'pan'|'select', ...}
  var undoStack = [];
  var lastPainted = null;

  function toast(msg, kind, ms) {
    var wrap = $('toastWrap');
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 280);
    }, ms || 2200);
  }

  /* ==================== 尺寸 / 坐标 ==================== */
  function resizeCanvas() {
    var wrap = $('canvasWrap');
    var cv = $('view');
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    var w = wrap.clientWidth, h = wrap.clientHeight;
    view.width = w; view.height = h; view.dpr = dpr;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    requestRedraw();
  }

  function frameOf(pat) {
    return R.createFrame(pat, displayOpts());
  }
  function displayOpts() {
    var o = {};
    for (var k in display) o[k] = display[k];
    o.cursor = display.cursor;
    o.showBoardLines = display.showBoardLinesOn ? (display.boardStepX || 29) : 0;
    return o;
  }

  function fitToWindow(pat) {
    var f = frameOf(pat);
    var pad = 24;
    var sx = (view.width - pad * 2) / f.boardX;
    var sy = (view.height - pad * 2) / f.boardY;
    view.scale = Math.max(0.02, Math.min(sx, sy));
    view.offsetX = (view.width - f.boardX * view.scale) / 2;
    view.offsetY = (view.height - f.boardY * view.scale) / 2;
    updateZoomLabel();
    requestRedraw();
  }

  function zoomAt(factor, cx, cy) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    cx = cx == null ? view.width / 2 : cx;
    cy = cy == null ? view.height / 2 : cy;
    var old = view.scale;
    var next = Math.max(view.minScale, Math.min(view.maxScale, old * factor));
    if (next === old) return;
    // 保持鼠标下的点不动
    var gx = (cx - view.offsetX) / old, gy = (cy - view.offsetY) / old;
    view.scale = next;
    view.offsetX = cx - gx * next;
    view.offsetY = cy - gy * next;
    updateZoomLabel();
    requestRedraw();
  }

  function setZoom(z) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    var old = view.scale;
    view.scale = Math.max(view.minScale, Math.min(view.maxScale, z));
    var gx = (view.width / 2 - view.offsetX) / old, gy = (view.height / 2 - view.offsetY) / old;
    view.offsetX = view.width / 2 - gx * view.scale;
    view.offsetY = view.height / 2 - gy * view.scale;
    updateZoomLabel();
    requestRedraw();
  }

  function updateZoomLabel() {
    var z = $('zoomLabel');
    if (z) z.textContent = Math.round(view.scale * 100) + '%';
  }

  /** 屏幕坐标 -> 格子坐标 */
  function hit(clientX, clientY) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return null;
    var cv = $('view');
    var rect = cv.getBoundingClientRect();
    var px = clientX - rect.left, py = clientY - rect.top;
    var f = frameOf(pat);
    var h = R.hitTest(f, view, px, py);
    h.inside = h.x >= 0 && h.x < pat.cols && h.y >= 0 && h.y < pat.rows;
    // 是否落在网格区域内（考虑坐标轴留白）
    h.inBoard = (px - view.offsetX) >= f.x0 * view.scale && (py - view.offsetY) >= f.y0 * view.scale;
    return h;
  }

  /** 让某个格子居中显示；ensureVisible=true 时只在它跑出视野时才移动 */
  function centerOn(x, y, opt) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    opt = opt || {};
    var f = frameOf(pat);
    var cell = display.cell;
    var targetX = f.x0 + (x + 0.5) * cell;
    var targetY = f.y0 + (y + 0.5) * cell;

    if (opt.ensureVisible) {
      var sx = view.offsetX + targetX * view.scale;
      var sy = view.offsetY + targetY * view.scale;
      var margin = Math.min(120, view.width * 0.18);
      var mx = 0, my = 0;
      if (sx < margin) mx = margin - sx;
      else if (sx > view.width - margin) mx = (view.width - margin) - sx;
      if (sy < margin) my = margin - sy;
      else if (sy > view.height - margin) my = (view.height - margin) - sy;
      if (mx === 0 && my === 0) { requestRedraw(); return; }   // 已经在视野里就不动
      view.offsetX += mx;
      view.offsetY += my;
      requestRedraw();
      return;
    }

    view.offsetX = view.width / 2 - targetX * view.scale;
    view.offsetY = view.height / 2 - targetY * view.scale;
    requestRedraw();
  }

  function isVisible(x, y) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return false;
    var f = frameOf(pat);
    var cell = display.cell;
    var sx = view.offsetX + (f.x0 + x * cell) * view.scale;
    var sy = view.offsetY + (f.y0 + y * cell) * view.scale;
    var margin = 60;
    return sx > margin && sy > margin &&
      sx + cell * view.scale < view.width - margin &&
      sy + cell * view.scale < view.height - margin;
  }

  /* ==================== 绘制 ==================== */
  function requestRedraw() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(function () {
      redrawQueued = false;
      draw();
    });
  }

  function draw() {
    var pat = root.PindouApp.getPattern();
    var cv = $('view');
    var ctx = cv.getContext('2d');
    if (!pat) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    var opts = displayOpts();
    R.renderView(ctx, pat, view, opts);
    updateStatusBar();
  }

  /* ==================== 状态栏 ==================== */
  function updateStatusBar() {
    var pat = root.PindouApp.getPattern();
    if (!pat) {
      $('statusPos').textContent = '—';
      $('statusCell').textContent = '—';
      $('statusProgress').textContent = '—';
      return;
    }
    var st = pat.stats();
    var c = display.cursor;
    if (c && c.x >= 0 && c.x < pat.cols && c.y >= 0 && c.y < pat.rows) {
      var i = c.y * pat.cols + c.x;
      var ci = pat.cells[i];
      $('statusPos').textContent = '第 ' + (c.x + 1) + ' 列 · 第 ' + (c.y + 1) + ' 行';
      if (ci >= 0) {
        var e = st.byIndex[ci];
        var col = pat.palette.colors[ci];
        $('statusCell').innerHTML = '当前：<b style="color:' + col.hex + '">■</b> ' + col.code +
          '（该色已拼 ' + e.done + '/' + e.count + '）' + (pat.done[i] ? '　<span style="color:#34d399">✓ 已拼</span>' : '');
      } else {
        $('statusCell').textContent = '这里是空格（不摆豆）';
      }
    } else {
      $('statusPos').textContent = '未选中格子';
      $('statusCell').textContent = '点击格子开始勾选进度';
    }
    $('statusProgress').textContent = '进度 ' + st.doneTotal + ' / ' + st.beadsTotal +
      '（' + Math.round(st.doneRatio * 100) + '%）· 用色 ' + st.colorsUsed + ' 种';
  }

  /* ==================== 光标 / 勾选 ==================== */
  /**
   * 选中一个格子（只是「看信息」）——不勾选、不推进。
   * 勾选由 HUD 上的「下一个」按钮触发，见 advance()。
   */
  function selectCell(x, y, opt) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    opt = opt || {};
    display.cursor = { x: x, y: y };
    var i = y * pat.cols + x;
    var ci = pat.cells[i];
    if (ci >= 0) {
      display.markColorIndex = ci;          // 顺便把统计面板那一行高亮出来
      display.isolateColor = opt.isolate ? ci : display.isolateColor;
      $('btnIsolate').classList.toggle('on', display.isolateColor >= 0);
    }
    if (opt.center !== false) centerOn(x, y, { ensureVisible: true });
    refreshHudOnly(pat);
    requestRedraw();
    updateStatsActive();
    updateStatusBar();
  }

  function syncHud() {
    var pat = root.PindouApp.getPattern();
    var hud = $('beadingHud');
    if (!pat || hud.hidden) { if (pat) refreshHudOnly(pat); return; }
    refreshHudOnly(pat);
  }

  /** 刷新 HUD（当前选中格子的详细信息 + 按钮可用状态） */
  function refreshHudOnly(pat) {
    if (!pat) return;
    var c = display.cursor;
    var sw = $('hudSwatch');
    var btnNext = $('btnHudNext');
    var btnDone = $('btnHudDone');
    var btnPrev = $('btnHudPrev');
    var btnSkip = $('btnHudSkip');

    if (!c || c.x < 0 || c.x >= pat.cols || c.y < 0 || c.y >= pat.rows) {
      sw.style.background = 'repeating-linear-gradient(45deg,#2a2f3a,#2a2f3a 6px,#20242d 6px,#20242d 12px)';
      $('hudCode').textContent = '未选中';
      $('hudSub').textContent = '点图纸上的格子查看色号信息';
      $('hudMeta').innerHTML = '';
      $('hudDone').textContent = '';
      if (btnNext) btnNext.disabled = true;
      if (btnDone) btnDone.disabled = true;
      if (btnSkip) btnSkip.disabled = true;
      return;
    }

    var i = c.y * pat.cols + c.x;
    var ci = pat.cells[i];
    var stats = pat.stats();
    var pos = '第 ' + (c.x + 1) + ' 列 · 第 ' + (c.y + 1) + ' 行';

    if (ci < 0) {
      sw.style.background = 'repeating-linear-gradient(45deg,#2a2f3a,#2a2f3a 6px,#20242d 6px,#20242d 12px)';
      $('hudCode').textContent = '空格';
      $('hudSub').textContent = pos + ' · 这一格不摆豆';
      $('hudMeta').innerHTML = '整张图共 <b>' + stats.emptyTotal + '</b> 个空格';
      $('hudDone').textContent = '';
      $('hudDone').className = 'hud-done';
      if (btnNext) btnNext.disabled = false;   // 仍然可以往前走
      if (btnDone) btnDone.disabled = true;
      if (btnSkip) btnSkip.disabled = false;
      refreshNavButtons(pat);
      return;
    }

    var col = pat.palette.colors[ci];
    var e = stats.byIndex[ci];
    var isDone = !!pat.done[i];
    sw.style.background = col.hex;
    $('hudCode').textContent = col.code;
    $('hudSub').innerHTML = (col.name ? escapeHtml(col.name) + ' · ' : '') +
      col.hex + ' · RGB(' + col.r + ',' + col.g + ',' + col.b + ')' +
      (col.group ? ' · ' + escapeHtml(col.group) + '组' : '');
    $('hudMeta').innerHTML = pos +
      ' · 这个色号：共 <b>' + e.count + '</b> 颗，已拼 <b>' + e.done + '</b>，还剩 <b>' + e.remaining + '</b>' +
      ' · 全图进度 <b>' + stats.doneTotal + '/' + stats.beadsTotal + '</b>';
    $('hudDone').textContent = isDone ? '✓ 这一颗已拼' : '未拼';
    $('hudDone').className = 'hud-done' + (isDone ? ' yes' : '');
    if (btnDone) btnDone.disabled = isDone;
    if (btnNext) btnNext.disabled = false;
    if (btnSkip) btnSkip.disabled = false;
    refreshNavButtons(pat);
  }

  function refreshNavButtons(pat) {
    var c = display.cursor;
    if (!c) return;
    var order = $('selOrder').value;
    var o = { order: order, skipDone: true, colorOrder: order === 'color' ? root.PindouApp.getColorOrder() : null };
    var fwd = pat.nextCell(c.x, c.y, Object.assign({ forward: true }, o));
    var bwd = pat.nextCell(c.x, c.y, Object.assign({ forward: false }, o));
    var btnNext = $('btnHudNext');
    if (btnNext) {
      // 已拼完的格子再点「下一个」也只是往前走，不重复勾选
      btnNext.title = '把当前这颗标记为已拼，并跳到下一个未拼的格子（快捷键：Space / Enter）';
      btnNext.textContent = '';
      btnNext.innerHTML = '下一个 <kbd>Space</kbd>';
    }
    var btnSkip = $('btnHudSkip');
    if (btnSkip) {
      btnSkip.disabled = !fwd;
      btnSkip.title = '不勾选，直接跳到下一个未拼的格子（快捷键：Tab）';
      btnSkip.innerHTML = '跳过这一颗 <kbd>Tab</kbd>';
    }
    var btnPrev = $('btnHudPrev');
    if (btnPrev) {
      btnPrev.disabled = !bwd;
      btnPrev.innerHTML = '上一个 <kbd>Shift</kbd>+<kbd>Tab</kbd>';
    }
    var hint = $('hudNextHint');
    if (hint) {
      if (fwd) {
        var ncol = pat.palette.colors[fwd.index];
        hint.textContent = '下一个：' + ncol.code + '（' + (fwd.x + 1) + ',' + (fwd.y + 1) + '）';
      } else {
        hint.textContent = '没有下一个未拼的格子了 🎉';
      }
    }
  }

  /** 把当前选中的格子标记为已拼（不移动） */
  function markCurrent() {
    var pat = root.PindouApp.getPattern();
    var c = display.cursor;
    if (!pat || !c) return false;
    var i = c.y * pat.cols + c.x;
    if (pat.cells[i] < 0) { toast('这一格是空格，不需要拼', 'warn', 1600); return false; }
    if (pat.done[i]) return false;
    pushUndo();
    toggleCell(c.x, c.y, true, false);
    afterCellToggle(c.x, c.y, true);
    refreshStatsTotals();
    refreshHudOnly(pat);
    return true;
  }

  /**
   * 「下一个」：勾选当前这一颗，然后跳到下一个未拼的格子并显示它的详细信息。
   * @param {boolean} skipMark true = 不勾选，直接跳（「跳过」按钮 / Tab）
   * @param {boolean} backward true = 往回找
   */
  function advance(skipMark, backward) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    var c = display.cursor;
    if (!c) {
      var first = pat.firstUndone();
      if (first) selectCell(first.x, first.y);
      return;
    }
    if (!skipMark && !backward) {
      var i = c.y * pat.cols + c.x;
      if (pat.cells[i] < 0) {
        toast('这一格是空格，已直接跳到下一个', 'warn', 1600);
      } else if (pat.done[i]) {
        // 已经勾过了：不重复记录撤销，直接往前走
      } else {
        markCurrent();
      }
    }
    if (!skipMark && backward) {
      // 往回时先取消当前这颗的勾选（符合「退回去重拼」的直觉）
      var ib = c.y * pat.cols + c.x;
      if (pat.cells[ib] >= 0 && pat.done[ib]) {
        pushUndo();
        toggleCell(c.x, c.y, false, false);
        afterCellToggle(c.x, c.y, false);
        refreshStatsTotals();
      }
    }
    var order = $('selOrder').value;
    var opt = {
      order: order, forward: !backward, skipDone: true,
      colorOrder: order === 'color' ? root.PindouApp.getColorOrder() : null
    };
    var next = pat.nextCell(c.x, c.y, opt);
    if (!next) {
      var p = pat.progress();
      if (p.done >= p.total) {
        toast('🎉 全部 ' + p.total + ' 颗都拼完了！', 'ok', 4000);
      } else {
        toast(backward ? '前面没有未拼的格子了' : '按当前顺序找不到下一个了（可换个顺序）', 'warn', 2600);
      }
      refreshHudOnly(pat);
      return;
    }
    selectCell(next.x, next.y);
    // 让「下一个」按钮保持焦点，方便连续敲空格
    var btn = $('btnHudNext');
    if (btn && document.activeElement === btn) { try { btn.focus(); } catch (e) { } }
  }

  /** 勾选/取消一个格子；返回是否真的改变了 */
  function toggleCell(x, y, force, recordUndo) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return false;
    var i = y * pat.cols + x;
    if (pat.cells[i] < 0) return false;            // 空格
    var want = (force === undefined) ? !pat.done[i] : !!force;
    if (pat.done[i] === (want ? 1 : 0)) return false;
    if (recordUndo !== false) pushUndo();
    pat.setDone(x, y, want);
    return true;
  }

  function pushUndo() {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    undoStack.push(pat.snapshotProgress());
    if (undoStack.length > 120) undoStack.shift();
  }
  function undo() {
    var pat = root.PindouApp.getPattern();
    if (!pat || !undoStack.length) { toast('没有可撤销的操作', 'warn'); return; }
    pat.restoreProgress(undoStack.pop());
    refreshAll();
    toast('已撤销');
  }
  function clearUndo() { undoStack.length = 0; }

  /* ==================== 交互 ==================== */
  function initCanvasEvents() {
    var cv = $('view');
    var wrap = $('canvasWrap');
    var spaceDown = false;

    cv.addEventListener('mousedown', function (e) {
      var pat = root.PindouApp.getPattern();
      if (!pat) return;
      var h = hit(e.clientX, e.clientY);
      if (!h) return;
      var panMode = e.button === 1 || spaceDown || root.PindouApp.isPanTool();
      if (panMode) {
        drag = { mode: 'pan', startX: e.clientX, startY: e.clientY, ox: view.offsetX, oy: view.offsetY };
        wrap.classList.add('panning');
        e.preventDefault();
        return;
      }
      if (e.button === 2) return;                     // 右键交给 contextmenu
      if (!h.inside) return;
      if (e.ctrlKey || e.metaKey) {                   // 框选
        drag = { mode: 'select', x0: h.x, y0: h.y, x1: h.x, y1: h.y, additive: e.shiftKey };
        display.selection = { x0: h.x, y0: h.y, x1: h.x, y1: h.y };
        requestRedraw();
        return;
      }
      /* 左键点格子：
         - 默认（step 模式）：只是「选中并查看详细信息」，不会勾选、也不会跳走。
           勾选由 HUD 上的「下一个」按钮触发（见 advance()）。
         - 按住 Alt（或把下方「点击即勾选」打开）：点一下直接切换勾选状态（老手感）。
         - 点住拖动：仍然可以连续勾选，方便批量补进度。 */
      var i = h.y * pat.cols + h.x;
      var altToggle = e.altKey || root.PindouApp.isClickToggle();
      if (pat.cells[i] < 0) {
        selectCell(h.x, h.y);
        toast('这里是空格（不摆豆）', 'warn', 1400);
        e.preventDefault();
        return;
      }
      if (altToggle) {
        var before = pat.done[i];
        pushUndo();
        toggleCell(h.x, h.y, !before, false);
        drag = { mode: 'paint', value: !before, moved: false };
        lastPainted = h.x + ',' + h.y;
        if (pat.done[i] !== (before ? 1 : 0)) afterCellToggle(h.x, h.y, !before);
        else { requestRedraw(); syncHud(); }
      } else {
        selectCell(h.x, h.y);
        drag = { mode: 'maybe-paint', value: true, moved: false, marked: 0 };
      }
      e.preventDefault();
    });

    root.addEventListener('mousemove', function (e) {
      if (!drag) return;
      if (drag.mode === 'pan') {
        view.offsetX = drag.ox + (e.clientX - drag.startX);
        view.offsetY = drag.oy + (e.clientY - drag.startY);
        requestRedraw();
        return;
      }
      var h = hit(e.clientX, e.clientY);
      if (!h) return;
      if (drag.mode === 'select') {
        display.selection = { x0: drag.x0, y0: drag.y0, x1: Math.max(0, Math.min(root.PindouApp.getPattern().cols - 1, h.x)), y1: Math.max(0, Math.min(root.PindouApp.getPattern().rows - 1, h.y)) };
        requestRedraw();
        return;
      }
      if (drag.mode === 'maybe-paint' || drag.mode === 'paint') {
        if (!h.inside) return;
        var key = h.x + ',' + h.y;
        if (key === lastPainted) return;
        var pat = root.PindouApp.getPattern();
        if (pat.cells[h.y * pat.cols + h.x] < 0) return;
        lastPainted = key;
        // 拖动了就切换成「连续勾选」模式
        if (drag.mode === 'maybe-paint') {
          if (drag.moved !== true) pushUndo();
          drag.mode = 'paint';
          drag.moved = true;
        }
        if (toggleCell(h.x, h.y, drag.value, false)) {
          display.cursor = { x: h.x, y: h.y };
          requestRedraw();
          updateStatsRow(pat.cells[h.y * pat.cols + h.x]);
          syncHud();
        }
      }
    });

    root.addEventListener('mouseup', function (e) {
      if (!drag) return;
      if (drag.mode === 'select') {
        var sel = display.selection;
        if (sel) {
          var n = applySelection(sel, e.shiftKey ? 'toggle' : 'done');
          toast(n ? ('框选：已勾选 ' + n + ' 颗') : '框选区域内没有可勾选的格子', n ? 'ok' : 'warn');
        }
      }
      var wasDragging = drag.moved;
      var wasPaint = (drag.mode === 'paint');
      drag = null;
      lastPainted = null;
      $('canvasWrap').classList.remove('panning');
      refreshAll();
      if (wasPaint) refreshStatsTotals();
      // 单击选中（没有拖动）时，把焦点交给 HUD，方便直接敲空格/回车走「下一个」
      if (!wasDragging) {
        var btn = $('btnHudNext');
        if (btn && !$('beadingHud').hidden) { try { btn.focus(); } catch (err) { } }
      }
    });

    cv.addEventListener('contextmenu', function (e) {
      var pat = root.PindouApp.getPattern();
      if (!pat) return;
      e.preventDefault();
      var h = hit(e.clientX, e.clientY);
      if (!h || !h.inside) return;
      showCellMenu(e.clientX, e.clientY, h.x, h.y);
    });

    cv.addEventListener('wheel', function (e) {
      if (!root.PindouApp.getPattern()) return;
      e.preventDefault();
      var rect = cv.getBoundingClientRect();
      var factor = Math.pow(1.0018, -e.deltaY * (e.ctrlKey ? 2.4 : 1));
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // 触屏：单指拖动平移，双指缩放，点按勾选
    var touchState = null;
    cv.addEventListener('touchstart', function (e) {
      if (!root.PindouApp.getPattern()) return;
      if (e.touches.length === 1) {
        touchState = { x: e.touches[0].clientX, y: e.touches[0].clientY, ox: view.offsetX, oy: view.offsetY, t: Date.now(), moved: false };
      } else if (e.touches.length === 2) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        touchState = { pinch: true, d: d, scale: view.scale, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      }
    }, { passive: true });
    cv.addEventListener('touchmove', function (e) {
      if (!touchState) return;
      if (touchState.pinch && e.touches.length === 2) {
        var d2 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        var rect2 = cv.getBoundingClientRect();
        var target = touchState.scale * (d2 / touchState.d);
        var before = view.scale;
        zoomAt(target / before, touchState.cx - rect2.left, touchState.cy - rect2.top);
        e.preventDefault();
      } else if (!touchState.pinch && e.touches.length === 1) {
        var dx = e.touches[0].clientX - touchState.x, dy = e.touches[0].clientY - touchState.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) touchState.moved = true;
        view.offsetX = touchState.ox + dx;
        view.offsetY = touchState.oy + dy;
        requestRedraw();
      }
    }, { passive: false });
    cv.addEventListener('touchend', function (e) {
      if (touchState && !touchState.pinch && !touchState.moved && Date.now() - touchState.t < 400) {
        var t = e.changedTouches[0];
        var h = hit(t.clientX, t.clientY);
        if (h && h.inside) {
          var pat = root.PindouApp.getPattern();
          var i = h.y * pat.cols + h.x;
          if (pat.cells[i] >= 0) {
            selectCell(h.x, h.y);          // 触屏也是「选中看信息」，勾选交给「下一个」按钮
            refreshAll();
          }
        }
      }
      touchState = null;
    }, { passive: true });

    // 键盘
    root.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      // 焦点在 HUD 按钮上时，空格/回车会触发按钮的 click，
      // 那样「看信息」的语义就乱了（焦点可能停在别的按钮上）。
      // 统一由下面的 handleKey 处理，这里先掐掉浏览器的默认 click 行为。
      var onHudBtn = e.target && e.target.closest && e.target.closest('#beadingHud .hud-actions');
      if (onHudBtn && (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar')) {
        e.preventDefault();
        handleKey(e);
        return;
      }
      if (e.key === ' ' && !typing) spaceDown = true;
      if (typing && !(e.key === 'Enter' && tag === 'input')) {
        if (e.key === 'F1') { e.preventDefault(); openHelp(); }
        return;
      }
      handleKey(e);
    });
    root.addEventListener('keyup', function (e) {
      if (e.key === ' ') spaceDown = false;
    });
  }

  function applySelection(sel, mode) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return 0;
    var x0 = Math.min(sel.x0, sel.x1), x1 = Math.max(sel.x0, sel.x1);
    var y0 = Math.min(sel.y0, sel.y1), y1 = Math.max(sel.y0, sel.y1);
    pushUndo();
    var n = 0;
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var i = y * pat.cols + x;
        if (pat.cells[i] < 0) continue;
        var want = mode === 'toggle' ? !pat.done[i] : true;
        if (pat.done[i] === (want ? 1 : 0)) continue;
        pat.setDone(x, y, want);
        n++;
      }
    }
    display.selection = null;
    return n;
  }

  function afterCellToggle(x, y, becameDone) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    var i = y * pat.cols + x;
    var col = pat.palette.colors[pat.cells[i]];
    var e = pat.stats().byIndex[pat.cells[i]];
    if (becameDone) {
      toast('✓ 第 ' + (x + 1) + ' 列 ' + (y + 1) + ' 行：' + col.code + '（本色还剩 ' + e.remaining + '）', 'ok', 1500);
    }
    updateStatsRow(pat.cells[i]);
    requestRedraw();
    syncHud();
    updateStatusBar();
  }

  /** 兼容旧调用：现在「推进」统一走 advance()（会先勾选再跳，并显示下一格信息） */
  function maybeAutoAdvance() {
    advance(false, false);
  }

  /* ==================== 键盘 ==================== */
  function handleKey(e) {
    var pat = root.PindouApp.getPattern();
    var mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); root.PindouApp.saveProject(); return; }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); root.PindouApp.printSheet(); return; }
      if (e.key === 'o' || e.key === 'O') { e.preventDefault(); root.PindouApp.openProjectDialog(); return; }
      return;
    }
    if (e.key === 'F1') { e.preventDefault(); openHelp(); return; }
    if (!pat) return;

    var c = display.cursor || { x: 0, y: 0 };
    var moved = false;
    switch (e.key) {
      case 'ArrowLeft': c = { x: Math.max(0, c.x - 1), y: c.y }; moved = true; break;
      case 'ArrowRight': c = { x: Math.min(pat.cols - 1, c.x + 1), y: c.y }; moved = true; break;
      case 'ArrowUp': c = { x: c.x, y: Math.max(0, c.y - 1) }; moved = true; break;
      case 'ArrowDown': c = { x: c.x, y: Math.min(pat.rows - 1, c.y + 1) }; moved = true; break;
      case ' ': case 'Enter':
        // 等价于点「下一个」：勾选当前这颗，然后跳到下一个未拼的并显示它的信息
        e.preventDefault();
        advance(false, false);
        return;
      case 'Tab': {
        e.preventDefault();
        // Tab = 「跳过」：不勾选，只看下一个；Shift+Tab 往回
        advance(true, e.shiftKey);
        return;
      }
      case 'Delete': case 'Backspace':
        // 只取消勾选，不移动（保持「看信息」的位置）
        e.preventDefault();
        if (pat.cells[c.y * pat.cols + c.x] >= 0 && pat.done[c.y * pat.cols + c.x]) {
          pushUndo();
          toggleCell(c.x, c.y, false, false);
          afterCellToggle(c.x, c.y, false);
          refreshStatsTotals();
        } else {
          toast('这一颗还没有勾选', 'warn', 1200);
        }
        return;
      case 'Escape':
        display.selection = null; requestRedraw();
        root.PindouApp.closeModals();
        return;
      case 'i': case 'I':
        toggleIsolate();
        return;
      case 'b': case 'B':
        root.PindouApp.toggleBeading();
        return;
      case '+': case '=': setZoom(view.scale * 1.25); return;
      case '-': case '_': setZoom(view.scale / 1.25); return;
      case '0': root.PindouApp.zoomFit(); return;
      case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9': {
        if (e.shiftKey) return;   // Shift+1 之类不处理
        var idx = parseInt(e.key, 10) - 1;
        selectColorByRank(idx, true);
        return;
      }
    }
    if (moved) { e.preventDefault(); selectCell(c.x, c.y); }
  }

  /** 选中「用量第 N 名」的颜色并只看它 */
  function selectColorByRank(rank, isolate) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    var list = pat.stats().list;
    if (rank >= list.length) { toast('没有第 ' + (rank + 1) + ' 种颜色', 'warn', 1600); return; }
    var e = list[rank];
    display.markColorIndex = e.index;
    if (isolate) display.isolateColor = e.index;
    var first = findFirstOfColor(pat, e.index);
    if (first) selectCell(first.x, first.y);
    requestRedraw();
    updateStatsActive();
    refreshHudOnly(pat);
    toast('当前色号：' + e.code + '（还剩 ' + e.remaining + ' 颗）', 'ok', 1800);
  }

  function findFirstOfColor(pat, ci, skipDone) {
    for (var i = 0; i < pat.cells.length; i++) {
      if (pat.cells[i] !== ci) continue;
      if (skipDone !== false && pat.done[i]) continue;
      return { x: i % pat.cols, y: (i / pat.cols) | 0 };
    }
    // 都拼完了就返回第一个
    for (var j = 0; j < pat.cells.length; j++) {
      if (pat.cells[j] === ci) return { x: j % pat.cols, y: (j / pat.cols) | 0 };
    }
    return null;
  }

  function toggleIsolate() {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    if (display.isolateColor >= 0) {
      display.isolateColor = -1;
      toast('已取消「只看当前色」');
    } else {
      var ci = display.markColorIndex;
      if (ci < 0 && display.cursor) {
        var i = display.cursor.y * pat.cols + display.cursor.x;
        ci = pat.cells[i];
      }
      if (ci < 0) { toast('先把光标放到一个有色号的格子上', 'warn'); return; }
      display.isolateColor = ci;
      toast('只看 ' + pat.palette.colors[ci].code + '（再按 I 取消）', 'ok');
    }
    $('btnIsolate').classList.toggle('on', display.isolateColor >= 0);
    updateStatsActive();
    requestRedraw();
    syncHud();
  }

  /* ==================== 格子右键菜单 ==================== */
  function showCellMenu(clientX, clientY, x, y) {
    var pat = root.PindouApp.getPattern();
    var i = y * pat.cols + x;
    var ci = pat.cells[i];
    var menu = $('ctxMenu');
    var items = [];
    if (ci >= 0) {
      var col = pat.palette.colors[ci];
      items.push({ label: '只看 ' + col.code + '（高亮这个颜色）', fn: function () { display.isolateColor = ci; display.markColorIndex = ci; $('btnIsolate').classList.add('on'); requestRedraw(); updateStatsActive(); } });
      items.push({ label: '把 ' + col.code + ' 全部标记为已拼', fn: function () { pushUndo(); pat.setColorDone(ci, true); refreshAll(); toast(col.code + ' 已全部标记为已拼', 'ok'); } });
      items.push({ label: '把 ' + col.code + ' 的进度清空', fn: function () { pushUndo(); pat.setColorDone(ci, false); refreshAll(); } });
      items.push({ sep: true });
      items.push({ label: pat.done[i] ? '取消勾选这一颗' : '勾选这一颗', fn: function () { pushUndo(); toggleCell(x, y, !pat.done[i], false); refreshAll(); } });
      items.push({ label: '以这一颗为起点继续拼', fn: function () { display.markColorIndex = ci; selectCell(x, y); } });
      items.push({ sep: true });
      items.push({ label: '换成别的色号…', fn: function () { root.PindouApp.changeCellColor(x, y); } });
      items.push({ label: '把全图的 ' + col.code + ' 换成…', fn: function () { root.PindouApp.replaceColorDialog(ci); } });
    } else {
      items.push({ label: '这里是空格（不摆豆）', fn: function () { } });
    }
    menu.innerHTML = '';
    items.forEach(function (it) {
      if (it.sep) { menu.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      b.textContent = it.label;
      b.addEventListener('click', function () { hideMenu(); it.fn(); });
      menu.appendChild(b);
    });
    menu.hidden = false;
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(clientX, root.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(clientY, root.innerHeight - h - 8) + 'px';
  }
  function hideMenu() { $('ctxMenu').hidden = true; }

  /* ==================== 用量清单 ==================== */
  function refreshStatsTotals() {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    var st = pat.stats();
    $('progFill').style.width = (st.doneRatio * 100) + '%';
    $('progText').innerHTML = '已拼 <b>' + st.doneTotal + '</b> / ' + st.beadsTotal + ' 颗（' +
      Math.round(st.doneRatio * 100) + '%）· 共 ' + st.colorsUsed + ' 种颜色';
    $('chipBeads').textContent = st.beadsTotal + ' 颗 / ' + st.colorsUsed + ' 色';
    updateStatusBar();
  }

  function updateStatsRow(ci) {
    var pat = root.PindouApp.getPattern();
    if (!pat) return;
    var el = document.querySelector('.stat-item[data-index="' + ci + '"]');
    if (!el) return;
    var e = pat.stats().byIndex[ci];
    if (!e) { el.parentNode.removeChild(el); return; }
    el.querySelector('.cnt').innerHTML = e.count + '<small>剩 ' + e.remaining + '</small>';
    el.classList.toggle('all-done', e.remaining === 0);
    refreshStatsTotals();
  }

  function renderStats() {
    var pat = root.PindouApp.getPattern();
    var host = $('statList');
    host.innerHTML = '';
    if (!pat) { host.innerHTML = '<p class="hint" style="padding:12px">还没有图纸。</p>'; refreshStatsTotals(); return; }
    var st = pat.stats();
    var packSize = parseInt($('selPack').value, 10) || 1000;
    var q = ($('searchColor').value || '').trim().toLowerCase();
    if (!st.list.length) {
      host.innerHTML = '<p class="hint" style="padding:12px">这张图纸全是空格（可能背景被当成空格了）。</p>';
      refreshStatsTotals();
      return;
    }
    var frag = document.createDocumentFragment();
    st.list.forEach(function (e, rank) {
      if (q && e.code.toLowerCase().indexOf(q) < 0 && (e.name || '').toLowerCase().indexOf(q) < 0) return;
      var div = document.createElement('div');
      div.className = 'stat-item' + (e.index === display.markColorIndex ? ' active' : '') + (e.remaining === 0 ? ' all-done' : '');
      div.dataset.index = e.index;
      div.title = '点击：只看这个色号并跳到它的第一颗；右键：更多操作';
      var sw = document.createElement('div');
      sw.className = 'sw';
      sw.style.background = e.hex;
      sw.style.color = root.PindouColor.contrastText(e.r, e.g, e.b);
      sw.textContent = String(rank + 1);
      var info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<div class="code">' + escapeHtml(e.code) + '</div>' +
        '<div class="meta">' + Math.ceil(e.count / packSize) + ' 包(' + packSize + ') · ' +
        (e.name ? escapeHtml(e.name) : (e.group ? escapeHtml(e.group) + '组' : '') ) + '</div>';
      var cnt = document.createElement('div');
      cnt.className = 'cnt';
      cnt.innerHTML = e.count + '<small>剩 ' + e.remaining + '</small>';
      div.appendChild(sw); div.appendChild(info); div.appendChild(cnt);
      div.addEventListener('click', function () {
        display.markColorIndex = e.index;
        display.isolateColor = e.index;
        $('btnIsolate').classList.add('on');
        var f = findFirstOfColor(pat, e.index);
        if (f) selectCell(f.x, f.y);
        requestRedraw();
        updateStatsActive();
        toast('只看 ' + e.code + '：共 ' + e.count + ' 颗，还剩 ' + e.remaining, 'ok', 2000);
      });
      div.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        showColorMenu(ev.clientX, ev.clientY, e);
      });
      frag.appendChild(div);
    });
    host.appendChild(frag);
    refreshStatsTotals();
  }

  function showColorMenu(clientX, clientY, e) {
    var pat = root.PindouApp.getPattern();
    var menu = $('ctxMenu');
    var items = [
      { label: '只看这个色号', fn: function () { display.markColorIndex = e.index; display.isolateColor = e.index; $('btnIsolate').classList.add('on'); var f = findFirstOfColor(pat, e.index); if (f) selectCell(f.x, f.y); refreshAll(); } },
      { label: '全部标记为已拼（' + e.count + ' 颗）', fn: function () { pushUndo(); pat.setColorDone(e.index, true); refreshAll(); } },
      { label: '清空这个色号的进度', fn: function () { pushUndo(); pat.setColorDone(e.index, false); refreshAll(); } },
      { sep: true },
      { label: '从这一颗继续（把光标放这里）', fn: function () { display.markColorIndex = e.index; var f = findFirstOfColor(pat, e.index); if (f) selectCell(f.x, f.y); } },
      { label: '把这个色号换成…', fn: function () { root.PindouApp.replaceColorDialog(e.index); } },
      { sep: true },
      { label: '复制色号 ' + e.code, fn: function () { copyText(e.code); } },
      { label: '复制用量清单', fn: function () { copyText(pat.stats().list.map(function (x) { return x.code + ' × ' + x.count; }).join('\n')); } }
    ];
    menu.innerHTML = '';
    items.forEach(function (it) {
      if (it.sep) { menu.appendChild(document.createElement('hr')); return; }
      var b = document.createElement('button');
      b.textContent = it.label;
      b.addEventListener('click', function () { hideMenu(); it.fn(); });
      menu.appendChild(b);
    });
    menu.hidden = false;
    menu.style.left = Math.min(clientX, root.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top = Math.min(clientY, root.innerHeight - menu.offsetHeight - 8) + 'px';
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('已复制到剪贴板', 'ok', 1400); },
        function () { toast('复制失败，请手动选择文本', 'warn'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板', 'ok', 1400); } catch (e) { toast('复制失败', 'warn'); }
      document.body.removeChild(ta);
    }
  }

  function updateStatsActive() {
    var items = document.querySelectorAll('.stat-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', parseInt(items[i].dataset.index, 10) === display.markColorIndex);
    }
  }

  /* ==================== 分板 ==================== */
  function renderBoards() {
    var pat = root.PindouApp.getPattern();
    var host = $('boardList');
    host.innerHTML = '';
    if (!pat) return;
    var bw = clampInt($('numBoardW2').value, 5, 100, 29);
    var bh = clampInt($('numBoardH2').value, 5, 100, 29);
    var ov = clampInt($('numOverlap').value, 0, 10, 0);
    var boards = pat.boards(bw, bh, ov);
    boards.forEach(function (b, idx) {
      var div = document.createElement('div');
      div.className = 'board-item' + (b.remaining === 0 ? ' done' : '');
      div.innerHTML = '<b>板 ' + (idx + 1) + '</b>' +
        '列 ' + (b.x + 1) + '–' + (b.x + b.w) + '<br>行 ' + (b.y + 1) + '–' + (b.y + b.h) +
        '<br>' + (b.remaining === 0 ? '✓ 已完成' : '还差 ' + b.remaining + ' 颗');
      div.title = '点击：跳到这块板还没拼的位置';
      div.addEventListener('click', function () {
        for (var y = b.y; y < b.y + b.h; y++) {
          for (var x = b.x; x < b.x + b.w; x++) {
            var i = y * pat.cols + x;
            if (pat.cells[i] >= 0 && !pat.done[i]) { selectCell(x, y); return; }
          }
        }
        selectCell(b.x, b.y);
        toast('这块板已经拼完了 ✓', 'ok');
      });
      host.appendChild(div);
    });
    if (!boards.length) host.innerHTML = '<p class="hint">没有可分的板。</p>';
  }

  /* ==================== 拼前检查 ==================== */
  function renderChecks() {
    var pat = root.PindouApp.getPattern();
    var host = $('checkBody');
    host.innerHTML = '';
    if (!pat) { host.innerHTML = '<p class="hint">先生成图纸。</p>'; return; }
    var st = pat.stats();
    var items = [];

    // 1. 易混色
    var pairs = root.PindouQuantizer.confusingPairs(pat.palette, st.list.map(function (e) { return e.index; }), 4);
    if (pairs.length) {
      var html = pairs.slice(0, 8).map(function (p) {
        var A = pat.palette.colors[p.a], B = pat.palette.colors[p.b];
        return '<div class="pair">' +
          '<span class="sw" style="background:' + A.hex + '"></span><code>' + A.code + '</code> ' +
          '<span class="sw" style="background:' + B.hex + '"></span><code>' + B.code + '</code>' +
          '<span style="color:#a7b1c2">色差 ' + p.deltaE.toFixed(1) + '（' + (p.deltaE < 2 ? '极易拿错' : '较接近') + '）</span></div>';
      }).join('');
      items.push({
        cls: 'warn', icon: '⚠️', title: '有 ' + pairs.length + ' 组颜色很接近，取豆时容易拿错',
        body: '建议拼之前先把这几组豆子分开放，或者在「设置」里限制用色数把它们合并掉。' + html
      });
    } else {
      items.push({ cls: 'ok', icon: '✓', title: '没有明显易混的颜色', body: '用到的颜色两两色差都在安全范围内。' });
    }

    // 2. 单颗/极少量的颜色（要单独买一包，不划算）
    var tiny = st.list.filter(function (e) { return e.count <= 3; });
    if (tiny.length) {
      items.push({
        cls: 'warn', icon: '🫘', title: '有 ' + tiny.length + ' 种颜色用量 ≤ 3 颗',
        body: '这些颜色要单独买一包。可以调大「消除碎豆」，或在设置里限制用色数把它们并掉。用量：' +
          tiny.slice(0, 12).map(function (e) { return e.code + '×' + e.count; }).join('、')
      });
    }

    // 3. 用色数提醒
    if (st.colorsUsed > 40) {
      items.push({
        cls: 'warn', icon: '🎨', title: '用了 ' + st.colorsUsed + ' 种颜色',
        body: '颜色太多会明显增加备料成本和拼错概率。照片建议限制在 12~24 色。'
      });
    } else {
      items.push({ cls: 'ok', icon: '🎨', title: '用色 ' + st.colorsUsed + ' 种', body: '备料压力不大。' });
    }

    // 4. 空格比例
    var emptyRatio = st.emptyTotal / (st.beadsTotal + st.emptyTotal);
    if (emptyRatio > 0.35) {
      items.push({
        cls: 'info', icon: '⬜', title: '空格占 ' + Math.round(emptyRatio * 100) + '%',
        body: '有 ' + st.emptyTotal + ' 个格子不摆豆。如果是背景，这是正常的；如果不想要留白，把「画面适配」改成「裁掉多余」。'
      });
    }

    // 5. 尺寸 / 分板
    var boards = pat.boards(29, 29, 0);
    if (boards.length > 1) {
      items.push({
        cls: 'info', icon: '🧩', title: '整图需要 ' + boards.length + ' 块 29×29 板',
        body: '去「分板」标签可以看到每块板的范围，并一块一块地拼。'
      });
    } else {
      items.push({ cls: 'ok', icon: '🧩', title: '一块 29×29 板就能装下', body: '尺寸 ' + pat.cols + '×' + pat.rows + ' 格。' });
    }

    // 6. 镜像提醒
    if (!$('chkMirror').checked) {
      items.push({
        cls: 'info', icon: '🪞', title: '没开镜像翻转',
        body: '摆豆时是「背面朝上」，烫完正面会左右翻转。带文字的图案建议开镜像，否则烫出来字是反的。'
      });
    }

    // 7. 色卡来源说明
    items.push({
      cls: 'info', icon: 'ℹ️', title: '色号数据：' + pat.palette.title,
      body: '来源：' + (pat.palette.source || '社区公开色卡') + '。屏幕显示色与实物可能有差异，重要作品请对实物色卡确认。'
    });

    items.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'check-item ' + it.cls;
      d.innerHTML = '<div class="ci-icon">' + it.icon + '</div><div class="ci-body"><b>' +
        escapeHtml(it.title) + '</b><span>' + it.body + '</span></div>';
      host.appendChild(d);
    });
  }

  /* ==================== 色卡一览 ==================== */
  function openPaletteChart() {
    var pat = root.PindouApp.getPattern();
    var pal = pat ? pat.palette : root.PindouPalette.get($('selPalette').value);
    if (!pal) return;
    $('chartTitle').textContent = pal.title + '（' + pal.size() + ' 色）· ' + (pal.brand || '');
    var host = $('chartBody');
    host.innerHTML = '';
    var frag = document.createDocumentFragment();
    pal.colors.forEach(function (c) {
      var d = document.createElement('div');
      d.className = 'chart-cell';
      d.style.background = c.hex;
      d.style.color = root.PindouColor.contrastText(c.r, c.g, c.b);
      d.innerHTML = c.code + (c.name ? '<small>' + escapeHtml(c.name.slice(0, 12)) + '</small>' : '');
      d.title = c.code + ' ' + (c.name || '') + ' ' + c.hex + (c.group ? ' [' + c.group + ']' : '');
      d.addEventListener('click', function () {
        display.markColorIndex = c.index;
        display.isolateColor = c.index;
        $('btnIsolate').classList.add('on');
        if (pat) { var f = findFirstOfColor(pat, c.index); if (f) selectCell(f.x, f.y); }
        updateStatsActive();
        requestRedraw();
        toast('只看 ' + c.code, 'ok', 1400);
      });
      frag.appendChild(d);
    });
    host.appendChild(frag);
    $('modalPaletteChart').hidden = false;
  }

  function openHelp() {
    $('modalHelp').hidden = false;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clampInt(v, min, max, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(min, Math.min(max, n));
  }

  /* ==================== 对外 ==================== */
  function refreshAll() {
    renderStats();
    renderBoards();
    renderChecks();
    requestRedraw();
    syncHudIfVisible();
    updateStatusBar();
  }
  function syncHudIfVisible() {
    var hud = $('beadingHud');
    if (!hud.hidden) syncHud();
  }

  root.PindouUI = {
    el: el,
    view: view,
    display: display,
    init: function () {
      el = {};
      ['view', 'canvasWrap', 'statList', 'boardList', 'checkBody', 'progFill', 'progText', 'statusPos',
        'statusCell', 'statusProgress', 'beadingHud', 'hudSwatch', 'hudCode', 'hudSub', 'ctxMenu',
        'modalInventory', 'modalPaletteChart', 'modalHelp', 'toastWrap', 'zoomLabel', 'chartBody']
        .forEach(function (id) { el[id] = $(id); });
      initCanvasEvents();
      root.addEventListener('resize', function () { resizeCanvas(); });
      root.addEventListener('mousedown', function (e) {
        if (!e.target.closest || (!e.target.closest('.menu'))) hideMenu();
      });
      var ro = root.ResizeObserver ? new ResizeObserver(function () { resizeCanvas(); }) : null;
      if (ro) ro.observe($('canvasWrap'));
      resizeCanvas();
    },
    requestRedraw: requestRedraw,
    draw: draw,
    resizeCanvas: resizeCanvas,
    fitToWindow: fitToWindow,
    setZoom: setZoom,
    zoomAt: zoomAt,
    zoomIn: function () { zoomAt(1.25); },
    zoomOut: function () { zoomAt(1 / 1.25); },
    selectCell: selectCell,
    setCursor: selectCell,      // 兼容旧名
    advance: advance,           // 「下一个」：勾选当前 + 跳到下一格并显示信息
    markCurrent: markCurrent,   // 只勾选当前这颗，不移动
    centerOn: centerOn,
    isVisible: isVisible,
    toggleIsolate: toggleIsolate,
    selectColorByRank: selectColorByRank,
    findFirstOfColor: findFirstOfColor,
    pushUndo: pushUndo,
    undo: undo,
    clearUndo: clearUndo,
    refreshAll: refreshAll,
    renderStats: renderStats,
    refreshStatsTotals: refreshStatsTotals,
    updateStatsRow: updateStatsRow,
    renderBoards: renderBoards,
    renderChecks: renderChecks,
    openPaletteChart: openPaletteChart,
    openHelp: openHelp,
    toast: toast,
    copyText: copyText,
    showColorMenu: showColorMenu,
    escapeHtml: escapeHtml,
    maybeAutoAdvance: maybeAutoAdvance,
    afterCellToggle: afterCellToggle,
    toggleCell: toggleCell,
    syncHud: syncHud,
    refreshHudOnly: refreshHudOnly
  };
})(typeof window !== 'undefined' ? window : globalThis);

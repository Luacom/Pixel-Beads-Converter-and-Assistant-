/* =========================================================================
 * app.js — 应用主体：状态、转换流水线、导入导出、摆豆模式、项目存取
 * 依赖: core/*.js, ui/ui.js, ui/exporters.js
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.PindouColor;
  var Pal = root.PindouPalette;
  var Samp = root.PindouSampler;
  var Q = root.PindouQuantizer;
  var PAT = root.PindouPattern;
  var R = root.PindouRender;
  var EXP = root.PindouExport;
  var UI = root.PindouUI;

  var $ = function (id) { return document.getElementById(id); };

  /* ==================== 状态 ==================== */
  var state = {
    sourceImage: null,        // {data,width,height} 已按 EXIF 摆正
    sourceName: '',
    sourceThumb: '',
    imageEl: null,
    pattern: null,
    paletteId: 'mard-221',
    inventory: null,          // 色号数组（只用我有的豆子）
    meta: { title: '', created: 0 },
    converting: false,
    pending: false,
    panTool: false,
    beading: false,
    colorOrder: null
  };

  var convertTimer = null;
  var AUTOSAVE_KEY = 'pindou.autosave.v1';
  var lastFocusedAction = null;   // 记录最后按下的「下一个」类按钮，方便重新获得焦点

  /* ==================== 初始化 ==================== */
  function init() {
    Pal.registerAll(root.PindouPaletteData);
    UI.init();
    buildPaletteSelect();
    buildOrderSelect();
    bindInputs();
    applyDefaultDisplay();
    loadSettings();
    initDropZone();
    initPaste();
    initModals();
    maybeRestoreAutosave();
    UI.requestRedraw();
    $('chipPalette').textContent = Pal.get(state.paletteId).title;
    updateEmptyState();
  }

  function buildPaletteSelect() {
    var sel = $('selPalette');
    sel.innerHTML = '';
    Pal.list().forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.title + ' · ' + p.size() + ' 色' + (p.tier ? '（' + p.tier + '）' : '');
      sel.appendChild(o);
    });
    sel.value = state.paletteId;
    updatePaletteHint();
  }

  function updatePaletteHint() {
    var p = Pal.get($('selPalette').value);
    if (!p) return;
    $('paletteHint').innerHTML = (p.note || '') + '　<span style="color:#5c6675">' +
      (p.beadSize ? p.beadSize + ' · ' : '') + '数据：' + (p.source || '') + '</span>';
  }

  function buildOrderSelect() {
    var sel = $('selOrder');
    sel.innerHTML = '';
    Object.keys(PAT.ORDERS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = PAT.ORDERS[k];
      sel.appendChild(o);
    });
    sel.value = 'row';
  }

  function applyDefaultDisplay() {
    var d = UI.display;
    d.cell = 22;
    d.showGrid = true;
    d.boldEvery = 5;
    d.showCoords = true;
    d.showCodes = true;
    d.codeMode = 'code';
  }

  /* ==================== 设置面板绑定 ==================== */
  function bindInputs() {
    // 图片
    $('dropZone').addEventListener('click', function () { $('fileImage').click(); });
    $('dropZone').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') $('fileImage').click(); });
    $('fileImage').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) loadImageFile(e.target.files[0]);
      e.target.value = '';
    });
    $('btnImport').addEventListener('click', function () { $('fileImage').click(); });
    $('btnImport2').addEventListener('click', function () { $('fileImage').click(); });
    $('btnDemo').addEventListener('click', makeDemoImage);
    $('btnClearImage').addEventListener('click', function () {
      state.sourceImage = null; state.imageEl = null; state.sourceThumb = '';
      $('thumbWrap').hidden = true;
      $('dropZone').hidden = false;
      state.pattern = null;
      UI.clearUndo();
      UI.refreshAll();
      updateEmptyState();
      updateChips();
    });

    ['selFit', 'selMethod', 'chkAutoTrim', 'chkDropBg'].forEach(function (id) {
      $(id).addEventListener('change', scheduleConvert);
    });
    $('rngBgTol').addEventListener('input', function () {
      $('valBgTol').textContent = this.value;
      scheduleConvert();
    });
    $('chkDropBg').addEventListener('change', function () {
      $('rowBgTol').hidden = !this.checked;
    });

    // 色卡
    $('selPalette').addEventListener('change', function () {
      state.paletteId = this.value;
      updatePaletteHint();
      $('chipPalette').textContent = Pal.get(state.paletteId).title;
      scheduleConvert();
    });
    $('btnPaletteChart').addEventListener('click', UI.openPaletteChart);
    $('btnInventory').addEventListener('click', openInventory);

    // 尺寸
    $('numCols').addEventListener('change', function () { onColsChange(true); });
    $('numRows').addEventListener('change', scheduleConvert);
    $('chkLockRatio').addEventListener('change', function () {
      $('rowRows').style.opacity = this.checked ? .5 : 1;
      $('numRows').disabled = this.checked;
      if (this.checked) onColsChange(true); else scheduleConvert();
    });
    $('numRows').disabled = true;
    $('rowRows').style.opacity = .5;
    Array.prototype.forEach.call($('sizePresets').children, function (b) {
      b.addEventListener('click', function () {
        $('numCols').value = b.dataset.cols;
        onColsChange(true);
      });
    });
    $('rngMaxColors').addEventListener('input', function () {
      var v = parseInt(this.value, 10);
      $('valMaxColors').textContent = v === 0 ? '不限制' : v + ' 色';
      scheduleConvert();
    });
    $('rngMerge').addEventListener('input', function () {
      var v = parseInt(this.value, 10);
      $('valMerge').textContent = v === 0 ? '关闭' : '小于 ' + v + ' 颗';
      scheduleConvert();
    });

    // 抖动
    ['selDither', 'chkSerpentine'].forEach(function (id) { $(id).addEventListener('change', scheduleConvert); });
    $('rngDither').addEventListener('input', function () {
      $('valDither').textContent = this.value + '%';
      scheduleConvert();
    });

    // 显示
    var d = UI.display;
    $('chkShowGrid').addEventListener('change', function () { d.showGrid = this.checked; UI.requestRedraw(); });
    $('numBold').addEventListener('change', function () { d.boldEvery = parseInt(this.value, 10) || 0; UI.requestRedraw(); });
    $('chkShowCoords').addEventListener('change', function () { d.showCoords = this.checked; UI.requestRedraw(); });
    $('numCoordEvery').addEventListener('change', function () { d.coordEvery = Math.max(1, parseInt(this.value, 10) || 1); UI.requestRedraw(); });
    $('chkShowCodes').addEventListener('change', function () { d.showCodes = this.checked; UI.requestRedraw(); });
    $('selCodeMode').addEventListener('change', function () { d.codeMode = this.value; UI.requestRedraw(); });
    $('numCell').addEventListener('change', function () {
      d.cell = Math.max(6, Math.min(80, parseInt(this.value, 10) || 22));
      UI.requestRedraw();
    });
    $('chkMirror').addEventListener('change', scheduleConvert);
    $('chkBoardLines').addEventListener('change', function () {
      d.showBoardLinesOn = this.checked;
      $('rowBoardSize').hidden = !this.checked;
      UI.requestRedraw();
    });
    $('numBoardW').addEventListener('change', function () { d.boardStepX = parseInt(this.value, 10) || 29; UI.requestRedraw(); });
    $('numBoardH').addEventListener('change', function () { d.boardStepY = parseInt(this.value, 10) || 29; UI.requestRedraw(); });
    $('numBoardW2').addEventListener('change', function () { $('numBoardW').value = this.value; UI.renderBoards(); });
    $('numBoardH2').addEventListener('change', function () { $('numBoardH').value = this.value; UI.renderBoards(); });
    $('numOverlap').addEventListener('change', UI.renderBoards);
    $('selRotate').addEventListener('change', scheduleConvert);
    $('txtTitle').addEventListener('input', function () {
      UI.display.title = this.value;
      state.meta.title = this.value;
      UI.requestRedraw();
    });

    $('btnConvert').addEventListener('click', function () { convertNow(true); });
    $('btnResetSettings').addEventListener('click', resetSettings);

    // 舞台工具
    $('btnZoomIn').addEventListener('click', UI.zoomIn);
    $('btnZoomOut').addEventListener('click', UI.zoomOut);
    $('btnZoomFit').addEventListener('click', zoomFit);
    $('btnZoom100').addEventListener('click', function () { UI.setZoom(1); });
    $('btnIsolate').addEventListener('click', UI.toggleIsolate);
    $('btnToggleAllDone').addEventListener('click', toggleAllDone);
    $('chkClickToggle').addEventListener('change', saveSettings);
    $('selOrder').addEventListener('change', saveSettings);
    $('btnBeading').addEventListener('click', toggleBeading);
    $('btnExportPng').addEventListener('click', exportSheetPng);
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('btnPrint').addEventListener('click', printSheet);

    // HUD：点选查看信息 → 按「下一个」才勾选并推进
    $('btnHudNext').addEventListener('click', function () { lastFocusedAction = $('btnHudNext'); UI.advance(false, false); });
    $('btnHudSkip').addEventListener('click', function () { lastFocusedAction = $('btnHudSkip'); UI.advance(true, false); });
    $('btnHudPrev').addEventListener('click', function () { lastFocusedAction = $('btnHudPrev'); UI.advance(false, true); });
    $('btnHudDone').addEventListener('click', function () {
      lastFocusedAction = $('btnHudDone');
      if (UI.markCurrent()) UI.toast('已勾选这一颗（没有跳走，可以继续看）', 'ok', 1400);
    });
    $('btnHudExit').addEventListener('click', function () { toggleBeading(false); });

    // 统计
    $('searchColor').addEventListener('input', UI.renderStats);
    $('selPack').addEventListener('change', UI.renderStats);
    $('btnExportShopping').addEventListener('click', exportShoppingPng);
    $('btnResetProgress').addEventListener('click', function () {
      if (!state.pattern) return;
      UI.pushUndo();
      state.pattern.clearProgress();
      UI.refreshAll();
      UI.toast('已清空勾选进度', 'ok');
    });

    // 顶栏
    $('btnSaveProject').addEventListener('click', saveProject);
    $('btnOpenProject').addEventListener('click', openProjectDialog);
    $('btnHelp').addEventListener('click', UI.openHelp);

    // 右侧标签
    Array.prototype.forEach.call($('rightTabs').children, function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call($('rightTabs').children, function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
          p.classList.toggle('active', p.dataset.panel === t.dataset.tab);
        });
        if (t.dataset.tab === 'boards') UI.renderBoards();
        if (t.dataset.tab === 'check') UI.renderChecks();
      });
    });
  }

  function onColsChange(doConvert) {
    var cols = Math.max(4, Math.min(400, parseInt($('numCols').value, 10) || 64));
    $('numCols').value = cols;
    if ($('chkLockRatio').checked && state.sourceImage) {
      var img = state.sourceImage;
      var rows = Math.max(4, Math.round(cols * (img.height / img.width)));
      rows = Math.min(400, rows);
      $('numRows').value = rows;
    } else if (!$('chkLockRatio').checked) {
      $('numRows').value = Math.max(4, Math.min(400, parseInt($('numRows').value, 10) || cols));
    }
    if (doConvert) convertNow();
  }

  function zoomFit() {
    if (!state.pattern) return;
    UI.fitToWindow(state.pattern);
  }

  /* ==================== 图片导入 ==================== */
  function initDropZone() {
    var zone = $('dropZone');
    var wrap = $('canvasWrap') || document.body;
    [zone, wrap, document.body].forEach(function (target) {
      target.addEventListener('dragover', function (e) { e.preventDefault(); if (target === zone) zone.classList.add('over'); });
      target.addEventListener('dragleave', function () { zone.classList.remove('over'); });
      target.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
      });
    });
  }

  function initPaste() {
    document.addEventListener('paste', function (e) {
      if ((e.target.tagName || '').toLowerCase() === 'textarea') return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          var f = items[i].getAsFile();
          if (f) { loadImageFile(f); UI.toast('已从剪贴板导入图片', 'ok'); }
          return;
        }
      }
      // 文本：可能是项目 JSON
      var text = e.clipboardData.getData('text/plain');
      if (text && text.indexOf('pindou-pattern') >= 0) {
        try { loadProjectData(JSON.parse(text)); UI.toast('已从剪贴板载入项目', 'ok'); } catch (err) { }
      }
    });
  }

  function handleFile(file) {
    var name = (file.name || '').toLowerCase();
    if (/\.json$/.test(name) || file.type === 'application/json') {
      var r = new FileReader();
      r.onload = function () {
        try { loadProjectData(JSON.parse(r.result)); }
        catch (e) { UI.toast('项目文件解析失败：' + e.message, 'err', 4000); }
      };
      r.readAsText(file);
      return;
    }
    loadImageFile(file);
  }

  /**
   * 读取图片 -> 像素数据。
   * 注意：在 file:// 下直接用 <img src="本地文件"> 会把 canvas 标记为污染（tainted），
   * 导致 getImageData 抛 SecurityError。所以这里先把文件读成 data URL / Blob URL，
   * 这两种来源不会污染 canvas。
   */
  function readImagePixels(file, onDone, onError) {
    function fromSrc(src, revoke) {
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { if (revoke) URL.revokeObjectURL(src); onError(new Error('图片尺寸为 0')); return; }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var data;
        try {
          data = ctx.getImageData(0, 0, w, h);
        } catch (e) {
          if (revoke) URL.revokeObjectURL(src);
          onError(new Error('无法读取图片像素（浏览器安全限制）：' + e.message));
          return;
        }
        if (revoke) URL.revokeObjectURL(src);
        onDone({ data: data.data, width: w, height: h }, img);
      };
      img.onerror = function () {
        if (revoke) URL.revokeObjectURL(src);
        onError(new Error('图片解码失败'));
      };
      img.src = src;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      // 优先用 Blob URL（省内存），构造失败再退回 data URL
      try {
        var comma = String(dataUrl).indexOf(',');
        var head = String(dataUrl).slice(0, comma);
        var mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
        var bin = atob(String(dataUrl).slice(comma + 1));
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var blobUrl = URL.createObjectURL(new Blob([arr], { type: mime }));
        fromSrc(blobUrl, true);
      } catch (e) {
        fromSrc(dataUrl, false);
      }
    };
    reader.onerror = function () { onError(new Error('文件读取失败')); };
    reader.readAsDataURL(file);
  }

  /** data URL -> File（自检用） */
  function dataUrlToFile(dataUrl, name, cb) {
    var comma = String(dataUrl).indexOf(',');
    var mime = (String(dataUrl).slice(0, comma).match(/data:([^;]+)/) || [])[1] || 'image/png';
    var bin = atob(String(dataUrl).slice(comma + 1));
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    cb(new File([arr], name, { type: mime }));
  }

  function loadImageFile(file) {
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '')) {
      UI.toast('这个文件不是图片', 'warn');
      return;
    }
    readImagePixels(file, function (imageData, img) {
      state.sourceImage = imageData;
      state.imageEl = img;
      state.sourceName = file.name || 'pasted-image';
      afterImageLoaded();
      UI.toast('已导入 ' + imageData.width + '×' + imageData.height + ' 图片', 'ok');
    }, function (err) {
      UI.toast(err.message, 'err', 5000);
    });
  }

  /** 是否手机/平板等触摸设备（手机上没有鼠标悬停，底部信息栏需要常显） */
  function isMobileLike() {
    try {
      if (root.matchMedia && root.matchMedia('(pointer: coarse)').matches) return true;
      if ('ontouchstart' in root) return true;
      if (root.navigator && root.navigator.maxTouchPoints > 0) return true;
    } catch (e) { }
    return false;
  }

  function afterImageLoaded() {
    renderThumbFromData();
    // 默认格数：按最长边 64 格左右，保持比例
    $('numCols').value = 64;
    onColsChange(false);
    updateEmptyState();
    saveSettings();
    convertNow();
  }

  /** 缩略图直接从像素数据画，不依赖 <img>（避免 file:// 下的污染问题） */
  function renderThumbFromData() {
    var src = state.sourceImage;
    if (!src) return;
    var tc = $('thumbCanvas');
    var ctx = tc.getContext('2d');
    ctx.clearRect(0, 0, tc.width, tc.height);
    var s = Math.min(tc.width / src.width, tc.height / src.height);
    var dw = Math.max(1, Math.round(src.width * s)), dh = Math.max(1, Math.round(src.height * s));
    var ox = Math.round((tc.width - dw) / 2), oy = Math.round((tc.height - dh) / 2);

    // 最近邻缩放（缩略图够用，且不需要额外的 image 解码）
    var out = ctx.createImageData(dw, dh);
    for (var y = 0; y < dh; y++) {
      var sy = Math.min(src.height - 1, Math.floor(y / s));
      for (var x = 0; x < dw; x++) {
        var sx = Math.min(src.width - 1, Math.floor(x / s));
        var si = (sy * src.width + sx) * 4, di = (y * dw + x) * 4;
        out.data[di] = src.data[si];
        out.data[di + 1] = src.data[si + 1];
        out.data[di + 2] = src.data[si + 2];
        out.data[di + 3] = src.data[si + 3];
      }
    }
    ctx.putImageData(out, ox, oy);
    $('thumbWrap').hidden = false;
    $('dropZone').hidden = true;
  }

  /** 内置示例：直接画一张像素图，方便没图片时试手感 */
  function makeDemoImage() {
    var art = [
      '................................',
      '............KKKKKK..............',
      '..........KKRRRRRRKK............',
      '.........KRRRRRRRRRRK...........',
      '........KRRRWWRRWWRRRK..........',
      '........KRRRWWRRWWRRRK..........',
      '.......KRRRRRRRRRRRRRRK.........',
      '.......KRRRRKRRRRKRRRRK.........',
      '.......KRRRRKRRRRKRRRRK.........',
      '........KRRRRRRRRRRRRK..........',
      '.........KKRRRRRRRRKK...........',
      '...........KKKKKKKK.............',
      '..........KKWWWWWWKK............',
      '........KKGGGGGGGGGGKK..........',
      '......KKGGGGGGGGGGGGGGKK........',
      '....KKGGGGGGGGGGGGGGGGGGKK......',
      '...KGGGGGGGGGGGGGGGGGGGGGGK.....',
      '..KGGGGGGGGGGGGGGGGGGGGGGGGK....',
      '..KGGGGKGGGGGGGGGGGGGGKGGGGK....',
      '..KKKKK.KKKKKKKKKKKKKK.KKKKK....',
      '................................',
      '.........P..P..P..P..P..........',
      '........PPPPPPPPPPPPPPP.........',
      '.......P..P..P..P..P..P.........',
      '................................'
    ];
    var colors = {
      '.': null,
      'K': [34, 32, 38], 'W': [250, 250, 250], 'R': [228, 62, 62],
      'G': [86, 176, 96], 'P': [176, 116, 204]
    };
    var h = art.length, w = art[0].length;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var imgData = ctx.createImageData(w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = colors[art[y][x]];
        var i = (y * w + x) * 4;
        if (!c) { imgData.data[i + 3] = 0; continue; }
        imgData.data[i] = c[0]; imgData.data[i + 1] = c[1]; imgData.data[i + 2] = c[2]; imgData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    state.sourceImage = { data: imgData.data, width: w, height: h };
    state.sourceName = 'demo';
    state.imageEl = null;
    afterImageLoaded();
  }

  function updateEmptyState() {
    $('emptyState').hidden = !!state.pattern;
  }

  function updateChips() {
    if (state.pattern) {
      $('chipSize').textContent = state.pattern.cols + ' × ' + state.pattern.rows + ' 格';
      $('chipPalette').textContent = state.pattern.palette.title;
    } else {
      $('chipSize').textContent = '未载入图片';
      $('chipPalette').textContent = Pal.get(state.paletteId) ? Pal.get(state.paletteId).title : '—';
      $('chipBeads').textContent = '—';
    }
  }

  /* ==================== 转换流水线 ==================== */
  function scheduleConvert() {
    saveSettings();
    if (!state.sourceImage) return;
    clearTimeout(convertTimer);
    convertTimer = setTimeout(function () { convertNow(); }, 220);
  }

  function collectConvertOptions() {
    return {
      fit: $('selFit').value,
      method: $('selMethod').value,
      autoTrim: $('chkAutoTrim').checked,
      dropBg: $('chkDropBg').checked,
      bgTol: parseInt($('rngBgTol').value, 10),
      dither: $('selDither').value,
      ditherStrength: parseInt($('rngDither').value, 10) / 100,
      serpentine: $('chkSerpentine').checked,
      maxColors: parseInt($('rngMaxColors').value, 10),
      removeIsolated: parseInt($('rngMerge').value, 10),
      mirror: $('chkMirror').checked,
      rotate: parseInt($('selRotate').value, 10) || 0
    };
  }

  function setBusy(on, text) {
    $('busy').hidden = !on;
    if (text) $('busyText').textContent = text;
  }

  function convertNow(manual) {
    if (!state.sourceImage) {
      if (manual) UI.toast('先导入一张图片', 'warn');
      return;
    }
    if (state.converting) { state.pending = true; return; }
    state.converting = true;
    setBusy(true, '正在转换…');

    var t0 = performance.now();
    // 让 busy 层先绘制
    setTimeout(function () {
      try {
        var opt = collectConvertOptions();
        var cols = Math.max(4, Math.min(400, parseInt($('numCols').value, 10) || 64));
        var rows = Math.max(4, Math.min(400, parseInt($('numRows').value, 10) || cols));

        var img = state.sourceImage;
        var trimRect = null;
        if (opt.autoTrim) {
          trimRect = Samp.autoTrim(img, { tolerance: 12 });
        }
        var crop = trimRect ? {
          x: trimRect.x / img.width, y: trimRect.y / img.height,
          w: trimRect.w / img.width, h: trimRect.h / img.height
        } : null;

        var sampled = Samp.sample(img, cols, rows, {
          method: opt.method, fit: opt.fit, crop: crop,
          alphaThreshold: 16,
          background: opt.dropBg ? detectBackground(img, crop) : null,
          backgroundTolerance: opt.bgTol
        });

        // 镜像 / 旋转（在格子层面做，保持原图比例语义不变）
        applyTransform(sampled, opt.mirror, opt.rotate);

        var palette = Pal.get(state.paletteId);
        var qopt = {
          dither: opt.dither,
          ditherStrength: opt.ditherStrength,
          serpentine: opt.serpentine,
          maxColors: opt.maxColors,
          removeIsolated: opt.removeIsolated,
          allowedCodes: state.inventory && state.inventory.length ? state.inventory : null
        };

        // 保留已有进度（按同位置同色号迁移，改设置不至于白拼）
        var prev = state.pattern;
        var prevCells = prev && prev.cols === cols && prev.rows === rows ? prev.cells : null;
        var prevDone = prev && prev.cols === cols && prev.rows === rows ? prev.done : null;

        applyQuantized(Q.quantize(sampled, palette, qopt), {
          cols: cols, rows: rows, palette: palette, opt: opt,
          prevCells: prevCells, prevDone: prevDone
        }, t0);

        if (state.pending) {
          state.pending = false;
          state.converting = false;
          setBusy(false);
          convertNow();
          return;
        }
      } catch (err) {
        console.error(err);
        UI.toast('转换失败：' + err.message, 'err', 5000);
      } finally {
        state.converting = false;
        setBusy(false);
      }
    }, 16);
  }

  /** 在采样数据上做镜像 / 旋转 */
  function applyTransform(sampled, mirror, rotate) {
    if (!mirror && !rotate) return;
    var w = sampled.cols, h = sampled.rows;
    var src = sampled.rgb, srcEmpty = sampled.empty;
    var rgb, empty, cols, rows;
    if (rotate === 90 || rotate === 270) { cols = h; rows = w; } else { cols = w; rows = h; }
    rgb = new Float32Array(cols * rows * 3);
    empty = new Uint8Array(cols * rows);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var nx, ny;
        if (rotate === 90) { nx = h - 1 - y; ny = x; }
        else if (rotate === 180) { nx = w - 1 - x; ny = h - 1 - y; }
        else if (rotate === 270) { nx = y; ny = w - 1 - x; }
        else { nx = x; ny = y; }
        if (mirror) nx = cols - 1 - nx;
        var si = (y * w + x) * 3, di = (ny * cols + nx) * 3;
        rgb[di] = src[si]; rgb[di + 1] = src[si + 1]; rgb[di + 2] = src[si + 2];
        empty[ny * cols + nx] = srcEmpty[y * w + x];
      }
    }
    sampled.rgb = rgb; sampled.empty = empty; sampled.cols = cols; sampled.rows = rows;
  }

  function applyQuantized(q, info, t0) {
    var pal = info.palette;
    var cells = q.cells;
    // 保留进度：同位置 + 同色号的格子继续算作已拼（改设置不用白拼一遍）
    var done = new Uint8Array(cells.length);
    if (info.prevCells && info.prevDone) {
      for (var j = 0; j < cells.length; j++) {
        if (info.prevDone[j] && cells[j] === info.prevCells[j]) done[j] = 1;
      }
    }
    var pat = new PAT.Pattern({
      cols: info.cols, rows: info.rows,
      paletteId: pal.id, palette: pal, cells: cells, done: done,
      meta: {
        title: $('txtTitle').value || '',
        created: Date.now(),
        source: state.sourceName,
        settings: info.opt,
        cols: info.cols, rows: info.rows
      }
    });
    state.pattern = pat;
    state.colorOrder = null;
    UI.clearUndo();

    // 光标放到第一个未拼的格子
    var first = pat.firstUndone();
    if (first) {
      UI.display.cursor = { x: first.x, y: first.y };
      UI.display.markColorIndex = first.index;
      UI.display.isolateColor = -1;
      $('btnIsolate').classList.remove('on');
      UI.fitToWindow(pat);                                  // 先整图入眼
      UI.centerOn(first.x, first.y, { ensureVisible: true }); // 需要时才平移
    } else {
      UI.fitToWindow(pat);
    }

    UI.refreshAll();
    updateEmptyState();
    updateChips();
    // 手机/平板上默认就把底部信息栏显示出来（没有鼠标悬停，看不到提示）
    if (isMobileLike() && !state.beading) {
      state.beading = true;
      $('beadingHud').hidden = false;
      $('beadingHud').classList.add('is-step');
      $('btnBeading').classList.add('on');
      UI.refreshHudOnly(pat);
    }
    var ms = Math.round(performance.now() - t0);
    UI.toast('已生成 ' + info.cols + '×' + info.rows + ' 图纸：' + pat.stats().colorsUsed + ' 色 / ' +
      pat.stats().beadsTotal + ' 颗（' + ms + 'ms）', 'ok', 2600);
  }

  /** 取四角颜色作为背景色 */
  function detectBackground(img, crop) {
    var w = img.width, h = img.height, d = img.data;
    var x0 = crop ? Math.round(crop.x * w) : 0;
    var y0 = crop ? Math.round(crop.y * h) : 0;
    var x1 = crop ? Math.min(w - 1, Math.round((crop.x + crop.w) * w) - 1) : w - 1;
    var y1 = crop ? Math.min(h - 1, Math.round((crop.y + crop.h) * h) - 1) : h - 1;
    var pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    var sum = [0, 0, 0];
    pts.forEach(function (p) {
      var i = (p[1] * w + p[0]) * 4;
      sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
    });
    return C.rgbToHex(Math.round(sum[0] / 4), Math.round(sum[1] / 4), Math.round(sum[2] / 4));
  }

  /* ==================== 摆豆模式 ==================== */
  function toggleBeading(force) {
    if (!state.pattern) { UI.toast('先生成图纸', 'warn'); return; }
    state.beading = force === undefined ? !state.beading : !!force;
    $('beadingHud').hidden = !state.beading;
    $('beadingHud').classList.toggle('is-step', state.beading);
    $('btnBeading').classList.toggle('on', state.beading);
    if (state.beading) {
      if (!UI.display.cursor) {
        var f = state.pattern.firstUndone();
        if (f) UI.setCursor(f.x, f.y);
      }
      // 放大到「一粒豆在屏幕上约 14px」，看得清色号又不会太夸张
      var targetScale = Math.max(UI.view.scale, Math.min(6, 14 / UI.display.cell));
      UI.setZoom(targetScale);
      UI.toast('摆豆模式：点格子看信息，按「下一个」勾选并前进（Space），Tab 跳过', 'ok', 3600);
      UI.syncHud();
    }
  }

  /** 按用量从多到少排出色号顺序（用于「按色号」导航） */
  function getColorOrder() {
    if (!state.pattern) return [];
    if (!state.colorOrder) {
      state.colorOrder = state.pattern.stats().list.map(function (e) { return e.index; });
    }
    return state.colorOrder;
  }

  function toggleAllDone() {
    var pat = state.pattern;
    if (!pat) return;
    var st = pat.stats();
    UI.pushUndo();
    if (st.doneTotal >= st.beadsTotal) {
      pat.clearProgress();
      UI.toast('已清空全部勾选', 'ok');
    } else {
      pat.markAll();
      UI.toast('已把全部 ' + st.beadsTotal + ' 颗标为已拼', 'ok');
    }
    UI.refreshAll();
  }

  /* ==================== 色号修改 ==================== */
  function changeCellColor(x, y) {
    var pat = state.pattern;
    if (!pat) return;
    var i = y * pat.cols + x;
    var cur = pat.cells[i];
    openColorPicker('把这一格换成哪个色号？', function (c) {
      UI.pushUndo();
      pat.setCell(x, y, c ? c.index : -1);
      UI.refreshAll();
      UI.toast(c ? ('已换成 ' + c.code) : '已改成空格', 'ok');
    }, cur);
  }

  function replaceColorDialog(from) {
    var pat = state.pattern;
    if (!pat) return;
    var col = pat.palette.colors[from];
    openColorPicker('把全图的 ' + col.code + ' 换成哪个色号？', function (c) {
      if (!c) return;
      UI.pushUndo();
      var n = pat.replaceColor(from, c.index);
      UI.refreshAll();
      UI.toast('已把 ' + n + ' 颗 ' + col.code + ' 换成 ' + c.code, 'ok');
    }, from);
  }

  /** 简易色号选择器：列出该图纸用到的色号（点一下即选中） */
  function openColorPicker(title, cb, current) {
    var pat = state.pattern;
    var host = $('modalPaletteChart');
    $('chartTitle').textContent = title;
    var body = $('chartBody');
    body.innerHTML = '';
    var frag = document.createDocumentFragment();
    function addCell(c, note) {
      var d = document.createElement('div');
      d.className = 'chart-cell';
      d.style.background = c.hex;
      d.style.color = C.contrastText(c.r, c.g, c.b);
      d.innerHTML = c.code + (note ? '<small>' + note + '</small>' : '');
      d.title = c.code + ' ' + c.hex + (c.name ? ' ' + c.name : '');
      d.addEventListener('click', function () {
        host.hidden = true;
        cb(c);
      });
      frag.appendChild(d);
    }
    frag.appendChild(makePickerButton('改成空格（不摆豆）', current, function () { host.hidden = true; cb(null); }));
    pat.stats().list.forEach(function (e) { addCell(pat.palette.colors[e.index], e.count + '颗'); });
    body.appendChild(frag);
    host.hidden = false;
  }

  function makePickerButton(label, current, fn) {
    var d = document.createElement('div');
    d.className = 'chart-cell';
    d.style.background = '#2a2f3a';
    d.style.color = '#e8ecf2';
    d.style.gridColumn = 'span 2';
    d.textContent = label;
    d.addEventListener('click', fn);
    return d;
  }

  /* ==================== 导出 ==================== */
  function currentDisplayOpts() {
    var d = UI.display;
    return {
      cell: d.cell, showGrid: d.showGrid, boldEvery: d.boldEvery,
      showCoords: d.showCoords, coordEvery: d.coordEvery,
      showCodes: d.showCodes, codeMode: d.codeMode,
      showStats: true, showTitle: true,
      title: $('txtTitle').value || ('拼豆图纸 ' + state.pattern.cols + '×' + state.pattern.rows),
      showLegendNumbers: true,
      showBoardLines: d.showBoardLinesOn ? (d.boardStepX || 29) : 0
    };
  }

  function exportSheetPng() {
    if (!state.pattern) { UI.toast('先生成图纸', 'warn'); return; }
    try {
      var cv = EXP.renderSheetCanvas(state.pattern, currentDisplayOpts());
      var name = EXP.safeName($('txtTitle').value || '拼豆图纸') + '_' +
        state.pattern.cols + 'x' + state.pattern.rows + '.png';
      EXP.saveCanvas(cv, name).then(function (how) {
        if (how === 'shared') UI.toast('已通过系统分享保存', 'ok');
        else if (how === 'downloaded') UI.toast('图纸已导出', 'ok');
      }).catch(function (e) { UI.toast('导出失败：' + e.message, 'err', 4000); });
    } catch (e) {
      UI.toast(e.message, 'err', 5000);
    }
  }

  function exportShoppingPng() {
    if (!state.pattern) { UI.toast('先生成图纸', 'warn'); return; }
    var cv = EXP.renderLegendCanvas(state.pattern, { statsPerRow: 4 });
    EXP.saveCanvas(cv, EXP.safeName('拼豆采购清单') + '.png').then(function (how) {
      if (how === 'shared') UI.toast('已通过系统分享保存', 'ok');
      else if (how === 'downloaded') UI.toast('采购清单已导出', 'ok');
    }).catch(function (e) { UI.toast('导出失败：' + e.message, 'err', 4000); });
  }

  function exportCsv() {
    if (!state.pattern) { UI.toast('先生成图纸', 'warn'); return; }
    var pack = parseInt($('selPack').value, 10) || 1000;
    EXP.downloadText(EXP.statsCsv(state.pattern, pack),
      EXP.safeName($('txtTitle').value || '拼豆用量') + '_用量清单.csv', 'text/csv;charset=utf-8');
    UI.toast('CSV 已导出', 'ok');
  }

  function printSheet() {
    if (!state.pattern) { UI.toast('先生成图纸', 'warn'); return; }
    var opts = currentDisplayOpts();
    EXP.buildPrintPages(state.pattern, opts, {
      boardW: parseInt($('numBoardW2').value, 10) || 29,
      boardH: parseInt($('numBoardH2').value, 10) || 29,
      overlap: parseInt($('numOverlap').value, 10) || 0
    });
    UI.toast('正在打开打印预览…', 'ok', 1500);
    setTimeout(function () { root.print(); }, 220);
  }

  /* ==================== 项目存取 ==================== */
  function saveProject() {
    if (!state.pattern) { UI.toast('还没有图纸可保存', 'warn'); return; }
    var data = state.pattern.serialize({ embedPalette: true, withProgress: true });
    data.app = '拼豆图纸工坊';
    data.savedAt = new Date().toISOString();
    data.settings = collectConvertOptions();
    data.paletteId = state.paletteId;
    data.title = $('txtTitle').value || '';
    EXP.downloadText(JSON.stringify(data),
      EXP.safeName($('txtTitle').value || '拼豆项目') + '_' + state.pattern.cols + 'x' + state.pattern.rows + '.pindou.json',
      'application/json');
    UI.toast('项目已保存（含进度，可下次继续）', 'ok');
  }

  function openProjectDialog() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });
    input.click();
  }

  function loadProjectData(data) {
    if (!data || data.format !== 'pindou-pattern') throw new Error('不是本工具的项目文件');
    var pat = PAT.Pattern.deserialize(data, function (id) { return Pal.get(id); });
    state.pattern = pat;
    state.paletteId = pat.paletteId;
    if (Pal.get(pat.paletteId)) $('selPalette').value = pat.paletteId;
    $('numCols').value = pat.cols;
    $('numRows').value = pat.rows;
    $('txtTitle').value = data.title || (pat.meta && pat.meta.title) || '';
    UI.display.title = $('txtTitle').value;
    UI.clearUndo();
    var first = pat.firstUndone();
    if (first) {
      UI.display.cursor = { x: first.x, y: first.y };
      UI.display.markColorIndex = first.index;
    }
    UI.refreshAll();
    UI.fitToWindow(pat);
    updateEmptyState();
    updateChips();
    UI.toast('已载入项目：' + pat.cols + '×' + pat.rows + '，进度 ' + pat.progress().done + '/' + pat.progress().total, 'ok', 3200);
  }

  /* ==================== 自动保存 / 设置持久化 ==================== */
  function saveSettings() {
    try {
      var s = {
        paletteId: state.paletteId,
        fit: $('selFit').value, method: $('selMethod').value,
        autoTrim: $('chkAutoTrim').checked, dropBg: $('chkDropBg').checked,
        bgTol: $('rngBgTol').value, dither: $('selDither').value,
        ditherStrength: $('rngDither').value, serpentine: $('chkSerpentine').checked,
        maxColors: $('rngMaxColors').value, removeIsolated: $('rngMerge').value,
        mirror: $('chkMirror').checked, rotate: $('selRotate').value,
        cols: $('numCols').value, lockRatio: $('chkLockRatio').checked,
        cell: UI.display.cell, showGrid: UI.display.showGrid, boldEvery: UI.display.boldEvery,
        showCoords: UI.display.showCoords, coordEvery: UI.display.coordEvery,
        showCodes: UI.display.showCodes, codeMode: UI.display.codeMode,
        clickToggle: $('chkClickToggle').checked, order: $('selOrder').value,
        boardLines: $('chkBoardLines').checked,
        boardW: $('numBoardW').value, boardH: $('numBoardH').value,
        inventory: state.inventory
      };
      localStorage.setItem('pindou.settings.v1', JSON.stringify(s));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function loadSettings() {
    var raw;
    try { raw = localStorage.getItem('pindou.settings.v1'); } catch (e) { return; }
    if (!raw) return;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return; }
    function set(id, v) { var n = $(id); if (n && v !== undefined) n.value = v; }
    function chk(id, v) { var n = $(id); if (n && v !== undefined) n.checked = !!v; }
    if (s.paletteId && Pal.get(s.paletteId)) { state.paletteId = s.paletteId; $('selPalette').value = s.paletteId; }
    set('selFit', s.fit); set('selMethod', s.method);
    chk('chkAutoTrim', s.autoTrim); chk('chkDropBg', s.dropBg);
    set('rngBgTol', s.bgTol); $('valBgTol').textContent = $('rngBgTol').value;
    $('rowBgTol').hidden = !$('chkDropBg').checked;
    set('selDither', s.dither); set('rngDither', s.ditherStrength);
    $('valDither').textContent = $('rngDither').value + '%';
    chk('chkSerpentine', s.serpentine);
    set('rngMaxColors', s.maxColors);
    $('valMaxColors').textContent = ($('rngMaxColors').value === '0' ? '不限制' : $('rngMaxColors').value + ' 色');
    set('rngMerge', s.removeIsolated);
    $('valMerge').textContent = ($('rngMerge').value === '0' ? '关闭' : '小于 ' + $('rngMerge').value + ' 颗');
    chk('chkMirror', s.mirror); set('selRotate', s.rotate);
    set('numCols', s.cols);
    chk('chkLockRatio', s.lockRatio);
    $('numRows').disabled = $('chkLockRatio').checked;
    $('rowRows').style.opacity = $('chkLockRatio').checked ? .5 : 1;
    if (s.cell) UI.display.cell = s.cell;
    set('numCell', UI.display.cell);
    chk('chkShowGrid', s.showGrid); UI.display.showGrid = s.showGrid !== false;
    if (s.boldEvery !== undefined) { UI.display.boldEvery = s.boldEvery; set('numBold', s.boldEvery); }
    chk('chkShowCoords', s.showCoords); UI.display.showCoords = s.showCoords !== false;
    if (s.coordEvery) { UI.display.coordEvery = s.coordEvery; set('numCoordEvery', s.coordEvery); }
    chk('chkShowCodes', s.showCodes); UI.display.showCodes = s.showCodes !== false;
    if (s.codeMode) { UI.display.codeMode = s.codeMode; set('selCodeMode', s.codeMode); }
    chk('chkClickToggle', s.clickToggle);
    set('selOrder', s.order);
    chk('chkBoardLines', s.boardLines);
    UI.display.showBoardLinesOn = !!s.boardLines;
    set('numBoardW', s.boardW); set('numBoardH', s.boardH);
    if (s.boardW) UI.display.boardStepX = parseInt(s.boardW, 10) || 29;
    if (s.boardH) UI.display.boardStepY = parseInt(s.boardH, 10) || 29;
    if (s.inventory && s.inventory.length) {
      state.inventory = s.inventory;
      updateInventoryTag();
    }
  }

  /** 页面关闭/刷新前把项目存到 localStorage，防止误关丢进度 */
  function maybeRestoreAutosave() {
    var raw;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (!data || data.format !== 'pindou-pattern') return;
      loadProjectData(data);
      UI.toast('已恢复上次自动保存的图纸（进度也在）', 'ok', 3600);
    } catch (e) { }
  }

  var autosaveTimer = null;
  function scheduleAutosave() {
    if (autosaveTimer) return;
    autosaveTimer = setTimeout(function () {
      autosaveTimer = null;
      if (!state.pattern) return;
      try {
        var data = state.pattern.serialize({ embedPalette: false, withProgress: true });
        data.title = $('txtTitle').value || '';
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
      } catch (e) { }
    }, 1200);
  }
  root.addEventListener('beforeunload', function () {
    if (!state.pattern) return;
    try {
      var data = state.pattern.serialize({ embedPalette: false, withProgress: true });
      data.title = $('txtTitle').value || '';
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    } catch (e) { }
  });

  /* ==================== 库存（只用我有的豆子） ==================== */
  function openInventory() {
    var ta = $('txtInventory');
    ta.value = state.inventory ? state.inventory.join(' ') : '';
    $('modalInventory').hidden = false;
    setTimeout(function () { ta.focus(); }, 30);
  }
  function updateInventoryTag() {
    var tag = $('inventoryTag');
    if (state.inventory && state.inventory.length) {
      tag.hidden = false;
      $('inventoryText').textContent = '只用 ' + state.inventory.length + ' 个色号转换';
    } else {
      tag.hidden = true;
    }
  }

  /* ==================== 弹层 ==================== */
  function initModals() {
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m || (e.target.dataset && 'close' in e.target.dataset)) m.hidden = true;
      });
    });
    $('btnInventoryApply').addEventListener('click', function () {
      var txt = $('txtInventory').value || '';
      var codes = txt.split(/[\s,，、;；]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      state.inventory = codes.length ? codes : null;
      $('modalInventory').hidden = true;
      updateInventoryTag();
      saveSettings();
      if (state.sourceImage) convertNow();
      UI.toast(codes.length ? ('已限制为 ' + codes.length + ' 个色号') : '已取消色号限制', 'ok');
    });
    $('btnClearInventory').addEventListener('click', function () {
      state.inventory = null;
      updateInventoryTag();
      saveSettings();
      if (state.sourceImage) convertNow();
      UI.toast('已取消色号限制', 'ok');
    });
    $('btnInventoryCurrent').addEventListener('click', function () {
      if (!state.pattern) { UI.toast('还没有图纸', 'warn'); return; }
      $('txtInventory').value = state.pattern.stats().list.map(function (e) { return e.code; }).join(' ');
    });
    $('btnInventoryAll').addEventListener('click', function () {
      var p = Pal.get($('selPalette').value);
      $('txtInventory').value = p.colors.map(function (c) { return c.code; }).join(' ');
    });
  }

  function closeModals() {
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) { m.hidden = true; });
    $('ctxMenu').hidden = true;
  }

  function resetSettings() {
    try { localStorage.removeItem('pindou.settings.v1'); } catch (e) { }
    location.reload();
  }

  /* ==================== 对外接口 ==================== */
  root.PindouApp = {
    state: state,
    init: init,
    getPattern: function () { return state.pattern; },
    isPanTool: function () { return state.panTool; },
    /** 左键点格子是否直接切换勾选（默认关闭 = 点选看信息） */
    isClickToggle: function () {
      var n = $('chkClickToggle');
      return !!(n && n.checked);
    },
    getColorOrder: getColorOrder,
    convertNow: convertNow,
    saveProject: saveProject,
    openProjectDialog: openProjectDialog,
    printSheet: printSheet,
    closeModals: closeModals,
    toggleBeading: toggleBeading,
    zoomFit: zoomFit,
    changeCellColor: changeCellColor,
    replaceColorDialog: replaceColorDialog,
    exportSheetPng: exportSheetPng,
    scheduleAutosave: scheduleAutosave
  };

  /* 进度变化时自动保存 */
  var origAfterToggle = UI.afterCellToggle;
  if (origAfterToggle) {
    UI.afterCellToggle = function () {
      origAfterToggle.apply(null, arguments);
      scheduleAutosave();
    };
  }

  /* ==================== 自检钩子（自动化测试用） ==================== */
  root.PindouSelfTest = {
    /**
     * 在页面里真实跑一遍：载图 -> 转换 -> 勾选 -> 导出（PNG/CSV）-> 打印页。
     * 结果写到 #selftestResult，供无头浏览器 dump 出来。
     */
    run: function (url, opts) {
      opts = opts || {};
      function finish(obj) {
        var out = document.createElement('pre');
        out.id = 'selftestResult';
        out.textContent = JSON.stringify(obj, null, 1);
        document.body.appendChild(out);
        // 可选：把导出结果直接贴在页面里，方便截图肉眼检查排版
        if (opts.sheets) {
          try {
            var pat = state.pattern;
            var wrap = document.createElement('div');
            wrap.id = 'selftestSheets';
            wrap.style.cssText = 'background:#fff;padding:8px;';
            var sheet = EXP.renderSheetCanvas(pat, {
              cell: opts.sheetCell || 13, showGrid: true, boldEvery: 5, showCoords: true, coordEvery: 1,
              showCodes: true, codeMode: opts.codeMode || 'code', showStats: true, showTitle: true,
              title: '示例：照片转拼豆图纸', showLegendNumbers: true,
              showBoardLines: opts.boardLines || 0
            });
            sheet.style.cssText = 'display:block;width:1500px;height:auto;border:1px solid #999;margin-bottom:10px';
            wrap.appendChild(sheet);
            var legend = EXP.renderLegendCanvas(pat, { statsPerRow: 4 });
            legend.style.cssText = 'display:block;width:1100px;height:auto;border:1px solid #999';
            wrap.appendChild(legend);
            // 自动下载导出的 PNG，方便自动化流程直接拿到文件
            try {
              sheet.toBlob(function (b) {
                if (!b) return;
                var a = document.createElement('a');
                a.href = URL.createObjectURL(b);
                a.download = 'selftest-sheet.png';
                document.body.appendChild(a);
                a.click();
              });
              legend.toBlob(function (b) {
                if (!b) return;
                var a = document.createElement('a');
                a.href = URL.createObjectURL(b);
                a.download = 'selftest-legend.png';
                document.body.appendChild(a);
                a.click();
              });
            } catch (e2) { /* 仅调试用 */ }
            document.body.appendChild(wrap);
          } catch (e) { /* 仅调试用 */ }
        }
      }
      function fail(e) {
        finish({ error: String(e && e.stack || e), stage: currentStage });
      }
      var currentStage = 'init';
      var checks = [];
      function chk(name, cond, extra) {
        checks.push({ name: name, pass: !!cond, extra: extra == null ? '' : String(extra) });
      }
      try {
        currentStage = 'load-image';
        // 走和用户导入完全相同的路径（Blob -> FileReader -> Image -> getImageData），
        // 这样 file:// 下也能测出真实的 canvas 污染问题。
        // 优先用内联的 data URL（file:// 下 fetch 读不了本地文件）。
        var inlineSrc = root.PINDouSelfTestImage || null;
        if (inlineSrc) {
          dataUrlToFile(inlineSrc, 'selftest-image.png', function (file) {
            readImagePixels(file, onPixels, function (err) { finish({ error: err.message, stage: currentStage }); });
          });
        } else {
          fetch(url).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' 读取测试图片失败');
            var type = r.headers.get('content-type') || 'image/png';
            return r.arrayBuffer().then(function (buf) {
              return new File([buf], 'selftest-image.png', { type: type.split(';')[0] });
            });
          }).then(function (file) {
            readImagePixels(file, onPixels, function (err) { finish({ error: err.message, stage: currentStage }); });
          }).catch(function (e) {
            finish({ error: '图片加载失败: ' + (e && e.message), stage: currentStage });
          });
        }

        function onPixels(imageData, img) {
          try {
            currentStage = 'decode';
            state.sourceImage = imageData;
            state.imageEl = img;
            state.sourceName = 'selftest';
            renderThumbFromData();
            chk('图片已载入', img.naturalWidth > 0, img.naturalWidth + 'x' + img.naturalHeight);

            // 先按原图比例定好尺寸（afterImageLoaded 会覆盖设定值，所以顺序很重要）
            var wantCols = opts.cols || 64;
            $('numCols').value = wantCols;
            var fitRows = Math.max(4, Math.min(400, Math.round(wantCols * (imageData.height / imageData.width))));
            $('numRows').value = fitRows;
            if (opts.palette && Pal.get(opts.palette)) { $('selPalette').value = opts.palette; state.paletteId = opts.palette; updatePaletteHint(); }
            if (opts.dither) $('selDither').value = opts.dither;
            if (opts.maxColors != null) $('rngMaxColors').value = opts.maxColors;

            currentStage = 'convert';
            convertNow();

            setTimeout(function () {
              try {
                currentStage = 'verify';
                var pat = state.pattern;
                chk('已生成图纸', !!pat);
                if (pat) {
                  var st = pat.stats();
                  chk('图纸尺寸 = 设定值', pat.cols === (parseInt($('numCols').value, 10) || 0), pat.cols + 'x' + pat.rows);
                  chk('用色数 > 1', st.colorsUsed > 1, st.colorsUsed);
                  chk('豆子数 = 有色格子数',
                    st.beadsTotal === Array.prototype.filter.call(pat.cells, function (v) { return v >= 0; }).length);
                  chk('有光标', !!UI.display.cursor);
                  chk('用量清单已渲染', $('statList').children.length > 0, $('statList').children.length + ' 行');
                  chk('检查面板已渲染', $('checkBody').children.length > 0, $('checkBody').children.length + ' 项');
                  chk('分板面板有内容', $('boardList').children.length > 0, $('boardList').children.length + ' 块');

                  var cvv = $('view');
                  var idata = cvv.getContext('2d').getImageData(0, 0, cvv.width, cvv.height).data;
                  var nonBg = 0;
                  for (var i = 0; i < idata.length; i += 4 * 97) {
                    if (idata[i] !== 15 || idata[i + 1] !== 18 || idata[i + 2] !== 24) nonBg++;
                  }
                  chk('主画布已绘制', nonBg > 20, nonBg + ' 采样点非背景');

                  currentStage = 'check-toggle';
                  // 新交互：点格子只选中看信息 → 「下一个」才勾选并推进
                  var f = pat.firstUndone();
                  if (f) {
                    var doneBefore = pat.progress().done;
                    UI.selectCell(f.x, f.y);
                    chk('点格子只选中、不勾选',
                      pat.progress().done === doneBefore && !pat.isDone(f.x, f.y) && UI.display.cursor.x === f.x && UI.display.cursor.y === f.y);
                    chk('HUD 显示该格色号与余量',
                      ($('hudCode').textContent || '').length > 0 &&
                      (($('hudSub').textContent || '') + ($('hudMeta').textContent || '')).indexOf('还剩') >= 0,
                      $('hudCode').textContent + ' | ' + $('hudMeta').textContent);
                    chk('「下一个」按钮可用', !$('btnHudNext').disabled);
                    chk('「下一个」提示显示下一格',
                      ($('hudNextHint').textContent || '').length > 0, $('hudNextHint').textContent);

                    UI.advance(false, false);       // = 点「下一个」
                    chk('按「下一个」后：当前这颗被勾选', pat.isDone(f.x, f.y));
                    chk('按「下一个」后：进度 +1', pat.progress().done === doneBefore + 1,
                      pat.progress().done + ' vs ' + (doneBefore + 1));
                    chk('按「下一个」后：光标已跳到下一格',
                      UI.display.cursor.x !== f.x || UI.display.cursor.y !== f.y,
                      JSON.stringify(UI.display.cursor));
                    var curIdx = pat.cells[UI.display.cursor.y * pat.cols + UI.display.cursor.x];
                    chk('跳到的新格子显示了自己的信息',
                      $('hudCode').textContent === pat.palette.colors[curIdx].code,
                      $('hudCode').textContent + ' vs ' + pat.palette.colors[curIdx].code);
                    chk('新格子尚未被勾选', !pat.isDone(UI.display.cursor.x, UI.display.cursor.y));

                    // 「跳过」：不勾选，只往后看
                    var skipFrom = { x: UI.display.cursor.x, y: UI.display.cursor.y };
                    var doneBeforeSkip = pat.progress().done;
                    UI.advance(true, false);
                    chk('按「跳过」：不勾选、进度不变', pat.progress().done === doneBeforeSkip);
                    chk('按「跳过」：光标移动了',
                      UI.display.cursor.x !== skipFrom.x || UI.display.cursor.y !== skipFrom.y);

                    // 「只勾选这一颗」：勾选但不移动
                    var keep = { x: UI.display.cursor.x, y: UI.display.cursor.y };
                    var d2 = pat.progress().done;
                    UI.markCurrent();
                    chk('「只勾选这一颗」：勾上但不移动',
                      pat.isDone(keep.x, keep.y) && pat.progress().done === d2 + 1 &&
                      UI.display.cursor.x === keep.x && UI.display.cursor.y === keep.y);
                  }
                  // 一共勾了 3 颗（下一个 / 跳过后的只勾选 / 只勾选这一颗），撤销 3 次应回到 0
                  chk('撤销栈可用（3 次勾选 = 3 步撤销）', (function () {
                    for (var u = 0; u < 3; u++) UI.undo();
                    return pat.progress().done === 0;
                  })(), '撤销后 done=' + pat.progress().done);

                  chk('只看当前色可用', (function () {
                    UI.display.markColorIndex = pat.stats().list[0].index;
                    UI.toggleIsolate();
                    var on = UI.display.isolateColor >= 0;
                    UI.toggleIsolate();
                    return on && UI.display.isolateColor < 0;
                  })());

                  currentStage = 'export-sheet';
                  var m = R.measureSheet(pat, { cell: 14, showStats: true });
                  chk('导图纸张尺寸合理', m.width > 100 && m.height > 100 && m.width * m.height < 268435456,
                    m.width + 'x' + m.height);
                  var sheet = EXP.renderSheetCanvas(pat, { cell: 12, showStats: true, showTitle: true, title: '自检' });
                  chk('图纸 PNG 画布已生成', sheet.width > 100 && sheet.height > 100, sheet.width + 'x' + sheet.height);
                  var sctx = sheet.getContext('2d');
                  var sdata = sctx.getImageData(0, 0, Math.min(sheet.width, 200), Math.min(sheet.height, 200)).data;
                  var inked = 0;
                  for (var k = 0; k < sdata.length; k += 4) if (sdata[k] !== 255 || sdata[k + 1] !== 255 || sdata[k + 2] !== 255) inked++;
                  chk('图纸 PNG 有内容', inked > 200, inked + ' 个非白像素（左上角区域）');

                  currentStage = 'export-legend';
                  var leg = EXP.renderLegendCanvas(pat, { statsPerRow: 4 });
                  chk('采购清单 PNG 已生成', leg.width === 1000 && leg.height > 120, leg.width + 'x' + leg.height);

                  currentStage = 'export-csv';
                  var csv = EXP.statsCsv(pat, 1000);
                  chk('CSV 有表头和数据行', csv.indexOf('色号') === 1 && csv.split('\r\n').length > st.colorsUsed, csv.split('\r\n').length + ' 行');
                  var pcsv = EXP.positionsCsv(pat);
                  chk('逐颗坐标 CSV 行数 = 豆子数 + 表头',
                    pcsv.split('\r\n').length === st.beadsTotal + 1, pcsv.split('\r\n').length + ' vs ' + (st.beadsTotal + 1));

                  currentStage = 'project';
                  var ser = pat.serialize({ embedPalette: true });
                  var back = PAT.Pattern.deserialize(JSON.parse(JSON.stringify(ser)));
                  var same = true;
                  for (var q = 0; q < pat.cells.length; q++) if (back.cells[q] !== pat.cells[q]) { same = false; break; }
                  chk('项目保存/读取往返一致', same && back.cols === pat.cols);

                  currentStage = 'print';
                  var pages = EXP.buildPrintPages(pat, { cell: 14, showGrid: true, showCoords: true, showCodes: true, boldEvery: 5, showStats: true },
                    { boardW: 29, boardH: 29, overlap: 0 });
                  chk('打印页已生成（总图 + 分板）', pages.length >= 1, pages.length + ' 页');
                  var pcv = document.querySelector('#printArea canvas');
                  chk('打印页画布有尺寸', !!pcv && pcv.width > 100, pcv ? pcv.width + 'x' + pcv.height : 'null');

                  currentStage = 'board-sub';
                  var boards = pat.boards(29, 29, 0);
                  chk('分板计算正确', boards.length >= 1, boards.length + ' 块');
                  var subCv = document.createElement('canvas');
                  subCv.width = boards[0].w * 20; subCv.height = boards[0].h * 20;
                  EXP.drawSubPattern(subCv.getContext('2d'), pat, boards[0], 20, { showGrid: true, showCoords: true, showCodes: true, boldEvery: 5, codeMode: 'code', coordEvery: 1 });
                  chk('分板绘制未报错', true);

                  currentStage = 'beading';
                  root.PindouApp.toggleBeading(true);
                  chk('摆豆模式打开', !$('beadingHud').hidden);
                  chk('HUD 显示色号', ($('hudCode').textContent || '').length > 0, $('hudCode').textContent);
                  chk('HUD 四个操作按钮都存在',
                    !!$('btnHudNext') && !!$('btnHudSkip') && !!$('btnHudDone') && !!$('btnHudPrev'));
                  chk('「下一个」按钮文案正确',
                    ($('btnHudNext').textContent || '').indexOf('下一个') >= 0, $('btnHudNext').textContent);
                  chk('HUD 显示该色号剩余数量',
                    ($('hudMeta').textContent || '').indexOf('还剩') >= 0, $('hudMeta').textContent);
                  if (!opts.keepBeading) root.PindouApp.toggleBeading(false);

                  currentStage = 'view-options';
                  // 逐个切换显示选项，确保渲染不报错
                  ['chkShowGrid', 'chkShowCoords', 'chkShowCodes', 'chkBoardLines'].forEach(function (id) {
                    var n = $(id);
                    n.checked = !n.checked;
                    n.dispatchEvent(new Event('change'));
                    n.checked = !n.checked;
                    n.dispatchEvent(new Event('change'));
                  });
                  $('selCodeMode').value = 'number';
                  $('selCodeMode').dispatchEvent(new Event('change'));
                  $('selCodeMode').value = 'symbol';
                  $('selCodeMode').dispatchEvent(new Event('change'));
                  $('selCodeMode').value = 'code';
                  $('selCodeMode').dispatchEvent(new Event('change'));
                  UI.draw();
                  chk('显示选项切换无异常', true);

                  currentStage = 'palette-chart';
                  UI.openPaletteChart();
                  chk('色卡一览弹层已渲染', $('chartBody').children.length > 50, $('chartBody').children.length + ' 格');
                  root.PindouApp.closeModals();
                }
                currentStage = 'done';
                finish({ ok: checks.every(function (c) { return c.pass; }), checks: checks,
                  failed: checks.filter(function (c) { return !c.pass; }).length,
                  info: state.pattern ? {
                    size: state.pattern.cols + 'x' + state.pattern.rows,
                    palette: state.pattern.palette.title,
                    colors: state.pattern.stats().colorsUsed,
                    beads: state.pattern.stats().beadsTotal
                  } : null });
              } catch (e) { fail(e); }
            }, opts.wait || 1500);
          } catch (e) { fail(e); }
        }
      } catch (e) { fail(e); }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* URL 参数自检：index.html?selftest=1&cols=64&palette=coco-291&dither=floyd
     （自动化测试用；正常使用不会触发） */
      try {
        var qs = String(location.search || '');
    if (/(^|[?&])selftest=1/.test(qs)) {
      var params = {};
      qs.replace(/^\?/, '').split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      var start = function () {
        root.PindouSelfTest.run(params.img || './assets/test-photo.png', {
          cols: params.cols ? parseInt(params.cols, 10) : 64,
          palette: params.palette || null,
          dither: params.dither || null,
          maxColors: params.maxColors ? parseInt(params.maxColors, 10) : null,
          sheets: params.sheets === '1',
          sheetCell: params.sheetCell ? parseInt(params.sheetCell, 10) : 13,
          codeMode: params.codeMode || 'code',
          boardLines: params.boardLines ? parseInt(params.boardLines, 10) : 0,
          keepBeading: params.beading === '1',
          wait: 1500
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 60); });
      else setTimeout(start, 60);
    }
  } catch (e) { /* 忽略 */ }
})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================================
 * pattern.js — 图纸数据模型：格子、进度、统计、导航
 * 纯逻辑，无 DOM 依赖。
 *
 * 格子取值： -1 = 空格（不摆豆）   0..N-1 = 色卡下标（对应 palette.colors[i]）
 * ========================================================================= */
(function (root) {
  'use strict';

  var EMPTY = -1;

  function Pattern(o) {
    this.cols = o.cols | 0;
    this.rows = o.rows | 0;
    this.paletteId = o.paletteId;
    this.cells = o.cells;                       // Int16Array(cols*rows)
    this.palette = o.palette;                   // Palette 实例（或用 paletteColors 还原）
    this.done = o.done || new Uint8Array(this.cols * this.rows);
    this.meta = o.meta || {};                   // 标题/来源/设置快照
    this.version = 1;
    this._stats = null;
    this._tint = null;                          // 淡色缓存（渲染用）
  }
  Pattern.EMPTY = EMPTY;

  Object.defineProperty(Pattern.prototype, 'size', {
    get: function () { return this.cols * this.rows; }
  });

  /** 重新统计（设置变更或载入后调用） */
  Pattern.prototype.invalidate = function () {
    this._stats = null;
    this._tint = null;
  };

  /* ---------------- 统计 ---------------- */
  Pattern.prototype.stats = function () {
    if (this._stats) return this._stats;
    var pal = this.palette;
    var n = this.cells.length;
    var counts = new Int32Array(pal ? pal.size() : 0);
    var doneCounts = new Int32Array(pal ? pal.size() : 0);
    var doneTotal = 0, beadsTotal = 0, emptyTotal = 0;
    for (var i = 0; i < n; i++) {
      var c = this.cells[i];
      if (c < 0) { emptyTotal++; continue; }
      beadsTotal++;
      counts[c]++;
      if (this.done[i]) { doneCounts[c]++; doneTotal++; }
    }
    var list = [];
    for (var k = 0; k < counts.length; k++) {
      if (!counts[k]) continue;
      var col = pal.colors[k];
      list.push({
        index: k, code: col.code, name: col.name, group: col.group,
        hex: col.hex, r: col.r, g: col.g, b: col.b,
        count: counts[k], done: doneCounts[k],
        remaining: counts[k] - doneCounts[k]
      });
    }
    list.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;       // 用量降序
      return a.code.localeCompare(b.code, 'zh');
    });
    this._stats = {
      beadsTotal: beadsTotal,
      colorsUsed: list.length,
      emptyTotal: emptyTotal,
      doneTotal: doneTotal,
      doneRatio: beadsTotal ? doneTotal / beadsTotal : 0,
      list: list,
      byIndex: (function () {
        var m = Object.create(null);
        list.forEach(function (e) { m[e.index] = e; });
        return m;
      })()
    };
    return this._stats;
  };

  Pattern.prototype.countOf = function (index) {
    var s = this.stats();
    return s.byIndex[index] ? s.byIndex[index].count : 0;
  };
  Pattern.prototype.progress = function () {
    var s = this.stats();
    return { done: s.doneTotal, total: s.beadsTotal, ratio: s.doneRatio };
  };

  /* ---------------- 勾选 / 取消 ---------------- */
  Pattern.prototype.isDone = function (x, y) {
    var i = y * this.cols + x;
    return !!(i >= 0 && i < this.done.length && this.done[i]);
  };
  Pattern.prototype.setDone = function (x, y, v) {
    var i = y * this.cols + x;
    if (i < 0 || i >= this.done.length) return false;
    if (this.cells[i] < 0) return false;
    var nv = v ? 1 : 0;
    if (this.done[i] === nv) return false;
    this.done[i] = nv;
    this._stats = null;
    return true;
  };
  Pattern.prototype.toggleDone = function (x, y) { return this.setDone(x, y, !this.isDone(x, y)); };

  /** 把某一色号全部标记为已拼 / 未拼 */
  Pattern.prototype.setColorDone = function (index, v) {
    var changed = 0;
    for (var i = 0; i < this.cells.length; i++) {
      if (this.cells[i] !== index) continue;
      var nv = v ? 1 : 0;
      if (this.done[i] !== nv) { this.done[i] = nv; changed++; }
    }
    if (changed) this._stats = null;
    return changed;
  };
  Pattern.prototype.clearProgress = function () {
    this.done.fill(0);
    this._stats = null;
  };
  Pattern.prototype.markAll = function () {
    for (var i = 0; i < this.cells.length; i++) this.done[i] = this.cells[i] >= 0 ? 1 : 0;
    this._stats = null;
  };

  /* ---------------- 把某个格子的颜色换成别的色号（手动修图） ---------------- */
  Pattern.prototype.setCell = function (x, y, index) {
    var i = y * this.cols + x;
    if (i < 0 || i >= this.cells.length) return;
    if (this.cells[i] === index) return;
    this.cells[i] = index;
    if (index < 0) this.done[i] = 0;
    this._stats = null;
  };
  /** 用某个色号替换全图另一色号 */
  Pattern.prototype.replaceColor = function (from, to) {
    var changed = 0;
    for (var i = 0; i < this.cells.length; i++) {
      if (this.cells[i] === from) { this.cells[i] = to; changed++; }
    }
    if (changed) this._stats = null;
    return changed;
  };

  /* ---------------- 进度快照（撤销用） ---------------- */
  Pattern.prototype.snapshotProgress = function () { return Uint8Array.from(this.done); };
  Pattern.prototype.restoreProgress = function (snap) {
    if (!snap || snap.length !== this.done.length) return;
    this.done.set(snap);
    this._stats = null;
  };
  Pattern.prototype.snapshotCells = function () { return Int16Array.from(this.cells); };
  Pattern.prototype.restoreCells = function (snap) {
    if (!snap || snap.length !== this.cells.length) return;
    this.cells.set(snap);
    this._stats = null;
  };

  /* ---------------- 导航：找下一个要拼的格子 ---------------- */
  var ORDERS = {
    row: '逐行（从左到右、从上到下）',
    col: '逐列（从上到下、从左到右）',
    'row-serpentine': '逐行蛇形（像扫地一样来回）',
    color: '按色号（一种颜色拼完再换下一种）'
  };

  /**
   * @param {number} x 当前列
   * @param {number} y 当前行
   * @param {Object} opt {order, forward, skipDone, colorIndex, colorOrder}
   * @returns {{x,y,index}|null}
   */
  Pattern.prototype.nextCell = function (x, y, opt) {
    opt = opt || {};
    var order = opt.order || 'row';
    var forward = opt.forward !== false;
    var skipDone = opt.skipDone !== false;
    var cols = this.cols, rows = this.rows;

    if (order === 'color') {
      var orderList = opt.colorOrder || null;    // 色号顺序（index 数组）
      if (!orderList) {
        orderList = this.stats().list.map(function (e) { return e.index; });
      }
      var seq = [];
      // 按色号顺序收集所有格子（同色内按逐行顺序，方便按区域拼）
      for (var oi = 0; oi < orderList.length; oi++) {
        var ci = orderList[oi];
        for (var yy = 0; yy < rows; yy++) {
          for (var xx = 0; xx < cols; xx++) {
            var p = yy * cols + xx;
            if (this.cells[p] === ci) seq.push(p);
          }
        }
      }
      if (!seq.length) return null;
      var startPos = 0;
      var cur = y * cols + x;
      for (var s = 0; s < seq.length; s++) { if (seq[s] === cur) { startPos = s; break; } }
      var step = forward ? 1 : -1;
      for (var t = 1; t <= seq.length; t++) {
        var pos = (startPos + step * t) % seq.length;
        if (pos < 0) pos += seq.length;
        var pp = seq[pos];
        if (skipDone && this.done[pp]) continue;
        return { x: pp % cols, y: (pp / cols) | 0, index: this.cells[pp] };
      }
      return null;
    }

    var total = cols * rows;
    var cur2 = y * cols + x;
    var step2 = forward ? 1 : -1;
    for (var k = 1; k <= total; k++) {
      var i = cur2 + step2 * k;
      if (i < 0 || i >= total) {
        if (opt.wrap === false) return null;
        i = ((i % total) + total) % total;
      }
      var cx = i % cols, cy = (i / cols) | 0;
      if (order === 'col') {
        // 逐列顺序：把 index 映射成 (col,row) 的转置遍历
        var idxCol = (i / rows) | 0, idxRow = i % rows;
        if (idxCol >= cols) continue;
        cx = idxCol; cy = idxRow;
        i = cy * cols + cx;
      }
      if (order === 'row-serpentine') {
        var ry = (i / cols) | 0;
        var rx = i % cols;
        if (ry % 2 === 1) rx = cols - 1 - rx;
        cx = rx; cy = ry; i = cy * cols + cx;
      }
      if (this.cells[i] < 0) continue;
      if (skipDone && this.done[i]) continue;
      return { x: cx, y: cy, index: this.cells[i] };
    }
    return null;
  };

  /** 第一个空格（没勾的格子），用于初始化光标 */
  Pattern.prototype.firstUndone = function () {
    for (var i = 0; i < this.cells.length; i++) {
      if (this.cells[i] >= 0 && !this.done[i]) return { x: i % this.cols, y: (i / this.cols) | 0, index: this.cells[i] };
    }
    return null;
  };

  /** 某一行还有多少未拼（提示「这一行还差几颗」） */
  Pattern.prototype.rowRemaining = function (y) {
    var n = 0;
    for (var x = 0; x < this.cols; x++) {
      var i = y * this.cols + x;
      if (this.cells[i] >= 0 && !this.done[i]) n++;
    }
    return n;
  };
  /** 整块板的剩余（用于分板提示） */
  Pattern.prototype.regionRemaining = function (x0, y0, w, h) {
    var n = 0;
    for (var y = y0; y < Math.min(this.rows, y0 + h); y++) {
      for (var x = x0; x < Math.min(this.cols, x0 + w); x++) {
        var i = y * this.cols + x;
        if (this.cells[i] >= 0 && !this.done[i]) n++;
      }
    }
    return n;
  };

  /* ---------------- 分板（按拼豆板尺寸拆分） ---------------- */
  /**
   * @param {number} bw 板宽（格）
   * @param {number} bh 板高（格）
   * @param {number} overlap 相邻板重叠格数（拼大图时常用 0 或 1）
   */
  Pattern.prototype.boards = function (bw, bh, overlap) {
    bw = Math.max(1, bw | 0); bh = Math.max(1, bh | 0);
    overlap = Math.max(0, overlap | 0);
    var out = [];
    var stepX = Math.max(1, bw - overlap), stepY = Math.max(1, bh - overlap);
    for (var y = 0; y < this.rows; y += stepY) {
      for (var x = 0; x < this.cols; x += stepX) {
        var w = Math.min(bw, this.cols - x), h = Math.min(bh, this.rows - y);
        if (w <= 0 || h <= 0) continue;
        out.push({ x: x, y: y, w: w, h: h, remaining: this.regionRemaining(x, y, w, h) });
        if (x + w >= this.cols) break;
      }
      if (y + h >= this.rows) break;
    }
    return out;
  };

  /* ---------------- 序列化 ---------------- */
  /** 游程压缩 */
  function encodeCells(cells) {
    var parts = [], i = 0, n = cells.length;
    while (i < n) {
      var v = cells[i], run = 1;
      while (i + run < n && cells[i + run] === v) run++;
      parts.push((v + 1).toString(36) + (run > 1 ? ':' + run.toString(36) : ''));
      i += run;
    }
    return parts.join('.');
  }
  function decodeCells(str, length) {
    var out = new Int16Array(length);
    var pos = 0;
    if (str) {
      var parts = str.split('.');
      for (var i = 0; i < parts.length && pos < length; i++) {
        var seg = parts[i].split(':');
        var v = parseInt(seg[0], 36) - 1;
        var run = seg.length > 1 ? parseInt(seg[1], 36) : 1;
        for (var r = 0; r < run && pos < length; r++) out[pos++] = v;
      }
    }
    return out;
  }

  /**
   * 压缩格子：主数据用游程，手工改过的零星格子另存补丁表。
   * 图片转换结果本身高度重复，所以这样能压得很小；改过的格子又不会把压缩率毁掉。
   * @returns {{rle:string, patches:number[]}} patches = [位置, 色号+1, 位置, 色号+1, ...]
   */
  function packCells(cells) {
    var rle = encodeCells(cells);
    var base = decodeCells(rle, cells.length);
    var patches = [];
    for (var i = 0; i < cells.length; i++) {
      if (base[i] !== cells[i]) patches.push(i, cells[i] + 1);
    }
    return { rle: rle, patches: patches };
  }
  function unpackCells(packed, length) {
    if (typeof packed === 'string') return decodeCells(packed, length);   // 兼容纯 RLE
    var out = decodeCells(packed.rle, length);
    var p = packed.patches || [];
    for (var i = 0; i + 1 < p.length; i += 2) {
      if (p[i] >= 0 && p[i] < length) out[p[i]] = p[i + 1] - 1;
    }
    return out;
  }

  /* 位图编码：每 6 bit 用一个字符。
     注意：不能用 base36 解码——parseInt 对大小写不敏感，会把 'S' 和 's' 当成同一个值，
     从而丢失一个 bit 平面（曾经就是这样把进度存坏的）。这里用固定字母表，绝不含糊。 */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_LOOKUP = (function () {
    var m = Object.create(null);
    for (var i = 0; i < B64.length; i++) m[B64[i]] = i;
    return m;
  })();

  function encodeBits(arr) {
    var out = '';
    var n = arr.length;
    for (var i = 0; i < n; i += 6) {
      var v = 0;
      for (var b = 0; b < 6; b++) {
        v = (v << 1) | ((i + b < n && arr[i + b]) ? 1 : 0);
      }
      out += B64[v];
    }
    return out;
  }
  function decodeBits(str, length) {
    var out = new Uint8Array(length);
    if (!str) return out;
    var pos = 0;
    for (var i = 0; i < str.length && pos < length; i++) {
      var v = B64_LOOKUP[str[i]];
      if (v === undefined) continue;
      for (var b = 5; b >= 0 && pos < length; b--) out[pos++] = (v >> b) & 1;
    }
    return out;
  }

  Pattern.prototype.serialize = function (opts) {
    opts = opts || {};
    var packed = packCells(this.cells);
    var data = {
      format: 'pindou-pattern',
      version: 2,
      cols: this.cols,
      rows: this.rows,
      paletteId: this.paletteId,
      meta: this.meta,
      cells: packed.rle,
      patches: packed.patches
    };
    if (opts.withProgress !== false) data.done = encodeBits(this.done);
    if (opts.embedPalette) data.palette = this.palette.serialize();
    return data;
  };

  /** 只序列化格子（不含 meta），用于撤销栈 */
  Pattern.prototype.serializeCells = function () { return packCells(this.cells); };

  Pattern.deserialize = function (data, paletteResolver) {
    var pal = null;
    if (data.palette) {
      pal = new root.PindouPalette.Palette(data.palette);
    } else if (paletteResolver) {
      pal = paletteResolver(data.paletteId);
    }
    if (!pal) throw new Error('找不到色卡: ' + data.paletteId);
    var n = data.cols * data.rows;
    return new Pattern({
      cols: data.cols,
      rows: data.rows,
      paletteId: data.paletteId,
      palette: pal,
      cells: unpackCells({ rle: data.cells, patches: data.patches }, n),
      done: data.done ? decodeBits(data.done, n) : new Uint8Array(n),
      meta: data.meta || {}
    });
  };

  Pattern.encodeCells = encodeCells;
  Pattern.decodeCells = decodeCells;
  Pattern.packCells = packCells;
  Pattern.unpackCells = unpackCells;
  Pattern.encodeBits = encodeBits;
  Pattern.decodeBits = decodeBits;

  /* ---------------- 采购：需要几包豆 ---------------- */
  /**
   * @param {number} packSize 每包颗数（常见 500/1000）
   */
  Pattern.prototype.shoppingList = function (packSize) {
    packSize = packSize || 1000;
    return this.stats().list.map(function (e) {
      return {
        code: e.code, name: e.name, hex: e.hex, count: e.count,
        packs: Math.ceil(e.count / packSize),
        spare: Math.ceil(e.count / packSize) * packSize - e.count
      };
    });
  };

  root.PindouPattern = {
    Pattern: Pattern,
    EMPTY: EMPTY,
    ORDERS: ORDERS,
    encodeCells: encodeCells,
    decodeCells: decodeCells,
    packCells: packCells,
    unpackCells: unpackCells,
    encodeBits: encodeBits,
    decodeBits: decodeBits
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================================
 * palette.js — 色卡模型 + 最近色匹配（含 RGB 立方体反查表加速）
 * 依赖: color.js
 * ========================================================================= */
(function (root) {
  'use strict';
  var C = root.PindouColor;

  var BITS = 5;                 // 每通道 5 bit -> 32768 格反查表
  var LEVELS = 1 << BITS;       // 32
  var SHIFT = 8 - BITS;         // 3

  /**
   * @param {Object} def  {id,title,brand,beadSize,note,source,colors:[{code,hex,group,name?}]}
   */
  function Palette(def) {
    this.id = def.id;
    var src = def.colors || def.beads || [];
    this.colors = new Array(src.length);
    this.byCode = Object.create(null);
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      var rgb = c.rgb || C.hexToRgb(c.hex) || [0, 0, 0];
      var o = {
        index: i,
        code: String(c.code),
        name: c.name || '',
        group: c.group || '',
        hex: (c.hex && /^#[0-9A-Fa-f]{6,8}$/.test(c.hex)) ? c.hex.toUpperCase() : C.rgbToHex(rgb[0], rgb[1], rgb[2]),
        r: rgb[0], g: rgb[1], b: rgb[2],
        lab: null
      };
      o.lab = C.rgbToLab(o.r, o.g, o.b);
      this.colors[i] = o;
      if (!(o.code in this.byCode)) this.byCode[o.code] = o;
    }
    this.id = def.id;
    this.title = def.title || def.id;
    this.brand = def.brand || '';
    this.beadSize = def.beadSize || '';
    this.note = def.note || '';
    this.source = def.source || '';
    this._tab = null;      // Uint16Array 反查表
    this._tree = null;     // KdTree（精确匹配）
  }
  Palette.prototype.size = function () { return this.colors.length; };
  Palette.prototype.get = function (code) { return this.byCode[code] || null; };

  /**
   * 生成 32768 格反查表：每个 (r,g,b) 5bit 立方体格子 -> 最近色卡下标。
   * 只在初次需要时构建（约 50-150ms），之后查色是 O(1)。
   */
  Palette.prototype._buildTable = function () {
    if (this._tab) return this._tab;
    var n = this.colors.length;
    var pts = new Float64Array(n * 3);
    for (var i = 0; i < n; i++) {
      var c = this.colors[i];
      pts[i * 3] = c.lab[0]; pts[i * 3 + 1] = c.lab[1]; pts[i * 3 + 2] = c.lab[2];
    }
    var tree = new C.KdTree(pts);
    var tab = new Uint16Array(LEVELS * LEVELS * LEVELS);
    var step = 255 / (LEVELS - 1);
    for (var r = 0; r < LEVELS; r++) {
      for (var g = 0; g < LEVELS; g++) {
        for (var b = 0; b < LEVELS; b++) {
          var lab = C.rgbToLab(Math.round(r * step), Math.round(g * step), Math.round(b * step));
          tab[(r << (BITS * 2)) | (g << BITS) | b] = tree.nearest(lab[0], lab[1], lab[2]).index;
        }
      }
    }
    this._tree = tree;
    this._tab = tab;
    return tab;
  };

  /** 精确最近色（Lab 欧氏距离，k-d tree） */
  Palette.prototype.nearestExact = function (r, g, b) {
    if (!this._tree) this._buildTable();
    var lab = C.rgbToLab(r, g, b);
    return this._tree.nearest(lab[0], lab[1], lab[2]).index;
  };

  /** 快速最近色（5bit 量化，O(1)）。dither=null 时用这个 */
  Palette.prototype.nearestFast = function (r, g, b) {
    var tab = this._buildTable();
    var ri = r >> SHIFT, gi = g >> SHIFT, bi = b >> SHIFT;
    return tab[(ri << (BITS * 2)) | (gi << BITS) | bi];
  };

  /** 统一入口 */
  Palette.prototype.nearest = function (r, g, b, exact) {
    return exact ? this.nearestExact(r, g, b) : this.nearestFast(r, g, b);
  };

  /**
   * 带记忆的精确匹配：同一张图里重复颜色极多，Map 命中率通常 >95%，
   * 于是「精确匹配」也能接近 O(1)。用来消除 5bit 反查表的量化误差。
   */
  Palette.prototype.nearestCached = function (r, g, b) {
    if (!this._cache) this._cache = new Map();
    var key = (r << 16) | (g << 8) | b;
    var hit = this._cache.get(key);
    if (hit !== undefined) return hit;
    var v = this.nearestExact(r, g, b);
    if (this._cache.size > 65536) this._cache.clear();
    this._cache.set(key, v);
    return v;
  };
  Palette.prototype.clearCache = function () { if (this._cache) this._cache.clear(); };

  /** 返回该色的对比文字色 */
  Palette.prototype.textColorOf = function (index) {
    var c = this.colors[index];
    return C.contrastText(c.r, c.g, c.b);
  };

  /** 导出为可序列化的精简数据（用于项目保存 / 自定义色卡） */
  Palette.prototype.serialize = function () {
    return {
      id: this.id, title: this.title, brand: this.brand, beadSize: this.beadSize,
      note: this.note, source: this.source,
      colors: this.colors.map(function (c) {
        return { code: c.code, hex: c.hex, group: c.group, name: c.name };
      })
    };
  };

  /* ---------- 注册表 ---------- */
  var registry = Object.create(null);
  var order = [];

  function register(def) {
    var p = (def instanceof Palette) ? def : new Palette(def);
    if (!registry[p.id]) order.push(p.id);
    registry[p.id] = p;
    return p;
  }
  function get(id) { return registry[id] || null; }
  function list() { return order.map(function (id) { return registry[id]; }); }
  function all() { return list(); }

  /** 从 PindouPaletteData（由 build 脚本生成）批量注册 */
  function registerAll(defs) {
    for (var i = 0; i < defs.length; i++) register(defs[i]);
    return list();
  }

  /** 用「已有豆子」的色号集合过滤出一张自定义色卡 */
  function subset(base, codes, opts) {
    opts = opts || {};
    var set = Object.create(null);
    for (var i = 0; i < codes.length; i++) set[String(codes[i]).trim().toUpperCase()] = 1;
    var colors = base.colors.filter(function (c) { return set[c.code.toUpperCase()]; });
    return new Palette({
      id: opts.id || (base.id + '-subset'),
      title: opts.title || (base.title + '（我的豆子）'),
      brand: base.brand, beadSize: base.beadSize,
      note: '自定义子集，共 ' + colors.length + ' 色',
      source: base.source,
      colors: colors
    });
  }

  root.PindouPalette = {
    Palette: Palette,
    register: register,
    registerAll: registerAll,
    get: get,
    list: list,
    all: all,
    subset: subset
  };
})(typeof window !== 'undefined' ? window : globalThis);

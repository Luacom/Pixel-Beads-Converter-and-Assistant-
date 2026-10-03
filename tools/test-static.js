#!/usr/bin/env node
/* =========================================================================
 * test-static.js — 静态检查：所有前端脚本语法正确、依赖顺序正确、
 *                  DOM id 引用齐全、没有明显的未定义引用
 *   node tools/test-static.js
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ---------- 1. 语法检查 ---------- */
console.log('\n1. 语法');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
ok('index.html 引用了脚本', scriptSrcs.length > 0, scriptSrcs.length + ' 个');

for (const src of scriptSrcs) {
  const p = path.join(ROOT, src);
  if (!fs.existsSync(p)) { ok('存在: ' + src, false, '文件不存在'); continue; }
  const code = fs.readFileSync(p, 'utf8');
  try {
    new vm.Script(code, { filename: p });
    ok('语法正确: ' + src, true);
  } catch (e) {
    ok('语法正确: ' + src, false, e.message);
  }
}

/* ---------- 2. 依赖顺序 ---------- */
console.log('\n2. 依赖顺序');
const need = {
  'src/core/palette.js': ['src/core/color.js'],
  'src/core/sampler.js': ['src/core/color.js'],
  'src/core/quantizer.js': ['src/core/color.js', 'src/core/palette.js'],
  'src/core/pattern.js': ['src/core/palette.js'],
  'src/core/render.js': ['src/core/color.js', 'src/core/pattern.js'],
  'src/ui/exporters.js': ['src/core/render.js'],
  'src/ui/ui.js': ['src/core/render.js', 'src/core/pattern.js'],
  'src/app.js': ['src/core/quantizer.js', 'src/ui/ui.js', 'src/ui/exporters.js', 'src/data/palettes.js', 'tests/selftest-asset.js']
};
const order = Object.fromEntries(scriptSrcs.map((s, i) => [s, i]));
let orderOK = true, orderMsg = '';
for (const [file, deps] of Object.entries(need)) {
  if (order[file] === undefined) continue;
  for (const d of deps) {
    if (order[d] === undefined) { orderOK = false; orderMsg += `${file} 依赖 ${d} 但没有加载; `; }
    else if (order[d] > order[file]) { orderOK = false; orderMsg += `${d} 必须在 ${file} 之前; `; }
  }
}
ok('脚本加载顺序满足依赖', orderOK, orderMsg);

/* ---------- 3. DOM id 引用 ---------- */
console.log('\n3. DOM 引用');
const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const missing = new Map();
for (const src of scriptSrcs) {
  if (src.indexOf('core/') >= 0 || src.indexOf('data/') >= 0) continue;
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  for (const m of code.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) {
    const id = m[1];
    if (!htmlIds.has(id)) {
      if (!missing.has(id)) missing.set(id, []);
      missing.get(id).push(src);
    }
  }
}
ok('脚本里 $() 引用的 id 都存在于 index.html', missing.size === 0,
  [...missing.entries()].map(([id, files]) => `${id} (${files.join(',')})`).join('; '));

// 反向：html 里声明了但没被引用的 id（不是错误，只报告）
const usedIds = new Set();
for (const src of scriptSrcs) {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  for (const m of code.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)) usedIds.add(m[1]);
}
const unused = [...htmlIds].filter(id => !usedIds.has(id));
console.log('    （未被 JS 直接引用的 id：' + unused.length + ' 个，正常）');

/* ---------- 4. 导出/调用一致性：谁调用了谁的方法 ---------- */
console.log('\n4. 模块接口');
const api = {
  'PindouColor': ['rgbToLab', 'ciede2000', 'hexToRgb', 'rgbToHex', 'contrastText', 'KdTree', 'labDist2'],
  'PindouPalette': ['Palette', 'register', 'registerAll', 'get', 'list', 'subset'],
  'PindouSampler': ['sample', 'computeRect', 'autoTrim'],
  'PindouQuantizer': ['quantize', 'quantizeAsync', 'confusingPairs'],
  'PindouPattern': ['Pattern', 'encodeCells', 'decodeCells', 'packCells', 'unpackCells', 'encodeBits', 'decodeBits', 'ORDERS'],
  'PindouRender': ['renderView', 'renderSheet', 'measureSheet', 'renderLegend', 'measureLegend', 'createFrame', 'hitTest', 'mergeDefaults', 'DEFAULTS', 'STYLE', 'symbolFor'],
  'PindouExport': ['downloadBlob', 'downloadText', 'canvasToBlob', 'safeName', 'renderSheetCanvas', 'renderLegendCanvas', 'statsCsv', 'positionsCsv', 'buildPrintPages', 'drawSubPattern'],
  'PindouUI': ['init', 'requestRedraw', 'fitToWindow', 'setZoom', 'zoomAt', 'zoomIn', 'zoomOut', 'selectCell', 'advance', 'markCurrent', 'centerOn', 'toggleIsolate', 'selectColorByRank', 'findFirstOfColor', 'pushUndo', 'undo', 'clearUndo', 'refreshAll', 'renderStats', 'refreshStatsTotals', 'updateStatsRow', 'renderBoards', 'renderChecks', 'openPaletteChart', 'openHelp', 'toast', 'copyText', 'afterCellToggle', 'toggleCell', 'syncHud', 'refreshHudOnly', 'display', 'view'],
  'PindouApp': ['init', 'getPattern', 'isPanTool', 'getColorOrder', 'convertNow', 'saveProject', 'openProjectDialog', 'printSheet', 'closeModals', 'toggleBeading', 'zoomFit', 'changeCellColor', 'replaceColorDialog', 'exportSheetPng', 'scheduleAutosave']
};

// 在沙箱里执行所有脚本（提供最小 DOM 桩），检查真正的导出
const domStub = makeDomStub(htmlIds);
const sandbox = {
  console: console,
  setTimeout: () => 0, clearTimeout: () => { },
  requestAnimationFrame: () => 0,
  navigator: { userAgent: 'node' },
  location: { reload() { } },
  performance: { now: () => Date.now() },
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  document: domStub.document,
  devicePixelRatio: 1,
  addEventListener() { }, removeEventListener() { },
  ResizeObserver: undefined,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
  Blob: function () { },
  Image: function () { this.onload = null; },
  print() { },
  innerWidth: 1600, innerHeight: 900
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let execErr = null;
try {
  for (const src of scriptSrcs) {
    const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
    vm.runInContext(code, sandbox, { filename: src });
  }
} catch (e) {
  execErr = e;
}
ok('所有脚本可在沙箱中加载执行', !execErr, execErr ? (execErr.message + ' @ ' + String(execErr.stack).split('\n')[1]) : '');

for (const [ns, methods] of Object.entries(api)) {
  const obj = sandbox[ns];
  if (!obj) { ok('存在命名空间 ' + ns, false); continue; }
  const miss = methods.filter(m => obj[m] === undefined);
  ok(ns + ' 暴露了需要的接口', miss.length === 0, miss.join(','));
}

/* ---------- 5. 关键行为小集成（跳过 DOM，直接用核心） ---------- */
console.log('\n5. 沙箱内集成');
if (!execErr) {
  const P = sandbox.PindouPalette;
  P.registerAll(sandbox.PindouPaletteData);
  const pal = P.get('coco-291');
  ok('沙箱内色卡可注册', pal && pal.size() === 291, pal ? pal.size() : 'null');
  const S = sandbox.PindouSampler;
  const W = 12, H = 12;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 90; data[i * 4 + 1] = 170; data[i * 4 + 2] = 220; data[i * 4 + 3] = 255; }
  const s = S.sample({ data, width: W, height: H }, 6, 6, { method: 'area', fit: 'fill' });
  const q = sandbox.PindouQuantizer.quantize(s, pal, { dither: 'none' });
  const pat = new sandbox.PindouPattern.Pattern({ cols: 6, rows: 6, paletteId: pal.id, palette: pal, cells: q.cells });
  const st = pat.stats();
  ok('纯色图 -> 只用 1 色', st.colorsUsed === 1, st.colorsUsed + ' 色');
  ok('36 颗豆', st.beadsTotal === 36, st.beadsTotal);
  const csv = sandbox.PindouExport.statsCsv(pat, 1000);
  ok('CSV 生成正常（含 BOM 和表头）', csv.charCodeAt(0) === 0xFEFF && csv.indexOf('色号') > 0, csv.slice(0, 40));
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(52));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) { console.log('失败列表：\n' + failures.map(f => '  - ' + f).join('\n')); process.exit(1); }
console.log('全部通过 ✓');

/* ==================== DOM 桩 ==================== */
function makeDomStub(ids) {
  function makeEl(tag, id) {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      id: id || '',
      style: new Proxy({}, { get: () => '', set: () => true }),
      dataset: {},
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      children: [],
      childNodes: [],
      hidden: false,
      value: '',
      checked: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      width: 800, height: 600,
      clientWidth: 800, clientHeight: 600,
      offsetWidth: 100, offsetHeight: 100,
      files: null,
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
      insertBefore(c) { this.children.push(c); return c; },
      addEventListener() { }, removeEventListener() { },
      setAttribute() { }, getAttribute: () => null, removeAttribute() { },
      querySelector: () => null, querySelectorAll: () => [],
      closest: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
      getContext: () => makeCtx(),
      toBlob(cb) { cb(null); }, toDataURL: () => 'data:image/png;base64,',
      focus() { }, click() { }, select() { },
      scrollIntoView() { },
      animate: () => ({ cancel() { } })
    };
    Object.defineProperty(el, 'firstChild', { get: () => el.children[0] || null });
    Object.defineProperty(el, 'parentNode', { value: null, writable: true });
    return el;
  }
  function makeCtx() {
    const noop = () => { };
    return {
      canvas: { width: 800, height: 600 },
      save: noop, restore: noop, setTransform: noop, translate: noop, scale: noop, rotate: noop,
      clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      stroke: noop, fill: noop, closePath: noop, fillText: noop, strokeText: noop, drawImage: noop,
      setLineDash: noop, measureText: () => ({ width: 10 }),
      putImageData: noop, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      arc: noop, ellipse: noop, rect: noop, clip: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: ''
    };
  }
  const byId = {};
  ids.forEach(id => { byId[id] = makeEl('div', id); });
  const document = {
    readyState: 'complete',
    body: makeEl('body'),
    documentElement: makeEl('html'),
    createElement: (t) => makeEl(t),
    createDocumentFragment: () => makeEl('fragment'),
    getElementById: (id) => byId[id] || (byId[id] = makeEl('div', id)),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { }, removeEventListener() { }
  };
  return { document, byId };
}

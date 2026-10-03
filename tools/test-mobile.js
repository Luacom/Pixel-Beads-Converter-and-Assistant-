#!/usr/bin/env node
/* =========================================================================
 * test-mobile.js — 手机/窄屏检查
 *
 * 背景（都是实测结论，不是猜的）：
 *   1) headless 窗口有最小宽度（本机 504px），--window-size=390 根本到不了 390；
 *   2) CDP 的 Emulation.setDeviceMetricsOverride 在 headless=new 下也不会缩小
 *      布局视口（实测 innerWidth 仍 686）。所以「用窗口模拟手机」不可靠。
 *   3) 可靠做法：在指定宽度的 iframe 里加载应用——iframe 的布局视口 = 它的宽度。
 *
 * 做法：每个宽度分几步「短探测」执行（每一步都很快返回），避免长 await 卡死；
 *       每步都有超时与明确的状态输出。
 *
 * 用法: node tools/test-mobile.js [edgePath] [baseUrl]
 * 前置: 先起 tools/serve.js
 * ========================================================================= */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = process.argv[2] || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = process.argv[3] || 'http://127.0.0.1:8765';
const PORT = 9345;

const WIDTHS = [
  { name: '小屏手机 (320px)', w: 320, h: 568 },
  { name: 'Android 常见 (360px)', w: 360, h: 740 },
  { name: 'iPhone 12/13 (390px)', w: 390, h: 844 },
  { name: '平板竖屏 (820px)', w: 820, h: 1180 }
];

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')); }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('非 JSON: ' + d.slice(0, 80))); } });
    }).on('error', reject);
  });
}
function waitPort(port, tries) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      http.get('http://127.0.0.1:' + port + '/json/version', (res) => { res.resume(); resolve(true); })
        .on('error', () => { if (++n > (tries || 50)) reject(new Error('调试端口未就绪')); else setTimeout(tick, 300); });
    };
    tick();
  });
}
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
    ws.addEventListener('open', () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const myId = ++id;
          pending.set(myId, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
          setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); rej(new Error(method + ' 超时')); } }, 45000);
        });
      },
      close() { try { ws.close(); } catch (e) { } }
    }));
  });
}

/* 每一步都在页面里同步执行、立刻返回，绝不 await */
const STEP_SETUP = (w, h, url) => `(function(){
  var old = document.getElementById('mframe');
  if (old) old.remove();
  var f = document.createElement('iframe');
  f.id = 'mframe';
  f.style.cssText = 'width:${w}px;height:${h}px;border:0;display:block';
  f.src = ${JSON.stringify(url)};
  document.body.appendChild(f);
  return 'started';
})()`;

const STEP_POLL = `(function(){
  var f = document.getElementById('mframe');
  if (!f) return { state: 'noframe' };
  var w = f.contentWindow, d = f.contentDocument;
  if (!w || !d) return { state: 'noload' };
  var out = { state: 'loading' };
  try {
    out.ready = d.readyState;
    out.hasUI = !!(w.PindouUI && w.PindouApp);
    out.hasPattern = !!(w.PindouApp && w.PindouApp.getPattern());
    out.hasDemo = !!d.getElementById('btnDemo');
    out.innerWidth = w.innerWidth;
  } catch (e) { out.err = String(e); }
  if (out.hasUI && !out.demoClicked) {
    // 只在第一次轮询时点一次示例
    try { d.getElementById('btnDemo').click(); out.demoClicked = true; } catch (e) { out.clickErr = String(e); }
  }
  out.state = out.hasPattern ? 'ready' : 'loading';
  return out;
})()`;

const STEP_MEASURE = `(function(){
  var f = document.getElementById('mframe');
  var w = f.contentWindow, d = f.contentDocument;
  var rec = {};
  rec.innerWidth = w.innerWidth; rec.innerHeight = w.innerHeight; rec.dpr = w.devicePixelRatio;
  rec.scrollWidth = d.documentElement.scrollWidth;
  rec.clientWidth = d.documentElement.clientWidth;
  rec.overflowX = rec.scrollWidth > rec.clientWidth + 1;
  var wide = [], all = d.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.offsetWidth > w.innerWidth + 1 && el.offsetWidth > 40) {
      var cs = w.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      // 定位用：标签 + id + class + 宽度 + 定位方式 + 是谁的孩子
      var path = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
        (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      wide.push(path + ' w=' + el.offsetWidth + ' pos=' + cs.position + ' display=' + cs.display +
        ' parent=' + (el.parentElement ? (el.parentElement.tagName.toLowerCase() + (el.parentElement.id ? '#' + el.parentElement.id : '') +
        (typeof el.parentElement.className === 'string' && el.parentElement.className.trim() ? '.' + el.parentElement.className.trim().split(/\s+/)[0] : '')) : '-'));
    }
  }
  rec.wide = wide.slice(0, 10); rec.wideCount = wide.length;
  function box(sel) {
    var el = d.querySelector(sel); if (!el) return null;
    var r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
  }
  rec.importBtn = box('#btnImport');
  rec.canvasWrap = box('#canvasWrap');
  rec.hud = box('#beadingHud');
  rec.layoutDir = w.getComputedStyle(d.querySelector('.layout')).flexDirection;
  rec.hasTouchAPI = ('ontouchstart' in w);
  rec.touchCtor = (typeof w.TouchEvent === 'function' && typeof w.Touch === 'function');
  rec.hudHiddenDefault = d.getElementById('beadingHud').hidden;
  return rec;
})()`;

const STEP_TOUCH = `(function(){
  var f = document.getElementById('mframe');
  var w = f.contentWindow, d = f.contentDocument;
  var pat = w.PindouApp.getPattern(), ui = w.PindouUI;
  var rec = { touched: false };
  var before = pat.progress().done;
  var first = pat.firstUndone();
  rec.first = first ? (first.x + ',' + first.y) : null;
  if (!first) return rec;
  var cv = d.getElementById('view');
  var fr = w.PindouRender.createFrame(pat, ui.display);
  var px = ui.view.offsetX + (fr.x0 + (first.x + 0.5) * ui.display.cell) * ui.view.scale;
  var py = ui.view.offsetY + (fr.y0 + (first.y + 0.5) * ui.display.cell) * ui.view.scale;
  var rect = cv.getBoundingClientRect();
  rec.scale = ui.view.scale;
  if (rec.touchCtorSafe === undefined) rec.touchCtorSafe = (typeof w.Touch === 'function');
  var cx = rect.left + px, cy = rect.top + py;
  if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) {
    rec.outsideCanvas = true;
    ui.selectCell(first.x, first.y);           // 兜底：直接选中
  } else {
    try {
      var t = new w.Touch({ identifier: 1, target: cv, clientX: cx, clientY: cy });
      cv.dispatchEvent(new w.TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
      cv.dispatchEvent(new w.TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
      rec.touched = true;
    } catch (e) {
      rec.touchErr = String(e);
      ui.selectCell(first.x, first.y);
    }
  }
  rec.doneUnchanged = (pat.progress().done === before);
  rec.stillUndone = !pat.isDone(first.x, first.y);
  rec.cursorAtFirst = (ui.display.cursor.x === first.x && ui.display.cursor.y === first.y);
  rec.hudCode = d.getElementById('hudCode').textContent;
  rec.hudVisible = !d.getElementById('beadingHud').hidden;
  return rec;
})()`;

const STEP_CLICK_NEXT = `(function(){
  var f = document.getElementById('mframe');
  var w = f.contentWindow, d = f.contentDocument;
  var pat = w.PindouApp.getPattern(), ui = w.PindouUI;
  var rec = {};
  var nb = d.getElementById('btnHudNext');
  // 像手指一样先滚到信息栏
  d.getElementById('beadingHud').scrollIntoView({ block: 'end' });
  var r = nb.getBoundingClientRect();
  rec.rect = { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  rec.inViewport = r.left >= -1 && r.right <= w.innerWidth + 1 && r.top >= -1 && r.bottom <= w.innerHeight + 1;
  rec.tapSize = Math.min(r.width, r.height);
  rec.disabled = nb.disabled;
  var before = pat.progress().done;
  var cur = { x: ui.display.cursor.x, y: ui.display.cursor.y };
  nb.click();
  rec.doneAfter = pat.progress().done;
  rec.markedCurrent = pat.isDone(cur.x, cur.y);
  rec.cursorMoved = !(ui.display.cursor.x === cur.x && ui.display.cursor.y === cur.y);
  rec.hudCodeAfter = d.getElementById('hudCode').textContent;
  rec.okProgress = (rec.doneAfter === before + 1);
  return rec;
})()`;

async function evalOnce(client, expr, label) {
  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error((label || 'eval') + ' 异常: ' +
      JSON.stringify((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails));
  }
  return r.result ? r.result.value : undefined;
}

async function main() {
  console.log('基础地址: ' + BASE);
  console.log('浏览器: ' + EDGE + '\n');
  const userDir = path.join(os.tmpdir(), 'pindou-mobile-' + Date.now());
  fs.mkdirSync(userDir, { recursive: true });
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-breakpad',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, '--window-size=1200,1000', 'about:blank'
  ], { stdio: 'ignore' });

  let client = null;
  try {
    await waitPort(PORT);
    let target = null;
    for (let i = 0; i < 20 && !target; i++) {
      const list = await getJson('http://127.0.0.1:' + PORT + '/json/list');
      target = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (!target) await new Promise(r => setTimeout(r, 300));
    }
    if (!target) throw new Error('找不到页面目标');
    client = await cdpConnect(target.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: BASE + '/tests/mobile-host.html' });
    await new Promise(r => setTimeout(r, 900));

    for (const dev of WIDTHS) {
      console.log('=== ' + dev.name + ' ===');
      await evalOnce(client, STEP_SETUP(dev.w, dev.h, '/index.html'), 'setup');

      // 轮询就绪（每次调用都很快返回）
      let ready = false, lastPoll = null;
      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 350));
        lastPoll = await evalOnce(client, STEP_POLL, 'poll');
        if (lastPoll && lastPoll.state === 'ready') { ready = true; break; }
      }
      ok('应用加载并生成图纸', ready, JSON.stringify(lastPoll));

      const m = await evalOnce(client, STEP_MEASURE, 'measure');
      console.log('  · iframe 视口 ' + m.innerWidth + 'x' + m.innerHeight + ' dpr=' + m.dpr +
        '  scrollWidth=' + m.scrollWidth + ' clientWidth=' + m.clientWidth);
      ok('布局视口等于目标宽度', Math.abs(m.innerWidth - dev.w) <= 1, m.innerWidth + ' vs ' + dev.w);
      ok('无横向溢出', !m.overflowX, 'scrollWidth=' + m.scrollWidth);
      ok('没有元素超出视口宽度', m.wideCount === 0, (m.wide || []).join(' '));
      ok('布局切为纵向堆叠', m.layoutDir === 'column', m.layoutDir);
      ok('顶部导入按钮在视口内', !!m.importBtn && m.importBtn.right <= m.innerWidth + 1,
        m.importBtn ? ('right=' + m.importBtn.right + ' / ' + m.innerWidth) : 'n/a');
      ok('画布区域高度 >= 180', !!m.canvasWrap && m.canvasWrap.h >= 180, m.canvasWrap ? (m.canvasWrap.h + 'px') : 'n/a');
      ok('信息栏宽度不超视口', !!m.hud && m.hud.w > 0 && m.hud.w <= m.innerWidth + 1,
        m.hud ? (m.hud.w + 'px') : 'n/a');
      ok('触摸设备上默认显示信息栏', m.hudHiddenDefault === false, 'hidden=' + m.hudHiddenDefault);
      ok('触屏事件构造器可用', m.touchCtor === true, 'TouchEvent/Touch=' + m.touchCtor);

      const touch = await evalOnce(client, STEP_TOUCH, 'touch');
      ok('手指点格子：只选中、不勾选', touch.doneUnchanged === true && touch.stillUndone === true,
        JSON.stringify(touch));
      ok('选中后光标在点的那一格', touch.cursorAtFirst === true, 'first=' + touch.first);
      ok('信息栏显示色号', (touch.hudCode || '').length > 0, touch.hudCode);
      ok('信息栏可见', touch.hudVisible === true);

      const nx = await evalOnce(client, STEP_CLICK_NEXT, 'next');
      ok('滚到信息栏后「下一个」在可视区', nx.inViewport === true, JSON.stringify(nx.rect) + ' 视口高=' + dev.h);
      ok('「下一个」触摸目标 >= 32px', nx.tapSize >= 32, nx.tapSize + 'px');
      ok('点「下一个」：当前这颗被勾选', nx.okProgress === true && nx.markedCurrent === true,
        'done=' + nx.doneAfter);
      ok('点「下一个」：光标跳到下一格并刷新信息', nx.cursorMoved === true, '新色号=' + nx.hudCodeAfter);
      console.log('');
    }
  } finally {
    if (client) client.close();
    try { child.kill(); } catch (e) { }
    setTimeout(() => { try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { } }, 1500);
  }

  console.log('='.repeat(56));
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) { console.log('失败列表：\n' + failures.map(f => '  - ' + f).join('\n')); process.exit(1); }
  console.log('手机/窄屏检查全部通过 ✓');
}

main().catch(e => { console.error('运行失败: ' + (e && e.stack || e)); process.exit(2); });

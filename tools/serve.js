#!/usr/bin/env node
/* =========================================================================
 * serve.js — 极简静态服务器（零依赖）
 * 用途：本地预览 / 手机同网访问 / 自动化测试
 *
 * 用法: node tools/serve.js [port] [host]
 *   node tools/serve.js                 -> 监听所有网卡，手机同 WiFi 也能打开
 *   node tools/serve.js 8765 127.0.0.1  -> 只允许本机访问
 *
 * 启动后会把「本机可用的地址」都打印出来（含局域网 IP，手机就用那个）。
 * ========================================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8765;
const HOST = process.argv[3] || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  // 目录穿越保护
  const target = path.normalize(path.join(ROOT, urlPath));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }
  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath);
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(target).pipe(res);
  });
});

function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, address: info.address });
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('拼豆图纸工坊已启动');
  console.log('  本机打开：  http://127.0.0.1:' + PORT + '/');
  const lan = localAddresses();
  if (HOST === '0.0.0.0' && lan.length) {
    console.log('  手机打开（同一 WiFi 下用这个）：');
    lan.forEach(a => console.log('    http://' + a.address + ':' + PORT + '/   （' + a.name + '）'));
    console.log('  提示：手机和电脑要在同一个 WiFi；Windows 首次会弹防火墙提示，选「允许访问」。');
  }
  console.log('  根目录：' + ROOT);
  console.log('  （Ctrl+C 停止）');
});

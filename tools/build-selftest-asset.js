#!/usr/bin/env node
/* =========================================================================
 * build-selftest-asset.js — 把示例图内联成 data URL
 * 为什么需要：file:// 下 fetch 不能读本地文件，而 <img src="./x.png"> 又会污染
 * canvas，导致 getImageData 抛 SecurityError。把图片内联成 data URL 后，
 * 自检就能在 file:// 下完整跑通（也正好验证了图片导入链路是干净的）。
 *
 * 用法: node tools/build-selftest-asset.js
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'assets', 'test-photo.png');
const OUT = path.join(ROOT, 'tests', 'selftest-asset.js');

const b64 = fs.readFileSync(IMG).toString('base64');
const content = `/* 自动生成，请勿手改 —— 由 tools/build-selftest-asset.js 生成（内联示例图，供 file:// 自检用） */
(function (root) {
  'use strict';
  root.PINDouSelfTestImage = 'data:image/png;base64,${b64}';
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(OUT, content, 'utf8');
console.log(`写出 ${path.relative(ROOT, OUT)}（${(content.length / 1024).toFixed(1)} KB，源图 ${(fs.statSync(IMG).size / 1024).toFixed(1)} KB）`);

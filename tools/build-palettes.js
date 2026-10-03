#!/usr/bin/env node
/* =========================================================================
 * build-palettes.js — 把 _upstream/data/*.csv 编译成离线可用的
 *                      src/data/palettes.js（普通 <script>，file:// 直接打开也能用）
 *
 * 用法:  node tools/build-palettes.js
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, '..', '_upstream', 'data');
const OUT = path.resolve(ROOT, 'src', 'data', 'palettes.js');

/* ---------- 色卡定义：id -> 元数据 ---------- */
const DEFS = [
  {
    id: 'mard-291', file: 'mard-291.csv', title: 'MARD 291色（全色）', brand: 'MARD（漫漫图/漫德）',
    beadSize: '2.6mm 常见', tier: 'S',
    note: '在 221 色基础上扩展，色域更全，适合高精度大图。',
    source: 'HansBug/pindou-color-data · mard-291-github'
  },
  {
    id: 'coco-291', file: 'coco-291.csv', title: 'COCO 291色', brand: 'COCO / 可可',
    beadSize: '2.6mm 常见', tier: 'A-',
    note: '性价比高、线下店常见；色号是 A01、K12 这种两位数字格式。',
    source: 'HansBug/pindou-color-data · coco-291'
  },
  {
    id: 'manman-278', file: 'manman-278.csv', title: '漫漫家 278色', brand: '漫漫家',
    beadSize: '2.6mm 常见', tier: 'B+',
    note: '老牌，早期图纸生态里很常见。',
    source: 'HansBug/pindou-color-data · manman-278'
  },
  {
    id: 'panpan-289', file: 'panpan-289.csv', title: '盼盼家 289色', brand: '盼盼家',
    beadSize: '2.6mm 常见', tier: 'B+',
    note: '工具站和材料包里常见。',
    source: 'HansBug/pindou-color-data · panpan-289'
  },
  {
    id: 'mixiaowo-290', file: 'mixiaowo-290.csv', title: '咪小窝 290色', brand: '咪小窝',
    beadSize: '2.6mm 常见', tier: 'B',
    note: '玩家圈/材料包常见；有 4 个原始资料无法确认的色号（标记为 UNKNOWN）。',
    source: 'HansBug/pindou-color-data · mixiaowo-290'
  },
  {
    id: 'artkal-418', file: 'artkal-418.csv', title: '优肯 / Artkal 418色', brand: '优肯 Artkal',
    beadSize: '2.6mm(C) / 5mm(M)', tier: 'A',
    note: '官方体系：C 系列 197 + M 系列 221 合并。含少量透明材质（CT01-CT09、MH1）。',
    source: 'HansBug/pindou-color-data · artkal-c197-m221-418-official'
  },
  {
    id: 'perler', file: 'perler.csv', title: 'Perler 117色', brand: 'Perler（美国）',
    beadSize: '5mm midi', tier: '国际',
    note: '国际主流品牌，5mm 豆。色值来自社区采样，与实物可能有轻微差异。',
    source: 'stitchmate.app · perler-bead-color-chart（社区采样）'
  },
  {
    id: 'hama', file: 'hama.csv', title: 'Hama 92色', brand: 'Hama（丹麦）',
    beadSize: '5mm midi', tier: '国际',
    note: '国际老牌，5mm 豆。色值来自社区采样。',
    source: 'stitchmate.app · hama-bead-color-chart（社区采样）'
  }
];

/* ---------- 读取与解析 ---------- */
function parseCsv(file) {
  const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const colors = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const f = t.split(',');
    if (f.length < 2) continue;
    const code = f[0].trim();
    let hex = f[1].trim().toUpperCase();
    if (!/^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(hex)) {
      console.warn(`  ! 跳过非法色值 ${file}: ${line}`);
      continue;
    }
    const group = (f[2] || '-').trim() || '-';
    const name = (f[3] || '').trim();
    colors.push({ code, hex, group, name });
  }
  return colors;
}

/* ---------- 派生：MARD 221 是 291 的子集（组 A-H + M，共 221 色） ----------
 * 上游没有单独的 221 CSV，但它与 291 的差异只是少了扩展组（P/R/T/Y/ZG/Q）。
 * 用「组过滤」派生，避免再抄一遍颜色数据引入错误。 */
const DERIVED = [
  {
    id: 'mard-221', from: 'mard-291.csv',
    keepGroups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'],
    expect: 221,
    title: 'MARD 221色', brand: 'MARD（漫漫图/漫德）',
    beadSize: '2.6mm 常见', tier: 'S', flagship: true,
    note: '国内最主流的色号体系，小店默认参考；新手先用这套最省事（A-H、M 共 9 组）。',
    source: 'HansBug/pindou-color-data · mard-291-github（按 221 色号集合派生）'
  }
];

/* ---------- 生成 ---------- */
function main() {
  const out = [];
  const manifest = [];
  const seen = new Set();

  /* 先处理派生色卡 */
  for (const d of DERIVED) {
    const all = parseCsv(d.from);
    const keep = new Set(d.keepGroups);
    const colors = all.filter(c => keep.has(c.group));
    if (colors.length !== d.expect) {
      throw new Error(`派生 ${d.id} 期望 ${d.expect} 色，实际 ${colors.length} 色，请检查组名`);
    }
    seen.add(d.id);
    out.push({ def: d, colors });
    manifest.push({ id: d.id, title: d.title, brand: d.brand, count: colors.length, tier: d.tier });
    console.log(`  ✓ ${d.id.padEnd(14)} ${String(colors.length).padStart(4)} 色  <- ${d.from} [派生: 组 ${d.keepGroups.join('/')}]`);
  }

  for (const def of DEFS) {
    if (!fs.existsSync(path.join(DATA_DIR, def.file))) {
      console.warn(`  ! 缺少数据文件 ${def.file}，跳过 ${def.id}`);
      continue;
    }
    const colors = parseCsv(def.file);
    if (!colors.length) { console.warn(`  ! ${def.file} 没有可用颜色，跳过`); continue; }
    if (seen.has(def.id)) throw new Error('重复色卡 id: ' + def.id);
    seen.add(def.id);
    out.push({ def, colors });
    manifest.push({ id: def.id, title: def.title, brand: def.brand, count: colors.length, tier: def.tier });
    console.log(`  ✓ ${def.id.padEnd(14)} ${String(colors.length).padStart(4)} 色  <- ${def.file}`);
  }

  const parts = [];
  parts.push('/* 自动生成，请勿手改 —— 由 tools/build-palettes.js 依据 _upstream/data/*.csv 生成 */');
  parts.push('(function (root) {');
  parts.push("  'use strict';");
  parts.push('  var P = root.PindouPaletteData = root.PindouPaletteData || [];');
  for (const { def, colors } of out) {
    parts.push('');
    parts.push(`  /* ${def.title} — ${def.brand} — ${colors.length} 色 */`);
    parts.push('  P.push(' + JSON.stringify({
      id: def.id,
      title: def.title,
      brand: def.brand,
      beadSize: def.beadSize,
      tier: def.tier,
      flagship: !!def.flagship,
      note: def.note,
      source: def.source,
      colors
    }) + ');');
  }
  parts.push('');
  parts.push('  root.PindouPaletteManifest = ' + JSON.stringify(manifest) + ';');
  parts.push('})(typeof window !== \'undefined\' ? window : globalThis);');
  parts.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, parts.join('\n'), 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(`\n写出 ${path.relative(ROOT, OUT)} (${kb} KB)，共 ${manifest.length} 套色卡，` +
    `${manifest.reduce((s, m) => s + m.count, 0)} 个颜色。`);
}

main();

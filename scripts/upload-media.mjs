#!/usr/bin/env node
/**
 * 更新赞赏码：把一张新图生成 PNG/WebP 并上传到 R2。
 *
 * 不用改仓库、不用升 ?v=、不用重新部署 —— Worker 对这两张图发的是
 * `cache-control: public, max-age=300, must-revalidate`：浏览器缓存 5 分钟，过期后带 ETag 协商。
 * 覆盖 R2 对象即完成更新，新访客立刻可见，老访客最多 5 分钟后生效。
 *
 * 用法：
 *   npm run media -- "/path/to/新赞赏码.png"
 *   npm run media -- "/path/to/新赞赏码.jpg" --dry-run
 *
 * 唯一不受这里控制的是外部代理缓存（CDN / 浏览器 / 社交平台预览），它们按 URL 缓存；
 * 换图后可能需要各自过期，站点本身是即时的。
 */
import { execFile } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadEnv } from './env.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'common';
const R2_PREFIX = 'onblog/media';
const MAX_EDGE = 800;

loadEnv();
const siteUrl = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
const WEBP_QUALITY = 92;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const source = args.find((arg) => !arg.startsWith('--'));

if (!source) {
  console.error('用法: npm run media -- "/path/to/新赞赏码.png" [--dry-run]');
  process.exit(1);
}
if (!existsSync(source)) {
  console.error(`找不到源文件: ${source}`);
  process.exit(1);
}

const step = (message) => console.log(`${dryRun ? '[dry-run] ' : ''}${message}`);

// ---------- 1. 生成两种格式 ----------
const workdir = await mkdtemp(join(tmpdir(), 'onblog-media-'));
const pngPath = join(workdir, 'wechat-pay.png');
const webpPath = join(workdir, 'wechat-pay.webp');

step(`源文件: ${source}`);
// 注意：不要显式加 `-s format png`。靠 .png 扩展名推断的输出小得多
// （实测同一张图：推断 62KB vs 显式 155KB），差别来自 sips 的位深/过滤策略。
await run('sips', ['-Z', String(MAX_EDGE), source, '--out', pngPath]);
// sips 输出的 PNG 常是高位深、体积偏大；oxipng 是无损重编码，能把体积压回去。
// 没装 oxipng 也能继续（只是文件大一点），不阻断流程。
try {
  await run('oxipng', ['-o', 'max', '--strip', 'safe', '--quiet', pngPath]);
} catch (error) {
  // oxipng 在「已经最优、无需改动」时会以退出码 1 结束，那不是错误。
  if (error?.code === 'ENOENT') {
    console.warn('⚠️ 没找到 oxipng，PNG 未做无损压缩（brew install oxipng 可装上）');
  }
}
await run('cwebp', ['-quiet', '-q', String(WEBP_QUALITY), '-sharp_yuv', '-m', '6', pngPath, '-o', webpPath]);

const pngSize = (await stat(pngPath)).size;
const webpSize = (await stat(webpPath)).size;
step(`生成: PNG ${pngSize} B · WebP ${webpSize} B（长边 ${MAX_EDGE}px）`);
if (pngSize > 300 * 1024) {
  console.warn(`⚠️ PNG 超过 300KB，建议换一张更小的源图（当前 ${(pngSize / 1024).toFixed(0)}KB）`);
}

// ---------- 2. 上传 R2（key 不变 = 接口路径不变）----------
const uploads = [
  { file: pngPath, key: `${R2_PREFIX}/wechat-pay.png`, type: 'image/png' },
  { file: webpPath, key: `${R2_PREFIX}/wechat-pay.webp`, type: 'image/webp' },
];

for (const { file, key, type } of uploads) {
  const target = `${BUCKET}/${key}`;
  if (dryRun) {
    step(`会执行: npx wrangler r2 object put ${target} --content-type ${type} --remote`);
    continue;
  }
  step(`上传 ${target}`);
  await run('npx', ['wrangler', 'r2', 'object', 'put', target, '--file', file, '--content-type', type, '--remote'], {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
}

// ---------- 收尾提示 ----------
console.log(
  dryRun
    ? '\n[dry-run] 没有真的上传。去掉 --dry-run 再跑一次即可。'
    : `\n完成 —— 不需要改仓库、不需要部署，刷新页面即可看到新图。\n验证: curl -sI ${siteUrl || 'https://example.com'}/media/wechat-pay.webp | grep -iE 'etag|cache-control'`,
);

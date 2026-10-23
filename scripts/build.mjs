#!/usr/bin/env node
/**
 * 交付前守卫（npm run build 会跑）：只做「静态检查」，不联网、不重新生成数据。
 *
 * 钉住几件容易悄悄坏掉的事：
 *   - 项目数据里出现了页面上不存在的图标（卡片会显示空白方块）
 *   - 引用了不存在的图片（线上就是 404 破图）
 *   - 页面偷偷引了外部 CDN 字体/脚本（本站承诺零外部依赖，也影响大陆访问）
 *   - 双语字段只写了一半（切换语言后出现空文本）
 *   - 旧的爱发电链接被带回来（用户明确要求下线）
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

const readText = (rel) => readFile(join(ROOT, rel), 'utf8');

const [dataRaw, html, css, appJs, readme, readmeZh] = await Promise.all([
  readText('public/data/projects.json'),
  readText('public/index.html'),
  readText('public/styles.css'),
  readText('public/app.js'),
  readText('README.md').catch(() => ''),
  readText('README.zh-CN.md').catch(() => ''),
]);

const data = JSON.parse(dataRaw);
const categories = new Set(data.categories);

check(Array.isArray(data.projects) && data.projects.length >= 5, '项目数量少于 5，看起来数据没生成完整');
check(data.totalStars > 0, 'totalStars 应该是正数');

for (const project of data.projects) {
  const where = project.id ?? '(unknown)';
  for (const field of ['id', 'name', 'url', 'stars', 'descEn', 'descZh', 'icon', 'category']) {
    check(
      project[field] !== undefined && project[field] !== '',
      `项目 ${where} 缺少字段 ${field}（双语或图标缺失会让卡片显示空内容）`,
    );
  }
  check(categories.has(project.category), `项目 ${where} 的分类 ${project.category} 不在 categories 里`);
  check(
    html.includes(`<symbol id="i-${project.icon}"`),
    `项目 ${where} 的图标 i-${project.icon} 在 index.html 的图标精灵里不存在`,
  );
  check(/^https:\/\/github\.com\//.test(project.url ?? ''), `项目 ${where} 的 url 不是 GitHub 仓库地址`);
}

// 图片引用必须真实存在（含 <source srcset> —— 漏了 webp 只会在某些浏览器上静默退回 png）
for (const [, src] of html.matchAll(/(?:src|srcset|href)="(\/media\/[^"\s]+)"/g)) {
  // 图片链接带 ?v=N 用来穿透 30 天缓存，校验时把查询串去掉
  const file = src.split('?')[0];
  // 赞赏码不在仓库里：由 Worker 从 R2 的 common 桶取，见 src/index.ts 的 MEDIA_ROUTES
  if (file.startsWith('/media/wechat-pay.')) continue;
  check(existsSync(join(ROOT, 'public', file)), `index.html 引用了不存在的文件 ${src}`);
}

// 零外部依赖：页面自身不允许加载外站资源（导航用的 <a href> 不算，那是出站链接）
for (const [label, text] of [
  ['index.html', html],
  ['styles.css', css],
  ['app.js', appJs],
]) {
  const linkTags = [...text.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const loadingLinks = linkTags.filter(
    (tag) =>
      /rel="(stylesheet|preload|prefetch|icon|apple-touch-icon|manifest|modulepreload)"/.test(tag) &&
      /href="https?:\/\//.test(tag),
  );
  const loaded = [
    ...[...text.matchAll(/\bsrc="(https?:\/\/[^"]+)"/g)].map((m) => m[1]),
    ...loadingLinks.map((tag) => tag.match(/href="([^"]+)"/)?.[1] ?? tag),
    ...[...text.matchAll(/url\(\s*['"]?(https?:\/\/[^)'"]+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/@import\s+['"]?(https?:\/\/[^'";]+)/g)].map((m) => m[1]),
  ];
  check(loaded.length === 0, `${label} 会从外站加载资源：${loaded.join(', ')}`);
}

// HTML 里的 id 必须唯一：重复 id 会让 getElementById 拿到错的那个元素，
// 踩过一次（section#timeline 与 ol#timeline 撞名，JS 直接把整个 section 清空了）。
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
check(duplicateIds.length === 0, `index.html 里有重复 id：${[...new Set(duplicateIds)].join(', ')}`);

// app.js 里 getElementById 的每个目标，都必须在页面里恰好存在一次
for (const [, target] of appJs.matchAll(/getElementById\('([^']+)'\)/g)) {
  const count = ids.filter((id) => id === target).length;
  check(count === 1, `app.js 里 getElementById('${target}') 在 index.html 中出现 ${count} 次（应为 1 次）`);
}

// 双语：每个 data-en 都要有 data-zh（反之亦然）
const enCount = (html.match(/data-en="/g) ?? []).length;
const zhCount = (html.match(/data-zh="/g) ?? []).length;
check(enCount === zhCount, `双语字段不成对：data-en ${enCount} 个，data-zh ${zhCount} 个`);

// 项目列表顺序必须等于时间线展平后的顺序（两者共用一条排序规则，防止各自漂移）
const timelineOrder = data.timeline.flatMap((entry) => entry.items.map((item) => item.url));
const projectOrder = data.projects.map((project) => project.url);
check(
  timelineOrder.length === projectOrder.length &&
    timelineOrder.every((url, index) => url === projectOrder[index]),
  '项目列表顺序与时间线不一致：scripts/fetch-projects.mjs 应让 projects 直接采用时间线顺序',
);

// README 不再列项目清单（和主页下方的 pinned 仓库重复），只保留统计数字与星标徽章 ——
// 这两处由 scripts/sync-readme.mjs 刷新，所以仍要校验它们没写偏。
for (const [label, text] of [
  ['README.md', readme],
  ['README.zh-CN.md', readmeZh],
]) {
  const countMatch = text.match(/\*\*(\d+)\*\* (?:public repositories|个公开仓库)/);
  check(
    countMatch?.[1] === String(data.projects.length),
    `${label} 的仓库数量写的是 ${countMatch?.[1] ?? '未找到'}，数据是 ${data.projects.length}`,
  );
  const followerMatch = text.match(/\*\*(\d+)\*\* (?:followers|位关注者)/);
  check(
    followerMatch?.[1] === String(data.followers),
    `${label} 的关注者写的是 ${followerMatch?.[1] ?? '未找到'}，数据是 ${data.followers}`,
  );
}

// README 里的相对图片必须真实存在：GitHub 会原样显示，缺文件就是破图
for (const [label, text] of [
  ['README.md', readme],
  ['README.zh-CN.md', readmeZh],
]) {
  for (const [, src] of text.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    if (/^https?:/i.test(src)) continue;
    const rel = src.replace(/^\.\//, '');
    check(existsSync(join(ROOT, rel)), `${label} 引用了不存在的本地图片 ${src}`);
  }
  // 两个 README 必须互相可达，否则语言切换就是死链
  const counterpart = label === 'README.md' ? 'README.zh-CN.md' : 'README.md';
  check(text.includes(`(${counterpart})`), `${label} 里缺少指向 ${counterpart} 的语言切换链接`);
}

// 已下线的爱发电链接不能再出现
for (const [label, text] of [['README.md', readme], ['index.html', html], ['projects.json', dataRaw]]) {
  check(!/afdian/i.test(text), `${label} 里还有已下线的爱发电链接`);
}

// 赞赏码不再进仓库：确认 Worker 里确实声明了 R2 路由（否则页面会 404）
const workerSource = await readText('src/index.ts');
check(
  workerSource.includes("'/media/wechat-pay.png'") && workerSource.includes('R2_MEDIA'),
  'src/index.ts 里缺少赞赏码的 R2 路由或 R2_MEDIA 绑定',
);
check(
  !existsSync(join(ROOT, 'public/media/wechat-pay.png')),
  '赞赏码又出现在仓库里了：应放在 R2（common 桶 onblog/media/ 前缀）',
);
check(existsSync(join(ROOT, 'public/media/avatar.jpg')), '缺少头像 public/media/avatar.jpg');
check(/\|/.test(readme) || /wechat-pay\.png/.test(readme), 'README 里没找到赞赏码图片引用');

if (problems.length > 0) {
  console.error(`\n❌ build 校验未通过（${problems.length} 项）：`);
  for (const problem of problems) console.error(`   - ${problem}`);
  process.exit(1);
}

console.log(
  `✅ 校验通过：${data.projects.length} 个项目 · ${data.totalStars} stars · 双语字段 ${enCount} 对 · 零外部资源依赖`,
);

#!/usr/bin/env node
/**
 * 交付前守卫（npm run build 会跑）：先重新渲染页面，再做静态检查。
 *
 * 站点已经是 SSG：项目卡片、筛选药丸、时间线、统计数字在构建期编译进 public/index.html。
 * 所以这里除了「引用是否真实存在」之外，还要钉住两件新的事：
 *
 *   - 产物和快照一致：卡片数量、顺序、star / fork、中英简介必须逐项对得上
 *   - 运行时不再依赖 GitHub：Worker 里没有 /api、没有 KV、没有 token；
 *     star / fork 的动态刷新只是一次匿名只读请求，失败时保留构建期数字
 *
 * 其余仍是老规矩：图标符号存在、图片存在、零外部资源依赖、双语字段成对、
 * 闭源产品链接两边一致、README 统计没写偏。
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CLOSED_PRODUCTS, HIDDEN_REPOS } from '../src/lib/projects.mjs';
import { applyTokens, buildTokenMap, escapeHtml, renderSite } from './render.mjs';
import { loadEnv } from './env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};
const num = (value) => new Intl.NumberFormat('en-US').format(value);
const readText = (rel) => readFile(join(ROOT, rel), 'utf8');
const readOptional = (rel) => readText(rel).catch(() => '');

loadEnv();

/**
 * Workers Builds 的构建命令会先用 SITE_URL 跑一次 render-seo（见仓库外的构建配置），
 * 把域名写进 public/index.html。build 随后会从模板重渲染，所以这里把已经落盘的域名捡回来，
 * 否则重渲染会把 __SITE_URL__ 又写回去、把 canonical / og:url 变成占位符。
 * 本地没配域名时自然拿到空串，产物继续保持占位符（仓库里不出现线上域名）。
 */
const detectSiteUrl = (html) => html.match(/<link rel="canonical" href="(https?:\/\/[^"/]+)\//)?.[1] ?? '';
const previousOutput = await readOptional('public/index.html');
const siteUrl = (process.env.SITE_URL ?? '').trim() || detectSiteUrl(previousOutput);
const tokens = buildTokenMap(siteUrl);
const resolve = (value) => applyTokens(value ?? '', tokens);

// 校验对象必须是即将部署的产物：先把模板 + 快照编译一遍。
await renderSite({ siteUrl, useEnv: true });

const [dataRaw, html, css, appJs, headers, readme, readmeZh, workerSource, wrangler, template] =
  await Promise.all([
    readText('public/data/projects.json'),
    readText('public/index.html'),
    readText('public/styles.css'),
    readText('public/app.js'),
    readText('public/_headers'),
    readOptional('README.md'),
    readOptional('README.zh-CN.md'),
    readText('src/index.ts'),
    readText('wrangler.jsonc'),
    readText('src/index.html'),
  ]);

const data = JSON.parse(dataRaw);
const categories = new Set(data.categories);

/* ---------- 快照本身 ---------- */

check(Array.isArray(data.projects) && data.projects.length >= 5, '项目数量少于 5，看起来数据没生成完整');
check(data.totalStars > 0, 'totalStars 应该是正数');
check(/^\d{4}-\d{2}-\d{2}$/.test(data.generatedAt ?? ''), `generatedAt 格式不对：${data.generatedAt}`);
check(
  JSON.stringify(data.categories) === JSON.stringify(CATEGORIES),
  `快照的分类 ${JSON.stringify(data.categories)} 与 CATEGORIES 不一致`,
);

for (const project of data.projects) {
  const where = project.id ?? '(unknown)';
  for (const field of ['id', 'name', 'url', 'stars', 'descEn', 'descZh', 'icon', 'category']) {
    check(
      project[field] !== undefined && project[field] !== '',
      `项目 ${where} 缺少字段 ${field}（双语或图标缺失会让卡片显示空内容）`,
    );
  }
  check(Number.isFinite(project.stars) && Number.isFinite(project.forks), `项目 ${where} 的 star/fork 不是数字`);
  check(categories.has(project.category), `项目 ${where} 的分类 ${project.category} 不在 categories 里`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(project.created ?? ''), `项目 ${where} 的 created 不是 YYYY-MM-DD`);
  check(
    html.includes(`<symbol id="i-${project.icon}"`),
    `项目 ${where} 的图标 i-${project.icon} 在 index.html 的图标精灵里不存在`,
  );
  if (project.logo) {
    check(
      existsSync(join(ROOT, 'public', project.logo.replace(/^\//, ''))),
      `项目 ${where} 的图标文件 ${project.logo} 不存在（线上就是破图）`,
    );
  }
  check(/^https:\/\/github\.com\//.test(project.url ?? ''), `项目 ${where} 的 url 不是 GitHub 仓库地址`);
}

for (const hidden of HIDDEN_REPOS) {
  check(!data.projects.some((project) => project.id === hidden), `被隐藏的仓库 ${hidden} 又出现在项目列表里`);
}

/* ---------- 生成的卡片与快照逐项对齐 ---------- */

const cardPattern = /<article class="card" data-cat="([^"]+)" data-repo="([^"]+)">[\s\S]*?<\/article>/g;
const cards = [...html.matchAll(cardPattern)].map((match) => ({
  category: match[1],
  id: match[2],
  html: match[0],
}));

check(cards.length === data.projects.length, `页面里有 ${cards.length} 张项目卡片，快照是 ${data.projects.length} 个`);
check(new Set(cards.map((card) => card.id)).size === cards.length, '页面里有重复的 data-repo');
check(
  cards.map((card) => card.id).join(',') === data.projects.map((project) => project.id).join(','),
  '卡片顺序与快照顺序不一致：scripts/render.mjs 应让两者共用同一份排序',
);

for (const project of data.projects) {
  const card = cards.find((entry) => entry.id === project.id);
  check(Boolean(card), `页面里缺少项目 ${project.id} 的卡片`);
  if (!card) continue;

  check(card.category === project.category, `项目 ${project.id} 的 data-cat 与快照分类不一致`);
  check(
    card.html.includes(`data-count="stars">${num(project.stars)}<`),
    `项目 ${project.id} 的 star 数没有按快照渲染（${project.stars}）`,
  );
  check(
    card.html.includes(`data-count="forks">${num(project.forks)}<`),
    `项目 ${project.id} 的 fork 数没有按快照渲染（${project.forks}）`,
  );
  check(
    card.html.includes(`data-en="${escapeHtml(project.descEn)}"`),
    `项目 ${project.id} 的英文简介没有按快照渲染`,
  );
  check(card.html.includes(`data-zh="${escapeHtml(project.descZh)}"`), `项目 ${project.id} 的中文简介没有按快照渲染`);
  check(card.html.includes(`>${escapeHtml(project.descZh)}</p>`), `项目 ${project.id} 的默认中文正文丢失`);
  check(card.html.includes(`href="${project.url}"`), `项目 ${project.id} 的仓库链接丢失`);
  const homeHref = resolve(project.home);
  if (homeHref) check(card.html.includes(`href="${homeHref}"`), `项目 ${project.id} 的在线体验链接丢失`);
  if (project.zhName) check(card.html.includes(escapeHtml(project.zhName)), `项目 ${project.id} 的中文名丢失`);
}

/* ---------- 筛选药丸 ---------- */

const chipsBlockStart = html.indexOf('<!-- build:chips:start -->');
const chipsBlockEnd = html.indexOf('<!-- build:chips:end -->');
check(chipsBlockStart !== -1 && chipsBlockEnd > chipsBlockStart, '页面里缺少筛选药丸的生成区块');
const chipsBlock = chipsBlockEnd > chipsBlockStart ? html.slice(chipsBlockStart, chipsBlockEnd) : '';

const chipPattern =
  /<button class="chip" type="button" data-filter="([^"]+)" aria-pressed="(true|false)">([\s\S]*?)<\/button>/g;
const chips = [...chipsBlock.matchAll(chipPattern)].map((match) => ({
  id: match[1],
  pressed: match[2],
  html: match[0],
}));

const expectedChips = [
  { id: 'all', count: data.projects.length },
  ...data.categories.map((id) => ({
    id,
    count: data.projects.filter((project) => project.category === id).length,
  })),
];

check(chips.length === expectedChips.length, `筛选药丸有 ${chips.length} 个，应为 ${expectedChips.length} 个`);
for (const expected of expectedChips) {
  const chip = chips.find((entry) => entry.id === expected.id);
  check(Boolean(chip), `缺少分类 ${expected.id} 的药丸`);
  if (!chip) continue;
  check(chip.html.includes(`<span class="chip__count">${expected.count}</span>`), `分类 ${expected.id} 的数量不对`);
  check(/data-en="[^"]+"/.test(chip.html) && /data-zh="[^"]+"/.test(chip.html), `分类 ${expected.id} 的双语标签缺失`);
  if (expected.id === 'all') {
    check(chip.pressed === 'true', '默认选中项必须是「全部」');
    check(!chip.html.includes('chip__dot'), '「全部」药丸不应该有分类圆点');
  } else {
    check(chip.html.includes(`chip__dot--${expected.id}`), `分类 ${expected.id} 的圆点样式缺失`);
  }
}

/* ---------- 时间线 ---------- */

const timelineStart = html.indexOf('<!-- build:timeline:start -->');
const timelineEnd = html.indexOf('<!-- build:timeline:end -->');
check(timelineStart !== -1 && timelineEnd > timelineStart, '页面里缺少时间线的生成区块');
const timelineBlock = timelineEnd > timelineStart ? html.slice(timelineStart, timelineEnd) : '';

let cursor = -1;
for (const project of data.projects) {
  const index = timelineBlock.indexOf(project.url);
  check(index > cursor, `时间线顺序与项目列表不一致：${project.id}`);
  cursor = index;
}
check(timelineBlock.includes('注册 GitHub，第一次把代码放上公网。'), '时间线缺少加入 GitHub 的节点');

for (const product of CLOSED_PRODUCTS) {
  const productUrl = resolve(product.url);
  check(timelineBlock.includes(`href="${productUrl}"`), `时间线缺少闭源产品 ${product.name}`);
}
check(
  (timelineBlock.match(/rail__tag--closed/g) ?? []).length === CLOSED_PRODUCTS.length,
  '时间线里的闭源产品数量不对',
);

/* ---------- 统计数字与页脚 ---------- */

check(html.includes(`id="starTotal">${num(data.totalStars)}<`), '头像旁的星标总数没有按快照渲染');
check(html.includes(`id="projectCount">${data.projects.length}<`), '开源项目面板的计数没有按快照渲染');
const footer = html.slice(html.indexOf('<footer class="foot">'), html.indexOf('</footer>'));
check(footer.includes(`内容更新于 ${data.generatedAt}。`), '页脚的中文更新日期没有按快照渲染');
check(footer.includes(`Content updated ${data.generatedAt}.`), '页脚的英文更新日期没有按快照渲染');
check(html.includes(`${data.projects.length} 个开源小工具`), 'og:description 没有按快照更新');
check(!/\{\{[A-Z_]+\}\}/.test(html), 'index.html 里还有未替换的 {{PLACEHOLDER}}');

// 模板必须保留区块标记，否则下次构建会把手工内容覆盖掉
for (const region of ['chips', 'projects', 'timeline']) {
  check(
    template.includes(`<!-- build:${region}:start -->`) && template.includes(`<!-- build:${region}:end -->`),
    `src/index.html 缺少 ${region} 的生成区块标记`,
  );
}
check(template.includes('__SITE_URL__'), 'src/index.html 里不再使用 __SITE_URL__，线上域名可能被写死');

/* ---------- 运行时确实不依赖 GitHub ---------- */

for (const [label, text] of [
  ['src/index.ts', workerSource],
  ['public/app.js', appJs],
  ['public/index.html', html],
  ['wrangler.jsonc', wrangler],
]) {
  check(!text.includes('/api/projects'), `${label} 里还有已经下线的 /api/projects`);
  check(!text.includes('GITHUB_CACHE'), `${label} 里还有 KV 绑定 GITHUB_CACHE`);
  check(!text.includes('GITHUB_TOKEN'), `${label} 里还有 GITHUB_TOKEN`);
}
check(!workerSource.includes('/api/'), 'Worker 里不应该再有任何 /api 路由');
check(
  !/fetch\(\s*['"]https:\/\/api\.github\.com/.test(workerSource),
  'Worker 运行时不应该再访问 GitHub（动态 star 只在浏览器端做）',
);
check(workerSource.includes('R2_MEDIA'), 'src/index.ts 里缺少 R2_MEDIA 绑定');
for (const path of ['/media/wechat-pay.png', '/media/wechat-pay.webp']) {
  check(workerSource.includes(path), `src/index.ts 里缺少 ${path} 的 R2 路由`);
  check(wrangler.includes(`"${path}"`), `wrangler.jsonc 的 run_worker_first 里缺少 ${path}`);
}
check(!wrangler.includes('kv_namespaces'), 'wrangler.jsonc 里还挂着 KV 命名空间');
check(!wrangler.includes('"/api/*"'), 'wrangler.jsonc 里还让 /api/* 进入 Worker');
check(wrangler.includes('"R2_MEDIA"'), 'wrangler.jsonc 里缺少 R2_MEDIA 绑定');

// 动态 star 只是渐进增强：必须走浏览器端匿名请求，失败时保留构建期数字
check(
  appJs.includes('https://api.github.com/users/onblog/repos'),
  'public/app.js 里缺少 star / fork 的匿名刷新请求',
);
check(appJs.includes('STATS_TTL_MS'), 'public/app.js 里缺少 star 数据的缓存时长');
check(!appJs.includes('/data/projects.json'), 'public/app.js 不应该再去取项目 JSON：内容已经编译进页面');
check(
  headers.includes('https://api.github.com'),
  'public/_headers 的 CSP connect-src 必须放行 https://api.github.com（否则刷新 star 会被拦截）',
);

/* ---------- 页面自身 ---------- */

// 图片引用必须真实存在（含 <source srcset> —— 漏了 webp 只会在某些浏览器上静默退回 png）
for (const [, src] of html.matchAll(/(?:src|srcset|href)="(\/media\/[^"\s]+)"/g)) {
  // 图片链接带 ?v=N 用来穿透缓存，校验时把查询串去掉
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
  const linkTags = [...text.matchAll(/<link\b[^>]*>/g)].map((match) => match[0]);
  const loadingLinks = linkTags.filter(
    (tag) =>
      /rel="(stylesheet|preload|prefetch|icon|apple-touch-icon|manifest|modulepreload)"/.test(tag) &&
      /href="https?:\/\//.test(tag),
  );
  const loaded = [
    ...[...text.matchAll(/\bsrc="(https?:\/\/[^"]+)"/g)].map((match) => match[1]),
    ...loadingLinks.map((tag) => tag.match(/href="([^"]+)"/)?.[1] ?? tag),
    ...[...text.matchAll(/url\(\s*['"]?(https?:\/\/[^)'"]+)/g)].map((match) => match[1]),
    ...[...text.matchAll(/@import\s+['"]?(https?:\/\/[^'";]+)/g)].map((match) => match[1]),
  ];
  check(loaded.length === 0, `${label} 会从外站加载资源：${loaded.join(', ')}`);
}

// HTML 里的 id 必须唯一：重复 id 会让 getElementById 拿到错的那个元素
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
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

// 禁 JS 时卡片也必须可见：入场动效默认 opacity:0，靠 noscript 样式兜回来
check(
  /<noscript>\s*<style>[\s\S]*?opacity:\s*1;/.test(html),
  'index.html 缺少 noscript 兜底样式：禁用 JS 时卡片会一直是透明的',
);
check(css.includes('.card[hidden]'), 'styles.css 缺少 .card[hidden] 规则：分类筛选会失效');

// 闭源产品：卡片是 index.html 的静态 HTML，时间线由 render.mjs 生成。
// 两处必须指向同一批站点 —— 否则时间线会把人带到一个「闭源项目」面板里不存在的产品。
check(CLOSED_PRODUCTS.length === 3, `CLOSED_PRODUCTS 有 ${CLOSED_PRODUCTS.length} 个，应为 3 个`);
for (const product of CLOSED_PRODUCTS) {
  const productUrl = resolve(product.url);
  check(html.includes(`href="${productUrl}"`), `闭源产品 ${product.name} 在 index.html 里没有对应链接`);
}

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
for (const [label, text] of [
  ['README.md', readme],
  ['index.html', html],
  ['projects.json', dataRaw],
]) {
  check(!/afdian/i.test(text), `${label} 里还有已下线的爱发电链接`);
}

// 赞赏码不再进仓库：确认 Worker 里确实声明了 R2 路由（否则页面会 404）
check(
  !existsSync(join(ROOT, 'public/media/wechat-pay.png')),
  '赞赏码又出现在仓库里了：应放在 R2（common 桶 onblog/media/ 前缀）',
);
check(existsSync(join(ROOT, 'public/media/avatar.jpg')), '缺少头像 public/media/avatar.jpg');

/* ---------- 隐私：真实域名 / 邮箱不能出现在 tracked 源文件里 ---------- */

// 本地构建（没有真实域名）时，用主机名白名单兜底：一旦有人把带真实域名的产物提交进来，这里会直接失败。
if (!siteUrl) {
  const allowedHosts = new Set([
    'github.com',
    'api.github.com',
    'img.shields.io',
    'static.cloudflareinsights.com',
    'cloudflareinsights.com',
    'www.w3.org',
    'example.com',
    'www.example.com',
  ]);
  for (const [, rawHost] of html.matchAll(/https?:\/\/([^/"'\s]+)/g)) {
    const host = rawHost.split(':')[0].toLowerCase();
    if (allowedHosts.has(host) || host.includes('__site_domain__')) continue;
    problems.push('public/index.html 里出现了未脱敏的主机名（应使用占位符或构建变量）');
    break;
  }
}

// 生产构建时才拿得到真实值；本地没有 .env 时这一节自动跳过。
// 不扫描 public/index.html —— 它在生产构建里本来就会由 render-seo / render 注入真实域名。
const isPlaceholder = (value) => /example\.(com|org|net)|localhost|127\.0\.0\.1/i.test(value);
const privacyValues = [
  ['站点域名', tokens.__SITE_HOST__],
  ['站点 URL', tokens.__SITE_URL__],
  ['联系邮箱', tokens.__CONTACT_EMAIL__],
  ['闭源产品 URL', tokens.__PRODUCT_OILMONKEY_URL__],
  ['闭源产品 URL', tokens.__PRODUCT_PIGEON_URL__],
  ['闭源产品 URL', tokens.__PRODUCT_TOOLSTACK_URL__],
].filter(([, value]) => value && value.length >= 5 && !isPlaceholder(value));

if (privacyValues.length > 0) {
  const privacyFiles = [
    'README.md',
    'README.zh-CN.md',
    'LICENSING.md',
    '.env.example',
    'wrangler.jsonc',
    'src/index.html',
    'src/index.ts',
    'src/lib/projects.mjs',
    'public/styles.css',
    'public/app.js',
    'public/data/projects.json',
    'public/_headers',
    'scripts/build.mjs',
    'scripts/render.mjs',
    'scripts/sync-readme.mjs',
    'scripts/fetch-projects.mjs',
    'scripts/check-freshness.mjs',
    'scripts/render-seo.mjs',
    'scripts/upload-media.mjs',
    'docs/en/DESIGN.md',
    'docs/en/OPERATIONS.md',
    'docs/zh/DESIGN.md',
    'docs/zh/OPERATIONS.md',
  ];

  for (const file of privacyFiles) {
    const text = await readOptional(file);
    if (!text) continue;
    for (const [label, value] of privacyValues) {
      check(!text.includes(value), `隐私泄露：${file} 仍含有真实的${label}（应使用环境变量或占位符）`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n❌ build 校验未通过（${problems.length} 项）：`);
  for (const problem of problems) console.error(`   - ${problem}`);
  process.exit(1);
}

console.log(
  `✅ 校验通过：${data.projects.length} 个项目 · ${num(data.totalStars)} stars · ${cards.length} 张卡片 · 双语字段 ${enCount} 对 · 零外部资源依赖 · 运行时零 GitHub 调用`,
);

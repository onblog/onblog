#!/usr/bin/env node
/**
 * 生成 public/data/projects.json —— 构建期的数据快照。
 *
 * 这份快照是站点内容的唯一数据源：
 *   1. scripts/render.mjs 把项目卡片、时间线、统计数字直接编译进 public/index.html
 *   2. scripts/sync-readme.mjs 用它刷新 README 的仓库数/关注者/星标
 *   3. scripts/check-freshness.mjs 拿它和 GitHub 现状做新鲜度比对
 *
 * 运行时不再访问 GitHub：线上 star / fork 的数字只由 public/app.js 做一次匿名只读刷新，
 * 失败时保留这里生成的数字。
 *
 * 转换逻辑与渲染脚本共用 src/lib/projects.mjs，不在这里另写一套。
 *
 * 用法：npm run data   （需要已登录的 gh CLI；会顺带刷新 README 并重新渲染页面）
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER, META, buildSnapshot, placeholderHome } from '../src/lib/projects.mjs';
import { loadEnv, siteHostFromEnv } from './env.mjs';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

loadEnv();
const siteHost = siteHostFromEnv();
if (!siteHost) {
  throw new Error('缺少 SITE_URL（复制 .env.example 为 .env 并填上站点地址），否则无法把 homepage 脱敏成占位符');
}

async function gh(apiPath) {
  const { stdout } = await execFileAsync('gh', ['api', apiPath], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const [repos, user] = await Promise.all([
  gh(`users/${OWNER}/repos?per_page=100&sort=created`),
  gh(`users/${OWNER}`),
]);

const snapshot = buildSnapshot(repos, user);
if (snapshot.projects.length < 5) {
  throw new Error(`只拿到 ${snapshot.projects.length} 个项目，像被限流了，先别写文件`);
}

// 快照会提交进公开仓库：把站点自己的域名换成 __SITE_DOMAIN__，由构建期注入。
// 外部域名直接报错，避免私有链接悄悄进 git。
for (const project of snapshot.projects) {
  if (project.home) project.home = placeholderHome(project.home, siteHost);
}

/**
 * 新仓库没登记 META 时，兜底结果是「名字由 slug 推导 + 通用 </> 图标 + 没有中文名」，
 * 页面不会报错，只会悄悄变丑（dsh-ready 就这么上过线）。所以这里点名，让它变成一条可见的提醒。
 */
const unregistered = snapshot.projects.filter((project) => !META[project.id]);
if (unregistered.length > 0) {
  console.warn(`⚠️ ${unregistered.length} 个仓库没登记 META（没有真实图标和中文名）：`);
  for (const project of unregistered) console.warn(`   - ${project.id}（当前显示为 ${project.name}）`);
  console.warn('   修法：图标放进 public/media/projects/，再在 src/lib/projects.mjs 的 META 里补一条。');
}

await mkdir(join(ROOT, 'public/data'), { recursive: true });
await writeFile(join(ROOT, 'public/data/projects.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

console.log(
  `✅ ${snapshot.projects.length} projects · ${snapshot.totalStars} stars · ${snapshot.followers} followers → public/data/projects.json`,
);

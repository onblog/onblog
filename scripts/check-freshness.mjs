#!/usr/bin/env node
/**
 * 数据新鲜度提示：比对已提交的 public/data/projects.json 和 GitHub 上的现状。
 *
 * 定位是**提示**，不是门禁：
 *   - 结构性变化（增删仓库、描述/语言/homepage 变了）→ ⚠️ 提醒你跑 npm run data
 *   - 纯数字变化（星标、fork、关注者）→ 只列出来，不催你
 *   - 断网 / gh 未登录 / 接口限流 → ⚪ 跳过，绝不让 npm run check 因为网络挂掉
 *
 * 默认退出码 0。加 --strict 时，只要结构过期就返回 1（想把它接进发布流程时用）。
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitBilingual } from '../src/lib/projects.ts';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'onblog';
const STRICT = process.argv.includes('--strict');
/** 检查不该拖慢 check：gh 超过这个时间就放弃。 */
const GH_TIMEOUT_MS = 15_000;

const skip = (reason) => {
  console.log(`⚪ 数据新鲜度：跳过（${reason}）`);
  process.exit(0);
};

async function gh(apiPath) {
  const { stdout } = await execFileAsync('gh', ['api', apiPath], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: GH_TIMEOUT_MS,
  });
  return JSON.parse(stdout);
}

let snapshot;
try {
  snapshot = JSON.parse(await readFile(join(ROOT, 'public/data/projects.json'), 'utf8'));
} catch {
  console.log('⚠️ 数据新鲜度：public/data/projects.json 不存在或不是合法 JSON，跑 npm run data 生成');
  process.exit(STRICT ? 1 : 0);
}

let liveRepos;
let liveUser;
try {
  [liveRepos, liveUser] = await Promise.all([
    gh(`users/${OWNER}/repos?per_page=100&sort=created`),
    gh(`users/${OWNER}`),
  ]);
} catch (error) {
  const raw = String(error?.stderr || error?.message || error?.code || '').trim();
  const reason = raw.split('\n')[0].slice(0, 60) || '未知错误';
  if (/rate limit/i.test(raw)) skip('GitHub 接口限流，稍后再试');
  if (/ENOENT|not found/i.test(raw)) skip('没装 gh CLI');
  if (/timed? ?out|killed/i.test(raw)) skip('GitHub 接口超时');
  skip(`连不上 GitHub（${reason}）`);
}

const liveProjects = liveRepos.filter((repo) => !repo.fork && !repo.archived && repo.visibility === 'public');
const currentByUrl = new Map(snapshot.projects.map((project) => [project.url, project]));
const liveByUrl = new Map(liveProjects.map((repo) => [repo.html_url, repo]));

/** 结构变化：必须重新生成数据才能体现的变化。 */
const structural = [];
/** 数字变化：随时在动，只做参考。 */
const numeric = [];

for (const [url, repo] of liveByUrl) {
  const current = currentByUrl.get(url);
  if (!current) {
    structural.push(`新增仓库 ${repo.name}`);
    continue;
  }
  const { descEn, descZh } = splitBilingual(repo.description);
  if (descEn !== current.descEn || descZh !== current.descZh) structural.push(`${repo.name} 的描述变了`);
  if ((repo.language ?? '') !== current.language) structural.push(`${repo.name} 的主语言变了`);
  if ((repo.homepage || '') !== current.home) structural.push(`${repo.name} 的 homepage 变了`);
  if (repo.stargazers_count !== current.stars) {
    numeric.push(`${repo.name} ★ ${current.stars} → ${repo.stargazers_count}`);
  }
  if (repo.forks_count !== current.forks) {
    numeric.push(`${repo.name} fork ${current.forks} → ${repo.forks_count}`);
  }
}

for (const [url, project] of currentByUrl) {
  if (!liveByUrl.has(url)) structural.push(`仓库已消失或转为私有/归档：${project.name}`);
}

const starsLive = liveProjects.reduce((sum, repo) => sum + repo.stargazers_count, 0);
if (starsLive !== snapshot.totalStars) {
  numeric.push(`星标合计 ${snapshot.totalStars} → ${starsLive}`);
}
if (liveUser.followers !== snapshot.followers) {
  numeric.push(`关注者 ${snapshot.followers} → ${liveUser.followers}`);
}

console.log(`数据新鲜度（public/data/projects.json，生成于 ${snapshot.generatedAt}）`);

if (structural.length === 0 && numeric.length === 0) {
  console.log(
    `✅ 与 GitHub 一致：${liveProjects.length} 个项目 · ${snapshot.totalStars} stars · ${snapshot.followers} followers`,
  );
  process.exit(0);
}

if (structural.length === 0) {
  console.log('✅ 仓库结构一致（只有数字在变，不必刷新）');
  for (const line of numeric) console.log(`   · ${line}`);
  process.exit(0);
}

console.log('⚠️ 数据落后于 GitHub，建议刷新：');
for (const line of structural) console.log(`   - ${line}`);
for (const line of numeric) console.log(`   · ${line}`);
console.log('\n   修复：npm run data');
process.exit(STRICT ? 1 : 0);

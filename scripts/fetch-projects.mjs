#!/usr/bin/env node
/**
 * 生成 public/data/projects.json —— 构建时的数据快照。
 *
 * 这份快照有两个用途：
 *   1. 离线兜底：/api/projects 拉不到 GitHub 时，页面回退到它，列表永远不会空
 *   2. README 统计：scripts/sync-readme.mjs 用它刷新仓库数/关注者/星标
 *
 * 转换逻辑与 Worker 运行时共用 src/lib/projects.ts，不在这里另写一套。
 *
 * 用法：npm run data   （需要已登录的 gh CLI）
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER, buildSnapshot } from '../src/lib/projects.ts';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

await mkdir(join(ROOT, 'public/data'), { recursive: true });
await writeFile(join(ROOT, 'public/data/projects.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

console.log(
  `✅ ${snapshot.projects.length} projects · ${snapshot.totalStars} stars · ${snapshot.followers} followers → public/data/projects.json`,
);

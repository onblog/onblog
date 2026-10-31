#!/usr/bin/env node
/**
 * 刷新两份 README 里的统计数字与星标徽章。
 *
 * README 不列项目清单了 —— 个人主页下方本来就有 pinned 仓库，再列一遍是重复，
 * 而且清单要跟着仓库改名/增删手动维护。这里只同步那几个容易写偏的数字：
 * 仓库数、关注者数、星标徽章。
 *
 * 由 `npm run data` 串在 fetch-projects.mjs 之后自动执行。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const data = JSON.parse(await readFile(join(ROOT, 'public/data/projects.json'), 'utf8'));

const fmt = (n) => n.toLocaleString('en-US');
/** 徽章与文案上的星标都取「向下取整到百 + 」，不假装精确。 */
const starClaim = `${fmt(Math.floor(data.totalStars / 100) * 100)}+`;
const starBadge = encodeURIComponent(starClaim);
const count = data.projects.length;

/** 统计数字、徽章按同一份数据刷新。 */
function sync(text) {
  const rules = [
    [/\*\*\d+\*\* public repositories/g, `**${count}** public repositories`],
    [/\*\*\d+\*\* 个公开仓库/g, `**${count}** 个公开仓库`],
    [/\*\*\d+\*\* followers/g, `**${data.followers}** followers`],
    [/\*\*\d+\*\* 位关注者/g, `**${data.followers}** 位关注者`],
    [/\*\*[\d,]+\+\*\* stars/g, `**${starClaim}** stars`],
    [/badge\/stars-[^-]+-C99538/g, `badge/stars-${starBadge}-C99538`],
  ];
  return rules.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

for (const file of ['README.md', 'README.zh-CN.md']) {
  const path = join(ROOT, file);
  const before = await readFile(path, 'utf8');
  const after = sync(before);
  if (after !== before) await writeFile(path, after, 'utf8');
  console.log(`${after === before ? '·' : '✎'} ${file} —— ${count} 个仓库 · ${data.followers} 关注者 · ${starClaim} stars`);
}

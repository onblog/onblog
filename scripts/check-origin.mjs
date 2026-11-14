#!/usr/bin/env node
/**
 * 守卫：除 site.json / README / docs 外，任何文件都不得复写真实域名或角色邮箱。
 *
 * 与 M2 的「I 档必须收敛到唯一一处」对应：
 *   - 要扫描的值从 site.json 反推（邮箱、邮箱域名、闭源产品 host），脚本自身不写死任何域名。
 *   - 站点自身主域名不在 site.json 里（设计如此），如果环境提供了 SITE_URL 就一并扫描。
 *   - README / docs 允许出现公开域名与角色邮箱（用于 SEO），属于白名单。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 允许出现真实值的文件（M2：site.json 是唯一落点；README/docs 出于 SEO 豁免）。 */
const ALLOW = [/^site\.json$/, /^README(\.zh-CN)?\.md$/, /^docs\//, /^LICENSE/];

/** 不参与扫描：二进制资源、依赖、构建缓存、锁文件。 */
const SKIP = [/^node_modules\//, /^\.git\//, /^\.wrangler\//, /^public\/media\//, /^package-lock\.json$/];

const TEXT = /\.(ts|mjs|js|json|jsonc|html|css|md|txt)$/;

const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));

const values = new Set();
const add = (value) => {
  if (typeof value === 'string' && value.trim().length >= 4) values.add(value.trim());
};

add(site.author?.email);
const emailHost = String(site.author?.email ?? '').split('@')[1];
if (emailHost) add(emailHost);

for (const product of site.products ?? []) {
  try {
    add(new URL(product.url).hostname);
  } catch {
    /* 非法 URL 由 build.mjs 负责报错，这里跳过 */
  }
}

const siteUrl = process.env.SITE_URL;
if (siteUrl) {
  try {
    add(new URL(siteUrl).hostname);
  } catch {
    /* 非法 SITE_URL 不参与扫描 */
  }
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(ROOT, abs).split('\\').join('/');
    if (SKIP.some((pattern) => pattern.test(rel))) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else if (TEXT.test(rel)) files.push({ abs, rel });
  }
};
walk(ROOT);

const violations = [];
for (const { abs, rel } of files) {
  if (ALLOW.some((pattern) => pattern.test(rel))) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const value of values) {
      if (line.includes(value)) violations.push({ rel, line: index + 1, value });
    }
  });
}

if (violations.length > 0) {
  console.error('❌ 以下文件复写了 site.json 里的真实值（I 档必须只写一处）：');
  for (const item of violations) console.error(`   ${item.rel}:${item.line}  ->  ${item.value}`);
  console.error('\n修法：把值移回 site.json；代码里用占位符、派生值，或从 site.json 读取。');
  process.exit(1);
}

console.log(`✅ 无硬编码域名/邮箱：扫描 ${files.length} 个文件`);

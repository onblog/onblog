#!/usr/bin/env node
/**
 * 构建校验：site.json 结构 + 图标文件存在。
 *
 * 线上渲染在 Worker 里，构建期不再生成任何页面。
 * 这个脚本只做一件事：在部署前把「数据写错」挡在门外。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site.json');
const CATEGORIES = new Set(['app', 'lib', 'site', 'game']);

const fail = (message) => {
  console.error(`❌ ${message}`);
  process.exit(1);
};

let site;
try {
  site = JSON.parse(readFileSync(SITE, 'utf8'));
} catch (error) {
  fail(`site.json 读不了：${error.message}`);
}

if (site.schemaVersion !== 1) fail('site.json 的 schemaVersion 必须是 1');
if (!site.author?.name) fail('site.json 缺少 author.name');
if (!String(site.author?.email ?? '').includes('@')) fail('site.json 的 author.email 不是邮箱');
if (!Array.isArray(site.projects) || site.projects.length === 0) fail('site.json 的 projects 不能为空');

const seen = new Set();
for (const [index, project] of site.projects.entries()) {
  const at = `projects[${index}]`;
  if (!project.repo) fail(`${at}.repo 不能为空`);
  if (seen.has(project.repo)) fail(`${at}.repo 重复：${project.repo}`);
  seen.add(project.repo);
  if (!project.name?.en && !project.name?.zh) fail(`${at}.name 至少要有一个语言`);
  if (!project.icon?.startsWith('/')) fail(`${at}.icon 必须是站内绝对路径`);
  if (!existsSync(join(ROOT, 'public', project.icon.replace(/^\//, '')))) fail(`${at}.icon 文件不存在：${project.icon}`);
  if (project.category && !CATEGORIES.has(project.category)) fail(`${at}.category 非法：${project.category}`);
}

for (const [index, product] of (site.products ?? []).entries()) {
  const at = `products[${index}]`;
  if (!product.id) fail(`${at}.id 不能为空`);
  if (!/^https?:\/\//.test(product.url ?? '')) fail(`${at}.url 必须是 http(s) 地址`);
  if (product.icon && !existsSync(join(ROOT, 'public', product.icon.replace(/^\//, '')))) {
    fail(`${at}.icon 文件不存在：${product.icon}`);
  }
}

console.log(
  `✅ site.json 合法：${site.projects.length} 个开源项目 · ${(site.products ?? []).length} 个闭源产品 · ${site.author.email}`,
);

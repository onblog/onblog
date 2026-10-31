#!/usr/bin/env node
/**
 * 构建期把快照编译进页面（SSG）。
 *
 *   src/index.html（模板，手工维护） + public/data/projects.json（构建快照）
 *     → public/index.html（产物，提交进仓库，Workers Builds 也会在构建时重新生成）
 *
 * 为什么不再让浏览器去取数据：项目列表是页面主体，靠 JS 渲染意味着首屏空一块、
 * 爬虫也只能看到骨架。现在卡片、筛选药丸、时间线、统计数字都是 HTML，
 * 禁用 JavaScript 也能完整阅读；app.js 只负责语言切换、分类筛选和 star 数的渐进增强。
 *
 * 页面里的 `__SITE_URL__` 占位符不在这里替换：线上域名由构建环境提供，
 * 交给 scripts/render-seo.mjs 处理，仓库里继续不出现任何线上域名。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORY_LABELS,
  CLOSED_PRODUCTS,
  LANGUAGE_COLORS,
} from '../src/lib/projects.mjs';
import { loadEnv } from './env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'src/index.html');
const OUTPUT = join(ROOT, 'public/index.html');
const SNAPSHOT = join(ROOT, 'public/data/projects.json');

const num = (value) => new Intl.NumberFormat('en-US').format(value);
const hostOf = (value) => {
  try {
    return value ? new URL(value).hostname : '';
  } catch {
    return '';
  }
};

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** 文本与属性统一转义：描述里出现引号、尖括号时不能把卡片撑破。 */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
const esc = escapeHtml;

/**
 * 构建期环境变量 → 页面占位符。
 *
 * 真实域名与邮箱只允许出现在 `.env` / Workers Builds 的 build variables 里；
 * 仓库中的 `src/index.html`、快照和文档只写占位符。
 */
export function buildTokenMap(siteUrl = '', { useEnv = true } = {}) {
  if (useEnv) loadEnv();
  const env = useEnv ? process.env : {};

  const origin = (siteUrl || env.SITE_URL || '').trim().replace(/\/+$/, '');
  const host = origin ? hostOf(origin) : '';
  const productUrls = {
    OILMONKEY: env.PRODUCT_OILMONKEY_URL || '',
    PIGEON: env.PRODUCT_PIGEON_URL || '',
    TOOLSTACK: env.PRODUCT_TOOLSTACK_URL || '',
  };

  return {
    __SITE_URL__: origin,
    __SITE_HOST__: host,
    __SITE_DOMAIN__: host,
    __CONTACT_EMAIL__: env.CONTACT_EMAIL || '',
    __PRODUCT_OILMONKEY_URL__: productUrls.OILMONKEY,
    __PRODUCT_OILMONKEY_HOST__: hostOf(productUrls.OILMONKEY),
    __PRODUCT_PIGEON_URL__: productUrls.PIGEON,
    __PRODUCT_PIGEON_HOST__: hostOf(productUrls.PIGEON),
    __PRODUCT_TOOLSTACK_URL__: productUrls.TOOLSTACK,
    __PRODUCT_TOOLSTACK_HOST__: hostOf(productUrls.TOOLSTACK),
  };
}

/** 把 token map 应用到任意文本；空值保持占位符，构建守卫会负责报错。 */
export function applyTokens(text, tokens) {
  let result = String(text);
  for (const [token, value] of Object.entries(tokens)) {
    if (value) result = result.split(token).join(value);
  }
  return result;
}

const TOKEN_ENV = {
  __SITE_URL__: 'SITE_URL',
  __SITE_HOST__: 'SITE_URL',
  __SITE_DOMAIN__: 'SITE_URL',
  __CONTACT_EMAIL__: 'CONTACT_EMAIL',
  __PRODUCT_OILMONKEY_URL__: 'PRODUCT_OILMONKEY_URL',
  __PRODUCT_OILMONKEY_HOST__: 'PRODUCT_OILMONKEY_URL',
  __PRODUCT_PIGEON_URL__: 'PRODUCT_PIGEON_URL',
  __PRODUCT_PIGEON_HOST__: 'PRODUCT_PIGEON_URL',
  __PRODUCT_TOOLSTACK_URL__: 'PRODUCT_TOOLSTACK_URL',
  __PRODUCT_TOOLSTACK_HOST__: 'PRODUCT_TOOLSTACK_URL',
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 用 `<!-- build:<name>:start --> … <!-- build:<name>:end -->` 圈出可重复生成的区块。 */
function replaceRegion(html, name, content) {
  const start = `<!-- build:${name}:start -->`;
  const end = `<!-- build:${name}:end -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (!pattern.test(html)) throw new Error(`src/index.html 里缺少 ${start} / ${end} 标记`);
  return html.replace(pattern, `${start}\n${content}\n          ${end}`);
}

function projectCard(project) {
  const descZh = project.descZh || project.descEn;
  const descEn = project.descEn || project.descZh;
  const color = LANGUAGE_COLORS[project.language] ?? '#9a9a9a';

  const mark = project.logo
    ? `<img class="card__icon card__icon--logo" src="${esc(project.logo)}" alt="" width="46" height="46" loading="lazy" decoding="async" />`
    : `<span class="card__icon card__icon--${esc(project.category)}"><svg class="ico" aria-hidden="true"><use href="#i-${esc(project.icon)}" /></svg></span>`;

  const demo = project.home
    ? `
                <a class="card__demo" href="${esc(project.home)}" target="_blank" rel="noopener noreferrer" data-en="Live demo" data-zh="在线体验">在线体验</a>`
    : '';

  return `            <article class="card" data-cat="${esc(project.category)}" data-repo="${esc(project.id)}">
              <div class="card__head">
                ${mark}
                <span class="card__stars" title="GitHub stars"><svg class="ico ico--fill" aria-hidden="true"><use href="#i-star" /></svg><span data-count="stars">${num(project.stars)}</span></span>
              </div>
              <h3 class="card__title">
                <a href="${esc(project.url)}" target="_blank" rel="noopener noreferrer">
                  <span>${esc(project.name)}</span>${project.zhName ? `<span class="card__zh">${esc(project.zhName)}</span>` : ''}
                </a>
              </h3>
              <p class="card__desc" data-en="${esc(descEn)}" data-zh="${esc(descZh)}">${esc(descZh)}</p>
              <div class="card__meta">
                <span class="card__lang"><span class="card__dot" style="background:${color}"></span><span>${esc(project.language || 'Text')}</span></span>
                <span class="card__forks"><svg class="ico" aria-hidden="true"><use href="#i-fork" /></svg><span data-count="forks">${num(project.forks)}</span></span>${demo}
              </div>
            </article>`;
}

function chips(data) {
  const entries = [
    { id: 'all', label: { zh: '全部', en: 'All' }, count: data.projects.length },
    ...data.categories.map((id) => ({
      id,
      label: CATEGORY_LABELS[id] ?? { zh: id, en: id },
      count: data.projects.filter((project) => project.category === id).length,
    })),
  ];

  return entries
    .map(({ id, label, count }) => {
      const dot = id === 'all' ? '' : `<span class="chip__dot chip__dot--${esc(id)}"></span>`;
      return `            <button class="chip" type="button" data-filter="${esc(id)}" aria-pressed="${id === 'all'}">${dot}<span data-en="${esc(label.en)}" data-zh="${esc(label.zh)}">${esc(label.zh)}</span><span class="chip__count">${count}</span></button>`;
    })
    .join('\n');
}

function timeline(data) {
  // 闭源产品按上线年份并进同一组，用虚线药丸区分；规则与页面上的「闭源项目」卡片一致。
  const entries = data.timeline.map((entry) => ({ ...entry, items: [...entry.items] }));
  for (const product of CLOSED_PRODUCTS) {
    const group = entries.find((entry) => entry.year === product.year);
    if (group) group.items.push(product);
    else entries.unshift({ year: product.year, items: [product] });
  }

  return entries
    .map((entry) => {
      const body = entry.join
        ? `<p class="rail__join" data-en="Joined GitHub and put code on the public internet for the first time." data-zh="注册 GitHub，第一次把代码放上公网。">注册 GitHub，第一次把代码放上公网。</p>`
        : entry.items
            .map((item) => {
              const classes = item.closed ? 'rail__tag rail__tag--closed' : 'rail__tag';
              const title = item.closed ? ' title="闭源产品 / Closed-source product"' : '';
              return `<a class="${classes}"${title} href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(item.name)}</span>${item.zh ? `<small>${esc(item.zh)}</small>` : ''}</a>`;
            })
            .join('\n                ');
      return `            <li class="rail__item">
              <span class="rail__year">${entry.year}</span>
              <div class="rail__body">
                ${body}
              </div>
            </li>`;
    })
    .join('\n');
}

/**
 * @param {{ siteUrl?: string }} [options]
 *   siteUrl 只在「构建环境已经知道线上域名」时传：Workers Builds 的 build command 会先跑
 *   scripts/render-seo.mjs（见仓库外的构建配置），或者把 SITE_URL 放进环境变量。
 *   不传时保留 __SITE_URL__ 占位符，仓库里继续不出现线上域名。
 */
export async function renderSite({ siteUrl = '', useEnv = false } = {}) {
  const [template, rawSnapshot] = await Promise.all([readFile(TEMPLATE, 'utf8'), readFile(SNAPSHOT, 'utf8')]);
  const data = JSON.parse(rawSnapshot);

  if (!Array.isArray(data.projects) || data.projects.length === 0) {
    throw new Error('public/data/projects.json 里没有项目，先跑 npm run data');
  }

  const tokens = buildTokenMap(siteUrl, { useEnv });
  const starClaim = `${num(Math.floor(data.totalStars / 100) * 100)}+`;
  const ogDesc = `把复杂留在代码里，把简单留给用的人。${data.projects.length} 个开源小工具，${starClaim} stars。`;

  let html = template;
  html = replaceRegion(html, 'chips', chips(data));
  html = replaceRegion(html, 'projects', data.projects.map(projectCard).join('\n'));
  html = replaceRegion(html, 'timeline', timeline(data));
  html = html
    .replaceAll('{{STAR_TOTAL}}', num(data.totalStars))
    .replaceAll('{{PROJECT_COUNT}}', String(data.projects.length))
    .replaceAll('{{UPDATED}}', esc(data.generatedAt))
    .replaceAll('{{OG_DESC}}', esc(ogDesc));

  html = applyTokens(html, tokens);

  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) throw new Error(`模板里还有未替换的占位符：${[...new Set(leftover)].join(', ')}`);

  // 生产构建（SITE_URL 已知）不允许任何 token 残留：否则线上会出现 __CONTACT_EMAIL__ 这类字样。
  if (tokens.__SITE_URL__) {
    const unresolved = [...new Set(Object.keys(tokens).filter((token) => html.includes(token)))];
    if (unresolved.length > 0) {
      const envNames = [...new Set(unresolved.map((token) => TOKEN_ENV[token] ?? token))];
      throw new Error(`生产构建缺少环境变量：${envNames.join(', ')}`);
    }
  }

  await writeFile(OUTPUT, html, 'utf8');
  console.log(
    `✅ SSG：${data.projects.length} 个项目 · ${num(data.totalStars)} stars · ${data.generatedAt} → public/index.html${tokens.__SITE_URL__ ? '（生产域名已注入）' : ''}`,
  );
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // 默认只写占位符，保证 `npm run data` / `npm run render` 之后的产物可以直接提交。
  // 本地想看真实链接时用 `--env`（配合 .env 或显式环境变量），看完记得再跑一次干净的 render。
  await renderSite({ useEnv: process.argv.includes('--env') });
}

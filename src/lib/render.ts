/**
 * 模板渲染：纯函数，输入 site.json + GitHub 数字，输出整页 HTML。
 *
 * 只有 Worker 调用（构建期不再生成静态页）。
 * 模板本身通过 wrangler 的 Text 规则以字符串形式打包进 bundle。
 */
import type { Bilingual, ProjectEntry, ProductEntry, SiteConfig } from './site';
import type { Stats } from './github';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
const num = (value: number): string => new Intl.NumberFormat('en-US').format(Number(value) || 0);

const hostOf = (value: string): string => {
  try {
    return value ? new URL(value).hostname : '';
  } catch {
    return '';
  }
};

/** GitHub 语言色，写进卡片语言圆点的行内样式；不认识的语言用中性灰。 */
const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#e4c33c',
  TypeScript: '#3b82c4',
  Java: '#b07219',
  Go: '#00add8',
  CSS: '#563d7c',
  HTML: '#e34c26',
  Shell: '#89e051',
};

const CATEGORY_LABELS: Record<string, Bilingual> = {
  app: { zh: '桌面应用', en: 'Desktop apps' },
  lib: { zh: '开源库', en: 'Libraries' },
  site: { zh: '网站服务', en: 'Websites' },
  game: { zh: '小游戏', en: 'Games' },
};

const CATEGORY_ORDER = ['app', 'lib', 'site', 'game'];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 用 `<!-- build:<name>:start --> … <!-- build:<name>:end -->` 圈出可重复生成的区块。 */
function replaceRegion(html: string, name: string, content: string): string {
  const start = `<!-- build:${name}:start -->`;
  const end = `<!-- build:${name}:end -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (!pattern.test(html)) throw new Error(`模板里缺少 ${start} / ${end} 标记`);
  return html.replace(pattern, `${start}\n${content}\n          ${end}`);
}

function projectCard(project: ProjectEntry, site: SiteConfig, stats: Stats, siteHost: string): string {
  const repo = stats.repos[project.repo];
  const stars = repo?.stars ?? 0;
  const forks = repo?.forks ?? 0;
  const language = repo?.language ?? '';
  const color = LANGUAGE_COLORS[language] ?? '#9a9a9a';

  const descEn = project.summary.en || project.summary.zh;
  const descZh = project.summary.zh || project.summary.en;
  const home = project.subdomain ? `https://${project.subdomain}.${siteHost}` : '';
  const repoUrl = `https://github.com/${site.author.github}/${project.repo}`;

  const demo = home
    ? `
                <a class="card__demo" href="${esc(home)}" target="_blank" rel="noopener noreferrer" data-en="Live demo" data-zh="在线体验">在线体验</a>`
    : '';

  return `            <article class="card" data-cat="${esc(project.category)}" data-repo="${esc(project.repo)}">
              <div class="card__head">
                <img class="card__icon card__icon--logo" src="${esc(project.icon)}" alt="" width="46" height="46" loading="lazy" decoding="async" />
                <span class="card__stars" title="GitHub stars"><svg class="ico ico--fill" aria-hidden="true"><use href="#i-star" /></svg><span data-count="stars">${num(stars)}</span></span>
              </div>
              <h3 class="card__title">
                <a href="${esc(repoUrl)}" target="_blank" rel="noopener noreferrer">
                  <span>${esc(project.name.en || project.name.zh)}</span>${project.name.zh ? `<span class="card__zh">${esc(project.name.zh)}</span>` : ''}
                </a>
              </h3>
              <p class="card__desc" data-en="${esc(descEn)}" data-zh="${esc(descZh)}">${esc(descZh)}</p>
              <div class="card__meta">
                <span class="card__lang"><span class="card__dot" style="background:${color}"></span><span>${esc(language || 'Text')}</span></span>
                <span class="card__forks"><svg class="ico" aria-hidden="true"><use href="#i-fork" /></svg><span data-count="forks">${num(forks)}</span></span>${demo}
              </div>
            </article>`;
}

function productCard(product: ProductEntry): string {
  const tone = product.badgeTone || 'plain';
  const descEn = product.summary.en || product.summary.zh;
  const descZh = product.summary.zh || product.summary.en;
  const badgeEn = product.badge.en || product.badge.zh;
  const badgeZh = product.badge.zh || product.badge.en;

  return `            <article class="card card--product">
              <div class="card__head">
                <img class="card__logo" src="${esc(product.icon)}" alt="${esc(product.zh)} / ${esc(product.name)}" width="52" height="52" loading="lazy" decoding="async" />
                <span class="card__badge card__badge--${esc(tone)}" data-en="${esc(badgeEn)}" data-zh="${esc(badgeZh)}">${esc(badgeZh)}</span>
              </div>
              <h3 class="card__title">
                <a href="${esc(product.url)}" target="_blank" rel="noopener noreferrer">
                  <span>${esc(product.name)}</span>${product.zh ? `<span class="card__zh">${esc(product.zh)}</span>` : ''}
                </a>
              </h3>
              <p class="card__desc" data-en="${esc(descEn)}" data-zh="${esc(descZh)}">${esc(descZh)}</p>
              <div class="card__meta">
                <span class="card__domain">${esc(hostOf(product.url))}</span>
                <a class="card__demo" href="${esc(product.url)}" target="_blank" rel="noopener noreferrer" data-en="Visit site" data-zh="打开网站">打开网站</a>
              </div>
            </article>`;
}

function chips(site: SiteConfig): string {
  const used = CATEGORY_ORDER.filter((id) => site.projects.some((project) => project.category === id));
  const entries = [
    { id: 'all', label: { zh: '全部', en: 'All' }, count: site.projects.length },
    ...used.map((id) => ({
      id,
      label: CATEGORY_LABELS[id] ?? { zh: id, en: id },
      count: site.projects.filter((project) => project.category === id).length,
    })),
  ];

  return entries
    .map(({ id, label, count }) => {
      const dot = id === 'all' ? '' : `<span class="chip__dot chip__dot--${esc(id)}"></span>`;
      return `            <button class="chip" type="button" data-filter="${esc(id)}" aria-pressed="${id === 'all'}">${dot}<span data-en="${esc(label.en)}" data-zh="${esc(label.zh)}">${esc(label.zh)}</span><span class="chip__count">${count}</span></button>`;
    })
    .join('\n');
}

function aboutBlocks(site: SiteConfig): string {
  return site.author.about
    .filter((entry) => entry.en || entry.zh)
    .map(
      (entry) => `            <p data-en="${esc(entry.en)}" data-zh="${esc(entry.zh)}">${esc(entry.zh || entry.en)}</p>`,
    )
    .join('\n');
}

interface TimelineItem {
  name: string;
  zh: string;
  url: string;
  closed?: boolean;
}

function timeline(site: SiteConfig, stats: Stats): string {
  const byYear = new Map<number, TimelineItem[]>();

  const push = (year: number, item: TimelineItem): void => {
    if (!year) return;
    const bucket = byYear.get(year) ?? [];
    bucket.push(item);
    byYear.set(year, bucket);
  };

  for (const project of site.projects) {
    const repo = stats.repos[project.repo];
    const year = Number((repo?.created ?? '').slice(0, 4));
    push(year, {
      name: project.name.en || project.name.zh,
      zh: project.name.zh,
      url: `https://github.com/${site.author.github}/${project.repo}`,
    });
  }

  for (const product of site.products) {
    push(product.year, { name: product.name, zh: product.zh, url: product.url, closed: true });
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);
  const joinYear = Number((stats.memberSince || '').slice(0, 4));

  const rows: string[] = [];
  for (const year of years) {
    const items = (byYear.get(year) ?? [])
      .map((item) => {
        const classes = item.closed ? 'rail__tag rail__tag--closed' : 'rail__tag';
        const title = item.closed ? ' title="闭源产品 / Closed-source product"' : '';
        return `<a class="${classes}"${title} href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(item.name)}</span>${item.zh ? `<small>${esc(item.zh)}</small>` : ''}</a>`;
      })
      .join('\n                ');
    rows.push(`            <li class="rail__item">
              <span class="rail__year">${year}</span>
              <div class="rail__body">
                ${items}
              </div>
            </li>`);
  }

  if (joinYear) {
    rows.push(`            <li class="rail__item">
              <span class="rail__year">${joinYear}</span>
              <div class="rail__body">
                <p class="rail__join" data-en="Joined GitHub and put code on the public internet for the first time." data-zh="注册 GitHub，第一次把代码放上公网。">注册 GitHub，第一次把代码放上公网。</p>
              </div>
            </li>`);
  }

  return rows.join('\n');
}

export interface RenderInput {
  template: string;
  site: SiteConfig;
  stats: Stats;
  siteUrl: string;
}

export function renderPage({ template, site, stats, siteUrl }: RenderInput): string {
  const siteHost = hostOf(siteUrl) || siteUrl;
  const totalStars = site.projects.reduce((sum, project) => sum + (stats.repos[project.repo]?.stars ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const starClaim = `${num(Math.floor(totalStars / 100) * 100)}+`;
  const ogDesc = `把复杂留在代码里，把简单留给用的人。${site.projects.length} 个开源小工具，${starClaim} stars。`;

  let html = template;
  html = replaceRegion(html, 'about', aboutBlocks(site));
  html = replaceRegion(html, 'chips', chips(site));
  html = replaceRegion(html, 'projects', site.projects.map((project) => projectCard(project, site, stats, siteHost)).join('\n'));
  html = replaceRegion(html, 'products', site.products.map(productCard).join('\n'));
  html = replaceRegion(html, 'timeline', timeline(site, stats));

  const tokens: Record<string, string> = {
    '{{AUTHOR_NAME}}': esc(site.author.name),
    '{{TAGLINE_EN}}': esc(site.author.tagline.en),
    '{{TAGLINE_ZH}}': esc(site.author.tagline.zh),
    '{{BIO_EN}}': esc(site.author.bio.en),
    '{{BIO_ZH}}': esc(site.author.bio.zh),
    '{{CONTACT_EMAIL}}': esc(site.author.email),
    '{{GITHUB_URL}}': `https://github.com/${esc(site.author.github)}`,
    '{{GITHUB_HANDLE}}': esc(site.author.github),
    '{{SITE_URL}}': esc(siteUrl),
    '{{SITE_HOST}}': esc(siteHost),
    '{{STAR_TOTAL}}': num(totalStars),
    '{{PROJECT_COUNT}}': String(site.projects.length),
    '{{PRODUCT_COUNT}}': String(site.products.length),
    '{{UPDATED}}': today,
    '{{OG_DESC}}': esc(ogDesc),
  };

  for (const [token, value] of Object.entries(tokens)) {
    html = html.split(token).join(value);
  }

  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) throw new Error(`模板里有未替换的占位符：${[...new Set(leftover)].join(', ')}`);

  return html;
}

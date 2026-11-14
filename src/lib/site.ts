/**
 * 站点数据的唯一来源：仓库根目录的 site.json。
 *
 * 站点身份、开源项目展示信息、闭源产品全部在这一个文件里。
 * 构建期由 esbuild 内联进 Worker bundle，运行时零读取。
 * 更新方式：改 site.json → push → Workers Builds 自动部署。
 */
import SITE_JSON from '../../site.json';

export interface Env {
  ASSETS: Fetcher;
  R2_MEDIA: R2Bucket;
  KV_CACHE: KVNamespace;
}

export interface Bilingual {
  en: string;
  zh: string;
}

export interface Author {
  name: string;
  tagline: Bilingual;
  bio: Bilingual;
  about: Bilingual[];
  email: string;
  github: string;
}

export interface ProjectEntry {
  /** GitHub 仓库名，用于匹配实时数字 */
  repo: string;
  name: Bilingual;
  summary: Bilingual;
  /** 站内静态路径，例如 /media/projects/miaomiao-bar.png */
  icon: string;
  category: string;
  /** 站点内子域标签（bar / notes / dsh…），渲染时拼成完整地址；不存真实域名 */
  subdomain: string;
}

export interface ProductEntry {
  id: string;
  name: string;
  zh: string;
  url: string;
  year: number;
  icon: string;
  badge: Bilingual;
  /** 卡片徽章配色变体：browser / notify / toolbox / plain */
  badgeTone: string;
  summary: Bilingual;
}

export interface SiteConfig {
  schemaVersion: number;
  author: Author;
  projects: ProjectEntry[];
  products: ProductEntry[];
}

export const CATEGORIES = ['app', 'lib', 'site', 'game'] as const;

export const CATEGORY_LABELS: Record<string, Bilingual> = {
  app: { zh: '桌面应用', en: 'Desktop apps' },
  lib: { zh: '开源库', en: 'Libraries' },
  site: { zh: '网站服务', en: 'Websites' },
  game: { zh: '小游戏', en: 'Games' },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function bilingual(value: unknown): Bilingual {
  if (!isObject(value)) return { en: '', zh: '' };
  return { en: text(value.en), zh: text(value.zh) };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`site.json 不合法：${message}`);
}

/**
 * 校验并归一化 site.json。
 *
 * 宁可整页 500 也不要渲染半份数据：一个字段写错时，明确报错比悄悄缺卡片容易排查。
 */
export function normalizeSite(raw: unknown): SiteConfig {
  assert(isObject(raw), '根节点必须是对象');
  assert(raw.schemaVersion === 1, 'schemaVersion 必须是 1');

  const authorRaw = raw.author;
  assert(isObject(authorRaw), '缺少 author');

  const author: Author = {
    name: text(authorRaw.name),
    tagline: bilingual(authorRaw.tagline),
    bio: bilingual(authorRaw.bio),
    about: Array.isArray(authorRaw.about) ? authorRaw.about.map(bilingual) : [],
    email: text(authorRaw.email),
    github: text(authorRaw.github),
  };
  assert(author.name, 'author.name 不能为空');
  assert(author.email.includes('@'), 'author.email 必须是邮箱');

  const projectsRaw = Array.isArray(raw.projects) ? raw.projects : [];
  assert(projectsRaw.length > 0, 'projects 不能为空');

  const projects: ProjectEntry[] = projectsRaw.map((entry, index) => {
    assert(isObject(entry), `projects[${index}] 必须是对象`);
    const repo = text(entry.repo);
    const name = bilingual(entry.name);
    const icon = text(entry.icon);
    const category = text(entry.category);
    assert(repo, `projects[${index}].repo 不能为空`);
    assert(name.en || name.zh, `projects[${index}].name 至少要有一个语言`);
    assert(icon.startsWith('/'), `projects[${index}].icon 必须是站内绝对路径`);
    return {
      repo,
      name,
      summary: bilingual(entry.summary),
      icon,
      category: (CATEGORIES as readonly string[]).includes(category) ? category : 'app',
      subdomain: text(entry.subdomain),
    };
  });

  const productsRaw = Array.isArray(raw.products) ? raw.products : [];
  const products: ProductEntry[] = productsRaw.map((entry, index) => {
    assert(isObject(entry), `products[${index}] 必须是对象`);
    const id = text(entry.id);
    const url = text(entry.url);
    assert(id, `products[${index}].id 不能为空`);
    assert(/^https?:\/\//.test(url), `products[${index}].url 必须是 http(s) 地址`);
    return {
      id,
      name: text(entry.name) || id,
      zh: text(entry.zh),
      url,
      year: Number(entry.year) || 0,
      icon: text(entry.icon),
      badge: bilingual(entry.badge),
      badgeTone: text(entry.badgeTone) || 'plain',
      summary: bilingual(entry.summary),
    };
  });

  return { schemaVersion: 1, author, projects, products };
}

/** 校验构建期内联的站点数据。 */
export function loadSite(): SiteConfig {
  return normalizeSite(SITE_JSON);
}

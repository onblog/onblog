/**
 * GitHub 仓库 → 站点数据结构的唯一转换实现。
 *
 * 两个消费者共用这一份，避免「构建快照」和「运行时接口」各写一套而悄悄跑偏：
 *   - src/index.ts（Worker /api/projects，运行时拉最新）
 *   - scripts/fetch-projects.mjs（生成 public/data/projects.json，作为降级兜底与 README 数据源）
 *
 * 输出顺序有一条硬规则：项目列表 = 时间线展平后的顺序（新年份在前，同一年内创建时间升序）。
 * build 脚本会断言这条不变式。
 */

export const OWNER = 'onblog';

export const CATEGORIES = ['app', 'lib', 'site', 'game'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * 手工维护：显示名、中文名、图标、分类。
 * 仓库不在表里时自动兜底（名字由 slug 推导、图标 code、分类 app），不会静默漏项目。
 */
export const META: Record<string, { en: string; zh: string; icon: string; category: Category }> = {
  'miaomiao-bar': { en: 'Miaomiao Bar', zh: '喵喵吧台', icon: 'clipboard', category: 'app' },
  'font-squeeze': { en: 'Font Squeeze', zh: '字压', icon: 'type', category: 'app' },
  'miaomiao-notes': { en: 'Miaomiao Notes', zh: '喵喵笔记', icon: 'notes', category: 'app' },
  'java-limiter': { en: 'Java Limiter', zh: '无锁限流库', icon: 'gauge', category: 'lib' },
  doctor: { en: 'Doctor', zh: '症状自查', icon: 'stethoscope', category: 'site' },
  'maowo-blog': { en: 'Maowo Blog', zh: '猫窝博客', icon: 'blog', category: 'site' },
  'xiu-xian-game': { en: 'Xiu Xian Game', zh: '凡人修仙', icon: 'sword', category: 'game' },
  // 站点自身的仓库也算公开项目（页面文案承诺「全部公开仓库」），单独给个图标区分开。
  onblog: { en: 'Onblog', zh: '个人主页', icon: 'sparkle', category: 'site' },
};

/** GitHub REST 里我们真正用到的字段。 */
export interface GitHubRepo {
  name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  created_at: string;
  pushed_at?: string;
  fork: boolean;
  archived: boolean;
  visibility?: string;
}

export interface GitHubUser {
  created_at: string;
  followers: number;
}

export interface Project {
  id: string;
  name: string;
  zhName: string;
  url: string;
  home: string;
  stars: number;
  forks: number;
  language: string;
  created: string;
  pushed: string;
  descEn: string;
  descZh: string;
  icon: string;
  category: Category;
}

export interface TimelineEntry {
  year: number;
  items: { name: string; zh: string; url: string }[];
  join?: true;
}

export interface Snapshot {
  generatedAt: string;
  owner: string;
  followers: number;
  totalStars: number;
  categories: Category[];
  projects: Project[];
  timeline: TimelineEntry[];
}

const CJK = /[\u4e00-\u9fff]/;

/**
 * 仓库描述是「English. 中文」的写法，从第一个汉字处切开。
 * 不能按句号切：英文描述自己就带句号。
 */
export function splitBilingual(description: string | null | undefined): { descEn: string; descZh: string } {
  const raw = (description ?? '').trim();
  if (!raw) return { descEn: '', descZh: '' };
  const index = raw.search(CJK);
  if (index === -1) return { descEn: raw, descZh: '' };
  return {
    descEn: raw.slice(0, index).trim().replace(/[\s.,;:—–-]+$/u, ''),
    descZh: raw.slice(index).trim(),
  };
}

const titleCase = (slug: string): string =>
  slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** 只要公开、非 fork、非归档的仓库。 */
export function selectPublicRepos(repos: GitHubRepo[]): GitHubRepo[] {
  return repos.filter((repo) => !repo.fork && !repo.archived && (repo.visibility ?? 'public') === 'public');
}

export function buildSnapshot(repos: GitHubRepo[], user: GitHubUser, now: Date = new Date()): Snapshot {
  const projects: Project[] = selectPublicRepos(repos)
    .map((repo) => {
      const meta = META[repo.name];
      const { descEn, descZh } = splitBilingual(repo.description);
      return {
        id: repo.name,
        name: meta?.en ?? titleCase(repo.name),
        zhName: meta?.zh ?? '',
        url: repo.html_url,
        home: repo.homepage || '',
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language ?? '',
        created: repo.created_at.slice(0, 10),
        pushed: repo.pushed_at?.slice(0, 10) ?? repo.created_at.slice(0, 10),
        descEn,
        descZh,
        icon: meta?.icon ?? 'code',
        category: meta?.category ?? 'app',
      } satisfies Project;
    })
    .sort((a, b) => a.created.localeCompare(b.created));

  // 时间线：按创建年份分组，新年份在前，组内保持创建时间升序。
  const byYear = new Map<number, TimelineEntry['items']>();
  for (const project of projects) {
    const year = Number(project.created.slice(0, 4));
    const bucket = byYear.get(year) ?? [];
    bucket.push({ name: project.name, zh: project.zhName, url: project.url });
    byYear.set(year, bucket);
  }

  const timeline: TimelineEntry[] = [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, items]) => ({ year, items }));
  timeline.push({ year: Number(user.created_at.slice(0, 4)), items: [], join: true });

  // 项目列表顺序直接取自时间线展平后的顺序 —— 只保留一处排序规则。
  const timelineOrder = timeline.flatMap((entry) => entry.items.map((item) => item.url));
  projects.sort((a, b) => timelineOrder.indexOf(a.url) - timelineOrder.indexOf(b.url));

  return {
    generatedAt: now.toISOString().slice(0, 10),
    owner: OWNER,
    followers: user.followers,
    totalStars: projects.reduce((sum, project) => sum + project.stars, 0),
    categories: [...CATEGORIES],
    projects,
    timeline,
  };
}

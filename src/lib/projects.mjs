/**
 * GitHub 仓库 → 站点数据结构的唯一转换实现（构建期使用，纯 ESM，不依赖 TS 运行时）。
 *
 * 消费者只有构建脚本：
 *   - scripts/fetch-projects.mjs（生成 public/data/projects.json 快照）
 *   - scripts/render.mjs（把快照编译进 public/index.html）
 *   - scripts/check-freshness.mjs（比对已提交快照与 GitHub 现状）
 *
 * 输出顺序有一条硬规则：项目列表 = 时间线展平后的顺序（全部按创建时间倒序，最新在最前）。
 * build 脚本会断言这条不变式。
 */

export const OWNER = 'onblog';

export const CATEGORIES = ['app', 'lib', 'site', 'game'];

/** 分类的中英标签：构建期写进筛选药丸，前端不再各自维护一份。 */
export const CATEGORY_LABELS = {
  app: { zh: '桌面应用', en: 'Desktop apps' },
  lib: { zh: '开源库', en: 'Libraries' },
  site: { zh: '网站服务', en: 'Websites' },
  game: { zh: '小游戏', en: 'Games' },
};

/** GitHub 语言色，写进卡片语言圆点的行内样式；不认识的语言用中性灰。 */
export const LANGUAGE_COLORS = {
  JavaScript: '#e4c33c',
  TypeScript: '#3b82c4',
  Java: '#b07219',
  Go: '#00add8',
  CSS: '#563d7c',
  HTML: '#e34c26',
  Shell: '#89e051',
};

/**
 * 闭源产品不来自 GitHub，所以快照里没有它们：手写在这张表里。
 * 时间线会把它们按上线年份并进对应那一组，用虚线药丸和开源仓库区分开；
 * 页面上的「闭源项目」卡片是同一批东西，scripts/build.mjs 会校验两处链接没有漂移。
 *
 * URL 用占位符，不把真实域名写进仓库：scripts/render.mjs 在构建期从环境变量解析，
 * 生产值放在 Cloudflare Workers Builds 的 build variables / 本地 .env 里。
 */
export const CLOSED_PRODUCTS = [
  { name: 'Oil Monkey', zh: '油小猴', url: '__PRODUCT_OILMONKEY_URL__', year: 2026, closed: true },
  { name: 'Pigeon', zh: '信鸽', url: '__PRODUCT_PIGEON_URL__', year: 2026, closed: true },
  { name: 'Toolstack', zh: '工具栈', url: '__PRODUCT_TOOLSTACK_URL__', year: 2026, closed: true },
];

/**
 * 手工维护：显示名、中文名、图标、分类，以及（必要时）整段简介。
 * 仓库不在表里时自动兜底（名字由 slug 推导、图标 code、分类 app），不会静默漏项目；
 * 但兜底结果是「没图标、没中文名」，所以 scripts/fetch-projects.mjs 会对未登记的仓库报警。
 *
 * `logo` 是仓库自带的**真实图标**（`/media/projects/…`，由 build.mjs 校验文件存在）：
 * 卡片优先用它，`icon` 退化成兜底 —— 符号精灵只在 logo 缺失时才出现。
 */
export const META = {
  'miaomiao-bar': {
    en: 'Miaomiao Bar',
    zh: '喵喵剪贴板',
    icon: 'clipboard',
    logo: '/media/projects/miaomiao-bar.png',
    category: 'app',
    descEn:
      'The clipboard workbench for macOS: whatever lands on it — a paragraph, a column of names, a picture — comes back cleaned, tidied and ready to paste.',
    descZh: '喵喵剪贴板：macOS 上的剪贴板工作台，文字和图片进了剪贴板就变成能直接用的样子。',
  },
  'font-squeeze': {
    en: 'Font Squeeze',
    zh: '字压',
    icon: 'type',
    logo: '/media/projects/font-squeeze.svg',
    category: 'app',
    descZh: '字压：纯前端字体按需裁剪与格式转换工具。',
  },
  'miaomiao-notes': {
    en: 'Miaomiao Notes',
    zh: '喵喵笔记',
    icon: 'notes',
    logo: '/media/projects/miaomiao-notes.png',
    category: 'app',
    descEn:
      'Miaomiao Notes — a cute, local-first Markdown notes app for macOS, synced through iCloud Drive.',
    descZh: '喵喵笔记：一只喵喵的本地 Markdown 笔记应用，通过 iCloud Drive 同步。',
  },
  'java-limiter': {
    en: 'Java Limiter',
    zh: '疾限',
    icon: 'gauge',
    logo: '/media/projects/java-limiter.svg',
    category: 'lib',
  },
  doctor: {
    en: 'Doctor',
    zh: '症状自查',
    icon: 'stethoscope',
    logo: '/media/projects/doctor.svg',
    category: 'site',
  },
  'maowo-blog': {
    en: 'Maowo Blog',
    zh: '猫窝博客',
    icon: 'blog',
    logo: '/media/projects/maowo-blog.svg',
    category: 'site',
  },
  'xiu-xian-game': {
    en: 'Xiu Xian Game',
    zh: '凡人修仙',
    icon: 'sword',
    logo: '/media/projects/xiu-xian-game.svg',
    category: 'game',
  },
  // 站点自身的仓库（个人名片）：条目留着，方便哪天想放回列表时只改 HIDDEN_REPOS 一处。
  onblog: {
    en: 'Onblog',
    zh: '个人主页',
    icon: 'sparkle',
    logo: '/media/projects/onblog.png',
    category: 'site',
  },
  'dsh-ready': {
    en: 'DSH Ready',
    zh: 'DSH 就位',
    icon: 'rocket',
    logo: '/media/projects/dsh-ready.png',
    category: 'app',
    descEn: 'One-click desktop launcher for DeepSeek Harness — install, launch and upgrade without touching a terminal.',
    descZh: 'DeepSeek Harness 一键桌面启动器：装好、启动、升级，全程不用终端。',
  },
};

const CJK = /[\u4e00-\u9fff]/;

/**
 * 仓库描述是「English. 中文」的写法，从第一个汉字处切开。
 * 不能按句号切：英文描述自己就带句号。
 */
export function splitBilingual(description) {
  const raw = (description ?? '').trim();
  if (!raw) return { descEn: '', descZh: '' };
  const index = raw.search(CJK);
  if (index === -1) return { descEn: raw, descZh: '' };
  return {
    descEn: raw.slice(0, index).trim().replace(/[\s.,;:—–-]+$/u, ''),
    descZh: raw.slice(index).trim(),
  };
}

/**
 * 双语简介的唯一入口：META 里手写的整段优先，否则拆 GitHub 描述。
 * scripts/check-freshness.mjs 也走这里，否则「手写简介」会被误报成「描述变了」。
 */
export function describeProject(name, description) {
  const meta = META[name];
  const split = splitBilingual(description);
  return { descEn: meta?.descEn ?? split.descEn, descZh: meta?.descZh ?? split.descZh };
}

/**
 * 把仓库 homepage 里的站点域名替换成 `__SITE_DOMAIN__` 占位符。
 *
 * 快照会提交进公开仓库，所以真实域名不能落在文件里；构建期由 scripts/render.mjs
 * 从 SITE_URL 推导出域名再替换回来。只接受站点自身域名或其子域，遇到外部域名直接报错，
 * 逼开发者显式设计映射（而不是让私有域名悄悄进 git）。
 */
export function placeholderHome(home, siteHost) {
  if (!home) return '';
  const url = new URL(home);
  if (url.hostname === siteHost) return home.replace(`//${siteHost}`, '//__SITE_DOMAIN__');
  if (url.hostname.endsWith(`.${siteHost}`)) return home.replace(`.${siteHost}`, '.__SITE_DOMAIN__');
  throw new Error(`homepage ${home} 不在站点域名 ${siteHost} 下；请把真实地址放进环境变量，而不是提交进仓库`);
}

const titleCase = (slug) =>
  slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * 不进项目列表的仓库（按仓库名匹配）。
 *
 * `onblog` 就是本站自己的「个人名片」仓库 —— 在「我的开源项目」里展示自己属于自指，产品要求排除。
 * 规则只放在 selectPublicRepos 里，构建快照与新鲜度检查共用：
 * 否则 freshness 会把「列表里怎么没有 onblog」误报成新增仓库，README 统计也会和列表对不上。
 */
export const HIDDEN_REPOS = new Set(['onblog']);

/** 只要公开、非 fork、非归档、且不在 HIDDEN_REPOS 里的仓库。 */
export function selectPublicRepos(repos) {
  return repos.filter(
    (repo) =>
      !repo.fork &&
      !repo.archived &&
      (repo.visibility ?? 'public') === 'public' &&
      !HIDDEN_REPOS.has(repo.name),
  );
}

/**
 * @param {Array<object>} repos GitHub REST /users/{owner}/repos 的返回
 * @param {{ created_at: string, followers: number }} user GitHub REST /users/{owner}
 * @param {Date} [now]
 */
export function buildSnapshot(repos, user, now = new Date()) {
  // 最新在前：仓库先按创建时间倒序，后面时间线分组与列表展平都只靠这一条顺序。
  // 同一秒创建的（同一天导入的项目）用仓库名兜底，保证每次生成的顺序一致。
  const ordered = selectPublicRepos(repos)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.name.localeCompare(b.name));

  const projects = ordered.map((repo) => {
    const meta = META[repo.name];
    const { descEn, descZh } = describeProject(repo.name, repo.description);
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
      logo: meta?.logo ?? '',
      category: meta?.category ?? 'app',
    };
  });

  // 时间线：按创建年份分组，新年份在前，组内保持创建时间倒序（= 上面那一条顺序的切片）。
  const byYear = new Map();
  for (const project of projects) {
    const year = Number(project.created.slice(0, 4));
    const bucket = byYear.get(year) ?? [];
    bucket.push({ name: project.name, zh: project.zhName, url: project.url });
    byYear.set(year, bucket);
  }

  const timeline = [...byYear.entries()]
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

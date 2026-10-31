/* ============================================================
   首页交互：语言切换、分类筛选、star / fork 渐进增强。

   项目卡片、筛选药丸、时间线和统计数字都由 scripts/render.mjs 在构建期编译进
   index.html，所以禁用 JavaScript 也能完整阅读。这里只做三件锦上添花的事：

     1. 中文 / EN 双语切换（data-zh / data-en）
     2. 分类筛选（隐藏或显示已经渲染好的卡片）
     3. 一次匿名 GitHub API 调用，刷新 star / fork 数字
        1 小时 localStorage 缓存；失败或限流时静默保留构建期的数字。
        页面不依赖这次请求，它发不出去也不会少任何内容。
   ============================================================ */

const LANG_KEY = 'onblog:lang';
const STATS_KEY = 'onblog:stats:v1';
const STATS_TTL_MS = 60 * 60 * 1000;
/** 一次请求拿全部仓库，避免每个仓库各发一次；未登录限流是 60 次/小时/IP。 */
const STATS_URL = 'https://api.github.com/users/onblog/repos?per_page=100&sort=created';

const state = { lang: 'zh', filter: 'all' };

const num = (value) => new Intl.NumberFormat('en-US').format(value);

/* ---------- 语言 ---------- */

function resolveLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* 隐私模式下 localStorage 会抛错，按浏览器语言判断即可 */
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function applyLang() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';

  for (const node of document.querySelectorAll('[data-zh]')) {
    const value = node.dataset[state.lang];
    if (value) node.textContent = value;
  }

  for (const button of document.querySelectorAll('.lang__btn')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === state.lang));
  }
}

/* ---------- 分类筛选 ---------- */

function applyFilter() {
  for (const chip of document.querySelectorAll('.chip')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
  }
  for (const card of document.querySelectorAll('#projectGrid .card')) {
    card.hidden = state.filter !== 'all' && card.dataset.cat !== state.filter;
  }
}

/* ---------- star / fork 渐进增强 ---------- */

function readStatsCache() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || !parsed.stats) return null;
    if (Date.now() - parsed.at > STATS_TTL_MS) return null;
    return parsed.stats;
  } catch {
    return null;
  }
}

/** 更新卡片上的 star / fork 与头像旁的星标总数；数据缺项时保留原有文本。 */
function applyStats(stats) {
  let total = 0;

  for (const card of document.querySelectorAll('#projectGrid .card[data-repo]')) {
    const live = stats[card.dataset.repo];
    if (live) {
      const stars = card.querySelector('[data-count="stars"]');
      const forks = card.querySelector('[data-count="forks"]');
      if (stars && Number.isFinite(live.stars)) stars.textContent = num(live.stars);
      if (forks && Number.isFinite(live.forks)) forks.textContent = num(live.forks);
    }

    const shown = card.querySelector('[data-count="stars"]');
    if (shown) total += Number(shown.textContent.replace(/\D/g, '')) || 0;
  }

  const badge = document.getElementById('starTotal');
  if (badge && total > 0) badge.textContent = num(total);
}

async function loadStats() {
  const cached = readStatsCache();
  if (cached) {
    applyStats(cached);
    return;
  }

  try {
    const response = await fetch(STATS_URL, { headers: { accept: 'application/vnd.github+json' } });
    // 限流（403/429）或断网时什么都不做：构建期的数字已经是可用值。
    if (!response.ok) return;

    const repos = await response.json();
    if (!Array.isArray(repos)) return;

    const stats = {};
    for (const repo of repos) {
      if (!repo || typeof repo.name !== 'string') continue;
      stats[repo.name] = {
        stars: Number(repo.stargazers_count) || 0,
        forks: Number(repo.forks_count) || 0,
      };
    }

    applyStats(stats);
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify({ at: Date.now(), stats }));
    } catch {
      /* 写不进去就下次再来，不影响本次展示 */
    }
  } catch {
    /* 离线或被拦截：保留构建期数字 */
  }
}

/* ---------- 入场动效 ---------- */

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      revealObserver.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
);

function observeReveal(host) {
  for (const node of host.querySelectorAll('.card, .rail__item')) {
    revealObserver.observe(node);
  }
}

/* ---------- 启动 ---------- */

function boot() {
  state.lang = resolveLang();

  for (const button of document.querySelectorAll('.lang__btn')) {
    button.addEventListener('click', () => {
      state.lang = button.dataset.lang;
      try {
        localStorage.setItem(LANG_KEY, state.lang);
      } catch {
        /* 存不了就只在本次生效 */
      }
      applyLang();
    });
  }

  document.getElementById('chips')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.chip') : null;
    if (!target) return;
    state.filter = target.dataset.filter || 'all';
    applyFilter();
  });

  applyLang();
  applyFilter();
  observeReveal(document);
  void loadStats();
}

boot();

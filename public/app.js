/* ============================================================
   首页交互：语言切换、分类筛选、入场动效。

   项目卡片、筛选药丸、时间线和统计数字都由 Worker 在请求时渲染（SSR），
   数据来自 KV 缓存 → GitHub 仓库 + 各仓库的 metadata.json。
   页面禁用 JavaScript 也能完整阅读，这里只做三件锦上添花的事：

     1. 中文 / EN 双语切换（data-zh / data-en）
     2. 分类筛选（隐藏或显示已经渲染好的卡片）
     3. 滚动入场动效

   注意：不再需要浏览器端去 GitHub 拉 star / fork —— SSR 渲染出来的数字
   已经是当前缓存窗口内最新的，再请求一次只会多打一次匿名限流。
   ============================================================ */

const LANG_KEY = 'onblog:lang';

const state = { lang: 'zh', filter: 'all' };

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
}

boot();

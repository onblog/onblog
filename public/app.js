/* ============================================================
   首页交互：语言切换、项目筛选、时间线渲染
   数据优先取 /api/projects（Worker 运行时拉 GitHub，边缘缓存 5 分钟）；
   接口不可用时回退到构建快照 /data/projects.json，列表不会空。
   页面本身是预渲染好的静态 HTML，所以禁 JS 也能读到全部文案，只是少了卡片列表。
   ============================================================ */

const LANG_KEY = 'onblog:lang';
const SVG_NS = 'http://www.w3.org/2000/svg';

const CATEGORY_LABELS = {
  app: { zh: '桌面应用', en: 'Desktop apps' },
  lib: { zh: '开源库', en: 'Libraries' },
  site: { zh: '网站服务', en: 'Websites' },
  game: { zh: '小游戏', en: 'Games' },
};

const LANGUAGE_COLORS = {
  JavaScript: '#e4c33c',
  TypeScript: '#3b82c4',
  Java: '#b07219',
  Go: '#00add8',
  CSS: '#563d7c',
  HTML: '#e34c26',
  Shell: '#89e051',
};

const state = { lang: 'zh', filter: 'all', data: null };

/* ---------- 小工具 ---------- */

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined && value !== false) {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
};

const icon = (id, mod = '') => {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `ico ${mod}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
};

const num = (n) => new Intl.NumberFormat('en-US').format(n);

const t = (obj) => obj[state.lang] ?? obj.zh;

/* ---------- 语言 ---------- */

function resolveLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function applyLang() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  for (const node of document.querySelectorAll('[data-zh]')) {
    const value = node.dataset[state.lang];
    if (value) node.textContent = value;
  }
  for (const btn of document.querySelectorAll('.lang__btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === state.lang));
  }
  if (state.data) {
    renderChips();
    renderProjects();
    renderTimeline();
  }
}

/* ---------- 渲染：筛选 ---------- */

function renderChips() {
  const host = document.getElementById('chips');
  if (!host) return;
  host.replaceChildren();

  const { projects, categories } = state.data;
  const entries = [
    { id: 'all', label: { zh: '全部', en: 'All' }, count: projects.length },
    ...categories.map((id) => ({
      id,
      label: CATEGORY_LABELS[id] ?? { zh: id, en: id },
      count: projects.filter((p) => p.category === id).length,
    })),
  ];

  for (const entry of entries) {
    const chip = el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': String(state.filter === entry.id),
      onclick: () => {
        state.filter = entry.id;
        renderChips();
        renderProjects();
      },
    });
    if (entry.id !== 'all') chip.append(el('span', { class: `chip__dot chip__dot--${entry.id}` }));
    chip.append(el('span', { text: t(entry.label) }));
    chip.append(el('span', { class: 'chip__count', text: String(entry.count) }));
    chip.dataset.filter = entry.id;
    host.append(chip);
  }
}

/* ---------- 渲染：项目卡片 ---------- */

function projectCard(project) {
  const desc = state.lang === 'zh' ? project.descZh || project.descEn : project.descEn || project.descZh;

  const head = el('div', { class: 'card__head' }, [
    el('span', { class: `card__icon card__icon--${project.category}` }, [icon(project.icon)]),
    el('span', { class: 'card__stars', title: 'GitHub stars' }, [
      icon('star', 'ico--fill'),
      el('span', { text: num(project.stars) }),
    ]),
  ]);

  const titleLink = el(
    'a',
    { href: project.url, target: '_blank', rel: 'noopener noreferrer' },
    [el('span', { text: project.name })],
  );
  if (project.zhName) titleLink.append(el('span', { class: 'card__zh', text: project.zhName }));

  const meta = el('div', { class: 'card__meta' }, [
    el('span', { class: 'card__lang' }, [
      el('span', {
        class: 'card__dot',
        style: `background:${LANGUAGE_COLORS[project.language] ?? '#9a9a9a'}`,
      }),
      el('span', { text: project.language || 'Text' }),
    ]),
    el('span', { class: 'card__forks' }, [icon('fork'), el('span', { text: num(project.forks) })]),
  ]);

  if (project.home) {
    meta.append(
      el(
        'a',
        { class: 'card__demo', href: project.home, target: '_blank', rel: 'noopener noreferrer' },
        [el('span', { text: state.lang === 'zh' ? '在线体验' : 'Live demo' })],
      ),
    );
  }

  return el('article', { class: 'card', 'data-cat': project.category }, [
    head,
    el('h3', { class: 'card__title' }, [titleLink]),
    el('p', { class: 'card__desc', text: desc }),
    meta,
  ]);
}

function renderProjects() {
  const host = document.getElementById('projectGrid');
  if (!host || !state.data) return;

  const list =
    state.filter === 'all'
      ? state.data.projects
      : state.data.projects.filter((p) => p.category === state.filter);

  host.replaceChildren(...list.map(projectCard));
  observeReveal(host);
}

/* ---------- 渲染：时间线 ---------- */

function renderTimeline() {
  const host = document.getElementById('timelineList');
  if (!host || !state.data) return;
  host.replaceChildren();

  for (const entry of state.data.timeline) {
    const body = el('div', { class: 'rail__body' });

    if (entry.join) {
      body.append(
        el('p', {
          class: 'rail__join',
          text:
            state.lang === 'zh'
              ? '注册 GitHub，第一次把代码放上公网。'
              : 'Joined GitHub and put code on the public internet for the first time.',
        }),
      );
    } else {
      for (const item of entry.items) {
        body.append(
          el(
            'a',
            {
              class: 'rail__tag',
              href: item.url,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            [el('span', { text: item.name }), item.zh ? el('small', { text: item.zh }) : null],
          ),
        );
      }
    }

    host.append(
      el('li', { class: 'rail__item' }, [
        el('span', { class: 'rail__year', text: String(entry.year) }),
        body,
      ]),
    );
  }
  observeReveal(host);
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

/* ---------- 取数：接口优先，静态快照兜底 ---------- */

async function loadProjects() {
  try {
    const res = await fetch('/api/projects', { headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = await res.json();
      if (body?.ok && body.data?.projects) return body.data;
    }
    console.warn('[onblog] /api/projects 返回异常，回退到静态快照', res.status);
  } catch (error) {
    console.warn('[onblog] /api/projects 不可用，回退到静态快照', error);
  }
  const res = await fetch('/data/projects.json', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------- 启动 ---------- */

async function boot() {
  state.lang = resolveLang();

  for (const btn of document.querySelectorAll('.lang__btn')) {
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      localStorage.setItem(LANG_KEY, state.lang);
      applyLang();
    });
  }

  try {
    state.data = await loadProjects();
  } catch (error) {
    console.error('[onblog] 项目数据加载失败', error);
    const host = document.getElementById('projectGrid');
    if (host) {
      host.append(
        el('p', {
          class: 'panel__lede',
          text:
            state.lang === 'zh'
              ? '项目列表没加载出来，刷新试试（数据来自 /api/projects，失败时回退静态快照）。'
              : 'The project list failed to load. Refresh to retry — it reads /api/projects and falls back to the static snapshot.',
        }),
      );
    }
    applyLang();
    return;
  }

  const starTotal = document.getElementById('starTotal');
  if (starTotal) starTotal.textContent = `${num(state.data.totalStars).replace(/,/g, ',')}+`;

  const count = document.getElementById('projectCount');
  if (count) count.textContent = String(state.data.projects.length);

  applyLang();
  observeReveal(document);
}

boot();

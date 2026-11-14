/**
 * GitHub 实时数字：stars / forks / 语言 / 日期 / 关注者。
 *
 * 站点数据（有哪些项目）由 R2 的 site.json 决定，这里只负责补数字。
 * 结果整体写 KV，5 分钟 stale-while-revalidate：
 * 过期先返回旧值、后台刷新，用户请求不会等 GitHub。
 *
 * 为什么只拉一次列表：`/users/{owner}/repos` 一次返回全部公开仓库，
 * 再按 site.json 里的 repo 名取用，避免每个仓库一次请求（子请求与限流都省）。
 */
import type { Env } from './site';

export interface RepoStats {
  stars: number;
  forks: number;
  language: string;
  /** YYYY-MM-DD */
  created: string;
  /** YYYY-MM-DD */
  pushed: string;
}

export interface Stats {
  followers: number;
  /** YYYY-MM-DD，用于时间线末尾的「加入 GitHub」节点 */
  memberSince: string;
  repos: Record<string, RepoStats>;
}

const OWNER = 'onblog';
const KV_KEY = 'onblog:github:v1';
const KV_LOCK_KEY = 'onblog:github:v1:lock';
const FRESH_MS = 5 * 60 * 1000;
const STALE_TTL_S = 30 * 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 5000;

interface CachedStats {
  updatedAt: number;
  data: Stats;
}

interface GithubRepo {
  name: string;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  created_at?: string;
  pushed_at?: string | null;
}

interface GithubUser {
  created_at?: string;
  followers?: number;
}

const EMPTY: Stats = { followers: 0, memberSince: '', repos: {} };

const day = (value?: string | null): string => (typeof value === 'string' ? value.slice(0, 10) : '');

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'onblog-home',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return (await response.json()) as T;
}

async function fetchStats(): Promise<Stats> {
  const [user, repos] = await Promise.all([
    fetchJson<GithubUser>(`https://api.github.com/users/${OWNER}`),
    fetchJson<GithubRepo[]>(`https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner`),
  ]);

  if (!Array.isArray(repos)) throw new Error('GitHub repos 返回不是数组');

  const byName: Record<string, RepoStats> = {};
  for (const repo of repos) {
    if (!repo || typeof repo.name !== 'string') continue;
    byName[repo.name] = {
      stars: Number(repo.stargazers_count) || 0,
      forks: Number(repo.forks_count) || 0,
      language: repo.language ?? '',
      created: day(repo.created_at),
      pushed: day(repo.pushed_at) || day(repo.created_at),
    };
  }

  return {
    followers: Number(user.followers) || 0,
    memberSince: day(user.created_at),
    repos: byName,
  };
}

async function refresh(env: Env): Promise<Stats> {
  const lock = await env.KV_CACHE.get(KV_LOCK_KEY);
  if (lock) {
    const cached = await env.KV_CACHE.get<CachedStats>(KV_KEY, 'json');
    if (cached) return cached.data;
    throw new Error('GitHub 数据正在刷新，且没有历史缓存');
  }

  await env.KV_CACHE.put(KV_LOCK_KEY, '1', { expirationTtl: 60 });
  try {
    const data = await fetchStats();
    await env.KV_CACHE.put(KV_KEY, JSON.stringify({ updatedAt: Date.now(), data } satisfies CachedStats), {
      expirationTtl: STALE_TTL_S,
    });
    return data;
  } finally {
    await env.KV_CACHE.delete(KV_LOCK_KEY);
  }
}

/**
 * 取 GitHub 数字。
 *
 * 永远返回一个 Stats：GitHub 不可达且没有历史缓存时给全 0，
 * 页面仍然完整（只是数字为 0），不会因为第三方接口挂掉而 500。
 */
export async function loadStats(env: Env, ctx: ExecutionContext): Promise<Stats> {
  const cached = await env.KV_CACHE.get<CachedStats>(KV_KEY, 'json');
  const age = cached ? Date.now() - cached.updatedAt : Infinity;

  if (cached && age < FRESH_MS) return cached.data;

  if (cached) {
    // 过期：先把旧值给用户，后台刷新。刷新失败时下次请求再试。
    ctx.waitUntil(refresh(env).catch(() => undefined));
    return cached.data;
  }

  try {
    return await refresh(env);
  } catch {
    return EMPTY;
  }
}

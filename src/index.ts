/**
 * onblog-home Worker
 *
 *   1. /api/projects —— 项目数据。**不缓存接口响应**，每次实时组装；
 *      只把「调用 GitHub 的结果」放进 KV（默认 5 分钟），把上游调用次数压到最低
 *   2. /api/health   —— 健康检查
 *   3. 其它一切交给 Static Assets（页面、CSS、图片走边缘缓存，不执行本脚本）
 *
 * 三层职责分清楚：
 *   静态图片  → 边缘 + 浏览器缓存 30 天（public/_headers，改图靠 ?v= 或改名）
 *   接口响应  → no-store，永远现算，不做任何响应缓存
 *   GitHub 调用 → KV（GITHUB_CACHE），成功 300s / 兜底 60s，跨机房共享
 *
 * 响应头：
 *   x-projects-source: github | snapshot     数据本身来自哪
 *   x-projects-cache:  kv | miss             KV 命中，还是这次刚去抓的
 */

import {
  OWNER,
  buildSnapshot,
  type GitHubRepo,
  type GitHubUser,
  type Snapshot,
} from './lib/projects';

interface Env {
  ASSETS: Fetcher;
  R2_MEDIA: R2Bucket;
  GITHUB_CACHE: KVNamespace;
  /** 可选。不配也能跑，但未认证是 60 次/小时/IP 且与同机房 Workers 共享出口，配上是更稳的做法。 */
  GITHUB_TOKEN?: string;
}

const SERVICE = 'onblog-home';
const VERSION = '1.3.0';
/** 超过这个耗时就打 slow 标记，用来发现边缘异常，而不是等到用户报错。 */
const SLOW_REQUEST_MS = 300;

/**
 * KV key：命名空间 `common` 由多个项目共用，所以 key 以 `onblog:` 开头；
 * 后面带上数据结构版本，换结构时不必清理旧值，直接换 key 即可。
 */
const KV_KEY = 'onblog:github:projects:v1';
/** 成功结果的 KV 时长。 */
const SUCCESS_TTL_SECONDS = 300;
/** 兜底结果的 KV 时长：短一点，GitHub 恢复后尽快切回实时数据，同时避免故障期每个请求都去重试。 */
const FALLBACK_TTL_SECONDS = 60;

type ErrorCode = 'bad_request' | 'not_found' | 'method_not_allowed_on_path' | 'internal_error';

/** 数据最终来自哪。 */
type DataSource = 'github' | 'snapshot';
/** 这次响应的数据是 KV 里拿的还是刚抓的。 */
type CacheState = 'kv' | 'miss';

/** KV 里存的不是裸 payload：来源与抓取时间跟着一起走，命中后也说得清数据新旧。 */
interface CachedEnvelope {
  payload: Snapshot;
  source: DataSource;
  storedAt: number;
}

/**
 * 赞赏码走 R2，不进仓库：仓库是公开的，把收款二维码提交进去等于永久留在 git 历史里。
 * 路径保持 /media/wechat-pay.*（与原先一致），由 Worker 从 common 桶的 onblog/media/ 前缀取。
 */
const MEDIA_ROUTES: Record<string, string> = {
  '/media/wechat-pay.png': 'onblog/media/wechat-pay.png',
  '/media/wechat-pay.webp': 'onblog/media/wechat-pay.webp',
};
/**
 * 赞赏码的缓存策略：浏览器缓存 5 分钟，过期后 ETag 协商。
 *
 * 注意 Worker 的响应**不进 Cloudflare 的 CDN 缓存**（CDN 在 Worker 前面），所以这里的 max-age
 * 只作用于浏览器；每次缓存过期仍会执行 Worker 并读一次 R2。R2 读取本身就在边缘、按次计费但很便宜，
 * 所以不值得再在 Worker 里加一层 Cache API。
 *
 * 5 分钟是换图便利性与重复请求之间的折中：
 *   - 5 分钟内：直接用本地副本，零请求
 *   - 超过 5 分钟：带 ETag 问一次，没变回 304，变了拿新图（换图因此最多 5 分钟生效）
 */
const MEDIA_CACHE_CONTROL = 'public, max-age=300, must-revalidate';

async function serveMedia(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  const object = await env.R2_MEDIA.get(key);
  if (!object) return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });

  const headers = new Headers({
    'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'cache-control': MEDIA_CACHE_CONTROL,
    etag: object.httpEtag,
    'x-media-source': 'r2',
  });

  // 允许浏览器走协商缓存：命中就不必再传一次图片
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });

const fail = (code: ErrorCode, message: string, status: number): Response =>
  json({ ok: false, error: { code, message } }, status, { 'cache-control': 'no-store' });

function respondProjects(envelope: CachedEnvelope, cache: CacheState): Response {
  const degraded = envelope.source === 'snapshot';
  return json(
    {
      ok: true,
      data: envelope.payload,
      meta: {
        source: envelope.source,
        cache,
        degraded,
        generatedAt: envelope.payload.generatedAt,
        storedAt: new Date(envelope.storedAt).toISOString(),
        ttlSeconds: degraded ? FALLBACK_TTL_SECONDS : SUCCESS_TTL_SECONDS,
      },
    },
    200,
    {
      // 接口响应本身不进任何缓存：浏览器、CDN、代理都别存，每次都现算。
      'cache-control': 'no-store',
      'x-projects-source': envelope.source,
      'x-projects-cache': cache,
    },
  );
}

async function readKv(env: Env): Promise<CachedEnvelope | null> {
  try {
    return await env.GITHUB_CACHE.get<CachedEnvelope>(KV_KEY, { type: 'json' });
  } catch (error) {
    // KV 故障不能拖垮接口：退化成"这次直接问 GitHub"。
    console.error(JSON.stringify({ event: 'kv_read_failed', message: String(error).slice(0, 120) }));
    return null;
  }
}

function writeKv(env: Env, ctx: ExecutionContext, envelope: CachedEnvelope, ttlSeconds: number): void {
  ctx.waitUntil(
    env.GITHUB_CACHE.put(KV_KEY, JSON.stringify(envelope), { expirationTtl: ttlSeconds }).catch((error) => {
      console.error(JSON.stringify({ event: 'kv_write_failed', message: String(error).slice(0, 120) }));
    }),
  );
}

async function fetchFromGitHub(env: Env): Promise<Snapshot> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'onblog-home',
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const [reposResponse, userResponse] = await Promise.all([
    fetch(`https://api.github.com/users/${OWNER}/repos?per_page=100&sort=created`, { headers }),
    fetch(`https://api.github.com/users/${OWNER}`, { headers }),
  ]);

  if (!reposResponse.ok || !userResponse.ok) {
    throw new Error(`github responded ${reposResponse.status}/${userResponse.status}`);
  }

  const [repos, user] = (await Promise.all([reposResponse.json(), userResponse.json()])) as [
    GitHubRepo[],
    GitHubUser,
  ];
  return buildSnapshot(repos, user);
}

async function serveProjects(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return fail('method_not_allowed_on_path', '这个接口只接受 GET。', 405);
  }

  // 1) 只看 KV：命中的是"GitHub 调用的结果"，不是"接口响应"
  const cached = await readKv(env);
  if (cached) return respondProjects(cached, 'kv');

  // 2) KV miss：真的去问 GitHub
  try {
    const payload = await fetchFromGitHub(env);
    const envelope: CachedEnvelope = { payload, source: 'github', storedAt: Date.now() };
    writeKv(env, ctx, envelope, SUCCESS_TTL_SECONDS);
    return respondProjects(envelope, 'miss');
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'github_fetch_failed',
        message: String(error).slice(0, 200),
        hasToken: Boolean(env.GITHUB_TOKEN),
      }),
    );

    // 3) 兜底：构建时提交的快照。同样写进 KV，但只存 60 秒 ——
    //    否则 GitHub 故障期间每个请求都会再去重试一次上游。
    const url = new URL(request.url);
    const fallback = await env.ASSETS.fetch(new Request(new URL('/data/projects.json', url.origin).toString()));
    if (!fallback.ok) return fail('internal_error', '项目数据暂时取不到，请稍后再试。', 503);
    const payload = (await fallback.json()) as Snapshot;
    const envelope: CachedEnvelope = { payload, source: 'snapshot', storedAt: Date.now() };
    writeKv(env, ctx, envelope, FALLBACK_TTL_SECONDS);
    return respondProjects(envelope, 'miss');
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    const started = Date.now();

    const mediaKey = MEDIA_ROUTES[url.pathname];
    if (mediaKey) {
      const started = Date.now();
      const media = await serveMedia(request, env, mediaKey);
      console.log(
        JSON.stringify({
          event: 'request',
          service: SERVICE,
          method: request.method,
          path: url.pathname,
          status: media.status,
          duration: Date.now() - started,
          source: 'r2',
        }),
      );
      return media;
    }

    if (!url.pathname.startsWith('/api/')) {
      // assets.run_worker_first 已经拦住了非 /api/ 路径，这里只兜住"资源 miss + 客户端 fetch"的情况。
      return env.ASSETS.fetch(request);
    }

    let response: Response;

    if (url.pathname === '/api/health') {
      response =
        request.method === 'GET' || request.method === 'HEAD'
          ? json(
              { ok: true, data: { service: SERVICE, version: VERSION, status: 'ok', now: new Date().toISOString() } },
              200,
              { 'cache-control': 'no-store' },
            )
          : fail('method_not_allowed_on_path', '这个接口只接受 GET。', 405);
    } else if (url.pathname === '/api/projects') {
      response = await serveProjects(request, env, ctx);
    } else {
      response = fail('not_found', '没有这个接口。', 404);
    }

    const duration = Date.now() - started;
    console.log(
      JSON.stringify({
        event: 'request',
        service: SERVICE,
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration,
        slow: duration > SLOW_REQUEST_MS,
        source: response.headers.get('x-projects-source') ?? undefined,
        cache: response.headers.get('x-projects-cache') ?? undefined,
      }),
    );

    return response;
  },
} satisfies ExportedHandler<Env>;

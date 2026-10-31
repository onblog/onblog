/**
 * wordtk —— 个人名片站：静态资源 + 两条 R2 媒体路由。
 *
 * 站点内容已经在构建期编译成静态 HTML（SSG，见 scripts/render.mjs），
 * 运行时不再访问 GitHub：
 *
 *   静态页面 / CSS / 脚本 / 项目图标 → Static Assets（边缘直出，不执行 Worker、不计请求数）
 *   /media/wechat-pay.png|webp      → 从 R2 的 common 桶 onblog/media/ 前缀取
 *
 * 收款二维码不进公开仓库（提交进去就等于永久留在 git 历史里），所以只有这两条路径
 * 需要 Worker。没有 /api 路由、没有 KV、也不持有任何 GitHub 凭据。
 */

interface Env {
  ASSETS: Fetcher;
  R2_MEDIA: R2Bucket;
}

const SERVICE = 'onblog-home';
const VERSION = '2.0.0';

/** 公开路径 → R2 key。路径保持不变，换图不需要改页面、也不需要发版。 */
const MEDIA_ROUTES: Record<string, string> = {
  '/media/wechat-pay.png': 'onblog/media/wechat-pay.png',
  '/media/wechat-pay.webp': 'onblog/media/wechat-pay.webp',
};

/**
 * 赞赏码的缓存策略：浏览器缓存 5 分钟，过期后 ETag 协商。
 *
 * Worker 的响应不进 Cloudflare 的 CDN 缓存（CDN 在 Worker 前面），所以 max-age 只作用于浏览器；
 * 每次过期仍会执行 Worker 并读一次 R2。R2 读取本身就在边缘，再加一层 Cache API 不值得。
 *
 * 5 分钟是换图便利性与重复请求之间的折中：换图最多 5 分钟生效。
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

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const key = MEDIA_ROUTES[url.pathname];

    // 其余请求全部交回 Static Assets。run_worker_first 只放了这两条媒体路径，
    // 正常情况下只有它们会进来；这里兜住直接调用 Worker 的情况。
    if (!key) return env.ASSETS.fetch(request);

    const started = Date.now();
    const response = await serveMedia(request, env, key);
    console.log(
      JSON.stringify({
        event: 'request',
        service: SERVICE,
        version: VERSION,
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration: Date.now() - started,
        source: 'r2',
      }),
    );
    return response;
  },
} satisfies ExportedHandler<Env>;

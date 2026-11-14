/**
 * wordtk —— 个人名片站：Worker 单点渲染 + R2 数据 + 静态资源。
 *
 * 数据只有一个来源：R2 的 onblog/site.json（个人信息、开源项目展示、闭源产品）。
 * 更新仓库信息 = 覆盖上传这个对象，下一次请求立即生效。
 *
 *   /                 → 读 R2 site.json + GitHub 数字 → SSR 渲染整页
 *   /index.html       → 301 到 /
 *   /media/wechat-pay.* → 从 R2 的 common 桶 onblog/media/ 前缀取赞赏码
 *   其余               → Static Assets（边缘直出，不执行 Worker、不计请求数）
 *
 * 站点域名不写进代码：canonical / OG / 站内子域链接全部由 request.url 的 origin 派生。
 */

import templateHtml from './index.html';
import { loadSite, type Env } from './lib/site';
import { loadStats } from './lib/github';
import { renderPage } from './lib/render';

const SERVICE = 'onblog-home';
const VERSION = '3.0.0';

/** 公开路径 → R2 key。赞赏码不进公开仓库，所以走 R2。 */
const MEDIA_ROUTES: Record<string, string> = {
  '/media/wechat-pay.png': 'onblog/media/wechat-pay.png',
  '/media/wechat-pay.webp': 'onblog/media/wechat-pay.webp',
};

const MEDIA_CACHE_CONTROL = 'public, max-age=300, must-revalidate';
const PAGE_CACHE_CONTROL = 'max-age=0, must-revalidate';

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

  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

async function renderHome(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  try {
    // site.json 已内联进 bundle；GitHub 数字命中 KV 时也是毫秒级。
    const site = loadSite();
    const stats = await loadStats(env, ctx);
    const html = renderPage({ template: templateHtml, site, stats, siteUrl: url.origin });

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': PAGE_CACHE_CONTROL,
        'x-site-source': 'bundle',
        'x-github-source': stats.repos ? 'kv' : 'none',
      },
    });
  } catch (error) {
    // 数据缺失或非法时明确报错，而不是渲染半份页面。
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`站点数据加载失败\n\n${message}\n\n修复：npm run site:upload`, {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      const started = Date.now();
      const response = await renderHome(request, env, ctx);
      console.log(
        JSON.stringify({
          event: 'request',
          service: SERVICE,
          version: VERSION,
          method: request.method,
          path: url.pathname,
          status: response.status,
          duration: Date.now() - started,
        }),
      );
      return response;
    }

    // M8：robots / sitemap 由 Worker 生成，内容从 request.url 派生，不落仓库。
    if (url.pathname === '/robots.txt') {
      return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    if (url.pathname === '/sitemap.xml') {
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${url.origin}/</loc></url>\n</urlset>\n`;
      return new Response(body, {
        headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    // 静态产物里的 index.html 已删除：/index.html 统一 301，避免两个入口重复内容。
    if (url.pathname === '/index.html') {
      return Response.redirect(new URL('/', url).toString(), 301);
    }

    const key = MEDIA_ROUTES[url.pathname];
    if (key) {
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
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

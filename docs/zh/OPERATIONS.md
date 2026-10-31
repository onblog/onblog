# 运维手册

前提：本地有仓库、`gh` 以 `onblog` 登录、`wrangler` 登录的是持有站点所在 Zone 的那个 Cloudflare 账号。

## 配置与隐私

仓库里的文件不写真实域名、邮箱和产品 URL。真实值只在本地 `.env`（复制 `.env.example`）或生产环境的
Workers Builds build variables 里：

| 变量 | 用途 |
| --- | --- |
| `SITE_URL` | canonical / Open Graph / sitemap，以及项目体验链接里的 `__SITE_DOMAIN__` |
| `CONTACT_EMAIL` | 首屏与联系面板的邮件链接 |
| `PRODUCT_OILMONKEY_URL`、`PRODUCT_PIGEON_URL`、`PRODUCT_TOOLSTACK_URL` | 闭源产品卡片与时间线 |

`npm run data` 需要 `SITE_URL`：它会把仓库 homepage 写成 `https://<sub>.__SITE_DOMAIN__`，而不是真实主机名。
设置了 `SITE_URL` 时，`npm run build` 会在 token 未解析或 tracked 文件里出现真实值时失败；不配这些变量时
产物保留占位符，仍然可以安全提交。

## 刷新项目列表

站点是纯静态编译的：`npm run data` 拉取 GitHub、写入 `public/data/projects.json`，然后 `scripts/render.mjs`
把这份快照编译成 `public/index.html` 里的项目卡片、筛选药丸、时间线与统计数字。运行时没有任何请求去 GitHub，
Worker 里也没有 /api 路由。

```bash
npm run data     # GitHub -> 快照 -> README 统计 -> public/index.html
npm run check    # 构建守卫 + 类型检查 + 新鲜度
```

`npm run data` 会剔除 fork 与归档仓库、把双语描述在第一个汉字处切开、按创建年份给时间线分组、累加星标。
`public/data/projects.json` 与重新生成的 `public/index.html` 都要一起提交。

项目卡片的排序只有一处规则：直接采用**时间线展平后**的顺序（整体按创建时间倒序，最新在前），
所以两个区块不可能各排各的。`npm run build` 会断言这件事，并且逐张卡片核对 star / fork、中英简介与筛选计数。

显示名、图标、分类、以及必要时的整段简介，手工维护在 `src/lib/projects.mjs` 的 `META` 表里。
`META` 里没有的仓库也会出现（名字由 slug 推导、图标用 `code`、没有中文名），不会被静默丢掉 ——
但看起来就是兜底样式，所以 `npm run data` 会对未登记的仓库打印 ⚠️ 提醒。

### 新增一个仓库

1. 把仓库自带的图标压到 96px 放进 `public/media/projects/<repo>.png`（或直接放 svg）。
2. 在 `META` 里补一条：`en` / `zh` 显示名、`icon`（精灵里的兜底符号）、`logo`（上面那张图）、`category`。
3. 描述默认取 GitHub 仓库描述并在第一个汉字处切开；中英两边都出现同一专有名词时会被拆坏
   （英文尾巴会重复、中文段会丢前缀），这种就写 `descEn` / `descZh` 整段覆盖。
4. `npm run data && npm run check`，把 `public/data/projects.json` 和 `public/index.html` 一起提交。

### 排除某个仓库

站点自己的名片仓库（`onblog`）不进列表：`src/lib/projects.mjs` 里的 `HIDDEN_REPOS` 按仓库名过滤，
构建快照与新鲜度检查共用这一份规则。要放回列表或再加一个，只改这个集合即可 ——
`META` 里的条目留着不影响，被过滤的仓库根本走不到那一步。

### 数据是不是落后了？

`npm run check` 最后会跑一次新鲜度比对，拿已提交的 JSON 和 GitHub 现状对照：

```bash
npm run freshness                # 只提示，永远返回 0
npm run freshness -- --strict    # 仓库结构变了就返回 1
```

| 变化类型 | 报什么 | 会拦吗 |
| --- | --- | --- |
| 增删仓库 / 归档、描述、主语言、homepage | ⚠️ 结构性变化，提示跑 `npm run data` | 默认不拦（`--strict` 时拦） |
| 星标、fork、关注者 | `·` 数字行，只做参考 | 从不 |
| 断网 / 没装 `gh` / 接口限流 | ⚪ 跳过并说明原因 | 从不 |

星标每天都在动，把所有变化都当失败会让 `check` 永远是红的，所以只有结构才进门禁。默认非阻断是刻意的：
`npm run check` 必须能离线跑。

## 动态 star / fork

star 与 fork 在构建期写进 HTML，页面加载后再由浏览器刷新一次：

- `public/app.js` 只发**一次**匿名请求 `GET https://api.github.com/users/onblog/repos?per_page=100`，
  一次返回全部仓库的 `stargazers_count` / `forks_count`。
- 结果缓存在 `localStorage` 的 `onblog:stats:v1`，有效期 **1 小时**。
- 不需要 token、不走 Worker 代理、不占 KV。未登录 GitHub 限流是 60 次/小时/**访客自己的 IP**，
  一小时一次远低于阈值。
- 请求失败、被限流或被拦截时，构建期的数字原样保留；页面从不等待它，也不会因此少任何内容。

请求由 `public/_headers` 的 `connect-src https://api.github.com` 放行。新增仓库或修改描述仍然要跑
`npm run data` —— 列表本身不是客户端渲染的。

## 新增一个分类

1. 把新 id 加进 `src/lib/projects.mjs` 的 `CATEGORIES`，并在 `META` 里给项目打标签。
2. 在同一个文件的 `CATEGORY_LABELS` 里补中英标签；筛选药丸在构建期生成。
3. 在 `public/styles.css` 里补 `.chip__dot--<id>` 与 `.card__icon--<id>`。
4. 跑一次 `npm run data`（或 `npm run render`）并提交重新生成的页面。

`npm run build` 会在项目指向未声明的分类、或指向图标精灵里不存在的图标时直接失败，所以漏掉一步会在部署前被抓住。

## 部署

```bash
npm run check                 # 必须全绿
npx wrangler deploy           # 不带参数：生效的是顶层配置
npx wrangler deploy --dry-run # 先看绑定与路由清单
```

- `assets.run_worker_first: ["/media/wechat-pay.png", "/media/wechat-pay.webp"]` —— 所有页面、样式、脚本、
  项目图标和项目数据都在 `public/index.html` 里，由静态资源直出，不消耗 Worker 请求数；只有赞赏码两条路径
  会执行 Worker。
- `workers_dev: false` —— 唯一入口是主域名与它的 `www` 别名。
- 已开启 Workers Logs 与 Traces；每个赞赏码请求打一行 JSON 日志
  （`event`、`service`、`method`、`path`、`status`、`duration`、`source: r2`）。

Workers Builds 会先跑 `node scripts/render-seo.mjs`，再跑 `npm run build`，上面这些变量配置在 build variables 里。
因为 build 会从 `src/index.html` 重新渲染一次，它会把已经写进现有 `public/index.html` 的域名读回来继续使用 ——
否则新产物会把 canonical / Open Graph 里的域名又变回 `__SITE_URL__`。本地不配这些变量时产物保留占位符，
仓库里依旧不出现线上域名。

## 域名

主域名与它的 `www` 别名都是本 Worker 上 `custom_domain: true` 的路由，DNS 记录与证书由 Cloudflare 托管。
`www` 由 zone 级规则归一化，**不靠这个 Worker** —— `src/index.ts` 里刻意没有写 www 跳转：边缘规则一旦被停用，
你会直接看见故障，而不是被兜底掩盖。

Single Redirects 规则（控制台 → Rules → Redirect Rules），排第一条：

| 字段 | 值 |
| --- | --- |
| 自定义筛选表达式 | `(http.host eq "www.example.com")` |
| 类型 | 动态（Dynamic）→ `wildcard_replace(http.request.full_uri, "*://www.*", "https://${2}")` |
| 状态码 | 301 |
| 保留查询字符串 | 开 |

通配写法同时匹配 `http://` 与 `https://`，所以裸 HTTP 的 www 请求一跳就到根域名，不会死循环。
限定 scheme 的写法（`https://www.*`）在不匹配时会把源串原样返回，那正好就是"301 到自己"的故障形态。

## 部署后复核

```bash
curl -sI https://example.com/ | head -5                       # 200 + 安全响应头
curl -s  https://example.com/ | grep -c 'data-repo='          # 8 张项目卡片已编译进 HTML
curl -s  https://example.com/ | grep -c 'chip__count'         # 5 个筛选药丸已编译进 HTML
curl -sI https://www.example.com/ | grep -i location          # 301 -> https://example.com/
curl -sI "https://www.example.com/?a=1&b=2" | grep -i location # query 保留且只有一份
curl -s  https://example.com/does-not-exist | head -3         # 出 404 页面，不是 JSON 错误
curl -sI https://example.com/styles.css | grep -i cache       # max-age=0, must-revalidate
curl -sI https://example.com/media/wechat-pay.png | grep -iE 'cache-control|etag|x-media-source'
```

然后打开页面确认：语言切换刷新后仍保持、分类标签能筛选、时间线可见、赞赏码能扫；再关掉 JavaScript 刷新一次，
项目卡片仍应完整可见（筛选、语言切换与星级刷新才是需要 JS 的部分）。

## 回滚

```bash
npx wrangler versions list
npx wrangler rollback
```

## 成本

一个只负责从 R2 读赞赏码的 Worker + 一份静态资源包，没有 D1 / KV / Workers AI / Durable Objects。
页面与图片访问免费；赞赏码在浏览器 5 分钟缓存过期后，每次请求产生一次 R2 读取。

## 缓存：谁缓存在哪

最容易被混为一谈的几样东西，这里刻意分开：

| 对象 | 缓存在哪 | 时长 | 为什么 |
| --- | --- | --- | --- |
| 页面、CSS、JS、项目图标（`/media/*`） | Cloudflare 边缘 **+ 浏览器** | 5 分钟 + ETag（HTML / JS 每次回源校验） | 静态文件，直出成本极低 |
| 项目列表 | 编译进 `public/index.html` | 直到下一次构建 | 运行时完全不取数 |
| star / fork 动态刷新 | 浏览器 `localStorage`（`onblog:stats:v1`） | 1 小时 | 一次匿名请求，失败就保留构建期数字 |
| 赞赏码（`/media/wechat-pay.*`） | 浏览器 + ETag | 5 分钟 | 缓存未命中时 Worker 读 R2 |

页面本身没有任何接口调用；加载后唯一的网络请求是可选的星级刷新：

```bash
curl -s https://example.com/ | grep -c 'data-repo='   # 8 —— 卡片在 HTML 里，不是取回来的
```

### 图片缓存穿透

`public/_headers` 给 `/media/*` 5 分钟 + ETag 协商，所以换图最多 5 分钟生效。HTML 里的图片引用还带 `?v=N`，
**换图时把 N 加一**，或者直接改名。`npm run build` 会校验每个引用到的文件真实存在（校验时忽略查询串）。

### 为什么不再需要 GitHub token

旧方案由 Worker 运行时调 GitHub，未登录请求与同机房其它 Worker 共享出口 IP，所以不得不加 KV 缓存和
fine-grained token。静态构建把这一整套都去掉了：`gh` 只在本地 `npm run data` 时使用，浏览器刷新是每位访客
一小时一次。现在没有要轮换的密钥、没有 KV 命名空间，GitHub 故障也不可能让页面变空。

## 更新赞赏码

赞赏码放在 R2，**不进仓库**。Worker 对外是两条固定路径，接口永远不变：

| 对外路径 | R2 key |
| --- | --- |
| `/media/wechat-pay.png` | `common/onblog/media/wechat-pay.png` |
| `/media/wechat-pay.webp` | `common/onblog/media/wechat-pay.webp` |

```bash
npm run media -- "/path/to/新赞赏码.png"            # 生成 PNG + WebP 并上传
npm run media -- "/path/to/新赞赏码.png" --dry-run   # 只预览
```

这就是全部步骤：**不改仓库、不加 `?v=`、不重新部署**。刷新页面就是新图。

能做到这一点，是因为这两条响应带 `cache-control: public, max-age=300, must-revalidate` 和 ETag：浏览器
先用自己的副本 5 分钟，过期后再问一次 —— 没变回 `304`，变了就拿到新图。所以覆盖 R2 对象即可完成更新，
不改仓库、不加 `?v=`、不重新部署；新访客立刻可见，老访客最多 5 分钟。

有个细节值得记住：**Worker 返回的响应不会进 Cloudflare 的 CDN 缓存**（CDN 在 Worker 前面），所以这两张图
的 `max-age` 只作用于浏览器，每个到达 Worker 的请求都会真的读一次 R2。R2 读取在 Cloudflare 网络内部完成、
成本很低，再在 Worker 里套一层 Cache API 属于为几乎为零的收益增加复杂度。头像这类静态资源不一样：它们
会被 CDN 缓存，响应头里能看到 `cf-cache-status: HIT`。

唯一覆盖不到的地方：GitHub 的 README 图片走 camo 代理，它按 URL 缓存。站点是即时的，README 里的图可能要
等 camo 过期才更新。

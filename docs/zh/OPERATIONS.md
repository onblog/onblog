# 运维手册

前提：本地有仓库、`gh` 以 `onblog` 登录、`wrangler` 登录的是持有 `wordtk.com` 的那个 Cloudflare 账号。

## 刷新项目列表

项目卡片是静态的：构建时生成一次并提交，所以有人看页面时永远不会去调 GitHub 接口。

```bash
npm run data     # GitHub API -> public/data/projects.json
npm run check    # 构建守卫 + 类型检查
```

`npm run data` 会剔除 fork 与归档仓库、把双语描述在第一个汉字处切开、按创建年份给时间线分组、累加星标。

项目卡片的排序只有一处规则：直接采用**时间线展平后**的顺序（新年份在前，同一年内创建时间升序），
所以两个区块不可能各排各的。`npm run build` 会断言这件事。
显示名、图标、分类手工维护在 `scripts/fetch-projects.mjs` 顶部的 `META` 表里；`META` 里没有的仓库也会出现
（名字由 slug 推导、图标用 `code`），不会被静默丢掉。

重新生成的 `public/data/projects.json` 要一起提交 —— 页面读的是这个文件，部署时不会再拉一次。

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

## 新增一个分类

1. 把新 id 加进 `scripts/fetch-projects.mjs` 的 `CATEGORIES`，并在 `META` 里给项目打标签。
2. 在 `public/app.js` 的 `CATEGORY_LABELS` 里补中英标签。
3. 在 `public/styles.css` 里补 `.chip__dot--<id>` 与 `.card__icon--<id>`。

`npm run build` 会在项目指向未声明的分类、或指向图标精灵里不存在的图标时直接失败，所以漏掉一步会在部署前被抓住。

## 部署

```bash
npm run check                 # 必须全绿
npx wrangler deploy           # 不带参数：生效的是顶层配置
npx wrangler deploy --dry-run # 先看绑定与路由清单
```

- `assets.run_worker_first: ["/api/*"]` —— 只有 `/api/*` 会执行 Worker；所有页面、样式、图片、项目 JSON
  都由静态资源直出，不消耗 Worker 请求数。
- `workers_dev: false` —— 唯一入口是 `wordtk.com` 与 `www.wordtk.com`。
- 已开启 Workers Logs 与 Traces；每个 `/api/*` 请求打一行 JSON 日志
  （`event`、`method`、`path`、`status`、`duration`、`slow`）。

## 域名

`wordtk.com` 与 `www.wordtk.com` 都是本 Worker 上 `custom_domain: true` 的路由，DNS 记录与证书由 Cloudflare 托管。
`www` 由 zone 级规则归一化，**不靠这个 Worker** —— `src/index.ts` 里刻意没有写 www 跳转：边缘规则一旦被停用，
你会直接看见故障，而不是被兜底掩盖。

Single Redirects 规则（控制台 → Rules → Redirect Rules），排第一条：

| 字段 | 值 |
| --- | --- |
| 自定义筛选表达式 | `(http.host eq "www.wordtk.com")` |
| 类型 | 动态（Dynamic）→ `wildcard_replace(http.request.full_uri, "*://www.*", "https://${2}")` |
| 状态码 | 301 |
| 保留查询字符串 | 开 |

通配写法同时匹配 `http://` 与 `https://`，所以裸 HTTP 的 www 请求一跳就到根域名，不会死循环。
限定 scheme 的写法（`https://www.*`）在不匹配时会把源串原样返回，那正好就是"301 到自己"的故障形态。

## 部署后复核

```bash
curl -sI https://wordtk.com/ | head -5                       # 200 + 安全响应头
curl -s  https://wordtk.com/api/health                       # {"ok":true,...}
curl -s  https://wordtk.com/api/nope                         # {"ok":false,"error":{"code":"not_found"}}
curl -sI https://www.wordtk.com/ | grep -i location          # 301 -> https://wordtk.com/
curl -sI "https://www.wordtk.com/?a=1&b=2" | grep -i location # query 保留且只有一份
curl -s  https://wordtk.com/does-not-exist | head -3         # 出 404 页面，不是 JSON 错误
curl -sI https://wordtk.com/styles.css | grep -i cache       # max-age=0, must-revalidate
```

然后打开页面确认：语言切换刷新后仍保持、分类标签能筛选、时间线标签可见、赞赏码能扫。

## 回滚

```bash
npx wrangler versions list
npx wrangler rollback
```

## 成本

一个只服务 `/api/*` 的 Worker + 一份静态资源包，没有 D1 / KV / R2 / AI 绑定：页面访问免费，删掉 Worker 就等于
删掉整个站点。

## 每个仓库的赞助按钮

八个公开仓库的默认分支上都放了 `.github/FUNDING.yml`：

```yaml
custom: ["https://wordtk.com/#contact"]
```

- URL **必须加引号**。`https:` 自己就带冒号，不加引号 YAML 会被切坏。
- GitHub 会保留 fragment：Sponsor 下拉里列的就是 `https://wordtk.com/#contact`，点一下直接落到赞赏面板，
  二维码在眼前，而不是落在首页首屏再让人自己往下找。
- `custom` 最多支持 4 条 URL，将来加支付宝 / GitHub Sponsors 不用改结构。
- 还必须打开 Settings → Features 里的 **Sponsorships** 开关，否则按钮根本不会渲染。这个开关只能走界面：
  REST 的仓库对象里有 `has_issues`、`has_discussions` 这些字段，但没有 funding 相关字段，脚本改不了，
  只能每个仓库点一次。

新仓库的检查清单：

1. 提交 `.github/FUNDING.yml`（同样两行）。
2. Settings → Features → **Sponsorships** → 勾上。
3. 确认仓库页里出现 `"showSponsorButton":true`，再点开 Sponsor 下拉确认列出 `https://wordtk.com/#contact`。
   验证要等页面 hydrate 完 —— 太早点复选框会点在未挂载事件的控件上，静默无效（踩过一次）。

## 缓存：三件事分开做

最容易被混为一谈的三样东西，这里刻意分开：

| 对象 | 缓存在哪 | 时长 | 为什么 |
| --- | --- | --- | --- |
| 图片（`/media/*`）等静态文件 | Cloudflare 边缘 **+ 浏览器** | 30 天，`immutable` | 图基本不变；换了图就换 `?v=` |
| `GET /api/projects` 的响应 | **哪里都不缓存** —— `cache-control: no-store` | — | 每次现算，所以不可能读到旧值 |
| 调 GitHub 的那次请求 | **KV**（共用命名空间 `common`，键 `onblog:github:projects:v1`，绑定 `GITHUB_CACHE`） | 成功 300 秒 / 兜底 60 秒 | 这才是唯一贵的部分，一次调用服务所有机房的所有访客 |

所以 `/api/projects` 每次请求都真的在干活，只是这活通常就是一次 KV 读，而不是去问 GitHub：

```bash
curl -sI https://wordtk.com/api/projects | grep -iE 'x-projects|cache-control'
# cache-control: no-store
# x-projects-source: github      数据来源：github | snapshot
# x-projects-cache:  kv          kv（来自 KV）| miss（这次刚抓的）

curl -s https://wordtk.com/api/projects | jq .meta
```### 实际上必须配 token

GitHub 未认证请求限制是 **60 次/小时/IP**，而 Workers 的出口 IP 与同数据中心所有 Worker 共享 —— 实测上游
直接被打回，站点静默回退到静态快照（`x-projects-source: static`）。

```bash
npx wrangler secret put GITHUB_TOKEN    # 粘贴一个仅"公开仓库只读"的 fine-grained token
```

用 **fine-grained** token，只勾公开仓库只读。不要复用个人的 `gh` token —— 那种通常带 `repo`、`delete_repo`
权限，一个纯展示主页不该握有这些。配好之后冷缓存时 `x-projects-source` 应该是 `github`，之后变 `edge` 或
`memory`。

新增 / 改名仓库后仍然建议跑一次 `npm run data`：它会刷新兜底快照并同步 README 里的统计数字；线上接口会在
5 分钟内自己发现新仓库。

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

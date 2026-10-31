# Operations

Everything here assumes a local checkout, `gh` logged in as `onblog`, and `wrangler` logged into the same
Cloudflare account that owns the site's zone.

## Configuration and privacy

Tracked files never contain live domains, addresses or product URLs. Real values are supplied by `.env` locally
(copy `.env.example`) or by Workers Builds build variables in production:

| Variable | Purpose |
| --- | --- |
| `SITE_URL` | canonical / Open Graph / sitemap, and the `__SITE_DOMAIN__` used by project demo links |
| `CONTACT_EMAIL` | mail links in the hero and the contact panel |
| `PRODUCT_OILMONKEY_URL`, `PRODUCT_PIGEON_URL`, `PRODUCT_TOOLSTACK_URL` | closed-source product cards and timeline |

`npm run data` needs `SITE_URL`: it writes repository homepages as `https://<sub>.__SITE_DOMAIN__` instead of the
real host. With `SITE_URL` set, `npm run build` fails if a token is unresolved and scans tracked files for the
configured values; without those variables it writes placeholders and the result stays committable.

## Refresh the project list

The site is statically compiled. `npm run data` pulls GitHub, writes `public/data/projects.json`, and then
`scripts/render.mjs` compiles that snapshot into the project cards, filter chips, timeline and stats inside
`public/index.html`. Nothing on the site reads GitHub at runtime, and the Worker has no API routes.

```bash
npm run data     # GitHub -> snapshot -> README stats -> public/index.html
npm run check    # build guards + typecheck + freshness
```

`npm run data` filters out forks and archived repositories, splits each bilingual description at the first CJK
character, groups the timeline by creation year, and sums the stars. Commit both `public/data/projects.json` and
the regenerated `public/index.html`.

Project ordering has a single source of truth: the horizontal card grid is sorted by the **flattened timeline**
(newest first overall, strictly by creation time), so the two sections can never disagree. `npm run build`
asserts it, and also checks every card, description, star count and chip against the snapshot.

Display names, icons, categories and — when needed — a hand-written description live in the `META` table in
`src/lib/projects.mjs`. A repository missing from `META` still appears (slug-derived name, the `code` icon, no
Chinese name) rather than being dropped — but it looks like a fallback, so `npm run data` prints a ⚠️ for it.

### Adding a repository

1. Downscale the repository's own icon to 96px into `public/media/projects/<repo>.png` (or ship an svg).
2. Add a `META` row: `en` / `zh` display names, `icon` (sprite fallback), `logo` (the image above), `category`.
3. Descriptions come from the GitHub repository description, split at the first CJK character. When the same
   proper noun appears on both sides the split breaks (the English tail repeats, the Chinese part loses its
   prefix) — write `descEn` / `descZh` in `META` to override the whole pair.
4. `npm run data && npm run check`, then commit `public/data/projects.json` and `public/index.html`.

### Hiding a repository

The site's own profile repo (`onblog`) is not listed: `HIDDEN_REPOS` in `src/lib/projects.mjs` filters by
repository name, and the build snapshot and the freshness check share that one rule. To put it back or hide
another repository, edit that set — the `META` row can stay, hidden repositories never reach it.

### Is the committed data stale?

`npm run check` ends with a freshness pass that compares the committed JSON against GitHub:

```bash
npm run freshness                # hint only — always exits 0
npm run freshness -- --strict    # exits 1 when the repository structure changed
```

| What changed | Reported as | Blocks? |
| --- | --- | --- |
| Repository added / removed / archived, description, language or homepage | ⚠️ structural — tells you to run `npm run data` | No (yes with `--strict`) |
| Stars, forks, followers | `·` numeric lines, listed for reference | Never |
| No network, no `gh`, or a rate limit | ⚪ skipped with the reason | Never |

Star counts move daily, so treating every change as a failure would make `check` red all the time; only the
structure gates. The check is deliberately non-blocking by default: `npm run check` must stay runnable offline.

## Live star / fork counts

Star and fork numbers are rendered into the HTML at build time, then refreshed once by the browser:

- `public/app.js` makes **one** anonymous `GET https://api.github.com/users/onblog/repos?per_page=100` call,
  which returns every repository's `stargazers_count` / `forks_count` in a single response.
- The result is cached in `localStorage` under `onblog:stats:v1` for **1 hour**.
- No token, no Worker proxy, no KV. Unauthenticated GitHub allows 60 requests/hour **per visitor IP**; one
  request per hour is far below it.
- If the call fails, is rate-limited or is blocked, the build-time numbers stay on screen. The page never waits
  for it and loses nothing.

The request is allowed by `connect-src https://api.github.com` in `public/_headers`. A new repository or a
changed description still requires `npm run data` — the list itself is not client-rendered.

## Adding a new category

1. Put the new id in `CATEGORIES` in `src/lib/projects.mjs` and tag projects with it in `META`.
2. Add the label pair to `CATEGORY_LABELS` in the same file; chips are rendered at build time.
3. Add `.chip__dot--<id>` and `.card__icon--<id>` rules in `public/styles.css`.
4. Run `npm run data` (or `npm run render`) and commit the regenerated page.

`npm run build` fails if a project points at a category that is not declared or at an icon that is not in the
sprite, so a missing step is caught before deploy.

## Deploy

```bash
npm run check                 # must be green
npx wrangler deploy           # no arguments: top-level config is what ships
npx wrangler deploy --dry-run # list the bindings and routes first
```

- `assets.run_worker_first: ["/media/wechat-pay.png", "/media/wechat-pay.webp"]` — every page, stylesheet,
  script, project icon and the project data live inside `public/index.html` and are served by Static Assets,
  which does not consume Worker requests. Only the two tip-QR paths execute the Worker.
- `workers_dev: false` — the only entries are the apex host and its `www` alias.
- Observability (Workers Logs + Traces) is on; each QR request logs one JSON line
  (`event`, `service`, `method`, `path`, `status`, `duration`, `source: r2`).

Workers Builds runs `node scripts/render-seo.mjs` then `npm run build`, with the variables above configured as
build variables. Because the build re-renders from `src/index.html`, it reads the origin already written into the
existing `public/index.html` and keeps it — otherwise the fresh render would put `__SITE_URL__` back into
canonical / Open Graph URLs. Locally, without those variables, the output keeps placeholders and the repository
still carries no live domain.

## Domains

The apex host and its `www` alias are both `custom_domain: true` routes on this Worker, so DNS records and
certificates are managed by Cloudflare. `www` is normalised to the apex by a zone-level rule, **not by this
Worker** — there is deliberately no `www` redirect in `src/index.ts`, so if the edge rule is ever disabled you
will see it instead of having it silently masked.

Single Redirects rule (dashboard → Rules → Redirect Rules), first in the list:

| Field | Value |
| --- | --- |
| When | `(http.host eq "www.example.com")` |
| Then | Dynamic redirect → `wildcard_replace(http.request.full_uri, "*://www.*", "https://${2}")` |
| Status code | 301 |
| Preserve query string | on |

The wildcard form matches both `http://` and `https://`, so a plain-HTTP `www` request reaches the apex in one
hop instead of looping. A scheme-restricted pattern (`https://www.*`) returns the source unchanged when it does
not match, which is exactly the "301 to itself" failure mode.

## Verify after deploy

```bash
curl -sI https://example.com/ | head -5                       # 200 + security headers
curl -s  https://example.com/ | grep -c 'data-repo='          # 8 project cards baked into the HTML
curl -s  https://example.com/ | grep -c 'chip__count'         # 5 filter chips baked into the HTML
curl -sI https://www.example.com/ | grep -i location          # 301 -> https://example.com/
curl -sI "https://www.example.com/?a=1&b=2" | grep -i location # query preserved, not duplicated
curl -s  https://example.com/does-not-exist | head -3         # the 404 page, not a JSON error
curl -sI https://example.com/styles.css | grep -i cache       # max-age=0, must-revalidate
curl -sI https://example.com/media/wechat-pay.png | grep -iE 'cache-control|etag|x-media-source'
```

Then load the page and check: language toggle persists across reloads, category chips filter, the timeline is
visible, the QR code scans, and the project cards are visible with JavaScript disabled (all content is in the
HTML; only the filter, language switch and live star refresh need JS).

## Rollback

```bash
npx wrangler versions list
npx wrangler rollback
```

## Cost

One Worker whose only job is reading the tip QR from R2, plus one static asset bundle. No D1, KV, Workers AI or
Durable Objects. Pages and images are free to serve; the QR costs one R2 read per request after the browser's
five-minute cache expires.

## Caching: what lives where

The moving parts people usually conflate are kept apart on purpose.

| What | Where it is cached | TTL | Why |
| --- | --- | --- | --- |
| Pages, CSS, JS, project icons (`/media/*`) | Cloudflare edge **and** browser | 5 minutes + ETag (HTML/JS revalidate every time) | static files, cheap to serve |
| The rendered project list | inside `public/index.html` | until the next build | no runtime data fetch at all |
| Live star / fork refresh | browser `localStorage` (`onblog:stats:v1`) | 1 hour | one anonymous request, failure keeps the build-time numbers |
| Tip QR (`/media/wechat-pay.*`) | browser + ETag | 5 minutes | the Worker reads R2 on a cache miss |

The page itself has no API call. The only network request after load is the optional star refresh:

```bash
curl -s https://example.com/ | grep -c 'data-repo='   # 8 — cards are in the HTML, not fetched
```

### Image cache busting

`public/_headers` gives `/media/*` five minutes plus ETag revalidation, so a replaced image goes live within five
minutes. Every image reference in the HTML also carries `?v=N`; **bump it when you replace an image**, or rename
the file. `npm run build` checks that each referenced file exists (query string stripped).

### Why there is no GitHub token any more

The old design called GitHub from the Worker, which forced a KV cache and a fine-grained token because
unauthenticated Workers share egress IPs. The static build removed all of it: `gh` is only used locally by
`npm run data`, and the browser refresh is one request per visitor per hour. There is no secret to rotate,
no KV namespace to manage, and no way for a GitHub outage to blank the page.

## Updating the tip QR code

The QR image lives in R2, **not** in the repository. Two fixed paths are served by the Worker, so the interface
never changes:

| Public path | R2 key |
| --- | --- |
| `/media/wechat-pay.png` | `common/onblog/media/wechat-pay.png` |
| `/media/wechat-pay.webp` | `common/onblog/media/wechat-pay.webp` |

```bash
npm run media -- "/path/to/new-qr.png"            # generate PNG + WebP and upload
npm run media -- "/path/to/new-qr.png" --dry-run   # preview only
```

That is the whole update: **no repository change, no `?v=` bump, no deploy.** Refresh the page and you have the
new image.

This works because these two responses carry `cache-control: public, max-age=300, must-revalidate` plus an ETag:
the browser reuses its copy for five minutes, then asks again — a `304` when the bytes are unchanged, the new
image as soon as they differ. Replacing the object therefore needs no repository change, no `?v=` bump and no
deploy; new visitors see the update instantly and returning visitors within five minutes.

One thing worth knowing: **Worker responses are not stored in Cloudflare's CDN cache** (the cache sits in front of
the Worker), so for these two files `max-age` only governs the browser. Every request that does reach the Worker
reads the object from R2 — which is served from inside Cloudflare's network and is cheap, so adding a Cache API
layer in front of it would be complexity for almost no gain. Static assets such as the avatar are different:
they are CDN-cached and show `cf-cache-status: HIT`.

One place this does not cover: GitHub proxies README images through camo, which caches by URL. The site updates
immediately; the image inside the README may lag until camo expires it.

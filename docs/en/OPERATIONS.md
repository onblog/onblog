# Operations

Everything here assumes a local checkout, `gh` logged in as `onblog`, and `wrangler` logged into the same
Cloudflare account that owns `wordtk.com`.

## Refresh the project list

Project cards are static: they are generated once and committed, so the page never calls the GitHub API while
someone is looking at it.

```bash
npm run data     # GitHub API -> public/data/projects.json
npm run check    # build guards + typecheck
```

`npm run data` filters out forks and archived repositories, splits each bilingual description at the first CJK
character, groups the timeline by creation year, and sums the stars.

Project ordering has a single source of truth: the horizontal card grid is sorted by the **flattened timeline**
(newest year first, oldest-first inside a year), so the two sections can never disagree. `npm run build` asserts it. Display names, icons and categories are
hand-maintained in the `META` table at the top of `scripts/fetch-projects.mjs`; a repository missing from `META`
still appears (with a slug-derived name and the `code` icon) rather than being dropped.

Commit the regenerated `public/data/projects.json` — the page reads it, it is not fetched at deploy time.

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

## Adding a new category

1. Put the new id in `CATEGORIES` in `scripts/fetch-projects.mjs` and tag projects with it in `META`.
2. Add the label pair to `CATEGORY_LABELS` in `public/app.js`.
3. Add `.chip__dot--<id>` and `.card__icon--<id>` rules in `public/styles.css`.

`npm run build` fails if a project points at a category that is not declared or at an icon that is not in the
sprite, so a missing step is caught before deploy.

## Deploy

```bash
npm run check                 # must be green
npx wrangler deploy           # no arguments: top-level config is what ships
npx wrangler deploy --dry-run # list the bindings and routes first
```

- `assets.run_worker_first: ["/api/*"]` — only `/api/*` runs the Worker; every page, stylesheet, image and the
  project JSON are served by Static Assets, which does not consume Worker requests.
- `workers_dev: false` — the only entries are `wordtk.com` and `www.wordtk.com`.
- Observability (Workers Logs + Traces) is on; `/api/*` requests log one JSON line each
  (`event`, `method`, `path`, `status`, `duration`, `slow`).

## Domains

`wordtk.com` and `www.wordtk.com` are both `custom_domain: true` routes on this Worker, so DNS records and
certificates are managed by Cloudflare. `www` is normalised to the apex by a zone-level rule, **not by this
Worker** — there is deliberately no `www` redirect in `src/index.ts`, so if the edge rule is ever disabled you
will see it instead of having it silently masked.

Single Redirects rule (dashboard → Rules → Redirect Rules), first in the list:

| Field | Value |
| --- | --- |
| When | `(http.host eq "www.wordtk.com")` |
| Then | Dynamic redirect → `wildcard_replace(http.request.full_uri, "*://www.*", "https://${2}")` |
| Status code | 301 |
| Preserve query string | on |

The wildcard form matches both `http://` and `https://`, so a plain-HTTP `www` request reaches the apex in one
hop instead of looping. A scheme-restricted pattern (`https://www.*`) returns the source unchanged when it does
not match, which is exactly the "301 to itself" failure mode.

## Verify after deploy

```bash
curl -sI https://wordtk.com/ | head -5                       # 200 + security headers
curl -s  https://wordtk.com/api/health                       # {"ok":true,...}
curl -s  https://wordtk.com/api/nope                         # {"ok":false,"error":{"code":"not_found"}}
curl -sI https://www.wordtk.com/ | grep -i location          # 301 -> https://wordtk.com/
curl -sI "https://www.wordtk.com/?a=1&b=2" | grep -i location # query preserved, not duplicated
curl -s  https://wordtk.com/does-not-exist | head -3         # the 404 page, not a JSON error
curl -sI https://wordtk.com/styles.css | grep -i cache       # max-age=0, must-revalidate
```

Then load the page and check: language toggle persists across reloads, category chips filter, the timeline tab is
visible, and the QR code scans.

## Rollback

```bash
npx wrangler versions list
npx wrangler rollback
```

## Cost

One Worker serving only `/api/*` and one static asset bundle. There is no D1, KV, R2 or AI binding: the page is
free to serve, and deleting the Worker removes the whole site.

## Sponsor button on every repository

All eight repositories carry `.github/FUNDING.yml` on their default branch:

```yaml
custom: ["https://wordtk.com/#contact"]
```

- The URL must be **quoted**. `https:` already contains a colon, and an unquoted colon breaks YAML.
- GitHub keeps the fragment: the Sponsor dropdown lists `https://wordtk.com/#contact`, so a click lands on the
  tip panel with the QR code instead of the homepage hero — one step fewer for someone who decided to pay.
- `custom` accepts up to four URLs, so a second channel (Alipay, GitHub Sponsors) can be added later without
  changing the shape of the file.
- The **Sponsorships** toggle under Settings → Features must also be on, otherwise the button never renders.
  That toggle is UI-only: the REST repository object exposes `has_issues`, `has_discussions`, … but nothing for
  funding, so it cannot be scripted and has to be clicked once per repository.

Checklist for a new repository:

1. Commit `.github/FUNDING.yml` (same two lines).
2. Settings → Features → **Sponsorships** → tick the box.
3. Confirm the repository page contains `"showSponsorButton":true`, then open the Sponsor dropdown and check it
   lists `https://wordtk.com/#contact`. Do this after the page has hydrated — clicking the checkbox too early
   lands on an unhydrated control and silently does nothing.

## Caching: three layers, three different jobs

The three things people usually conflate are kept apart on purpose.

| What | Where it is cached | TTL | Why |
| --- | --- | --- | --- |
| Images (`/media/*`) and other static files | Cloudflare edge **and** browser | 30 days, `immutable` | they never change; a new image gets a new `?v=` |
| `GET /api/projects` response | **nowhere** — `cache-control: no-store` | — | it is assembled per request, so it can never be stale |
| The GitHub API call | **KV** (shared namespace `common`, key `onblog:github:projects:v1`, binding `GITHUB_CACHE`) | 300 s success / 60 s fallback | this is the only expensive part — one call serves every visitor in every data centre |

So a request to `/api/projects` always does real work, but that work is usually a single KV read instead of
hitting GitHub:

```bash
curl -sI https://wordtk.com/api/projects | grep -iE 'x-projects|cache-control'
# cache-control: no-store
# x-projects-source: github      data provenance: github | snapshot
# x-projects-cache:  kv          kv (from KV) | miss (fetched just now)

curl -s https://wordtk.com/api/projects | jq .meta
# {"source":"github","cache":"kv","degraded":false,"generatedAt":"2026-10-23",
#  "storedAt":"2026-10-23T06:30:35.507Z","ttlSeconds":300}
```

If GitHub fails, the Worker serves the committed `public/data/projects.json` and writes it to KV for 60 s —
short enough to switch back to live data quickly, long enough that an outage does not cost every visitor a retry.
KV failures are non-fatal: the read falls back to "ask GitHub now", the write is skipped.

### Image cache busting

`public/_headers` gives `/media/*` thirty days and `immutable`, so browsers will not even revalidate. Every image
reference in the HTML therefore carries `?v=N`; **bump it when you replace an image**, or rename the file.
`npm run build` checks that each referenced file exists (query string stripped).

### The token is not optional in practice

Unauthenticated GitHub requests are limited to 60 per hour **per IP**, and Workers share egress IPs with every
other Worker in the same data centre — in testing the upstream call came back rejected and the site silently fell
back to the static snapshot (`x-projects-source: static`).

```bash
npx wrangler secret put GITHUB_TOKEN    # paste a fine-grained token with public-repo read only
```

Use a **fine-grained** token limited to public repositories (read-only). Do not reuse a personal `gh` token —
those usually carry `repo`/`delete_repo` scopes that a read-only homepage has no business holding. After the
secret is set, `x-projects-source` should read `github` on a cold cache and `edge`/`memory` afterwards.

`npm run data` is still the right command after adding or renaming a repository: it refreshes the fallback
snapshot and refreshes the README stats line. The live API picks the new repository up on its own within 5 minutes.

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

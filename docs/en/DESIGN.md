# Design notes

This site is a personal homepage that doubles as a business card: it should tell a stranger in ten seconds
what Martin builds, and give a returning visitor the fastest path to the tools themselves.

## The subject drives the design

The work has a strong signature already: small, local-first tools whose names carry a cat (Miaomiao Bar,
Miaomiao Notes, Maowo Blog). The cartoon direction is not decoration on top of a generic layout — it is the
vernacular of the subject. Everything on the page is drawn from that: a storybook paper surface, thick ink
outlines, offset hard shadows, stickers that sit at slight angles, and a hand-drawn cat-eared frame around the
real avatar.

## Color

| Token | Hex | Where |
| --- | --- | --- |
| `--paper` | `#FFF6E4` | page surface, plus a 22px dot grid |
| `--panel` | `#FFFCF2` | content panels |
| `--card` | `#FFFFFF` | project cards, buttons, chips |
| `--ink` | `#2B2622` | text, every border (3px), hard shadows |
| `--ink-2` | `#74695D` | secondary copy (5.1:1 on `--card`) |
| `--gold` | `#C99538` | the single accent: squiggle, tags, star pills |
| `--gold-soft` | `#F6D68E` | sticker fills (taken from the tip QR code) |
| `--sky` / `--mint` / `--blush` | `#D8EFFA` / `#DCF1E4` / `#FBE2E0` | three supporting category tints |

Gold is sampled from the WeChat tip QR code that ships with the site, so the donation card does not look
imported from somewhere else. Gold is never used for body text — it only fails contrast at that size.

## Type

- Display and body both come from system rounded faces: `ui-rounded` / SF Pro Rounded / Yuanti SC, with PingFang SC
  as the body face. **No webfonts.** A hosted font is the single easiest way to add 300KB and a render-blocking
  request for visitors in mainland China, and the brief asks for a page that loads instantly.
- The name is the only element set at poster scale (clamp to 118px) with a hand-drawn underline; everything else
  steps down through 26 / 19 / 16 / 14.5 / 13.5.
- Body copy stays under ~46 characters per line.

## Layout

```
┌ sticky bar: cat mark · Martin                 [GitHub] [中|EN] ┐
│                                                              │
│  Hi, I'm                    ╭──────────────╮               │
│  Martin (poster)            │  avatar      │ ← cat ears    │
│  signature (22ch)           │  ★ 4,110     │               │
│  one-paragraph intro        ╰──────────────╯               │
│  [See projects] [Say hello]                                  │
│                                                              │
│  ╭─ 关于我 ─────────────────────────────────────────╮        │
│  │ three paragraphs        │ toolbox chips            │        │
│  ╰────────────────────────────────────────────────────╯        │
│  ╭─ 开源项目 8 ───────────────────────────────────────╮        │
│  │ [All 7][Desktop apps 3][Libraries 1][Websites 2]   │        │
│  │ ┌────┐ ┌────┐ ┌────┐  ← cards with icon + stars    │        │
│  ╰────────────────────────────────────────────────────╯        │
│  ╭─ 项目时间线 ───────────────────────────────────────╮        │
│  │ 2026 ● tags …  2020 ●  …  2017 ● joined GitHub     │        │
│  ╰────────────────────────────────────────────────────╯        │
│  ╭─ 联系与赞赏 ───────────────────────────────────────╮        │
│  │ email + github            │ tip QR (tilted card)   │        │
│  ╰────────────────────────────────────────────────────╯        │
└ footer: updated date + copyright ─────────────────────────────┘
```

Section titles are file-folder tabs that overlap the panel border instead of the usual all-caps eyebrow, because
the tab encodes structure (which panel you are in) rather than decorating the heading. Panels are left-aligned
and the content column is capped at 1080px.

## Motion

One orchestrated entrance: hero blocks drop in with a short stagger, then cards and timeline nodes fade up once
on first scroll via `IntersectionObserver`. Hover only answers the pointer (cards lift 2px, QR card straightens).
`prefers-reduced-motion: reduce` removes all of it.

## Deliberate omissions

- **No dark mode.** A cream paper surface with ink outlines is the identity; a dark variant would need a second
  set of borders and shadows to keep the cartoon feel and would double the maintenance surface.
- **No frontend framework.** A small Node script (`scripts/render.mjs`) compiles the build snapshot into static
  HTML; what ships is plain HTML/CSS/JS.
- **No third-party badges, fonts, analytics or embeds on the page.** Only the README uses shields.io badges, where
  the cost is a README image request rather than a visitor's render path.
- **No invented stats.** Stars, forks and follower counts come from GitHub at build time; a single anonymous
  browser refresh (1-hour cache) keeps star/fork current, and silently falls back to the build numbers.

## Bilingual copy

Every translatable node in `public/index.html` carries `data-en` and `data-zh`; `public/app.js` swaps
`textContent` and persists the choice in `localStorage` (`onblog:lang`), defaulting to the browser language.
Project data carries `descEn` / `descZh` split from the repository description at the first CJK character.
UI chrome strings that only exist in JS (filter labels, "Live demo") are kept in the same two languages.

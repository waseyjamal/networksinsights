# 0028. Design system "Signal"

Status: Accepted
Date: 2026-09-20

## Context

The site starts at 500+ tools and grows without limit, so every page must look and behave the same without each one inventing its own styles. ADR 0005 chose Tailwind CSS 4 with design tokens and left the design system to Mission 6. The system has to be premium and calm, fast (no layout shift, almost no JavaScript), accessible (WCAG 2.2 AA), and usable from Astro (zero JavaScript) and from React islands without duplicating styles. This ADR refines ADR 0005; it does not supersede it.

## Decision

### Concept

"Signal": networks (connected nodes) plus insights (clarity, light). Quiet and highly readable wherever tools are used; expressive only in four brand moments: the hero network constellation with an aurora glow, the command-bar glass, the category bento grid, and the glow border of the main tool workspace card.

### Tokens (`apps/web/src/styles/tokens.css`)

Tokens live in Tailwind v4 `@theme`, in OKLCH, for light and dark. The file has four parts:

1. `@theme static`: the same in both themes. Palette (electric indigo, violet, cyan, a cool slate whose dark end is a deep navy-black, never pure black), radius scale, fluid type scale with `clamp()`, motion durations, the brand gradient. Tailwind's default palette is removed (`--color-*: initial`).
2. `@theme inline` (the bridge): exposes each theme-switching token as a Tailwind utility (`bg-surface`, `text-fg`).
3. Light values as runtime variables on `:root` and `[data-theme="light"]`.
4. Dark values, written once as a `@utility theme-dark` and applied with `@apply` to `[data-theme="dark"]` and to `:root` when `data-theme="system"` and the OS prefers dark.

Theme-switching tokens: surfaces (`bg`, `surface`, `surface-raised`, `surface-sunken`), borders, text (`fg`, `fg-muted`, `fg-subtle`), brand (`brand`, `brand-ui`, `brand-text`, `brand-soft`, `ring`, ...), semantic `success`, `warning`, `danger`, `info` (each with `-soft` and `-text`), glass, and eleven category accents (`pdf`, `image`, `video-audio`, `text`, `calculators`, `converters`, `generators`, `developer`, `web-seo`, `color-design`, `date-time`). Shadows are also per theme: subtle layered shadows in light, a hairline border plus inner glow in dark.

Why runtime variables plus a bridge, and not `light-dark()`: `light-dark()` needs Safari 17.5, which would drop iPhones stuck on iOS 16. With variables, the browser floor stays the one Tailwind sets (below). The trade-off is a bridge list, and `tokens.test.ts` fails if a token is missing from the bridge, the light block or the dark block. Components use the runtime variable (`var(--surface)`), not the bridged `--color-surface`, because only the runtime variable is re-resolved inside a `data-theme` subtree.

Rules (`docs/design-system.md`, enforced by `guards.test.ts`): no raw color values outside `tokens.css`; category accents only as small icon tints; the brand gradient only in brand moments and never behind body text.

### Accessibility of the tokens

Every text/background pair meets WCAG 2.2 AA (4.5:1 body text, 3:1 large text and UI parts) in both themes. `contrast-pairs.ts` lists 131 pairs; `tokens.test.ts` checks them, plus the aurora overlap, the glass surface (over the page and over the brand color) and the tinted category chips. The OKLCH to sRGB converter is validated before its results are trusted (`color.test.ts`): 9 conversions match Chromium, Firefox and WebKit (they agree with each other within 1/255), the five sRGB primaries match the values published by the author of OKLab, and known WCAG ratios (21:1, 4.54:1, 4.48:1) are reproduced. All colors are inside the sRGB gamut, so the converter never has to guess about gamut mapping.

### Fonts

Geist (UI and headings) and Geist Mono (numbers, code, file sizes), both SIL Open Font License 1.1. The license text was read in the installed `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages (5.3.0): "Copyright 2024 The Geist Project Authors ... licensed under the SIL Open Font License, Version 1.1".

They are self-hosted through Astro's built-in Fonts API, variable weight 100 to 900, Latin subset, `font-display: swap`, with metric-matched fallbacks (Astro generates `size-adjust`, `ascent-override` and `descent-override` fallbacks for Arial and Courier New). Only Geist is preloaded; Geist Mono relies on its fallback. Files are 29,400 B (Geist) and 23,128 B (Geist Mono).

Deviation from the approved plan: the plan named Astro's `npm` font provider. In Astro 7.3.2 that provider reads the CSS from `node_modules` but rewrites every font URL to `cdn.jsdelivr.net` and downloads the files at build time (`resolveFromLocal` in unifont 0.7.5), even with `remote: false`, and it does not apply the `subsets` filter (it also pulled the Cyrillic file). So the build is not offline and the served bytes are not the lockfile's bytes. We use Astro's `local` provider instead, pointing at `geist-latin-wght-normal.woff2` and `geist-mono-latin-wght-normal.woff2` inside the two pinned packages. Same packages, versions and licenses; no network at build time.

### Components: one styling source

All component styles are in `components.css`, with tokens only. The Astro components (`components/ui/*.astro`) and the React components (`components/ui/react/*.tsx`) emit the same class names, `data-*` attributes and ARIA, both through the helpers in `attrs.ts`. `parity.test.ts` renders both with the same input and fails if the markup differs. Shared components have no `<style>` block.

Built: Button (primary, secondary, ghost, danger; sizes; loading), Input, Textarea, Select, Checkbox, Switch, Badge, Card, Tabs, Tooltip, Kbd, Alert, Progress, Skeleton, Dropzone (visual only), ThemeToggle, and the signature elements: hero constellation, command bar, category bento grid, tool workspace card. Accessibility follows the WAI-ARIA Authoring Practices: visible focus rings, keyboard support, roving tabindex and arrow keys in Tabs, Esc to dismiss Tooltips (WCAG 1.4.13), native inputs for Checkbox and Switch, a real file input inside the Dropzone label, and a `forced-colors` fallback. No component library and no new runtime dependency.

Tabs and Tooltip carry a small script in their Astro versions (bundled only on pages that use them). ThemeToggle is not an island: it is three native radio buttons handled by the head script, hidden when JavaScript is off.

### Theme

Follows the system by default, with a manual light / dark / system toggle stored in `localStorage` (`ni-theme`). `<html>` starts as `data-theme="system"`, so pages work without JavaScript. A static inline script in `<head>` (1,493 B, 559 B gzip) sets `data-theme` before first paint, keeps the two `theme-color` metas in step with a manual choice, and handles the toggle. It has no interpolation, so Mission 12 can hash it for CSP. `Base.astro` also sets `<meta name="color-scheme" content="light dark">` and a `theme-color` meta for each scheme, with hex values derived from the `--bg` tokens.

### Motion

CSS only. Hover, press and focus feedback takes 120 to 250 ms and animates only `transform`, `opacity` and color. Under `prefers-reduced-motion: reduce` every animation and transition is switched off (one unlayered rule in `base.css`), including the constellation and aurora. Cross-page View Transitions are pure CSS (`@view-transition { navigation: auto }` inside `prefers-reduced-motion: no-preference`), a progressive enhancement; we do not use Astro's `<ClientRouter />`, which would add JavaScript to every page.

The constellation is inline SVG with a fixed seed (identical output on every build), `aria-hidden`, and never the LCP element (measured: the LCP element is a paragraph).

### Browser floor

The floor is set by Tailwind CSS v4. From https://tailwindcss.com/docs/compatibility, read on 2026-09-20: "Tailwind CSS v4.0 is designed for and tested on modern browsers, and the core functionality of the framework specifically depends on these browser versions": **Chrome 111** (March 2023), **Safari 16.4** (March 2023), **Firefox 128** (July 2024). The page names v4.0 and gives no different floor for later 4.x releases; the installed version is 4.3.3. Everything we add on top is either inside that floor (`oklch()`, `color-mix()`, `@layer`, `:has()`) or a progressive enhancement that older browsers ignore (View Transitions, `backdrop-filter` with a solid fallback, `prefers-reduced-transparency`, `mask-image` fade).

### Dependencies (dev only, exact versions, none ships to visitors)

| Package | Version | License | Why |
|---|---|---|---|
| `@fontsource-variable/geist` | 5.3.0 | OFL-1.1 | Geist font file (Latin, variable) |
| `@fontsource-variable/geist-mono` | 5.3.0 | OFL-1.1 | Geist Mono font file (Latin, variable) |
| `@axe-core/playwright` | 4.13.0 | MPL-2.0 | Accessibility scan in the E2E tests |
| `axe-core` (transitive) | 4.13.0 | MPL-2.0 | The scan engine |

MPL-2.0 is not on the banned list of ADR 0017 (AGPL, GPL, SSPL, non-commercial). It is file-level weak copyleft; axe is used unmodified as test tooling and is never bundled or served, so no MPL obligation reaches the product. The owner approved it on 2026-09-20. All four were published more than 3 days before install (ADR 0019); none has an install script, so `allowBuilds` stays denied. Size impact: the two font packages are 181 KB and 172 KB unpacked, `@axe-core/playwright` 47 KB and `axe-core` 3.1 MB, all dev-only. Their only effect on shipped bytes is the two font files above.

Tooling change: Biome's CSS parser needs `css.parser.tailwindDirectives: true` in `biome.json` to read `@theme`, `@utility` and `@apply` (ADR 0010).

## Budgets and measured results

| Budget | Limit | Measured |
|---|---|---|
| Design CSS on `/design-system` (all stylesheets and inline `<style>`) | 30 KB compressed | 54,815 B raw, **10,943 B gzip, 9,425 B brotli** |
| Preloaded font files | at most 2 | **1** (Geist) |
| Font bytes on `/design-system` | n/a | **52,528 B** in 2 files |
| Home page JavaScript | no new JavaScript except the theme script | 69,187 B gzip in 4 files against 68,991 B before this mission (+196 B from chunk splitting, nothing new); plus the inline theme script, 559 B gzip |
| CLS on `/design-system` | at most 0.1 | **0.0001**, also with fonts delayed by 1,200 ms |
| Axe (WCAG 2.2 A and AA) | zero violations | **0 violations**, light and dark, Chromium, Firefox and WebKit |

Axe marks 16 `color-contrast` checks "incomplete" (it cannot compute a background): text over the hero aurora and constellation, text on the command-bar glass, and the workspace card, whose gradient border confuses it. Those cases are covered by the token tests instead (aurora overlap, glass over the page and over the brand color, text on `surface`).

Observed and not resolved: Playwright's WebKit build reports a different number of font requests from run to run. In 4 runs it reported 3 requests (the preloaded Geist file twice, 81,928 B), 3 requests, 2 requests (52,528 B) and 1 request (29,400 B). Chromium always reports 2 requests and Firefox 1 or 2, never a duplicate. So a WebKit double download of the preloaded file happens sometimes and is not reproducible on demand. It is not confirmed in real Safari, so the preload stays; `budgets.spec.ts` counts unique files for the byte budget and skips the once-per-file check on WebKit.

## Amendments

- **Constellation strength (Mission 7).** Measuring the pixels behind the hero text showed that a constellation node could drop muted text to about 3:1 (light) and 3.3:1 (dark), and the aurora test did not cover nodes. Nodes and links are now capped by a token, `--constellation-alpha: 0.25`, which `.ni-constellation` uses as its opacity (links are drawn at 60% of it, so they stay visible). `tokens.test.ts` checks the worst case, a node at that alpha over the page with all three aurora glows, against `--fg` in both themes, and hero text is set in `--fg` (the hero subtitle is `text-fg`); `guards.test.ts` keeps `--fg-muted` and `--fg-subtle` out of `<Hero>`. The glass test now covers every page surface and glass on glass (the site header's command bar).

## Consequences

- One CSS file styles every component, so a visual change happens in one place, and the tests stop light and dark, Astro and React, or the rules from drifting.
- Adding a token or component has a fixed checklist (`docs/design-system.md`); `AGENTS.md` now requires tokens and existing components, and new components go into the design system first.
- The site CSS is one global stylesheet (about 11 KB gzip), so the home page also carries the component styles it does not use yet. That is the price of a single cacheable file, and it is far under the budget.
- The token files need a bridge list, which is more to write than `light-dark()` but keeps Safari 16.4 working.
- The E2E suite is slower (about 4 minutes for three browsers).

## Revisit when

- Tailwind publishes a different browser floor, or the site decides to drop Safari 16.x. Then `light-dark()` can replace the bridge.
- Astro's `npm` font provider serves files from `node_modules` without the CDN, or applies `subsets`. Then the provider choice can be reconsidered.
- The measured CSS approaches 30 KB compressed. Then split tool-only styles from the global sheet.
- Mission 12 needs the theme script hashed: keep it static.

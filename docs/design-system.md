# Design system: Signal

How to build UI on NetworksInsights. Read this before you write any markup or style. The decision record is [ADR 0028](adr/0028-design-system-signal.md). The living reference is the page `/design-system` (noindex), which shows every token and component in both themes.

## The rule

**UI must use design tokens and existing components. New components go into the design system first.**

If you need something that does not exist, add it to the design system in its own change (see [Adding a component](#adding-a-component)), then use it. Never style a one-off in a tool page.

## Concept

Signal is networks (connected nodes) plus insights (clarity, light). It is premium, modern, calm and fast.

- **Quiet where tools are used.** Tool pages are neutral, readable and fast. Color is for meaning, not decoration.
- **Expressive in a few brand moments.** The hero constellation and aurora, the command bar glass, the category bento grid, and the glow border of the main tool workspace card. Nothing else gets a glow, gradient or animation.

## Where things live

| What | Where |
|---|---|
| Tokens (color, type, radius, depth, motion) | `apps/web/src/styles/tokens.css` |
| Element defaults, focus ring, reduced motion | `apps/web/src/styles/base.css` |
| Every component style | `apps/web/src/styles/components.css` |
| Astro components (no JavaScript) | `apps/web/src/components/ui/*.astro` |
| React components (for islands) | `apps/web/src/components/ui/react/*.tsx` |
| Markup contract shared by both | `apps/web/src/components/ui/attrs.ts` |
| Icon paths | `apps/web/src/components/ui/icons.ts` |
| Category list | `apps/web/src/data/categories.ts` |
| Style guide page | `apps/web/src/pages/design-system.astro` |

Styles live in **one** place, `components.css`. The Astro and React versions of a component only emit markup: the same class names, `data-*` attributes and ARIA. A test renders both and fails if they differ.

## Tokens

### How they are defined

`tokens.css` has four parts. All colors are OKLCH.

1. **`@theme static`**: values that are the same in both themes. The palette (`--color-indigo-500`, `--color-slate-900`, ...), radius, type scale, motion, brand gradient. Tailwind's default palette is removed on purpose.
2. **`@theme inline` (the bridge)**: turns each theme-switching token into a Tailwind utility (`--color-surface: var(--surface)` gives `bg-surface`).
3. **Light values** on `:root` and `[data-theme="light"]`: the runtime variables (`--surface`, `--fg`, `--brand`, ...).
4. **Dark values**, written **once** as the `theme-dark` utility, applied to `[data-theme="dark"]` and to `:root` when the theme is `system` and the OS prefers dark.

`tokens.test.ts` fails if any color token is missing from the bridge, the light block or the dark block, so the sets cannot drift apart.

### Using tokens

| Where | Use | Example |
|---|---|---|
| Page markup (Tailwind utilities) | theme utilities | `bg-surface text-fg border-border` |
| Component CSS | runtime variable | `background: var(--surface)` |
| Radius, type, motion | static tokens | `rounded-2xl`, `text-lg`, `var(--duration-base)` |

Use the runtime variable (`var(--surface)`), never the bridged `var(--color-surface)`: only the runtime variable is re-resolved inside a `data-theme` subtree.

Do not use Tailwind's `dark:` variant. Tokens already switch with the theme.

### Semantic tokens

| Group | Tokens |
|---|---|
| Surfaces | `bg`, `surface`, `surface-raised`, `surface-sunken` |
| Borders | `border` (decorative), `border-strong` (control edges, 3:1) |
| Text | `fg`, `fg-muted`, `fg-subtle`, `inverse`, `inverse-fg` |
| Brand | `brand`, `brand-hover`, `brand-active`, `brand-fg` (button), `brand-ui`, `brand-ui-fg` (checked controls, progress), `brand-text` (links), `brand-soft`, `brand-soft-fg`, `ring` |
| Status | `success`, `warning`, `danger`, `info`, each with `-soft` (background) and `-text`; `danger-solid`, `danger-solid-hover`, `on-danger` for the danger button |
| Glass | `glass`, `glass-border` |
| Category accents | `cat-pdf`, `cat-image`, `cat-video-audio`, `cat-text`, `cat-calculators`, `cat-converters`, `cat-generators`, `cat-developer`, `cat-web-seo`, `cat-color-design`, `cat-date-time` |

### Color rules

1. **No raw color values in components or pages.** No hex, `rgb()`, `hsl()`, `oklch()`, Tailwind palette classes (`bg-red-500`) or arbitrary color classes (`bg-[#fff]`). Only tokens. Raw values live in `tokens.css` alone.
2. **Category accents are small icon tints only.** Set `data-cat="pdf"` on a container and use the `.ni-icon-tint` chip. Never use an accent for text, backgrounds of large areas, borders or buttons.
3. **The brand gradient is for brand moments only** (hero glow, gradient borders). Never behind body text. Today only `.ni-workspace` uses it.
4. **Palette variables (`--color-*`) are for brand moments only** (aurora, constellation). Everything else goes through the semantic tokens.
5. **Every text/background pair meets WCAG 2.2 AA**: 4.5:1 for body text, 3:1 for large text and UI parts. `src/lib/contrast-pairs.ts` lists the pairs; `tokens.test.ts` checks them in both themes; the style guide prints the measured ratios.

`guards.test.ts` enforces rules 1 to 4.

### Adding or changing a token

1. Add it to the bridge, the light block and the dark block (colors), or to `@theme static` (theme-independent).
2. If text or a UI part will sit on it, add the pair to `contrast-pairs.ts`.
3. Run `pnpm test`. Fix any contrast failure by changing the token, not the threshold.
4. Check it on `/design-system`.

## Typography

- **Geist** for UI and headings, **Geist Mono** for numbers, code and file sizes. Both are SIL Open Font License 1.1, self-hosted, variable weight 100 to 900, Latin subset.
- Use `font-mono tabular-nums` for numbers that line up (sizes, counts, prices).
- Fluid scale with `clamp()`: `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`, `text-display`. `h1` to `h4` are already styled. Display headings are bold with tight tracking.
- Body text is at least `text-base`. Use `text-sm` for secondary text and `text-xs` only for labels and badges.

## Shape, depth and motion

- **Radius:** `xs` to `3xl`, plus `full`. Cards use `2xl`; the workspace card uses `3xl`.
- **Depth:** `--shadow-xs` to `--shadow-lg`. In light mode they are subtle layered shadows; in dark mode they are a hairline border plus an inner glow. Use the token, never a hand-written `box-shadow`.
- **Glow border:** one treatment, `.ni-workspace`, reserved for the main tool workspace card. Do not reuse it.
- **Motion:** 120 to 250 ms (`--duration-fast`, `--duration-base`, `--duration-slow`), `--ease-standard` or `--ease-out-soft`. Animate only `transform`, `opacity` and color. All animation and transition is switched off under `prefers-reduced-motion` (`base.css`); you do not need to add anything.
- **Page transitions:** cross-page View Transitions are pure CSS (`@view-transition`), a progressive enhancement that older browsers ignore. Do not add a JavaScript router for it.

## Theme

- Follows the system by default. The toggle offers light, dark and system and stores the choice in `localStorage` (`ni-theme`).
- A tiny inline script in `<head>` (`Base.astro`) sets `data-theme` on `<html>` before first paint, so there is no flash of the wrong theme. It is static so Mission 12 can hash it for CSP. Do not add interpolation to it.
- `<html>` starts as `data-theme="system"`, so pages work without JavaScript.
- Any element can carry `data-theme="light"` or `data-theme="dark"` to force a theme for its subtree. The style guide uses this to show both themes at once.
- Add one `<ThemeToggle id="...">` per place it appears. Each toggle needs a unique `id`.

## Components

Import Astro components from `components/ui/`, React components from `components/ui/react`.

| Component | Astro | React | Notes |
|---|---|---|---|
| Button | `Button` | `Button`, `ButtonLink` | `variant` primary, secondary, ghost, danger; `size` sm, md, lg; `loading` |
| Input, Textarea, Select | yes | yes | `id` is required. `label`, `hint`, `error` wire up `aria-describedby` and `aria-invalid` |
| Checkbox, Switch | yes | yes | Native inputs, so keyboard and screen readers work |
| Badge | yes | yes | `tone` neutral, brand, success, warning, danger, info |
| Card | `Card` (`href` for a link) | `Card`, `CardLink` | |
| Tabs | `Tabs` + `TabPanel` | `Tabs` | WAI-ARIA Tabs: arrow keys, Home, End, roving tabindex |
| Tooltip | yes | yes | The trigger must carry `aria-describedby={id}`. Esc dismisses |
| Kbd, Alert, Progress, Skeleton | yes | yes | Progress needs a `label` |
| Dropzone | yes | yes | Visual only for now |
| ThemeToggle | yes | no | Uses the head script |
| Icon | yes | yes | Decorative (`aria-hidden`). Put the meaning in text |
| ToolWorkspace | yes | yes | Glow border, dropzone, actions, result, privacy badge |
| CommandBar, Hero, Constellation, BentoGrid, CategoryTile | yes | no | Signature elements |

The privacy badge text is fixed: "Runs in your browser — files never leave your device".

### Accessibility checklist

Every component must have: a visible focus ring (from `base.css`, do not remove it), full keyboard support, correct ARIA per the WAI-ARIA Authoring Practices, target size of at least 24 by 24 CSS pixels, and no information conveyed by color alone. `/design-system` runs an axe scan in both themes in CI with zero violations allowed.

### Adding a component

1. Write its styles in `components.css`, inside `@layer components`, with tokens only.
2. Put its markup contract (class name, `data-*`, ARIA) in `attrs.ts`.
3. Build the Astro component and the React component; both call the helper from `attrs.ts`. Do not add a `<style>` block to a shared component.
4. Add a case to `parity.test.ts`.
5. Show it, with every state, on `/design-system`.
6. Update the table above.

## What the tests enforce

| Test | Guarantees |
|---|---|
| `color.test.ts` | The OKLCH to sRGB converter matches browser engines and published references |
| `tokens.test.ts` | Light and dark parity, gamut, WCAG contrast of every pair |
| `guards.test.ts` | No raw colors, gradient and accent rules, one style source |
| `parity.test.ts` | Astro and React emit the same markup |
| `Base.test.ts` | Theme script, `color-scheme` meta, `theme-color` metas |
| `e2e/design-system.spec.ts` | No console errors, axe zero violations in light and dark, reduced motion, toggle persistence, theme before first paint |
| `e2e/budgets.spec.ts` | CSS size, font preloads, home page JavaScript, CLS, LCP |

## Budgets

| Budget | Limit |
|---|---|
| Design CSS on `/design-system` | 30 KB compressed |
| Preloaded font files | 2 (today: 1) |
| Home page JavaScript | no new JavaScript except the theme script |
| CLS on `/design-system` | at most 0.1 (Core Web Vitals "good") |

## Browser support

The floor is set by Tailwind CSS v4: Chrome 111, Safari 16.4, Firefox 128. See ADR 0028. Everything above that floor is a progressive enhancement (View Transitions, `backdrop-filter`, `prefers-reduced-transparency`).

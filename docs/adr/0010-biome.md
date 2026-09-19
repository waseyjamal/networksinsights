# 0010. Biome for lint and format

Status: Accepted
Date: 2026-09-19

## Context

The project needs one linter and formatter.

## Decision

Use Biome for lint and format. It was set up in Mission 3 (2026-09-20).

- `@biomejs/biome` 2.5.14 is a root devDependency at an exact version.
- `biome.json` at the repo root: 2-space indent, LF, line width 100; linter with `preset: "recommended"` (`rules.recommended` is deprecated in 2.5.14); VCS integration with git and `useIgnoreFile`, so `.gitignore` is respected; `public/` folders are excluded because they hold static assets served as-is.
- Astro support is switched on with `html.experimentalFullSupportEnabled` and `html.formatter.enabled`. `html.formatter.selfCloseVoidElements` is `always`, to keep the existing `<meta ... />` style.
- Scripts: `pnpm lint` (`biome check .`, no writes) and `pnpm fix` (`biome check --write .`, safe fixes only).

What Biome covers in `.astro` files:

- Frontmatter: linted, formatted, imports organized. It understands TypeScript, and an import used only in the template is not reported as unused.
- `<script>` blocks, including `is:inline` and TypeScript: linted and formatted.
- `<style>` blocks: linted and formatted as CSS.
- Template: expressions such as `{a == b}` are linted, accessibility rules apply to elements (`useAltText`, `useHtmlLang`, `useButtonType`, `useValidAnchor`), and the markup is formatted.

What it does not cover:

- Type checking. `astro check` does that (`pnpm typecheck`).
- Astro-specific rules `noAstroSetHtmlDirective` and `useAstroClientOnlyDirectiveValue`. They are not in the recommended preset, so they are off.
- Guaranteed stability. Biome's own language table marks Astro parsing, formatting and linting as partial.

Biome does not handle Markdown or YAML at all, so those files are not checked.

## Consequences

Lint and format are enforced by `pnpm check` and by the git hooks (ADR 0024). Because Astro formatting is partial, a Biome upgrade can produce a formatting-only diff in `.astro` files.

## Revisit when

Biome removes the `experimental` label from Astro support, or a Biome release changes how `.astro` files are formatted or linted.

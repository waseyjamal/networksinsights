# 0065. Override source-map-js and smol-toml to their patched versions

Status: Accepted
Date: 2026-10-06

## Context

`pnpm audit --audit-level moderate` fails on two advisories, both with patched versions:

- GHSA-68fv-2mgg-jv7q (high): `source-map-js` from 1.0.0 to 1.2.1 allows an event-loop denial of service. The lockfile resolves 1.2.1 through `vitest > vite > postcss` and `astro > magicast`. Patched in 1.2.2.
- GHSA-r4xh-jqrq-34v2 (moderate): `smol-toml` up to 1.8.0 parses some keys in quadratic time. The lockfile resolves 1.8.0 through `@astrojs/mdx > @astrojs/internal-helpers` and `astro > @astrojs/internal-helpers`. Patched in 1.9.0.

Both are build-time and test-time packages. Neither reaches a visitor.

## Decision

Pin each exact vulnerable version to the exact patched one in `overrides` (`pnpm-workspace.yaml`), as ADR 0056 did for devalue:

- `"source-map-js@1.2.1": "1.2.2"`: BSD-3-Clause, published on npm 2026-09-30, a patch release. Its dependants ask for `^1.2.1` (postcss, magicast), so 1.2.2 satisfies them.
- `"smol-toml@1.8.0": "1.9.0"`: BSD-3-Clause, published on npm 2026-09-22, a minor release with no major jump. `@astrojs/internal-helpers` asks for `^1.6.0`, so 1.9.0 satisfies it.

Both are past the three-day `minimumReleaseAge`, and `pnpm install` resolved them without bypassing it. `pnpm audit --audit-level moderate` passes. It still reports any other advisory, and it still prints the ignored GHSA-ch52-4w7c-c8xp (ADR 0059), which this decision does not change.

magicast 0.5.5 also bundles its own copy of `source-map-js` 1.2.1 inside its built files (its `inlinedDependencies`). No override can replace a bundled copy, and `pnpm audit` does not see it. Astro uses magicast only for config editing in its CLI (`astro add`), which neither the build nor CI runs.

## Remove when

Each override can go when its dependants resolve the patched version on their own. For `source-map-js`, that means postcss through Vite and Vitest, and magicast through Astro, resolve 1.2.2 or later. For `smol-toml`, it means `@astrojs/internal-helpers` through Astro resolves 1.9.0 or later. Then delete the override and its comment, run `pnpm install` and `pnpm audit --audit-level moderate`, and note the removal here.

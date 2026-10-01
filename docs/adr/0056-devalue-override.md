# 0056. Override devalue to 5.9.4 until Astro ships the fix

Status: Accepted
Date: 2026-10-01

## Context

`pnpm audit --audit-level moderate` failed on `main`. Every finding is in `devalue` 5.9.2, which `astro` 7.3.2 resolves (also through `@astrojs/mdx`): GHSA-j22f-vq7h-c4qm, GHSA-mcm9-63f2-9j32, GHSA-x5rw-q4pp-hg5g, GHSA-hx4r-w6wj-j8fg, GHSA-4q55-j62x-fr9h and one low advisory. All are patched in `devalue` 5.9.3 or later. `@astrojs/react` 7.0.0 already resolves 5.9.4, so the lockfile already held the fixed version.

## Decision

Add the pnpm override `"devalue@5.9.2": "5.9.4"` in `pnpm-workspace.yaml`, the same way ADR 0025's undici override works. Version 5.9.4 is the exact version, MIT licensed, published on 2026-09-18 (older than `minimumReleaseAge`), and inside Astro's declared range (`^5.8.1`). It adds no new package to the lockfile. `minimumReleaseAge` is not bypassed.

## Remove when

Astro ships a release whose `devalue` dependency resolves to 5.9.3 or later. Then delete the override and run `pnpm audit --audit-level moderate`.

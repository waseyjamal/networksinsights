# umami-tracker.js

A byte-for-byte copy of the analytics tracker that Umami Cloud serves (ADR 0051). It is served from
our own origin so the Content-Security-Policy keeps `script-src 'self'`.

| | |
|---|---|
| Source | https://cloud.umami.is/script.js, downloaded 2026-09-27 |
| Version | Umami v3.4.0 (released 2026-09-17): `src/tracker/index.ts` built with `COLLECT_API_HOST=https://gateway.umami.is` |
| SHA-256 | `91a876d767646fd5b7701b6fabf97f8a99ae53b94e7e5b58d465bad1e5d763e0` |
| Size | 4,810 B raw, 2,343 B gzip |
| Licence | MIT, Copyright (c) 2022 Umami Software, Inc. https://github.com/umami-software/umami/blob/v3.4.0/LICENSE |

Biome skips this file, and no one edits it. `TRACKER` in `src/config/analytics.ts` holds the same
version and hash. `config/analytics.test.ts` and `pnpm check:budgets` fail if the file, or the copy
the build writes, differs.

## Updating it

1. Wait until the new Umami release is at least three days old (the repository's release-age
   rule), and read its changelog for tracker changes.
2. Download `https://cloud.umami.is/script.js` over this file. Do not reformat it.
3. Read the whole file. Check that it still sends only to `https://gateway.umami.is/api/send`,
   without credentials, sets no cookies and writes nothing to storage, and that the `data-*`
   settings in `components/layout/Analytics.astro` still exist.
4. Update the table above and `TRACKER` (version and `sha256sum` of the file).
5. Run `pnpm check`, `pnpm build` with `UMAMI_WEBSITE_ID` set to any UUID, `pnpm check:budgets`
   and `pnpm test:e2e`, then open a pull request.

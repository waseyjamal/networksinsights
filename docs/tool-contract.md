# Tool contract

Status: DRAFT (finalized in Mission 8)

Every tool is one folder that follows this contract. The platform builds everything else from it.

## Folder anatomy

```
tools/<category>/<tool-id>/
  tool.config.ts    manifest
  logic.ts          pure functions (no UI or framework imports)
  worker.ts         optional, for the worker runtime
  ui.tsx            island
  content/en.mdx    unique how-to, examples, limits, FAQs
  logic.test.ts     required
```

## Manifest fields

| Field | Notes |
|---|---|
| `id` | Unique. Also the URL slug. |
| `category` | Used for listings only, never for the URL. |
| `tags` | |
| `runtime` | `"client"` \| `"worker"` \| `"server"` |
| `status` | `"beta"` \| `"stable"` \| `"deprecated"` |
| input schema | Zod |
| related tool ids | |
| `limits` | For a future Pro tier. Unlimited at launch. |
| added date | |

## Generated from the manifest

- Page and URL
- Category listing
- Sitemap entry
- Search index entry
- Structured data
- Share image
- Breadcrumbs
- Related links
- New-tools feed
- `llms.txt` entry

## Build-time gates

The build fails if any of these fail:

- Unique id and URL.
- No collision with reserved paths.
- Required content sections present.
- No near-duplicate content.
- Tests exist and pass.
- JavaScript size budget respected.
- Translations complete for enabled languages.

## URL rule

A tool lives at `/<tool-id>` at the site root, independent of its category. Renames go through a redirects registry so no URL ever returns 404.

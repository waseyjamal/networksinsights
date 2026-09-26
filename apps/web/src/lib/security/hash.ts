// CSP hash sources (ADR 0047). A browser hashes the exact text between <script> and </script>
// (or <style> and </style>), so the text hashed here must be the text the page carries.

import { createHash } from "node:crypto";

/** `'sha256-…'` without the quotes, the form Astro's config and the policy use. */
export function cspHash(source: string): `sha256-${string}` {
  return `sha256-${createHash("sha256").update(source, "utf8").digest("base64")}`;
}

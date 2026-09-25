// Writes dist/_headers after every build (ADR 0047, ADR 0048).
//
// Astro computes the Content-Security-Policy, with the hashes of our inline scripts and styles,
// and writes it into each page as a <meta>. A <meta> policy is not enough on its own: it does not
// cover what comes before it in <head>, and it cannot carry frame-ancestors. So this integration
// reads the policy back out of the built pages and sends it as a header too, with every other
// header from config/headers.ts. Astro can only hand headers to an adapter, and the site has none.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { headerRules, readPage, renderHeadersFile } from "../lib/security/headers-file";

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** dist/tools/index.html is /tools/, dist/404.html is /404.html. */
function pathOf(root: string, file: string): string {
  const rel = relative(root, file).split(sep).join("/");
  if (rel === "index.html") return "/";
  return rel.endsWith("/index.html") ? `/${rel.slice(0, -"index.html".length)}` : `/${rel}`;
}

export function securityHeaders(): AstroIntegration {
  return {
    name: "networksinsights:security-headers",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const pages = await Promise.all(
          (await htmlFiles(root)).map(async (file) =>
            readPage(pathOf(root, file), await readFile(file, "utf8")),
          ),
        );
        const rules = headerRules(pages);
        await writeFile(join(root, "_headers"), renderHeadersFile(rules));
        logger.info(`_headers written: ${rules.length} rules for ${pages.length} pages`);
      },
    },
  };
}

// Writes dist/sw.js after every build (ADR 0052), from lib/pwa/service-worker.ts and the settings
// lib/pwa/sw-build.ts reads out of the built files. The dev server has no service worker.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { buildConfig, renderServiceWorker } from "../lib/pwa/sw-build";

const SOURCE = fileURLToPath(new URL("../lib/pwa/service-worker.ts", import.meta.url));

export function serviceWorker(): AstroIntegration {
  return {
    name: "networksinsights:service-worker",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const config = buildConfig(root);
        await writeFile(
          join(root, "sw.js"),
          renderServiceWorker(await readFile(SOURCE, "utf8"), config),
        );
        logger.info(
          `sw.js written: build ${config.version}, ${config.shell.length} files in the shell, ${Object.keys(config.graph).length} files with imports`,
        );
      },
    },
  };
}

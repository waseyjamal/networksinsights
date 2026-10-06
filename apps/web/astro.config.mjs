// @ts-check

import { fileURLToPath } from "node:url";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";
import { csp } from "./src/config/headers.ts";
import { securityHeaders } from "./src/integrations/security-headers.ts";
import { serviceWorker } from "./src/integrations/service-worker.ts";
import { cspHash } from "./src/lib/security/hash.ts";
import { themeScript } from "./src/lib/theme-script.ts";

// Fonts: Geist and Geist Mono (SIL OFL 1.1), self-hosted by Astro's Fonts API. The files are
// the Latin variable-weight woff2 files of two pinned @fontsource-variable packages, read
// straight from node_modules by the `local` provider: no network at build time, and the exact
// bytes are fixed by the lockfile. (Astro's `npm` provider was tried first; it rewrites the
// file URLs to cdn.jsdelivr.net and downloads them at build time. See ADR 0028.)
// Astro adds metric-matched fallbacks, so the swap from fallback to Geist does not shift layout.
const local = fontProviders.local();

// https://astro.build/config
export default defineConfig({
  // One canonical form for every URL: /tools/, never /tools. Dev, build, preview and every link
  // agree, so an internal link never costs a redirect. Cloudflare redirects the slashless form.
  trailingSlash: "always",
  // MDX renders every tool's content/en.mdx (ADR 0033). It is not used anywhere else: the site's
  // own pages are .astro, so no page gains JavaScript from this.
  // securityHeaders writes dist/_headers from the built pages' policy and config/headers.ts.
  // serviceWorker writes dist/sw.js from the built files (ADR 0052).
  integrations: [react(), mdx(), securityHeaders(), serviceWorker()],
  // Content-Security-Policy with hashes for every inline script and style (ADR 0047). Astro writes
  // it into each page as a <meta>; the integration above sends the same policy as a header.
  security: {
    csp: {
      directives: [...csp.directives],
      // Astro hashes the scripts it bundles, not is:inline ones: the theme script is added here.
      scriptDirective: { resources: [...csp.scriptResources], hashes: [cspHash(themeScript)] },
      styleDirective: {
        resources: [
          ...csp.styleElementResources.map((resource) => ({
            resource,
            kind: /** @type {const} */ ("element"),
          })),
          ...csp.styleAttributeResources.map((resource) => ({
            resource,
            kind: /** @type {const} */ ("attribute"),
          })),
        ],
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Astro inlines a small bundled script that imports nothing. The analytics script and the
      // service worker's registration are two, and they must stay files: pages carry no inline
      // script but the theme script (ADR 0046, ADR 0051, ADR 0052), and a file is cached across
      // pages. Everything else keeps the default.
      assetsInlineLimit: (path) =>
        /(?:Analytics|ServiceWorker)\.astro_astro_type_script_/.test(path) ? false : undefined,
    },
    resolve: {
      alias: [
        // The design system's React components, for tool islands: `import { Button } from "@ui"`.
        // tools/tsconfig.json has the matching path for the type checker (docs/adding-a-tool.md).
        {
          find: "@ui",
          replacement: fileURLToPath(
            new URL("./src/components/ui/react/index.ts", import.meta.url),
          ),
        },
        // Exactly "zod" (not zod/v4, which the wrapper itself imports) goes through a wrapper that
        // turns on Zod's jitless mode first, so validating in the browser never trips the CSP
        // (src/lib/zod-jitless.ts, ADR 0047).
        {
          find: /^zod$/,
          replacement: fileURLToPath(new URL("./src/lib/zod-jitless.ts", import.meta.url)),
        },
        // ONNX Runtime Web's build that loads its WebAssembly from a URL, not the one that bundles
        // it: the AI image tools' workers fetch the engine from /vendor/onnxruntime-web/, so the
        // 14 MB file is served once, unmodified and versioned, never inside a hashed bundle
        // (ADR 0066).
        {
          find: /^onnxruntime-web\/wasm$/,
          replacement: fileURLToPath(
            new URL(
              "../../tools/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs",
              import.meta.url,
            ),
          ),
        },
      ],
    },
  },
  fonts: [
    {
      name: "Geist",
      cssVariable: "--font-geist",
      provider: local,
      options: {
        variants: [
          {
            weight: "100 900",
            style: "normal",
            src: ["./node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"],
          },
        ],
      },
      display: "swap",
    },
    {
      name: "Geist Mono",
      cssVariable: "--font-geist-mono",
      provider: local,
      options: {
        variants: [
          {
            weight: "100 900",
            style: "normal",
            src: [
              "./node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
            ],
          },
        ],
      },
      display: "swap",
      fallbacks: ["monospace"],
    },
  ],
});

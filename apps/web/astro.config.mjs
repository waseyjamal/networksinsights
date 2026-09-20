// @ts-check

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";

// Fonts: Geist and Geist Mono (SIL OFL 1.1), self-hosted by Astro's Fonts API. The files are
// the Latin variable-weight woff2 files of two pinned @fontsource-variable packages, read
// straight from node_modules by the `local` provider: no network at build time, and the exact
// bytes are fixed by the lockfile. (Astro's `npm` provider was tried first; it rewrites the
// file URLs to cdn.jsdelivr.net and downloads them at build time. See ADR 0028.)
// Astro adds metric-matched fallbacks, so the swap from fallback to Geist does not shift layout.
const local = fontProviders.local();

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
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

/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// getViteConfig applies the app's Astro config (React, Tailwind) so .astro files can be imported.
// The root is pinned to this folder because Vitest runs from the repo root.
export default getViteConfig(
  {
    test: {
      name: "web",
      environment: "node",
      include: ["src/**/*.test.ts"],
      exclude: ["e2e/**", "node_modules/**"],
      // Return the real text of tokens.css for `?raw` imports (Vitest stubs other CSS as empty).
      css: { include: [/tokens.css/] },
    },
  },
  { root: import.meta.dirname },
);

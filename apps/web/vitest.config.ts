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
      // The registry fixtures are folders that look exactly like tools, down to the required
      // logic.test.ts. They are test data, not tests: registry.test.ts reads them.
      exclude: ["e2e/**", "node_modules/**", "src/lib/registry/fixtures/**"],
      // Return the real text of tokens.css for `?raw` imports (Vitest stubs other CSS as empty).
      css: { include: [/tokens.css/] },
    },
  },
  { root: import.meta.dirname },
);

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
    },
  },
  { root: import.meta.dirname },
);

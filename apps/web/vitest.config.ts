/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

// Node provides import.meta.dirname; declared here because the repo has no @types/node yet.
declare global {
  interface ImportMeta {
    dirname: string;
  }
}

// getViteConfig applies the app's Astro config (React, Tailwind) so .astro files can be imported.
// The root is pinned to this folder because Vitest runs from the repo root.
export default getViteConfig(
  {
    test: {
      name: "web",
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  },
  { root: import.meta.dirname },
);

import { defineConfig } from "vitest/config";

// The SDK is pure TypeScript, so its tests need no Astro or DOM environment.
export default defineConfig({
  test: {
    name: "tool-sdk",
    // Slow tests carry the "slow" tag: `pnpm test` skips them, `pnpm test:slow` runs only them (ADR 0043).
    tags: [{ name: "slow" }],
    environment: "node",
    include: ["src/**/*.test.ts"],
    root: import.meta.dirname,
  },
});

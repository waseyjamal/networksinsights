import { defineConfig } from "vitest/config";

// The SDK is pure TypeScript, so its tests need no Astro or DOM environment.
export default defineConfig({
  test: {
    name: "tool-sdk",
    environment: "node",
    include: ["src/**/*.test.ts"],
    root: import.meta.dirname,
  },
});

import { defineConfig } from "vitest/config";

// Every tool's required logic.test.ts runs here, as the "tools" project (ADR 0032).
// passWithNoTests is left at its default (false): a run of this project that finds no tool test
// fails, like the repo-wide run.
export default defineConfig({
  test: {
    name: "tools",
    // Slow tests carry the "slow" tag: `pnpm test` skips them, `pnpm test:slow` runs only them (ADR 0043).
    tags: [{ name: "slow" }],
    environment: "node",
    include: ["*/*/**/*.test.ts"],
    root: import.meta.dirname,
  },
});

import { defineConfig } from "vitest/config";

// The tests of the scripts that add and check tools: the generator, `pnpm check:tools` and
// `pnpm check:budgets`. They write into scripts/.tmp/, which git ignores.
export default defineConfig({
  test: {
    name: "scripts",
    // Slow tests carry the "slow" tag: `pnpm test` skips them, `pnpm test:slow` runs only them (ADR 0043).
    tags: [{ name: "slow" }],
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: [".tmp/**", "node_modules/**"],
    // A test that generates a tool and type-checks it runs the TypeScript compiler.
    testTimeout: 120_000,
    root: import.meta.dirname,
  },
});

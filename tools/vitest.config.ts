import { defineConfig } from "vitest/config";

// Every tool's required logic.test.ts runs here, as the "tools" project (ADR 0032).
//
// passWithNoTests is true for this project only. There are no tools yet, and the repo-wide run
// still fails if it finds no tests anywhere. Nothing is lost by it: a tool without a logic.test.ts
// fails the build in the registry's file check, not here (ADR 0033).
export default defineConfig({
  test: {
    name: "tools",
    environment: "node",
    include: ["*/*/**/*.test.ts"],
    passWithNoTests: true,
    root: import.meta.dirname,
  },
});

import { defineConfig } from "vitest/config";

// Each workspace under apps/*, packages/* and tools/ that has a vitest.config.ts is its own
// project. passWithNoTests is deliberately left at its default (false): a run that finds no tests
// fails. The "tools" project overrides it while there are no tools (ADR 0032).
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*", "tools", "scripts"],
  },
});

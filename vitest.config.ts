import { defineConfig } from "vitest/config";

// Each workspace under apps/* and packages/* that has a vitest.config.ts is its own project.
// passWithNoTests is deliberately left at its default (false): a run that finds no tests fails.
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
  },
});

import { describe, expect, it } from "vitest";
import {
  e2eAlreadyPassed,
  e2eArtifactName,
  FILES_API_LIMIT,
  lighthousePages,
  selectScope,
} from "./ci-scope";

const files = (...names: string[]) => names.map((filename) => ({ filename, status: "modified" }));

const toolFiles = (category: string, id: string) =>
  ["tool.config.ts", "logic.ts", "ui.tsx", "island.astro", "content/en.mdx", "logic.test.ts"].map(
    (name) => `tools/${category}/${id}/${name}`,
  );

describe("selectScope", () => {
  it("treats a pull request that touches only a tool folder as tool-only", () => {
    const scope = selectScope(files(...toolFiles("text", "word-counter")));
    expect(scope).toMatchObject({ full: false, tools: ["word-counter"] });
    expect(lighthousePages(scope)).toEqual(["/word-counter/"]);
  });

  it("allows the tool's own E2E spec, as in Hash Generator (#35) and Color Converter (#36)", () => {
    const scope = selectScope(
      files(...toolFiles("developer", "hash-generator"), "apps/web/e2e/hash-generator.spec.ts"),
    );
    expect(scope).toMatchObject({ full: false, tools: ["hash-generator"] });
  });

  it("lists several tools sorted, once each", () => {
    const scope = selectScope(
      files(...toolFiles("text", "b-tool"), ...toolFiles("text", "a-tool")),
    );
    expect(lighthousePages(scope)).toEqual(["/a-tool/", "/b-tool/"]);
  });

  it("runs everything for a file outside the tool folders", () => {
    for (const path of [
      "apps/web/src/styles/components.css",
      "packages/tool-sdk/src/files.ts",
      "scripts/new-tool.ts",
      "pnpm-lock.yaml",
      ".github/workflows/ci.yml",
      "docs/design-system.md",
      "tools/README.md",
      "tools/vitest.config.ts",
      "tools/text/README.md",
    ]) {
      const scope = selectScope(files(...toolFiles("text", "word-counter"), path));
      expect(scope.full, path).toBe(true);
      expect(lighthousePages(scope), path).toEqual([]);
    }
  });

  it("runs everything for a spec that belongs to no changed tool, or another spec", () => {
    expect(selectScope(files("apps/web/e2e/word-counter.spec.ts")).full).toBe(true);
    expect(
      selectScope(files(...toolFiles("text", "word-counter"), "apps/web/e2e/pages.ts")).full,
    ).toBe(true);
    expect(
      selectScope(files(...toolFiles("text", "word-counter"), "apps/web/e2e/other-tool.spec.ts"))
        .full,
    ).toBe(true);
  });

  it("runs everything when a file is removed, renamed or has an unknown status", () => {
    for (const status of ["removed", "renamed", "copied", "unchanged", "surprise"]) {
      const list = [{ filename: "tools/text/word-counter/logic.ts", status }];
      expect(selectScope(list).full, status).toBe(true);
    }
  });

  it("accepts added and changed statuses", () => {
    for (const status of ["added", "modified", "changed"]) {
      const list = [{ filename: "tools/text/word-counter/logic.ts", status }];
      expect(selectScope(list).full, status).toBe(false);
    }
  });

  it("runs everything when the list is empty, missing, malformed or possibly truncated", () => {
    expect(selectScope([]).full).toBe(true);
    expect(selectScope(undefined).full).toBe(true);
    expect(selectScope(null).full).toBe(true);
    expect(selectScope("tools/text/word-counter/logic.ts").full).toBe(true);
    expect(selectScope([null]).full).toBe(true);
    expect(selectScope([{ filename: 3, status: "modified" }]).full).toBe(true);
    expect(selectScope([{ filename: "tools/text/x/logic.ts" }]).full).toBe(true);
    const many = Array.from({ length: FILES_API_LIMIT }, (_, i) => `tools/text/t/f${i}.ts`);
    expect(selectScope(files(...many)).full).toBe(true);
  });

  it("runs everything for odd paths", () => {
    for (const path of [
      "tools/text/word-counter/../../../apps/web/x.ts",
      "tools/text/word-counter/./logic.ts",
      "tools/text/Word Counter/logic.ts",
      "tools/text/word-counter",
      "tools/text//logic.ts",
      "tools/.hidden/word-counter/logic.ts",
      "tools\\text\\word-counter\\logic.ts",
      "tools/node_modules/word-counter/logic.ts",
    ]) {
      expect(selectScope(files(path)).full, path).toBe(true);
    }
  });

  // File lists of past tool pull requests, from the GitHub API. Only the paths outside tools/ matter.
  it("classifies real past pull requests", () => {
    const real = (id: string, category: string, extra: string[]) =>
      files(...toolFiles(category, id), ...extra);
    // Hash Generator (#35) and Color Converter (#36): tool folder plus their own spec.
    expect(
      selectScope(real("hash-generator", "developer", ["apps/web/e2e/hash-generator.spec.ts"]))
        .full,
    ).toBe(false);
    // Diff Checker (#34) also added a design-system component.
    expect(
      selectScope(
        real("diff-checker", "developer", [
          "apps/web/e2e/diff-checker.spec.ts",
          "apps/web/src/components/ui/DiffView.astro",
          "apps/web/src/styles/components.css",
        ]),
      ).full,
    ).toBe(true);
    // Word Counter (#20) and Compress Image (#21) also changed shared code.
    expect(
      selectScope(real("word-counter", "text", ["apps/web/src/pages/[slug].astro"])).full,
    ).toBe(true);
    expect(
      selectScope(real("compress-image", "image", ["packages/tool-sdk/src/worker.ts"])).full,
    ).toBe(true);
  });
});

describe("e2eAlreadyPassed", () => {
  const tree = "a".repeat(40);
  const repo = "123456";
  const artifact = (over: Record<string, unknown> = {}) => ({
    name: e2eArtifactName(tree),
    expired: false,
    workflow_run: { repository_id: 123456, head_repository_id: 123456 },
    ...over,
  });

  it("is true for a live artifact of this tree from this repository", () => {
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact()] }, repo)).toBe(true);
  });

  it("is false when there is no artifact, or it has another name", () => {
    expect(e2eAlreadyPassed(tree, { artifacts: [] }, repo)).toBe(false);
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact({ name: "e2e-passed-b" })] }, repo)).toBe(
      false,
    );
  });

  it("is false for an expired artifact or one whose state is unknown", () => {
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact({ expired: true })] }, repo)).toBe(false);
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact({ expired: undefined })] }, repo)).toBe(
      false,
    );
  });

  it("is false for an artifact from a fork or another repository", () => {
    const fork = { repository_id: 123456, head_repository_id: 999 };
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact({ workflow_run: fork })] }, repo)).toBe(
      false,
    );
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact({ workflow_run: {} })] }, repo)).toBe(
      false,
    );
  });

  it("is false for a bad tree, a bad repository id or a bad listing", () => {
    expect(e2eAlreadyPassed("HEAD", { artifacts: [artifact()] }, repo)).toBe(false);
    expect(e2eAlreadyPassed(tree, { artifacts: [artifact()] }, "")).toBe(false);
    expect(e2eAlreadyPassed(tree, null, repo)).toBe(false);
    expect(e2eAlreadyPassed(tree, { artifacts: "x" }, repo)).toBe(false);
    expect(e2eAlreadyPassed(tree, { artifacts: [null] }, repo)).toBe(false);
  });
});

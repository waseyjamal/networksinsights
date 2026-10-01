import { describe, expect, it } from "vitest";
import {
  acceptedKinds,
  e2eAlreadyPassed,
  e2eArtifactName,
  scopedSpecs,
  selectScope,
} from "./ci-scope";

const tree = "b".repeat(40);
const repo = "123456";
const listing = (...names: string[]) => ({
  artifacts: names.map((name) => ({
    name,
    expired: false,
    workflow_run: { repository_id: 123456, head_repository_id: 123456 },
  })),
});

const toolOnly = selectScope([
  { filename: "tools/text/word-counter/logic.ts", status: "modified" },
]);
const everything = selectScope([{ filename: "scripts/ci-scope.ts", status: "modified" }]);

/** What main does with a scope and the artifacts of its tree. */
const mainSkips = (scope: typeof toolOnly, ...names: string[]) =>
  e2eAlreadyPassed(tree, listing(...names), repo, acceptedKinds(scope));

describe("artifact names", () => {
  it("labels the kind and the tree", () => {
    expect(e2eArtifactName(tree, "full")).toBe(`e2e-passed-full-${tree}`);
    expect(e2eArtifactName(tree, "scoped")).toBe(`e2e-passed-scoped-${tree}`);
  });
});

describe("what lets main skip E2E", () => {
  const full = e2eArtifactName(tree, "full");
  const scoped = e2eArtifactName(tree, "scoped");

  it("skips a full run only for a full artifact", () => {
    expect(acceptedKinds(everything)).toEqual(["full"]);
    expect(mainSkips(everything, full)).toBe(true);
    expect(mainSkips(everything, scoped)).toBe(false);
    expect(mainSkips(everything)).toBe(false);
  });

  it("skips a scoped run for a scoped or a full artifact", () => {
    expect(acceptedKinds(toolOnly)).toEqual(["full", "scoped"]);
    expect(mainSkips(toolOnly, scoped)).toBe(true);
    expect(mainSkips(toolOnly, full)).toBe(true);
    expect(mainSkips(toolOnly)).toBe(false);
  });

  it("never accepts an artifact of another tree, an unlabelled one, or a fork's", () => {
    const other = "c".repeat(40);
    expect(mainSkips(toolOnly, e2eArtifactName(other, "full"))).toBe(false);
    expect(mainSkips(toolOnly, `e2e-passed-${tree}`)).toBe(false);
    expect(mainSkips(everything, `e2e-passed-${tree}`)).toBe(false);
    const fork = {
      artifacts: [
        {
          name: full,
          expired: false,
          workflow_run: { repository_id: 123456, head_repository_id: 999 },
        },
      ],
    };
    expect(e2eAlreadyPassed(tree, fork, repo, acceptedKinds(everything))).toBe(false);
  });

  it("defaults to full artifacts only", () => {
    expect(e2eAlreadyPassed(tree, listing(scoped), repo)).toBe(false);
    expect(e2eAlreadyPassed(tree, listing(full), repo)).toBe(true);
  });
});

describe("scopedSpecs", () => {
  const specFiles = [
    "word-counter.spec.ts",
    "hash-generator.spec.ts",
    "search.spec.ts",
    "seo.spec.ts",
    "brand-new-shared.spec.ts",
  ];
  const toolIds = ["word-counter", "hash-generator"];

  it("runs the shared specs and the changed tool's spec, not other tools' specs", () => {
    expect(scopedSpecs(toolOnly, specFiles, toolIds)).toEqual([
      "e2e/brand-new-shared.spec.ts",
      "e2e/search.spec.ts",
      "e2e/seo.spec.ts",
      "e2e/word-counter.spec.ts",
    ]);
  });

  it("still runs the shared specs for a changed tool that has no spec", () => {
    const scope = selectScope([{ filename: "tools/text/no-spec/logic.ts", status: "added" }]);
    expect(scopedSpecs(scope, specFiles, [...toolIds, "no-spec"])).toEqual([
      "e2e/brand-new-shared.spec.ts",
      "e2e/search.spec.ts",
      "e2e/seo.spec.ts",
    ]);
  });

  it("answers empty, meaning everything, for a full scope or an unknown tool list", () => {
    expect(scopedSpecs(everything, specFiles, toolIds)).toEqual([]);
    expect(scopedSpecs(toolOnly, specFiles, [])).toEqual([]);
  });
});

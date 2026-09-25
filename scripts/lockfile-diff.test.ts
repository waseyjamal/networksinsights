import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./lib/tools";
import {
  COMMENT_MARKER,
  diffLockfiles,
  formatDiff,
  parseLockfile,
  splitKey,
} from "./lockfile-diff";

const lockfile = (packages: string, importers = "") => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
${importers}
packages:

${packages}
snapshots:

  ignored@1.0.0: {}
`;

const entry = (key: string, integrity = `sha512-${key}`) =>
  `  '${key}':\n    resolution: {integrity: ${integrity}}\n\n`;

const direct = (name: string, specifier: string, version = specifier) =>
  `      ${name}:\n        specifier: ${specifier}\n        version: ${version}\n`;

describe("parseLockfile", () => {
  it("reads packages with their integrity and direct dependencies with their versions", () => {
    const parsed = parseLockfile(
      lockfile(entry("@scope/a@1.0.0") + entry("b@2.0.0"), direct("'@scope/a'", "1.0.0")),
    );
    expect([...parsed.packages]).toEqual([
      ["@scope/a@1.0.0", "sha512-@scope/a@1.0.0"],
      ["b@2.0.0", "sha512-b@2.0.0"],
    ]);
    expect([...parsed.direct]).toEqual([[". › @scope/a", "1.0.0"]]);
  });

  it("reads the real lockfile", () => {
    const parsed = parseLockfile(readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8"));
    expect(parsed.packages.size).toBeGreaterThan(100);
    expect(parsed.packages.get("astro@7.3.2")).toMatch(/^sha512-/);
    expect(parsed.direct.get("apps/web › astro")).toBe("7.3.2");
  });

  it("splits scoped names at the version", () => {
    expect(splitKey("@scope/name@1.2.3")).toEqual({ name: "@scope/name", version: "1.2.3" });
    expect(splitKey("name@1.2.3-rc.1")).toEqual({ name: "name", version: "1.2.3-rc.1" });
  });
});

describe("diffLockfiles", () => {
  it("finds nothing when nothing changed", () => {
    const text = readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8");
    const diff = diffLockfiles(parseLockfile(text), parseLockfile(text));
    expect(diff).toEqual({ added: [], removed: [], updated: [], integrityChanged: [], direct: [] });
  });

  it("reads updates, additions, removals and direct changes", () => {
    const base = parseLockfile(
      lockfile(entry("a@1.0.0") + entry("gone@1.0.0") + entry("two@1.0.0"), direct("a", "1.0.0")),
    );
    const head = parseLockfile(
      lockfile(
        entry("a@1.1.0") + entry("new@3.0.0") + entry("two@1.0.0") + entry("two@2.0.0"),
        direct("a", "1.1.0"),
      ),
    );
    const diff = diffLockfiles(base, head);
    expect(diff.updated).toEqual([{ name: "a", from: "1.0.0", to: "1.1.0" }]);
    expect(diff.added).toEqual(["new@3.0.0", "two@2.0.0"]);
    expect(diff.removed).toEqual(["gone@1.0.0"]);
    expect(diff.direct).toEqual([{ key: ". › a", from: "1.0.0", to: "1.1.0" }]);
    expect(diff.integrityChanged).toEqual([]);
  });

  it("flags a version whose integrity changed", () => {
    const base = parseLockfile(lockfile(entry("a@1.0.0", "sha512-old")));
    const head = parseLockfile(lockfile(entry("a@1.0.0", "sha512-new")));
    const diff = diffLockfiles(base, head);
    expect(diff.integrityChanged).toEqual(["a@1.0.0"]);
    expect(formatDiff(diff)).toContain("[!CAUTION]");
  });
});

describe("formatDiff", () => {
  it("starts with the marker CI uses to update its comment", () => {
    const base = parseLockfile(lockfile(entry("a@1.0.0")));
    const head = parseLockfile(lockfile(entry("a@1.1.0")));
    const text = formatDiff(diffLockfiles(base, head));
    expect(text.startsWith(COMMENT_MARKER)).toBe(true);
    expect(text).toContain("**0 added, 0 removed, 1 updated**");
    expect(text).toContain("`a` `1.0.0` → `1.1.0`");
  });

  it("says so when the lockfile changed without a package change", () => {
    const same = parseLockfile(lockfile(entry("a@1.0.0")));
    expect(formatDiff(diffLockfiles(same, same))).toContain("no package was added");
  });
});

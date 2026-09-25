// node scripts/lockfile-diff.ts --base <old pnpm-lock.yaml> --head <new pnpm-lock.yaml>
//
// Prints, as Markdown, what a pull request changes in pnpm-lock.yaml (ADR 0049): the direct
// dependencies of each workspace, then every package added, removed or updated anywhere in the
// tree, transitive ones included. CI posts it as a comment on the pull request.
//
// It has no dependencies and imports nothing but Node built-ins, so CI runs it with plain `node`
// (Node 24 runs TypeScript by stripping types) without installing anything: no third-party code
// runs in the job that holds permission to comment. That is also why the lockfile is read line by
// line rather than with a YAML library; pnpm writes it in a fixed shape (lockfile v9).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

export interface Lockfile {
  /** `name@version` to its integrity hash (or tarball URL). */
  packages: Map<string, string>;
  /** `workspace › name` to `specifier (resolved version)`. */
  direct: Map<string, string>;
}

const unquote = (text: string) => text.replace(/^'(.*)'$/, "$1");

/** Splits `@scope/name@1.2.3` at the version's `@`. */
export function splitKey(key: string): { name: string; version: string } {
  const at = key.lastIndexOf("@");
  return at > 0
    ? { name: key.slice(0, at), version: key.slice(at + 1) }
    : { name: key, version: "" };
}

export function parseLockfile(text: string): Lockfile {
  const packages = new Map<string, string>();
  const direct = new Map<string, string>();
  let section = "";
  let importer = "";
  let dependency = "";
  let specifier = "";
  let current = "";
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const top = /^(\S[^:]*):\s*$/.exec(line);
    if (top?.[1]) {
      section = top[1];
      continue;
    }
    if (section === "packages") {
      const key = /^ {2}(\S.*):$/.exec(line);
      if (key?.[1]) {
        current = unquote(key[1]);
        packages.set(current, "");
        continue;
      }
      const resolution = /^ {4}resolution: \{(?:integrity|tarball): ([^,}]+)/.exec(line);
      if (resolution?.[1] && current) packages.set(current, resolution[1].trim());
    }
    if (section === "importers") {
      const workspace = /^ {2}(\S.*):$/.exec(line);
      if (workspace?.[1]) {
        importer = unquote(workspace[1]);
        continue;
      }
      const name = /^ {6}(\S.*):$/.exec(line);
      if (name?.[1]) {
        dependency = unquote(name[1]);
        continue;
      }
      const spec = /^ {8}specifier: (.*)$/.exec(line);
      if (spec?.[1]) specifier = unquote(spec[1].trim());
      const version = /^ {8}version: (.*)$/.exec(line);
      if (version?.[1] && dependency) {
        // Peer suffixes such as 1.2.3(react@19.3.0) say nothing a reviewer needs.
        const resolved = unquote(version[1].trim()).replace(/\(.*$/, "");
        direct.set(
          `${importer} › ${dependency}`,
          specifier === resolved ? resolved : `${specifier} (${resolved})`,
        );
      }
    }
  }
  return { packages, direct };
}

export interface LockfileDiff {
  added: string[];
  removed: string[];
  /** `name`, from, to. */
  updated: Array<{ name: string; from: string; to: string }>;
  /** Same name and version, different integrity: a republished or tampered package. */
  integrityChanged: string[];
  direct: Array<{ key: string; from: string | undefined; to: string | undefined }>;
}

export function diffLockfiles(base: Lockfile, head: Lockfile): LockfileDiff {
  const byName = (packages: Map<string, string>) => {
    const names = new Map<string, string[]>();
    for (const key of packages.keys()) {
      const { name, version } = splitKey(key);
      names.set(name, [...(names.get(name) ?? []), version]);
    }
    return names;
  };
  const before = byName(base.packages);
  const after = byName(head.packages);
  const added: string[] = [];
  const removed: string[] = [];
  const updated: LockfileDiff["updated"] = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const old = (before.get(name) ?? []).filter(
      (version) => !(after.get(name) ?? []).includes(version),
    );
    const now = (after.get(name) ?? []).filter(
      (version) => !(before.get(name) ?? []).includes(version),
    );
    // One version replaced by one other reads as an update; anything else is added and removed.
    if (old.length === 1 && now.length === 1) {
      updated.push({ name, from: old[0] ?? "", to: now[0] ?? "" });
      continue;
    }
    for (const version of now) added.push(`${name}@${version}`);
    for (const version of old) removed.push(`${name}@${version}`);
  }
  const integrityChanged = [...head.packages]
    .filter(([key, integrity]) => {
      const previous = base.packages.get(key);
      return (
        previous !== undefined && previous !== "" && integrity !== "" && previous !== integrity
      );
    })
    .map(([key]) => key);
  const direct: LockfileDiff["direct"] = [];
  for (const key of new Set([...base.direct.keys(), ...head.direct.keys()])) {
    const from = base.direct.get(key);
    const to = head.direct.get(key);
    if (from !== to) direct.push({ key, from, to });
  }
  const byText = (a: string, b: string) => a.localeCompare(b);
  return {
    added: added.sort(byText),
    removed: removed.sort(byText),
    updated: updated.sort((a, b) => byText(a.name, b.name)),
    integrityChanged: integrityChanged.sort(byText),
    direct: direct.sort((a, b) => byText(a.key, b.key)),
  };
}

/** The marker that lets CI find and update its own comment. */
export const COMMENT_MARKER = "<!-- lockfile-diff -->";

const code = (text: string) => `\`${text.replaceAll("`", "")}\``;

function list(title: string, items: readonly string[]): string[] {
  if (items.length === 0) return [];
  return [
    `<details><summary>${title} (${items.length})</summary>`,
    "",
    ...items.map((item) => `- ${item}`),
    "",
    "</details>",
    "",
  ];
}

export function formatDiff(diff: LockfileDiff): string {
  const total = diff.added.length + diff.removed.length + diff.updated.length;
  const out = [COMMENT_MARKER, "## Lockfile changes", ""];
  if (total === 0 && diff.direct.length === 0 && diff.integrityChanged.length === 0) {
    out.push("`pnpm-lock.yaml` changed, but no package was added, removed or updated.");
    return out.join("\n");
  }
  out.push(
    `**${diff.added.length} added, ${diff.removed.length} removed, ${diff.updated.length} updated** across the whole tree, transitive dependencies included.`,
    "",
  );
  if (diff.integrityChanged.length > 0) {
    out.push(
      `> [!CAUTION]`,
      `> The integrity hash of ${diff.integrityChanged.length} package version(s) changed without a version change. A published version never changes, so treat this as suspect and do not merge until it is explained: ${diff.integrityChanged.map(code).join(", ")}`,
      "",
    );
  }
  if (diff.direct.length > 0) {
    out.push(
      "### Direct dependencies",
      "",
      "| Workspace › package | Before | After |",
      "| --- | --- | --- |",
    );
    for (const change of diff.direct) {
      out.push(
        `| ${code(change.key)} | ${change.from ? code(change.from) : "—"} | ${change.to ? code(change.to) : "—"} |`,
      );
    }
    out.push("");
  }
  out.push(
    ...list(
      "Updated",
      diff.updated.map(
        (change) => `${code(change.name)} ${code(change.from)} → ${code(change.to)}`,
      ),
    ),
    ...list("Added", diff.added.map(code)),
    ...list("Removed", diff.removed.map(code)),
    "Licences and known vulnerabilities of the new tree are checked by the `supply-chain` job (ADR 0049).",
  );
  return out.join("\n");
}

function main(): number {
  const { values } = parseArgs({
    options: { base: { type: "string" }, head: { type: "string" } },
    strict: true,
  });
  if (!values.base || !values.head) {
    console.error(
      "Usage: node scripts/lockfile-diff.ts --base <old lockfile> --head <new lockfile>",
    );
    return 2;
  }
  const base = parseLockfile(readFileSync(values.base, "utf8"));
  const head = parseLockfile(readFileSync(values.head, "utf8"));
  console.log(formatDiff(diffLockfiles(base, head)));
  return 0;
}

if (import.meta.main) process.exit(main());

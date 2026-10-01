// node scripts/ci-scope.ts pr   (env: GH_TOKEN, REPO, PR_NUMBER)
// node scripts/ci-scope.ts main (env: GH_TOKEN, REPO, GITHUB_REPOSITORY_ID)
//
// Decides how much of CI a run needs (ADR 0054) and writes the answer to $GITHUB_OUTPUT:
//
// - `pr`: asks the GitHub pull request files API what the pull request changes. If every file is
//   inside one or more tool folders (plus each tool's own E2E spec), `lighthouse_pages` lists only
//   those tools' pages. Otherwise it is empty, and Lighthouse measures every page.
// - `main`: asks the same question of the pushed commit's files, and skips E2E only when the same
//   tree already passed it in a run of this repository, proven by an `e2e-passed-<kind>-<tree hash>`
//   artifact that only a passing E2E gate uploads. A full run is skipped only for a "full" artifact;
//   a scoped run is skipped for a "scoped" or a "full" one.
// - `dispatch`: a manual run is always the full suite and never skipped.
//
// It writes `e2e_mode` (`full`, `scoped` or `skip`), `e2e_specs` (the spec files of a scoped run),
// `skip_e2e` and `lighthouse_pages`. Fail safe: anything unknown, empty, truncated or failing gives
// the full suite. It has no dependencies and imports only Node built-ins, so CI runs it with plain
// `node` and no install.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync } from "node:fs";

export interface ChangedFile {
  filename: string;
  status: string;
}

export interface Scope {
  /** True when the whole suite must run. */
  full: boolean;
  /** The changed tool ids, sorted, when `full` is false. */
  tools: string[];
  reason: string;
}

/** The files API lists at most 3,000 files per pull request; a list that long may be cut short. */
export const FILES_API_LIMIT = 3000;

/** Statuses that leave every changed file in place. A rename or a removal can delete a page. */
const SAFE_STATUSES = new Set(["added", "modified", "changed"]);

const ID = "[a-z0-9][a-z0-9-]*";
const TOOL_FILE = new RegExp(`^tools/${ID}/(${ID})/[A-Za-z0-9._/-]+$`);
const TOOL_E2E_SPEC = new RegExp(`^apps/web/e2e/(${ID})\\.spec\\.ts$`);

const full = (reason: string): Scope => ({ full: true, tools: [], reason });

/** Sorts the changed files of a pull request into "tool only" or "everything". */
export function selectScope(files: unknown): Scope {
  if (!Array.isArray(files) || files.length === 0) return full("no changed files were listed");
  if (files.length >= FILES_API_LIMIT) return full("the file list may be truncated");
  const tools = new Set<string>();
  const specs = new Set<string>();
  for (const entry of files as unknown[]) {
    if (typeof entry !== "object" || entry === null) return full("malformed file entry");
    const { filename, status } = entry as Partial<ChangedFile>;
    if (typeof filename !== "string" || typeof status !== "string") {
      return full("malformed file entry");
    }
    if (!SAFE_STATUSES.has(status)) return full(`${filename} is ${status}`);
    if (filename.split("/").some((part) => part === "." || part === "..")) {
      return full(`${filename} is not a plain path`);
    }
    const tool = TOOL_FILE.exec(filename);
    if (tool?.[1]) {
      tools.add(tool[1]);
      continue;
    }
    const spec = TOOL_E2E_SPEC.exec(filename);
    if (spec?.[1]) {
      specs.add(spec[1]);
      continue;
    }
    return full(`${filename} is outside the tool folders`);
  }
  for (const id of specs) {
    if (!tools.has(id)) return full(`apps/web/e2e/${id}.spec.ts changes without a tool folder`);
  }
  if (tools.size === 0) return full("no tool folder changed");
  return { full: false, tools: [...tools].sort(), reason: "only tool folders changed" };
}

/** The pages Lighthouse measures for a tool-only pull request; empty means every page. */
export function lighthousePages(scope: Scope): string[] {
  return scope.full ? [] : scope.tools.map((id) => `/${id}/`);
}

/** What an E2E run proved: every spec ("full"), or the changed tools' specs and the shared ones. */
export type E2eKind = "full" | "scoped";

export const e2eArtifactName = (tree: string, kind: E2eKind = "full") =>
  `e2e-passed-${kind}-${tree}`;

/** The artifact kinds that let a run of this size be skipped: a full run needs a full artifact. */
export const acceptedKinds = (scope: Scope): E2eKind[] =>
  scope.full ? ["full"] : ["full", "scoped"];

const SPEC_SUFFIX = ".spec.ts";

/**
 * The spec files (paths from apps/web) a scoped run executes: every shared spec, meaning one that is
 * not named after a tool folder, plus the spec of each changed tool that has one. A spec with an
 * unknown name counts as shared, so it always runs. Empty means "run everything".
 */
export function scopedSpecs(scope: Scope, specFiles: string[], toolIds: string[]): string[] {
  if (scope.full || scope.tools.length === 0 || toolIds.length === 0) return [];
  const known = new Set(toolIds);
  const changed = new Set(scope.tools);
  return specFiles
    .filter((file) => {
      const id = file.endsWith(SPEC_SUFFIX) ? file.slice(0, -SPEC_SUFFIX.length) : file;
      return !known.has(id) || changed.has(id);
    })
    .sort()
    .map((file) => `e2e/${file}`);
}

interface Artifact {
  name?: unknown;
  expired?: unknown;
  workflow_run?: { repository_id?: unknown; head_repository_id?: unknown };
}

/**
 * True only when the artifacts listing holds a live `e2e-passed-<tree>` artifact made by a run of
 * this very repository (not a fork's). Anything else, including a bad listing, is false.
 */
export function e2eAlreadyPassed(
  tree: string,
  listing: unknown,
  repositoryId: string,
  kinds: E2eKind[] = ["full"],
): boolean {
  if (!/^[0-9a-f]{40}$/.test(tree) || !/^\d+$/.test(repositoryId)) return false;
  const artifacts = (listing as { artifacts?: unknown } | null)?.artifacts;
  if (!Array.isArray(artifacts)) return false;
  return (artifacts as Artifact[]).some(
    (artifact) =>
      kinds.some((kind) => artifact?.name === e2eArtifactName(tree, kind)) &&
      artifact.expired === false &&
      String(artifact.workflow_run?.repository_id) === repositoryId &&
      String(artifact.workflow_run?.head_repository_id) === repositoryId,
  );
}

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const NL = String.fromCharCode(10);

const fileLines = (text: string): unknown[] =>
  text
    .split(NL)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);

function pullRequestScope(): Scope {
  return selectScope(
    fileLines(
      gh([
        "api",
        `repos/${env("REPO")}/pulls/${env("PR_NUMBER")}/files`,
        "--paginate",
        "--jq",
        ".[] | {filename, status}",
      ]),
    ),
  );
}

/** The pushed commit's own files. A merge commit has two parents, so it is never tool-only. */
function commitScope(): Scope {
  const commit = `repos/${env("REPO")}/commits/${env("GITHUB_SHA")}`;
  if (gh(["api", commit, "--jq", ".parents | length"]).trim() !== "1") {
    return full("the commit does not have exactly one parent");
  }
  return selectScope(
    fileLines(
      gh(["api", `${commit}?per_page=100`, "--paginate", "--jq", ".files[] | {filename, status}"]),
    ),
  );
}

/** Spec files and tool ids as they are on disk now. */
function specsOnDisk(): { specFiles: string[]; toolIds: string[] } {
  const specFiles = readdirSync("apps/web/e2e").filter((name) => name.endsWith(".spec.ts"));
  const toolIds = readdirSync("tools", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .flatMap((category) =>
      readdirSync(`tools/${category.name}`, { withFileTypes: true })
        .filter(
          (tool) =>
            tool.isDirectory() && existsSync(`tools/${category.name}/${tool.name}/tool.config.ts`),
        )
        .map((tool) => tool.name),
    );
  return { specFiles, toolIds };
}

function treeAlreadyPassed(kinds: E2eKind[]): boolean {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  // The artifacts API filters by exact name, so each kind is its own listing.
  return kinds.some((kind) => {
    const listing = JSON.parse(
      gh([
        "api",
        `repos/${env("REPO")}/actions/artifacts?name=${e2eArtifactName(tree, kind)}&per_page=100`,
      ]),
    ) as unknown;
    return e2eAlreadyPassed(tree, listing, env("GITHUB_REPOSITORY_ID"), [kind]);
  });
}

interface Decision {
  mode: "full" | "scoped" | "skip";
  specs: string[];
  lighthousePages: string[];
}

const EVERYTHING: Decision = { mode: "full", specs: [], lighthousePages: [] };

/** Turns a scope into a decision; a scoped run without a spec list becomes a full run. */
function decide(scope: Scope, lighthouse: boolean): Decision {
  if (scope.full) return EVERYTHING;
  const disk = specsOnDisk();
  const specs = scopedSpecs(scope, disk.specFiles, disk.toolIds);
  if (specs.length === 0) return EVERYTHING;
  return { mode: "scoped", specs, lighthousePages: lighthouse ? lighthousePages(scope) : [] };
}

function output(decision: Decision): void {
  const lines = [
    `e2e_mode=${decision.mode}`,
    `e2e_specs=${decision.specs.join(" ")}`,
    `skip_e2e=${decision.mode === "skip"}`,
    `lighthouse_pages=${decision.lighthousePages.join(" ")}`,
  ];
  console.log(lines.join(NL));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join(NL) + NL);
}

/** Runs `run`; anything that throws gives `fallback`, which is always the safe side. */
function attempt<T>(what: string, fallback: T, run: () => T): T {
  try {
    return run();
  } catch (error) {
    console.error(
      `scope: ${what}: ${error instanceof Error ? error.message : String(error)}; running everything`,
    );
    return fallback;
  }
}

function main(mode: string | undefined): number {
  if (mode !== "pr" && mode !== "main" && mode !== "dispatch") {
    console.error("Usage: node scripts/ci-scope.ts pr|main|dispatch");
    return 2;
  }
  if (mode === "dispatch") {
    output(EVERYTHING);
    return 0;
  }
  // Lighthouse narrows only on a pull request; E2E narrows on a pull request and on main.
  const scope = attempt("changed files", full("the changed files could not be read"), () =>
    mode === "pr" ? pullRequestScope() : commitScope(),
  );
  console.log(`scope: ${scope.reason}`);
  const decision = attempt("spec list", EVERYTHING, () => decide(scope, mode === "pr"));
  if (mode === "main") {
    const kinds = acceptedKinds(scope);
    if (attempt("artifact lookup", false, () => treeAlreadyPassed(kinds))) {
      output({ mode: "skip", specs: [], lighthousePages: [] });
      return 0;
    }
  }
  output(decision);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv[2]));

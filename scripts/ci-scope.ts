// node scripts/ci-scope.ts pr   (env: GH_TOKEN, REPO, PR_NUMBER)
// node scripts/ci-scope.ts main (env: GH_TOKEN, REPO, GITHUB_REPOSITORY_ID)
//
// Decides how much of CI a run needs (ADR 0054) and writes the answer to $GITHUB_OUTPUT:
//
// - `pr`: asks the GitHub pull request files API what the pull request changes. If every file is
//   inside one or more tool folders (plus each tool's own E2E spec), `lighthouse_pages` lists only
//   those tools' pages. Otherwise it is empty, and Lighthouse measures every page.
// - `main`: `skip_e2e=true` only when the same tree already passed E2E in a run of this repository,
//   proven by an `e2e-passed-<tree hash>` artifact that only a passing E2E job uploads.
//
// Fail safe: anything unknown, empty, truncated or failing gives the full suite. It has no
// dependencies and imports only Node built-ins, so CI runs it with plain `node` and no install.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

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

export const e2eArtifactName = (tree: string) => `e2e-passed-${tree}`;

interface Artifact {
  name?: unknown;
  expired?: unknown;
  workflow_run?: { repository_id?: unknown; head_repository_id?: unknown };
}

/**
 * True only when the artifacts listing holds a live `e2e-passed-<tree>` artifact made by a run of
 * this very repository (not a fork's). Anything else, including a bad listing, is false.
 */
export function e2eAlreadyPassed(tree: string, listing: unknown, repositoryId: string): boolean {
  if (!/^[0-9a-f]{40}$/.test(tree) || !/^\d+$/.test(repositoryId)) return false;
  const artifacts = (listing as { artifacts?: unknown } | null)?.artifacts;
  if (!Array.isArray(artifacts)) return false;
  return (artifacts as Artifact[]).some(
    (artifact) =>
      artifact?.name === e2eArtifactName(tree) &&
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

function output(values: Record<string, string>): void {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function pullRequestScope(): Scope {
  const lines = gh([
    "api",
    `repos/${env("REPO")}/pulls/${env("PR_NUMBER")}/files`,
    "--paginate",
    "--jq",
    ".[] | {filename, status}",
  ])
    .split("\n")
    .filter((line) => line.trim() !== "");
  return selectScope(lines.map((line) => JSON.parse(line) as unknown));
}

function mainSkipsE2e(): boolean {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  const listing = JSON.parse(
    gh([
      "api",
      `repos/${env("REPO")}/actions/artifacts?name=${e2eArtifactName(tree)}&per_page=100`,
    ]),
  ) as unknown;
  return e2eAlreadyPassed(tree, listing, env("GITHUB_REPOSITORY_ID"));
}

function main(mode: string | undefined): number {
  try {
    if (mode === "pr") {
      const scope = pullRequestScope();
      console.log(`scope: ${scope.reason}`);
      output({ lighthouse_pages: lighthousePages(scope).join(" "), skip_e2e: "false" });
      return 0;
    }
    if (mode === "main") {
      const skip = mainSkipsE2e();
      output({ lighthouse_pages: "", skip_e2e: String(skip) });
      return 0;
    }
    console.error("Usage: node scripts/ci-scope.ts pr|main");
    return 2;
  } catch (error) {
    // Unknown means the full suite: every page, and E2E.
    console.error(
      `scope: ${error instanceof Error ? error.message : String(error)}; running everything`,
    );
    output({ lighthouse_pages: "", skip_e2e: "false" });
    return 0;
  }
}

if (import.meta.main) process.exit(main(process.argv[2]));

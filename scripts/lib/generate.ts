// The generator behind `pnpm new:tool` (ADR 0035).
//
// It does three things in a fixed order, and the order is the safety:
//   1. Validate every input against the SDK, before anything is written.
//   2. Write the whole tool into a staging folder that is never a tool (it starts with a dot).
//   3. Move the finished folder into place in one step.
// A failure anywhere removes the staging folder and any category folder it created, so a run
// leaves either a complete tool or nothing. An existing folder is never touched.

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ContractViolation,
  checkQuality,
  formatViolation,
  KEBAB_CASE,
  REQUIRED_FILES,
  toolManifestSchema,
  validateTools,
} from "@networksinsights/tool-sdk";
import { z } from "zod";
import { toolFiles } from "./templates";
import { defaultToolsRoot, loadTools, siteConfig } from "./tools";

/** What the person asks for. `tags` is the list; the CLI splits `--tags a,b,c`. */
export interface NewToolInput {
  id: string;
  name: string;
  category: string;
  summary: string;
  runtime: string;
  tags: readonly string[];
}

/** The file-system calls the generator makes, so a test can make one of them fail. */
export interface FileSystem {
  mkdir(path: string): void;
  writeFile(path: string, content: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
  exists(path: string): boolean;
  isEmptyDir(path: string): boolean;
}

export const nodeFileSystem: FileSystem = {
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: (path, content) => writeFileSync(path, content),
  rename: (from, to) => renameSync(from, to),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  exists: (path) => existsSync(path),
  isEmptyDir: (path) => existsSync(path) && readdirSync(path).length === 0,
};

export interface GenerateOptions {
  /** The tools folder. Defaults to the repo's `tools/`; tests pass a temporary one. */
  toolsRoot?: string;
  /** How folders are named in messages. */
  label?: string;
  /** Today as YYYY-MM-DD, for `added` and `updated`. Defaults to the machine's date. */
  today?: string;
  /** Check everything and report what would be written, but write nothing. */
  dryRun?: boolean;
  fs?: FileSystem;
  /** Called with a function that undoes a half-finished run, so a signal handler can call it. */
  registerCleanup?: (cleanup: () => void) => void;
}

export interface GenerateResult {
  /** `tools/text/word-counter`. */
  dir: string;
  /** Absolute path of the folder. */
  path: string;
  /** The files written, or that would be written, relative to the folder. */
  files: string[];
  dryRun: boolean;
  runtime: string;
}

/** Every reason the input was refused, each as a sentence that says what to change. */
export class GeneratorError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join("\n"));
    this.name = "GeneratorError";
    this.problems = problems;
  }
}

/** Today's date in the machine's own time zone, as YYYY-MM-DD. */
export function localToday(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Splits `words, characters` or `words,characters` into clean tags. */
export function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

/** The flag that sets each manifest field, so a message can name what to change. */
const FLAG: Record<string, string> = {
  id: "--id",
  name: "--name",
  category: "--category",
  summary: "--summary",
  runtime: "--runtime",
  tags: "--tags",
};

const EXAMPLES: Record<string, string> = {
  id: "--id word-counter",
  name: '--name "Word counter"',
  category: `--category ${siteConfig.categoryIds.includes("text") ? "text" : (siteConfig.categoryIds[0] ?? "text")}`,
  summary: '--summary "Count the words, characters and lines in any text, as you type."',
  runtime: "--runtime client",
  tags: "--tags words,characters",
};

const describeFlag = (field: string) => FLAG[field] ?? field;

/**
 * Checks one input value without building the whole manifest, so the prompts can refuse a wrong
 * answer at once. Returns a sentence, or undefined when the value is fine.
 */
export function checkField(field: keyof NewToolInput, value: string | readonly string[]) {
  const problems = validateInput({ ...blankInput(), [field]: value }, [field]);
  return problems[0];
}

function blankInput(): NewToolInput {
  return {
    id: "example",
    name: "Example",
    category: siteConfig.categoryIds[0] ?? "text",
    summary: "An example summary that is long enough to pass.",
    runtime: "client",
    tags: ["example"],
  };
}

/**
 * Validates the input against the SDK manifest schema and the site's categories and reserved
 * paths. `only` limits the answer to some fields (for a prompt); without it every field is checked.
 */
export function validateInput(input: NewToolInput, only?: readonly string[]): string[] {
  const problems: string[] = [];
  const wanted = (field: string) => only === undefined || only.includes(field);

  const candidate = {
    ...input,
    tags: [...input.tags],
    status: "beta",
    input: z.object({ text: z.string() }),
    related: [],
    added: "2026-01-01",
    updated: "2026-01-01",
  };
  const parsed = toolManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "");
      // The runtime has a plainer message of its own, below.
      if (!wanted(field) || !(field in FLAG) || field === "runtime") continue;
      problems.push(
        `${describeFlag(field)}: ${issue.message}. Example: ${EXAMPLES[field] ?? describeFlag(field)}`,
      );
    }
  }

  if (wanted("runtime") && !["client", "worker", "server"].includes(input.runtime)) {
    if (!problems.some((problem) => problem.startsWith("--runtime"))) {
      problems.push(`--runtime: must be client, worker or server. Example: ${EXAMPLES.runtime}`);
    }
  }

  if (wanted("category") && !siteConfig.categoryIds.includes(input.category)) {
    const bySlug = siteConfig.categories.find((category) => category.slug === input.category);
    const hint = bySlug
      ? ` "${input.category}" is the URL slug of "${bySlug.name}"; the category id is "${bySlug.id}".`
      : "";
    if (!problems.some((problem) => problem.startsWith("--category"))) {
      problems.push(
        `--category: "${input.category}" is not a category id.${hint} Use one of: ${siteConfig.categoryIds.join(", ")}. Example: ${EXAMPLES.category}`,
      );
    }
  }

  if (wanted("id") && KEBAB_CASE.test(input.id)) {
    const slug = siteConfig.categories.find((category) => category.slug === input.id);
    if (slug) {
      problems.push(
        `--id: "${input.id}" is the URL of the category page "${slug.name}" (/${slug.slug}/), and a tool's id is its URL. Choose a different id, for example the same words with the action first.`,
      );
    } else if ((siteConfig.staticPagePaths as readonly string[]).includes(input.id)) {
      problems.push(
        `--id: "${input.id}" is the URL of a page the site already has (/${input.id}/), and a tool's id is its URL. Choose a different id.`,
      );
    } else if (siteConfig.reservedPaths.includes(input.id)) {
      problems.push(`--id: "${input.id}" is a reserved path. Choose a different id.`);
    }
  }
  return problems;
}

/**
 * Refuses a tool that would collide with what exists: its id in any category, its folder, and the
 * name and summary of another tool. Uses the same gates the build runs, on the tool as it would be.
 */
async function checkCollisions(
  values: NewToolInput & { today: string },
  root: string,
  label: string,
  fs: FileSystem,
): Promise<string[]> {
  const problems: string[] = [];
  const dir = `${label}/${values.category}/${values.id}`;

  const existing = await loadTools(root, label);
  const sameId = existing.find((tool) => tool.entry.dir.endsWith(`/${values.id}`));
  if (sameId) {
    problems.push(
      `--id: a tool with the id "${values.id}" already exists at ${sameId.entry.dir}. A tool's id is its URL, so it must be unique; choose another id.`,
    );
  }
  if (fs.exists(join(root, values.category, values.id))) {
    problems.push(`${dir} already exists. The generator never overwrites a folder.`);
  }
  if (problems.length > 0) return problems;

  // Run the build's own rules over the existing tools plus this one, and keep what is about it.
  const files = toolFiles({ ...values, runtime: values.runtime as "client" });
  const virtual = {
    dir,
    manifest: {
      id: values.id,
      name: values.name,
      category: values.category,
      summary: values.summary,
      tags: [...values.tags],
      runtime: values.runtime,
      status: "beta",
      input: z.object({ text: z.string() }),
      related: [],
      added: values.today,
      updated: values.today,
    },
    files: [...REQUIRED_FILES],
    content: files["content/en.mdx"],
    island: files["island.astro"],
    sources: {},
  };
  const everyone = [...existing.map((tool) => tool.entry), virtual];
  const ours = (violation: ContractViolation) => violation.dir === dir;
  const found = [
    ...validateTools(everyone, {
      categoryIds: siteConfig.categoryIds,
      reservedPaths: siteConfig.reservedPaths,
    }),
    ...checkQuality(everyone, { gates: ["unique-name-and-summary"], focus: [dir] }),
  ].filter(ours);
  for (const violation of found) problems.push(formatViolation(violation).replace(/\n\s+/g, " — "));
  return problems;
}

/** The staging folder a run writes into. It starts with a dot, so no tool glob can match it. */
export const stagingDirFor = (root: string, id: string) => join(root, `.staging-${id}`);

/**
 * Creates a tool folder, or refuses and leaves nothing behind. Throws GeneratorError for input
 * that is refused, and the original error for anything unexpected, after cleaning up.
 */
export async function generateTool(
  input: NewToolInput,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const root = options.toolsRoot ?? defaultToolsRoot;
  const label = options.label ?? "tools";
  const fs = options.fs ?? nodeFileSystem;
  const today = options.today ?? localToday();

  const refused = validateInput(input);
  if (refused.length > 0) throw new GeneratorError(refused);

  const values = { ...input, today };
  const collisions = await checkCollisions(values, root, label, fs);
  if (collisions.length > 0) throw new GeneratorError(collisions);

  const files = toolFiles({ ...values, runtime: input.runtime as "client" });
  const finalDir = join(root, input.category, input.id);
  const result: GenerateResult = {
    dir: `${label}/${input.category}/${input.id}`,
    path: finalDir,
    files: Object.keys(files),
    dryRun: options.dryRun === true,
    runtime: input.runtime,
  };
  if (options.dryRun) return result;

  const staging = stagingDirFor(root, input.id);
  const categoryDir = join(root, input.category);
  const rootExisted = fs.exists(root);
  const categoryExisted = fs.exists(categoryDir);
  const cleanup = () => {
    fs.remove(staging);
    // Folders this run created, and nothing else has used, go too. The tool folder itself is only
    // ever moved into place as the very last step, so there is nothing of it to undo.
    if (!categoryExisted && fs.isEmptyDir(categoryDir)) fs.remove(categoryDir);
    if (!rootExisted && fs.isEmptyDir(root)) fs.remove(root);
  };
  options.registerCleanup?.(cleanup);

  try {
    if (fs.exists(staging)) fs.remove(staging);
    for (const [name, content] of Object.entries(files)) {
      fs.mkdir(dirname(join(staging, name)));
      fs.writeFile(join(staging, name), content);
    }
    fs.mkdir(categoryDir);
    fs.rename(staging, finalDir);
  } catch (error) {
    cleanup();
    throw error;
  }
  return result;
}

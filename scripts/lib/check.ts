// `pnpm check:tools`: every tool-specific gate, run on its own, with one readable summary.
//
// The gates are the ones the build runs (the contract from ADR 0033, the quality gates from ADR
// 0036) plus the purity rule of logic.ts. Nothing here is a second implementation of a rule: it
// gathers the folders, calls the SDK, and prints.

import {
  type ContractViolation,
  formatViolation,
  indentMessage,
  QUALITY_GATES,
  type QualityContext,
  resolveBudget,
  toolManifestSchema,
  toQualityEntries,
  validateTools,
} from "@networksinsights/tool-sdk";
import { checkLogicPurity } from "../../apps/web/src/lib/registry/purity";
import {
  checkSafeRendering,
  SAFE_RENDERING_FILES,
} from "../../apps/web/src/lib/registry/safe-rendering";
import { adrProblem } from "./adr";
import { defaultToolsRoot, findToolDir, listToolFolders, loadTools, siteConfig } from "./tools";

/** One line of the summary: a rule, and what it found. */
export interface CheckSection {
  id: string;
  title: string;
  rule: string;
  /** "warning" sections print advice and never fail the check (ADR 0044). */
  severity: "error" | "warning";
  violations: ContractViolation[];
  /** How long the rule took to run, in milliseconds. */
  ms: number;
}

/** A tool that has raised its JavaScript budget, so the owner can see who and why. */
export interface RaisedBudget {
  dir: string;
  initialKb: number;
  onDemandKb: number;
  reason: string;
}

export interface CheckReport {
  /** How many tool folders exist. */
  toolCount: number;
  /** The folders the report is about: every tool, or the one asked for. */
  checked: string[];
  sections: CheckSection[];
  raisedBudgets: RaisedBudget[];
  /** Problems that fail the check. Sections that only warn are counted in `warningCount`. */
  problemCount: number;
  /** Advice from the gates that only warn (ADR 0044). It never fails the check. */
  warningCount: number;
  ok: boolean;
  ms: number;
}

export interface CheckOptions {
  /** The tools folder. Defaults to the repo's `tools/`. */
  root?: string;
  /** How folders are named in messages: `tools`. */
  label?: string;
  /** Check one tool, by id. The others are still read, because some gates compare across tools. */
  tool?: string;
}

/** Raised for something the owner typed wrong, such as an id that no folder has. */
export class CheckUsageError extends Error {}

const now = () => performance.now();

function time<T>(action: () => T): { value: T; ms: number } {
  const start = now();
  const value = action();
  return { value, ms: now() - start };
}

/** The ids closest to a mistyped one: shared prefix, or contained in each other. */
function suggest(id: string, ids: readonly string[]): string[] {
  return ids
    .filter((other) => other.includes(id) || id.includes(other) || other.startsWith(id.slice(0, 4)))
    .slice(0, 5);
}

export async function checkTools(options: CheckOptions = {}): Promise<CheckReport> {
  const started = now();
  const root = options.root ?? defaultToolsRoot;
  const label = options.label ?? "tools";
  const folders = listToolFolders(root);

  let focus: string[] | undefined;
  if (options.tool !== undefined) {
    const found = findToolDir(root, options.tool, label);
    if (!found) {
      const close = suggest(
        options.tool,
        folders.map(([, id]) => id),
      );
      throw new CheckUsageError(
        `There is no tool with the id "${options.tool}" in ${label}/.${
          close.length > 0 ? ` Did you mean: ${close.join(", ")}?` : ""
        } A tool's id is the name of its folder, for example: pnpm check:tools --tool word-counter`,
      );
    }
    focus = [found.dir];
  }
  const inFocus = (dir: string) => focus === undefined || focus.includes(dir);

  const loaded = await loadTools(root, label, { focus: options.tool });
  const loadProblems = loaded.flatMap((tool) => tool.problems);
  const broken = new Set(loadProblems.map((problem) => problem.dir));
  const entries = loaded.map((tool) => tool.entry);
  const readable = entries.filter((entry) => !broken.has(entry.dir));

  const sections: CheckSection[] = [];

  const contract = time(() => [
    ...loadProblems,
    ...validateTools(readable, {
      categoryIds: siteConfig.categoryIds,
      reservedPaths: siteConfig.reservedPaths,
    }),
  ]);
  sections.push({
    id: "contract",
    title: "Tool contract",
    rule: "Folders, manifests, required files, island.astro and the page outline (docs/tool-contract.md).",
    severity: "error",
    violations: contract.value.filter((violation) => inFocus(violation.dir)),
    ms: contract.ms,
  });

  const purity = time(() =>
    readable.flatMap((entry) => {
      const source = entry.sources?.["logic.ts"];
      if (source === undefined || !inFocus(entry.dir)) return [];
      return checkLogicPurity(source, "logic.ts").map(
        (problem): ContractViolation => ({
          dir: entry.dir,
          file: "logic.ts",
          problem: `logic.ts ${problem}`,
          fix: "keep logic.ts to pure functions; move anything that touches the page or the network into ui.tsx (see “logic.ts: what pure means” in docs/tool-contract.md)",
        }),
      );
    }),
  );
  sections.push({
    id: "purity",
    title: "logic.ts is pure",
    rule: "No DOM, no Node globals, no network, no top-level statements, only allowed imports.",
    severity: "error",
    violations: purity.value,
    ms: purity.ms,
  });

  const rendering = time(() =>
    readable.flatMap((entry) => {
      if (!inFocus(entry.dir)) return [];
      return SAFE_RENDERING_FILES.flatMap((file) => {
        const source = entry.sources?.[file];
        if (source === undefined) return [];
        return checkSafeRendering(source, file).map(
          (problem): ContractViolation => ({
            dir: entry.dir,
            file,
            problem: `${file} ${problem}`,
            fix: "render words as text: {value} in JSX or textContent, never markup built from a string; see “Rendering user text” in docs/tool-contract.md",
          }),
        );
      });
    }),
  );
  sections.push({
    id: "safe-rendering",
    title: "User text is rendered as text",
    rule: "No innerHTML, dangerouslySetInnerHTML, eval or any other API that turns a string into markup or code (ADR 0050).",
    severity: "error",
    violations: rendering.value,
    ms: rendering.ms,
  });

  // A security override (ADR 0047) is only as good as the decision behind it.
  const overrides = time(() =>
    readable.flatMap((entry): ContractViolation[] => {
      const parsed = toolManifestSchema.safeParse(entry.manifest);
      if (!parsed.success || !parsed.data.security || !inFocus(entry.dir)) return [];
      const problem = adrProblem(parsed.data.security.adr);
      return problem === undefined
        ? []
        : [
            {
              dir: entry.dir,
              file: "tool.config.ts",
              problem: `security names ${problem}`,
              fix: "write the ADR that approves this override and have the owner accept it, or remove security from the manifest (docs/runbooks/security.md, “Adding a CSP exception”)",
            },
          ];
    }),
  );
  sections.push({
    id: "security-override",
    title: "Security overrides are approved",
    rule: "A manifest that asks for more than the site-wide headers names an accepted ADR (ADR 0047).",
    severity: "error",
    violations: overrides.value,
    ms: overrides.ms,
  });

  const context: QualityContext = {
    entries: toQualityEntries(readable),
    focus: focus ? new Set(focus) : undefined,
  };
  for (const gate of QUALITY_GATES) {
    const run = time(() => gate.run(context));
    sections.push({
      id: gate.id,
      title: gate.title,
      rule: gate.rule,
      severity: gate.severity ?? "error",
      violations: run.value.sort((a, b) => a.dir.localeCompare(b.dir)),
      ms: run.ms,
    });
  }

  const raisedBudgets = readable.flatMap((entry): RaisedBudget[] => {
    const parsed = toolManifestSchema.safeParse(entry.manifest);
    if (!parsed.success || !parsed.data.budget || !inFocus(entry.dir)) return [];
    const { initialKb, onDemandKb } = resolveBudget(parsed.data.budget);
    return [{ dir: entry.dir, initialKb, onDemandKb, reason: parsed.data.budget.reason }];
  });

  const countOf = (severity: "error" | "warning") =>
    sections
      .filter((section) => section.severity === severity)
      .reduce((sum, section) => sum + section.violations.length, 0);
  const problemCount = countOf("error");
  return {
    toolCount: folders.length,
    checked: entries.map((entry) => entry.dir).filter(inFocus),
    sections,
    raisedBudgets,
    problemCount,
    warningCount: countOf("warning"),
    ok: problemCount === 0,
    ms: now() - started,
  };
}

/** The summary the owner reads: one line per gate, then every problem with its fix. */
export function formatReport(report: CheckReport): string {
  const out: string[] = [];
  const scope =
    report.checked.length === report.toolCount
      ? `${report.toolCount} ${report.toolCount === 1 ? "tool" : "tools"}`
      : `${report.checked.join(", ")} (of ${report.toolCount} tools)`;
  out.push(`Tool checks: ${scope}`, "");

  const width = Math.max(...report.sections.map((section) => section.id.length));
  for (const section of report.sections) {
    const isWarning = section.severity === "warning";
    const mark = section.violations.length === 0 ? "✓" : isWarning ? "!" : "✗";
    const [one, many] = isWarning ? ["warning", "warnings"] : ["problem", "problems"];
    const count =
      section.violations.length === 0
        ? ""
        : `  ${section.violations.length} ${section.violations.length === 1 ? one : many}`;
    out.push(`  ${mark} ${section.id.padEnd(width)}  ${section.title}${count}`);
  }

  if (report.toolCount === 0) {
    out.push("", "  There are no tools yet, so every gate passes with nothing to check.");
  }

  if (report.raisedBudgets.length > 0) {
    out.push("", "Raised JavaScript budgets (with the reason each tool gave):");
    for (const budget of report.raisedBudgets) {
      out.push(
        `  ${budget.dir}: initial ${budget.initialKb} KB, on demand ${budget.onDemandKb} KB — ${budget.reason}`,
      );
    }
  }

  if (report.problemCount > 0) {
    out.push(
      "",
      `${report.problemCount} ${report.problemCount === 1 ? "problem" : "problems"} to fix:`,
      "",
    );
    const byTool = new Map<string, ContractViolation[]>();
    for (const section of report.sections) {
      if (section.severity === "warning") continue;
      for (const violation of section.violations) {
        byTool.set(violation.dir, [...(byTool.get(violation.dir) ?? []), violation]);
      }
    }
    for (const [dir, violations] of [...byTool].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`${dir}`);
      for (const violation of violations) out.push(indentMessage(formatViolation(violation)));
      out.push("");
    }
    out.push("Fix one tool at a time: pnpm check:tools --tool <tool-id>");
  } else {
    out.push("", `All checks pass (${Math.round(report.ms)} ms).`);
  }

  if (report.warningCount > 0) {
    out.push(
      "",
      `${report.warningCount} ${report.warningCount === 1 ? "warning" : "warnings"} (these do not fail the check):`,
      "",
    );
    for (const section of report.sections) {
      if (section.severity !== "warning") continue;
      for (const violation of section.violations) {
        out.push(violation.dir, indentMessage(formatViolation(violation)), "");
      }
    }
  }
  return out.join("\n");
}

/** The report as JSON, for an agent or a script to read. */
export function reportToJson(report: CheckReport): string {
  return JSON.stringify(
    {
      ok: report.ok,
      tools: report.toolCount,
      checked: report.checked,
      problems: report.problemCount,
      warnings: report.warningCount,
      ms: Math.round(report.ms),
      gates: report.sections.map((section) => ({
        id: section.id,
        title: section.title,
        rule: section.rule,
        severity: section.severity,
        ok: section.severity === "warning" || section.violations.length === 0,
        ms: Math.round(section.ms),
        problems: section.violations.map((violation) => ({
          tool: violation.dir,
          file: violation.file ? `${violation.dir}/${violation.file}` : undefined,
          problem: violation.problem,
          fix: violation.fix,
          example: violation.example,
        })),
      })),
      raisedBudgets: report.raisedBudgets,
    },
    null,
    2,
  );
}

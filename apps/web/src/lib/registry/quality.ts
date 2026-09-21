// What the site does with content quality problems (ADR 0036).
//
// The gates themselves live in the SDK and are the same everywhere. What differs is the answer:
//
//   fail  the production build, `pnpm check:tools` and CI. A page with thin, copied or unfinished
//         content must not ship, so the problem stops the build.
//   warn  `astro dev`. A tool that is still being written keeps rendering, and the terminal says
//         what is left to do, so the owner can write the content and the code a bit at a time.
//
// Contract and purity violations are not handled here. They break rendering, so they stay hard
// failures in every mode (build.ts throws them, purity.test.ts checks purity).

import {
  type ContractViolation,
  checkQuality,
  checkQualityWarnings,
  formatViolation,
  indentMessage,
  type ToolEntry,
} from "@networksinsights/tool-sdk";

export type QualityMode = "warn" | "fail";

/** Thrown by the production build when a tool's content is not ready to publish. */
export class ToolQualityError extends Error {
  readonly violations: readonly ContractViolation[];

  constructor(violations: readonly ContractViolation[]) {
    const lines = violations.map((violation) => indentMessage(formatViolation(violation)));
    super(
      `${violations.length} content quality ${violations.length === 1 ? "problem" : "problems"} (ADR 0036):\n${lines.join("\n")}\n\nCheck one tool while you work on it: pnpm check:tools --tool <tool-id>`,
    );
    this.name = "ToolQualityError";
    this.violations = violations;
  }
}

/** Dev warns and keeps going; everything else stops. */
export function qualityMode(isDev: boolean): QualityMode {
  return isDev ? "warn" : "fail";
}

/**
 * Runs the quality gates over the tool set. In `fail` mode a problem throws. In `warn` mode it is
 * handed to `warn` as one readable message and the problems are returned, so the caller carries on.
 */
export function enforceQuality(
  entries: readonly ToolEntry[],
  mode: QualityMode,
  warn: (message: string) => void = console.warn,
): ContractViolation[] {
  const violations = checkQuality(entries);
  if (violations.length === 0) return violations;

  const error = new ToolQualityError(violations);
  if (mode === "fail") throw error;
  warn(
    `\n⚠ ${error.message.replace("(ADR 0036)", "(dev: the pages still render; the production build will fail)")}\n`,
  );
  return violations;
}

/**
 * Prints the advice of the gates that only warn (ADR 0044), in every mode, and returns it. Advice
 * never stops anything: a page is allowed to ship with it, and the message says how to act on it.
 */
export function adviseQuality(
  entries: readonly ToolEntry[],
  warn: (message: string) => void = console.warn,
): ContractViolation[] {
  const advice = checkQualityWarnings(entries);
  if (advice.length === 0) return advice;
  const lines = advice.map((violation) => indentMessage(formatViolation(violation)));
  const noun = advice.length === 1 ? "warning" : "warnings";
  warn(
    `\n! ${advice.length} content ${noun} (these do not fail the build):\n${lines.join("\n")}\n`,
  );
  return advice;
}

// The contract types every tool is built from. Pure TypeScript: this file imports nothing but
// Zod's type for the input schema, so the types can be read from any runtime (ADR 0031).

import type { ZodType } from "zod";

/** Where a tool's logic runs (ADR 0012). The privacy statement is derived from it (ADR 0034). */
export type ToolRuntime = "client" | "worker" | "server";

/** How finished a tool is. Only "beta" and "deprecated" show a badge on the page. */
export type ToolStatus = "beta" | "stable" | "deprecated";

/**
 * Caps for a future Pro tier. Absent means unlimited, which is what every tool ships with today
 * (ADR 0015): a limit that is not enforced must not be claimed on the page.
 */
export interface ToolLimits {
  /** Largest accepted input, in bytes. */
  maxInputBytes?: number;
  /** Largest number of files accepted at once. */
  maxFiles?: number;
  /** Runs per user per day. */
  maxRunsPerDay?: number;
}

/**
 * Raises the JavaScript budget of a tool that is genuinely heavy (ADR 0037). Absent means the
 * defaults. `reason` is required, is never shown on the tool page, and says in plain words why
 * this tool needs more.
 */
export interface ToolBudget {
  /** Gzip KB of island code loaded on page load, above the default. */
  maxInitialJsKb?: number | undefined;
  /** Gzip KB of code fetched only after a user action, above the default. */
  maxOnDemandJsKb?: number | undefined;
  /** Why the default is not enough. At least 20 characters. */
  reason: string;
}

/** An ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** The manifest of one tool: everything the platform needs to build its page and its listings. */
export interface ToolManifest<TInput extends ZodType = ZodType> {
  /** Kebab-case, unique, the same as the folder name. It becomes the URL: /<id>/ (ADR 0014). */
  id: string;
  /** Display name, used as the H1 and in the page title. */
  name: string;
  /** A category id from apps/web/src/config/categories.ts, the same as the parent folder name. */
  category: string;
  /** One sentence, unique across tools, under 160 characters. It is the meta description. */
  summary: string;
  /** Kebab-case keywords for listings and, from Mission 11, search. */
  tags: readonly string[];
  runtime: ToolRuntime;
  status: ToolStatus;
  /** The Zod schema of the tool's input (ADR 0006). */
  input: TInput;
  /** Ids of other tools to link to. Never this tool's own id. */
  related: readonly string[];
  /** Absent means unlimited. */
  limits?: ToolLimits;
  /** Absent means the default JavaScript budgets (ADR 0037). */
  budget?: ToolBudget;
  /** The date the tool went live. */
  added: IsoDate;
  /** The date it last changed. Never earlier than `added`. */
  updated: IsoDate;
}

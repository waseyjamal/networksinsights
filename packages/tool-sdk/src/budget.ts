// The JavaScript budgets of a tool page (ADR 0037). Pure numbers, so the manifest schema, the
// check:budgets script and the docs all read one source.
//
// Two numbers, measured separately on the built page, both in KB of gzip:
//
//   initial    the tool's own code loaded on page load: the island's static import closure, without
//              the shared renderer (React, ReactDOM, Astro's client runtime).
//   on demand  code fetched only after the visitor does something (chooses a file, presses a
//              button): chunks reached only through a dynamic import(), and the .wasm files those
//              chunks load.
//
// Lazy loading is rewarded: moving an engine from the first number to the second is the way to
// stay within budget, and the second number is much higher.

/** What a tool may load on page load without saying why. */
export const DEFAULT_INITIAL_JS_KB = 40;

/** The most any manifest can raise the initial budget to. Beyond it needs an ADR. */
export const INITIAL_JS_CEILING_KB = 250;

/** What a tool may fetch after a user action without saying why. Fits a PDF or image codec. */
export const DEFAULT_ON_DEMAND_JS_KB = 1024;

/** The most any manifest can raise the on-demand budget to. Beyond it needs an ADR. */
export const ON_DEMAND_JS_CEILING_KB = 8192;

/** The shortest reason that can honestly explain a raised budget. */
export const BUDGET_REASON_MIN_LENGTH = 20;

/** A budget the tool page is held to, in KB of gzip. */
export interface ResolvedBudget {
  initialKb: number;
  onDemandKb: number;
}

/** The budgets that apply to a manifest: its own raised numbers, or the defaults. */
export function resolveBudget(budget?: {
  maxInitialJsKb?: number | undefined;
  maxOnDemandJsKb?: number | undefined;
}): ResolvedBudget {
  return {
    initialKb: budget?.maxInitialJsKb ?? DEFAULT_INITIAL_JS_KB,
    onDemandKb: budget?.maxOnDemandJsKb ?? DEFAULT_ON_DEMAND_JS_KB,
  };
}

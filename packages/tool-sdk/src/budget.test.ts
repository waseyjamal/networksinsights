import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BUDGET_REASON_MIN_LENGTH,
  DEFAULT_INITIAL_JS_KB,
  DEFAULT_ON_DEMAND_JS_KB,
  INITIAL_JS_CEILING_KB,
  ON_DEMAND_JS_CEILING_KB,
  resolveBudget,
} from "./budget";
import { toolBudgetSchema, toolManifestSchema } from "./manifest";

// The manifest field that raises a tool's JavaScript budget (ADR 0037): it must raise something,
// stay under a ceiling, and say why.

const manifest = {
  id: "word-counter",
  name: "Word counter",
  category: "text",
  summary: "Count the words, characters and lines in any text, as you type.",
  tags: ["words"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string() }),
  related: [],
  added: "2026-09-20",
  updated: "2026-09-20",
};

const messages = (budget: unknown) => {
  const parsed = toolBudgetSchema.safeParse(budget);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("the numbers", () => {
  it("are 40 KB initial and 1,024 KB on demand by default, with ceilings above them", () => {
    expect(DEFAULT_INITIAL_JS_KB).toBe(40);
    expect(DEFAULT_ON_DEMAND_JS_KB).toBe(1024);
    expect(INITIAL_JS_CEILING_KB).toBe(250);
    expect(ON_DEMAND_JS_CEILING_KB).toBe(8192);
    expect(INITIAL_JS_CEILING_KB).toBeGreaterThan(DEFAULT_INITIAL_JS_KB);
    expect(ON_DEMAND_JS_CEILING_KB).toBeGreaterThan(DEFAULT_ON_DEMAND_JS_KB);
  });

  it("resolve to the defaults, or to the manifest's own raised numbers", () => {
    expect(resolveBudget()).toEqual({ initialKb: 40, onDemandKb: 1024 });
    expect(resolveBudget({ maxInitialJsKb: 100 })).toEqual({ initialKb: 100, onDemandKb: 1024 });
    expect(resolveBudget({ maxOnDemandJsKb: 4000 })).toEqual({ initialKb: 40, onDemandKb: 4000 });
  });
});

describe("the manifest field", () => {
  it("accepts a raised budget with a reason", () => {
    const budget = { maxInitialJsKb: 120, reason: "Bundles a small parser the tool needs." };
    expect(toolBudgetSchema.safeParse(budget).success).toBe(true);
    expect(toolManifestSchema.safeParse({ ...manifest, budget }).success).toBe(true);
    expect(toolManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("accepts raising only the on-demand number, for a tool with a WebAssembly engine", () => {
    expect(
      toolBudgetSchema.safeParse({
        maxOnDemandJsKb: 3000,
        reason: "Loads a WebAssembly PDF renderer after a file is chosen.",
      }).success,
    ).toBe(true);
  });

  it("refuses a budget without a reason, or with a reason too short to explain anything", () => {
    expect(messages({ maxInitialJsKb: 80 }).join()).toContain("reason");
    expect(messages({ maxInitialJsKb: 80, reason: "big" })).toEqual([
      `budget.reason must say why this tool needs more, in at least ${BUDGET_REASON_MIN_LENGTH} characters`,
    ]);
    expect(messages({ maxInitialJsKb: 80, reason: "                          " }).join()).toContain(
      "budget.reason",
    );
  });

  it("refuses a budget that raises nothing", () => {
    expect(messages({ reason: "A reason that is long enough to read." })).toEqual([
      "budget must raise maxInitialJsKb or maxOnDemandJsKb, otherwise remove it",
    ]);
  });

  it("refuses a number at or below the default, which raises nothing", () => {
    expect(messages({ maxInitialJsKb: 40, reason: "A reason that is long enough." })[0]).toContain(
      "must be above the default of 40 KB",
    );
    expect(
      messages({ maxOnDemandJsKb: 1024, reason: "A reason that is long enough." })[0],
    ).toContain("must be above the default of 1024 KB");
  });

  it("refuses a number over the ceiling, and points at the dynamic import", () => {
    const initial = messages({ maxInitialJsKb: 251, reason: "A reason that is long enough." });
    expect(initial[0]).toContain("at most 250 KB, the ceiling");
    expect(initial[0]).toContain("dynamic import()");
    expect(
      messages({ maxOnDemandJsKb: 8193, reason: "A reason that is long enough." })[0],
    ).toContain("at most 8192 KB, the ceiling");
  });

  it("refuses a field it does not know", () => {
    expect(
      toolBudgetSchema.safeParse({
        maxInitialJsKb: 80,
        reason: "A reason that is long enough.",
        x: 1,
      }).success,
    ).toBe(false);
  });
});

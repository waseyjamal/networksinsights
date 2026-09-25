import { describe, expect, it } from "vitest";
import { z } from "zod";
import { config } from "zod/v4/core";

// "zod" in the web app is the jitless wrapper (astro.config.mjs, src/lib/zod-jitless.ts), so a tool
// that validates in the browser never asks the CSP for eval (ADR 0047).

describe("zod in the web app", () => {
  it("is in jitless mode as soon as it is imported", () => {
    expect(config().jitless).toBe(true);
  });

  it("still validates, with the ordinary validators", () => {
    const schema = z.object({ text: z.string().max(5) });
    expect(schema.safeParse({ text: "short" }).success).toBe(true);
    expect(schema.safeParse({ text: "too long" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { overrideDirectives, overrideMarker, toolSecuritySchema } from "./security";

describe("toolSecuritySchema", () => {
  it("accepts cross-origin isolation with an ADR", () => {
    expect(toolSecuritySchema.safeParse({ adr: "0051", crossOriginIsolated: true }).success).toBe(
      true,
    );
  });

  it("accepts named https origins on fetch directives", () => {
    const parsed = toolSecuritySchema.safeParse({
      adr: "0052",
      sources: { "connect-src": ["https://api.example.com", "https://*.example.org:8443"] },
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a four-digit ADR", () => {
    for (const adr of [undefined, "51", "ADR-0051", "00510"]) {
      expect(
        toolSecuritySchema.safeParse({ adr, crossOriginIsolated: true }).success,
        `${adr}`,
      ).toBe(false);
    }
  });

  it("requires the override to ask for something", () => {
    expect(toolSecuritySchema.safeParse({ adr: "0051" }).success).toBe(false);
  });

  it("never widens scripts or styles", () => {
    for (const directive of ["script-src", "style-src", "default-src", "frame-ancestors"]) {
      const parsed = toolSecuritySchema.safeParse({
        adr: "0051",
        sources: { [directive]: ["https://cdn.example.com"] },
      });
      expect(parsed.success, directive).toBe(false);
    }
  });

  it("refuses keywords, schemes, wildcards and paths", () => {
    for (const source of [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "*",
      "https:",
      "http://api.example.com",
      "data:",
      "blob:",
      "https://api.example.com/path",
      "https://*",
      "https://api.example.com;script-src *",
      "https://API.example.com",
    ]) {
      const parsed = toolSecuritySchema.safeParse({
        adr: "0051",
        sources: { "connect-src": [source] },
      });
      expect(parsed.success, source).toBe(false);
    }
  });
});

describe("overrideDirectives and overrideMarker", () => {
  it("turns sources into directives in a fixed order", () => {
    expect(
      overrideDirectives({
        sources: {
          "worker-src": ["https://w.example.com"],
          "connect-src": ["https://a.example.com", "https://b.example.com"],
        },
      }),
    ).toEqual([
      "connect-src https://a.example.com https://b.example.com",
      "worker-src https://w.example.com",
    ]);
    expect(overrideDirectives({})).toEqual([]);
  });

  it("marks the page with its ADR and whether it is isolated", () => {
    expect(overrideMarker({ adr: "0051" })).toBe("adr=0051");
    expect(overrideMarker({ adr: "0051", crossOriginIsolated: true })).toBe(
      "adr=0051; cross-origin-isolated",
    );
  });
});

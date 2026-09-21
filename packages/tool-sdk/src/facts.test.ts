import { describe, expect, it } from "vitest";
import {
  describeLimits,
  formatBytes,
  formatIsoDate,
  NO_FIXED_LIMIT,
  type QuickFactsSource,
  quickFacts,
} from "./facts";
import { privacyStatement } from "./privacy";

const base: QuickFactsSource = { runtime: "client", updated: "2026-09-20" };
const facts = (over: Partial<QuickFactsSource> = {}) =>
  Object.fromEntries(quickFacts({ ...base, ...over }).map((fact) => [fact.id, fact.value]));

describe("quick facts", () => {
  it("always says: free, no sign-up, where it runs, whether files are uploaded, limits, updated", () => {
    expect(quickFacts(base).map((fact) => fact.label)).toEqual([
      "Price",
      "Sign-up",
      "Where it runs",
      "Files uploaded",
      "Limits",
      "Updated",
    ]);
    expect(facts()).toMatchObject({ price: "Free", signup: "Not required" });
  });

  it("derives where it runs and whether files are uploaded from the runtime, like the privacy line", () => {
    for (const runtime of ["client", "worker"] as const) {
      expect(facts({ runtime })).toMatchObject({ runs: "On your device", uploaded: "No" });
      expect(privacyStatement(runtime).onDevice).toBe(true);
    }
    expect(facts({ runtime: "server" })).toMatchObject({ runs: "On our server", uploaded: "Yes" });
    expect(privacyStatement("server").onDevice).toBe(false);
  });

  it("says there is no fixed limit unless the manifest sets one", () => {
    expect(facts().limits).toBe(NO_FIXED_LIMIT);
    expect(facts({ limits: {} }).limits).toBe("No fixed limit");
  });

  it("shows Accepts and Produces only when they are listed", () => {
    expect(Object.keys(facts())).not.toContain("accepts");
    expect(Object.keys(facts({ accepts: [], produces: [] }))).not.toContain("produces");
    expect(facts({ accepts: ["JPG", "PNG"], produces: ["WebP"] })).toMatchObject({
      accepts: "JPG, PNG",
      produces: "WebP",
    });
  });

  it("puts Accepts and Produces between the limits and the date", () => {
    const ids = quickFacts({ ...base, accepts: ["PDF"], produces: ["PDF"] }).map((fact) => fact.id);
    expect(ids).toEqual([
      "price",
      "signup",
      "runs",
      "uploaded",
      "limits",
      "accepts",
      "produces",
      "updated",
    ]);
  });

  it("shows the update date as a reader writes it", () => {
    expect(facts({ updated: "2026-09-20" }).updated).toBe("September 20, 2026");
    expect(facts({ updated: "2027-01-05" }).updated).toBe("January 5, 2027");
  });
});

describe("formatIsoDate", () => {
  it("does not depend on the machine's time zone", () => {
    expect(formatIsoDate("2026-12-31")).toBe("December 31, 2026");
    expect(formatIsoDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatIsoDate("2024-02-29")).toBe("February 29, 2024");
  });

  it("refuses text that is not an ISO date", () => {
    for (const bad of ["", "2026-9-1", "20-09-2026", "2026-13-01", "yesterday"]) {
      expect(() => formatIsoDate(bad), bad).toThrow(/Not an ISO date/);
    }
  });
});

describe("limits", () => {
  it("formats sizes in words a person reads", () => {
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(500)).toBe("500 bytes");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.5 GB");
  });

  it("describes every limit that is set, and only those", () => {
    expect(describeLimits(undefined)).toBe("No fixed limit");
    expect(describeLimits({ maxInputBytes: 10 * 1024 * 1024 })).toBe("Up to 10 MB per input");
    expect(describeLimits({ maxFiles: 1 })).toBe("Up to 1 file at once");
    expect(describeLimits({ maxFiles: 20, maxRunsPerDay: 50 })).toBe(
      "Up to 20 files at once; Up to 50 runs per day",
    );
    expect(describeLimits({ maxInputBytes: 1024, maxFiles: 2, maxRunsPerDay: 3 })).toBe(
      "Up to 1 KB per input; Up to 2 files at once; Up to 3 runs per day",
    );
  });
});

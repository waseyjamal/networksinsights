import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { analyticsSettings, TRACKER, UMAMI_HOST } from "./analytics";
import { csp } from "./headers";
import { site } from "./site";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("analyticsSettings", () => {
  it("is off without a website id", () => {
    expect(analyticsSettings({})).toBeUndefined();
    expect(analyticsSettings({ UMAMI_WEBSITE_ID: "  " })).toBeUndefined();
  });

  it("runs only on the production domain", () => {
    expect(analyticsSettings({ UMAMI_WEBSITE_ID: ` ${ID.toUpperCase()} ` })).toEqual({
      websiteId: ID,
      domains: site.domain,
    });
  });

  it("fails the build on a value that is not a website id", () => {
    expect(() => analyticsSettings({ UMAMI_WEBSITE_ID: "my-site" })).toThrow(/UUID/);
  });
});

describe("the tracker file", () => {
  const tracker = readFileSync(new URL("../lib/analytics/umami-tracker.js", import.meta.url));

  it("is the reviewed copy (update it only through lib/analytics/VENDOR.md)", () => {
    expect(createHash("sha256").update(tracker).digest("hex")).toBe(TRACKER.sha256);
  });

  it("sends to the one host the Content-Security-Policy allows", () => {
    expect(tracker.toString("utf8")).toContain(`"${UMAMI_HOST}"`);
    expect(csp.directives).toContain(`connect-src 'self' ${UMAMI_HOST}`);
  });

  it("stays within its 3 KB gzip budget (ADR 0051)", () => {
    expect(gzipSync(tracker, { level: 9 }).length).toBeLessThanOrEqual(3 * 1024);
  });
});

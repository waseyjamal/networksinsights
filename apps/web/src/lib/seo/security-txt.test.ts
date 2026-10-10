import { describe, expect, it } from "vitest";
import { buildSecurityTxt, securityTxt, securityTxtBody } from "./security-txt";

describe("security.txt (RFC 9116)", () => {
  const body = securityTxtBody();

  it("has a Contact that is a mailto URI", () => {
    expect(body).toMatch(/^Contact: mailto:[^@\s]+@[^@\s]+$/m);
  });

  it("names its own canonical URL on the production domain", () => {
    expect(body).toMatch(
      /^Canonical: https:\/\/networksinsights\.com\/\.well-known\/security\.txt$/m,
    );
  });

  it("has exactly one Expires, as a date-time that has not passed", () => {
    const lines = body.split("\n").filter((line) => line.startsWith("Expires:"));
    expect(lines).toHaveLength(1);
    const date = new Date(securityTxt.expires);
    expect(Number.isNaN(date.getTime())).toBe(false);
    // Fails on the day the file expires: renew `securityTxt.expires` then.
    expect(date.getTime()).toBeGreaterThan(Date.now());
    // RFC 9116 asks for less than a year ahead; a few days of slack for the day it was written.
    expect(date.getTime()).toBeLessThan(Date.now() + 366 * 24 * 3600 * 1000);
  });

  it("is plain lines that end with a newline", () => {
    expect(body.endsWith("\n")).toBe(true);
    expect(body).not.toContain("\r");
  });

  it("builds the fields it is given", () => {
    const text = buildSecurityTxt({
      contact: "mailto:a@example.test",
      expires: "2030-01-01T00:00:00.000Z",
      url: "https://example.test",
    });
    expect(text).toContain("Contact: mailto:a@example.test");
    expect(text).toContain("Canonical: https://example.test/.well-known/security.txt");
  });
});

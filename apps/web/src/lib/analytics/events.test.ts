import { describe, expect, it } from "vitest";
import { errorReport, MAX_MESSAGE_LENGTH, reportLimiter, scrubMessage, sourceOf } from "./events";

const origin = "https://networksinsights.com";

describe("scrubMessage", () => {
  it("keeps the shape of an error and nothing a visitor typed", () => {
    const message =
      "Invalid URL: \"https://example.org/private?token=abc\" for anna@example.org, order 1234567 'my secret'";
    const scrubbed = scrubMessage(message);
    expect(scrubbed).toBe("Invalid URL: <text> for <email>, order <number> <text>");
    for (const leak of ["example.org", "anna", "1234567", "secret", "token"]) {
      expect(scrubbed).not.toContain(leak);
    }
  });

  it("replaces bare URLs and keeps short numbers, which are rarely personal", () => {
    expect(scrubMessage("fetch https://a.b/c?d=e failed at step 3")).toBe(
      "fetch <url> failed at step 3",
    );
  });

  it("keeps a browser's own wording readable", () => {
    expect(scrubMessage("Cannot read properties of undefined (reading 'length')")).toBe(
      "Cannot read properties of undefined (reading <text>)",
    );
  });

  it("collapses whitespace and cuts long messages", () => {
    const scrubbed = scrubMessage(`a\n\n  b ${"x".repeat(500)}`);
    expect(scrubbed.startsWith("a b x")).toBe(true);
    expect(scrubbed).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(scrubbed.endsWith("…")).toBe(true);
  });
});

describe("sourceOf", () => {
  it("keeps the path of our own files without query or hash", () => {
    expect(sourceOf(`${origin}/_astro/ui.Ab12.js?v=1#x`, origin)).toBe("/_astro/ui.Ab12.js");
  });

  it("never reports another origin's address", () => {
    expect(sourceOf("https://extension.example/inject.js", origin)).toBe("external");
    expect(sourceOf("chrome-extension://abcdef/content.js", origin)).toBe("external");
  });

  it("is empty when the browser gives no file", () => {
    expect(sourceOf(undefined, origin)).toBe("");
    expect(sourceOf("", origin)).toBe("");
  });
});

describe("errorReport", () => {
  it("reports an Error by its name and scrubbed message", () => {
    const report = errorReport({
      error: new TypeError("bad value 'hunter2'"),
      filename: `${origin}/_astro/client.js`,
      line: 12,
      column: 7.9,
      origin,
      tool: "word-counter",
    });
    expect(report).toEqual({
      name: "TypeError",
      message: "bad value <text>",
      source: "/_astro/client.js",
      line: 12,
      column: 7,
      tool: "word-counter",
    });
  });

  it("reports a thrown string or object by its type, never its contents", () => {
    expect(errorReport({ error: "boom 'x'", origin, tool: "" })).toMatchObject({
      name: "string",
      message: "boom <text>",
    });
    expect(errorReport({ error: { password: "x" }, origin, tool: "" })).toMatchObject({
      name: "object",
      message: "",
    });
  });

  it("falls back to the event's message, and to zero for missing positions", () => {
    expect(errorReport({ error: null, message: "Script error.", origin, tool: "" })).toMatchObject({
      name: "Error",
      message: "Script error.",
      source: "",
      line: 0,
      column: 0,
    });
  });
});

describe("reportLimiter", () => {
  const base = { name: "Error", message: "m", source: "/a.js", line: 1, column: 1, tool: "" };

  it("drops repeats and stops at the limit", () => {
    const allow = reportLimiter(2);
    expect(allow(base)).toBe(true);
    expect(allow({ ...base, column: 2 })).toBe(false);
    expect(allow({ ...base, line: 2 })).toBe(true);
    expect(allow({ ...base, line: 3 })).toBe(false);
  });
});

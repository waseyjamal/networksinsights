import { describe, expect, it } from "vitest";
import { type Decoded, formatDuration, formatUtc, MAX_CHARS, run, timeStatus } from "./logic";

/** The HS256 sample token most JWT guides use. Its signature was made with a secret we do not use. */
const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

/** Base64URL of a text, the way a token writes it. */
function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function token(header: unknown, payload: unknown, signature = "c2ln"): string {
  const write = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  return `${b64url(write(header))}.${b64url(write(payload))}.${signature}`;
}

function decoded(text: string): Decoded {
  const result = run({ text });
  if (!result.ok) throw new Error(`expected a decode, got: ${result.error}`);
  return result;
}

function failure(text: string) {
  const result = run({ text });
  if (result.ok) throw new Error("expected a failure");
  return result;
}

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const seconds = (ms: number) => ms / 1000;

describe("decoding", () => {
  it("decodes the sample token into header, payload and signature", () => {
    const result = decoded(SAMPLE);
    expect(result.header.json).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect(result.payload.json).toBe(
      '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}',
    );
    expect(result.algorithm).toBe("HS256");
    expect(result.signature).toEqual({
      base64url: "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
      bytes: 32,
    });
    expect(result.times).toEqual([
      { name: "iat", label: "Issued at", seconds: 1516239022, utc: "2018-01-18 01:30:22 UTC" },
    ]);
    expect(result.problems).toEqual([]);
  });

  it("reads UTF-8 text in the payload", () => {
    const result = decoded(token({ alg: "none" }, { name: "Zoë 你好 🚀" }));
    expect(result.payload.json).toContain('"name": "Zoë 你好 🚀"');
  });

  it("copies numbers and strings exactly as written, and keeps every key", () => {
    const payload =
      '{"id":12345678901234567890,"price":1.50,"big":1E+5,"a":1,"a":2,"s":"a\\"b, c: d"}';
    const result = decoded(token({ alg: "none" }, payload));
    expect(result.payload.json).toBe(
      [
        "{",
        '  "id": 12345678901234567890,',
        '  "price": 1.50,',
        '  "big": 1E+5,',
        '  "a": 1,',
        '  "a": 2,',
        '  "s": "a\\"b, c: d"',
        "}",
      ].join("\n"),
    );
  });

  it("indents nested objects and arrays, and keeps empty ones on one line", () => {
    const result = decoded(token({ alg: "none" }, '{"roles":["a",{"b":[]}],"empty":{},"n":null}'));
    expect(result.payload.json).toBe(
      [
        "{",
        '  "roles": [',
        '    "a",',
        "    {",
        '      "b": []',
        "    }",
        "  ],",
        '  "empty": {},',
        '  "n": null',
        "}",
      ].join("\n"),
    );
  });

  it("accepts a Bearer prefix, line breaks and spaces around the token", () => {
    const wrapped = `  Bearer ${SAMPLE.slice(0, 30)}\n${SAMPLE.slice(30, 100)} \r\n${SAMPLE.slice(100)}\n`;
    expect(decoded(wrapped)).toEqual(decoded(SAMPLE));
    expect(decoded(`bearer ${SAMPLE}`)).toEqual(decoded(SAMPLE));
  });

  it("accepts a token with no signature (alg none)", () => {
    const result = decoded(`${b64url('{"alg":"none"}')}.${b64url('{"a":1}')}.`);
    expect(result.signature).toEqual({ base64url: "", bytes: 0 });
    expect(result.algorithm).toBe("none");
  });

  it("tolerates trailing = padding and reports no algorithm when there is none", () => {
    const padded = `${b64url("{}")}==.${b64url("{}")}.c2ln=`;
    const result = decoded(padded);
    expect(result.algorithm).toBeNull();
    expect(result.signature.base64url).toBe("c2ln");
  });

  it("ignores an alg that is not a string", () => {
    expect(decoded(token({ alg: 5 }, {})).algorithm).toBeNull();
  });
});

describe("errors", () => {
  it("asks for a token when the input is empty or only spaces", () => {
    expect(failure("")).toMatchObject({ reason: "empty", error: "Paste a token to decode it." });
    expect(failure("  \n ").reason).toBe("empty");
    expect(failure("Bearer ").reason).toBe("empty");
  });

  it("says how many parts a wrong token has", () => {
    expect(failure("abc").error).toContain("has no dot");
    expect(failure("a.b").error).toContain("this has 2");
    expect(failure("a.b.c.d").error).toContain("this has 4");
  });

  it("recognises an encrypted token by its five parts", () => {
    const result = failure("a.b.c.d.e");
    expect(result.reason).toBe("encrypted");
    expect(result.error).toContain("JWE");
  });

  it("names the part and the character that is not Base64URL", () => {
    const bad = `${b64url("{}")}.${b64url("{}").slice(0, 2)}!x.c2ln`;
    expect(failure(bad).error).toContain('Character 3 of the payload, "!"');
    expect(failure(`${b64url("{}")}.${b64url("{}")}.ab$c`).error).toContain(
      'Character 3 of the signature, "$"',
    );
  });

  it("explains standard Base64 characters", () => {
    const result = failure(`${b64url("{}")}.a+b/.c2ln`);
    expect(result.error).toContain('"+"');
    expect(result.error).toContain("Base64URL");
  });

  it("reports a part cut short", () => {
    const result = failure(`${b64url("{}")}xx.${b64url("{}")}.c2ln`);
    expect(result.error).toContain("The header is cut short");
  });

  it("reports a part that is not UTF-8, not JSON, or not an object", () => {
    // The bytes 0xFF 0xFE are not UTF-8.
    expect(failure(`__4.${b64url("{}")}.c2ln`).error).toContain(
      "The header decodes to bytes that are not valid UTF-8",
    );
    expect(failure(token("not json", {})).error).toBe(
      "The header decodes to text that is not valid JSON.",
    );
    expect(failure(token({ alg: "none" }, "[1,2]")).error).toContain(
      "The payload is JSON, but not a JSON object",
    );
    expect(failure(token({ alg: "none" }, '"text"')).error).toContain("not a JSON object");
    expect(failure(token({ alg: "none" }, "null")).error).toContain("not a JSON object");
  });

  it("refuses text over the limit", () => {
    const result = failure("a".repeat(MAX_CHARS + 1));
    expect(result.reason).toBe("too-large");
    expect(result.error).toContain("100,001 characters");
    expect(failure("a".repeat(MAX_CHARS)).reason).toBe("malformed");
  });
});

describe("time claims", () => {
  const at = (claims: Record<string, unknown>) => decoded(token({ alg: "HS256" }, claims));

  it("lists iat, nbf and exp in that order with their UTC moments", () => {
    const result = at({ exp: 2000000000, iat: 1000000000, nbf: 1500000000 });
    expect(result.times.map((claim) => claim.name)).toEqual(["iat", "nbf", "exp"]);
    expect(result.times[2]).toEqual({
      name: "exp",
      label: "Expires",
      seconds: 2000000000,
      utc: "2033-05-18 03:33:20 UTC",
    });
  });

  it("marks a token expired, with how long ago", () => {
    const status = timeStatus(at({ exp: seconds(NOW) - 3 * 86400 - 4 * 3600 - 5 * 60 }), NOW);
    expect(status.state).toBe("expired");
    expect(status.label).toBe("Expired");
    expect(status.detail).toBe("Expired 3 days 4 hours ago, at 2026-09-26 07:55:00 UTC.");
  });

  it("is expired at the very second exp names, and valid one second before", () => {
    expect(timeStatus(at({ exp: seconds(NOW) }), NOW).state).toBe("expired");
    expect(timeStatus(at({ exp: seconds(NOW) + 1 }), NOW).state).toBe("valid");
  });

  it("marks a token valid now, with how long is left", () => {
    const status = timeStatus(at({ exp: seconds(NOW) + 2 * 3600 + 5 * 60 + 9 }), NOW);
    expect(status.state).toBe("valid");
    expect(status.label).toBe("Valid now");
    expect(status.detail).toBe("Expires in 2 hours 5 minutes, at 2026-09-29 14:05:09 UTC.");
  });

  it("marks a token that has not started yet, before checking exp", () => {
    const status = timeStatus(at({ nbf: seconds(NOW) + 600, exp: seconds(NOW) + 3600 }), NOW);
    expect(status.state).toBe("not-yet-valid");
    expect(status.detail).toBe("Becomes valid in 10 minutes, at 2026-09-29 12:10:00 UTC.");
  });

  it("is valid at the second nbf names", () => {
    expect(timeStatus(at({ nbf: seconds(NOW), exp: seconds(NOW) + 60 }), NOW).state).toBe("valid");
  });

  it("says so when there is no exp, and does not invent one", () => {
    const status = timeStatus(at({ iat: 1 }), NOW);
    expect(status.state).toBe("no-expiry");
    expect(status.detail).toContain("no exp claim");
    expect(timeStatus(at({}), NOW).state).toBe("no-expiry");
  });

  it("reports a time claim that is not a number instead of guessing", () => {
    for (const exp of ["1700000000", null, true, [1], {}]) {
      const result = at({ exp });
      expect(result.times).toEqual([]);
      expect(result.problems).toEqual(["The exp claim is not a number of seconds."]);
      expect(timeStatus(result, NOW)).toMatchObject({ state: "unreadable", label: "Cannot check" });
    }
    expect(at({ nbf: "x" }).problems).toEqual(["The nbf claim is not a number of seconds."]);
    expect(timeStatus(at({ nbf: "x" }), NOW).state).toBe("unreadable");
  });

  it("reports a number too far from 1970 to be a date", () => {
    const result = at({ exp: 1e15 });
    expect(result.problems).toEqual(["The exp claim is too far from 1970 to be a date."]);
    expect(timeStatus(result, NOW).state).toBe("unreadable");
  });

  it("still checks exp when only iat is unusable", () => {
    const result = at({ iat: "yesterday", exp: seconds(NOW) + 60 });
    expect(result.problems).toEqual(["The iat claim is not a number of seconds."]);
    expect(timeStatus(result, NOW).state).toBe("valid");
  });

  it("accepts fractional seconds", () => {
    const result = at({ exp: seconds(NOW) + 30.5 });
    expect(result.times[0]?.utc).toBe("2026-09-29 12:00:30.500 UTC");
    expect(timeStatus(result, NOW).state).toBe("valid");
  });
});

describe("formatDuration", () => {
  it("uses the two largest units", () => {
    expect(formatDuration(0)).toBe("less than a second");
    expect(formatDuration(0.9)).toBe("less than a second");
    expect(formatDuration(1)).toBe("1 second");
    expect(formatDuration(45)).toBe("45 seconds");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(3600 + 59)).toBe("1 hour 59 seconds");
    expect(formatDuration(86400)).toBe("1 day");
    expect(formatDuration(90061)).toBe("1 day 1 hour");
    expect(formatDuration(11000 * 86400)).toBe("11,000 days");
    expect(formatDuration(-5)).toBe("less than a second");
  });
});

describe("formatUtc", () => {
  it("writes a moment in UTC", () => {
    expect(formatUtc(0)).toBe("1970-01-01 00:00:00 UTC");
    expect(formatUtc(4102444800)).toBe("2100-01-01 00:00:00 UTC");
    expect(formatUtc(-1)).toBe("1969-12-31 23:59:59 UTC");
  });
});

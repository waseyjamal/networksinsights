// Pure logic of "JWT Decoder": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// A JSON Web Token (RFC 7519) is three Base64URL parts joined by dots: header.payload.signature.
// Decoding reads the first two as JSON and hands the third back as it is. Nothing here checks the
// signature: that needs the secret or the public key, which only the token's issuer and the server
// that trusts it hold.

/** The most characters the tool reads. A real token is a few hundred to a few thousand. */
export const MAX_CHARS = 100_000;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
}

/** One decoded JSON part, formatted with two-space indentation. */
export interface JsonPart {
  /** The JSON as the token wrote it, re-indented: numbers and strings are copied exactly. */
  json: string;
}

/** A time claim (`iat`, `nbf` or `exp`) that holds a usable number of seconds. */
export interface TimeClaim {
  name: "iat" | "nbf" | "exp";
  label: string;
  /** Seconds since 1970-01-01 UTC, as the token holds them. */
  seconds: number;
  /** The moment in UTC, for example "2033-05-18 03:33:20 UTC". */
  utc: string;
}

/** What a successful decode gives back. */
export interface Decoded {
  ok: true;
  header: JsonPart;
  payload: JsonPart;
  /** The `alg` of the header, or null when it has none or it is not a string. */
  algorithm: string | null;
  signature: {
    /** The third part exactly as written. Empty for a token that has no signature. */
    base64url: string;
    /** How many bytes it decodes to. */
    bytes: number;
  };
  /** The time claims that hold a usable number, in the order iat, nbf, exp. */
  times: TimeClaim[];
  /** One sentence for each time claim that is present but is not a usable number of seconds. */
  problems: string[];
}

/** Why a token could not be decoded. */
export type Failure = {
  ok: false;
  reason: "empty" | "too-large" | "malformed" | "encrypted";
  error: string;
};

export type Result = Decoded | Failure;

/** Where a token stands against a clock. */
export type TimeState = "expired" | "not-yet-valid" | "valid" | "no-expiry" | "unreadable";

export interface TimeStatus {
  state: TimeState;
  /** Two or three words for a badge. */
  label: string;
  /** A sentence that says why, with the time left or passed. */
  detail: string;
}

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Milliseconds a JavaScript Date can hold either side of 1970. */
const MAX_DATE_MS = 8.64e15;

const TIME_CLAIMS: ReadonlyArray<{ name: TimeClaim["name"]; label: string }> = [
  { name: "iat", label: "Issued at" },
  { name: "nbf", label: "Not valid before" },
  { name: "exp", label: "Expires" },
];

/** Decodes a JSON Web Token. It never checks the signature. */
export function run(input: Input): Result {
  if (input.text.length > MAX_CHARS) {
    return fail(
      "too-large",
      `This is ${input.text.length.toLocaleString("en-US")} characters, more than the ${MAX_CHARS.toLocaleString("en-US")} the tool reads. A token is far shorter, so this is probably not a token.`,
    );
  }
  const token = input.text.replace(/^\s*bearer\s+/i, "").replace(/\s+/g, "");
  if (token === "") return fail("empty", "Paste a token to decode it.");

  const parts = token.split(".");
  if (parts.length === 5) {
    return fail(
      "encrypted",
      "This token has five parts, so it is an encrypted token (a JWE). Its payload is encrypted and cannot be read without the key.",
    );
  }
  if (parts.length !== 3) {
    return fail(
      "malformed",
      parts.length === 1
        ? "A JWT has three parts separated by dots, and this has no dot. Paste the whole token, from its first character to its last."
        : `A JWT has three parts separated by dots, and this has ${parts.length}. Paste the whole token, from its first character to its last.`,
    );
  }
  const [headerText, payloadText, signatureText] = parts as [string, string, string];

  const header = readJsonPart("header", headerText);
  if (!header.ok) return header;
  const payload = readJsonPart("payload", payloadText);
  if (!payload.ok) return payload;
  const signature = readBase64Url("signature", signatureText);
  if (!signature.ok) return signature;

  const { alg: algorithm } = header.value;
  const { times, problems } = readTimeClaims(payload.value);
  return {
    ok: true,
    header: { json: header.json },
    payload: { json: payload.json },
    algorithm: typeof algorithm === "string" ? algorithm : null,
    signature: { base64url: signatureText.replace(/=+$/, ""), bytes: signature.bytes.length },
    times,
    problems,
  };
}

/**
 * Where the token stands at `nowMs` (milliseconds since 1970, like Date.now()), from its own
 * `nbf` and `exp` claims. RFC 7519 says a token must not be accepted on or after its `exp`, and not
 * before its `nbf`, so a token is expired at the very second its `exp` names.
 */
export function timeStatus(decoded: Decoded, nowMs: number): TimeStatus {
  const nowSeconds = nowMs / 1000;
  const exp = decoded.times.find((claim) => claim.name === "exp");
  const nbf = decoded.times.find((claim) => claim.name === "nbf");
  const broken = decoded.problems.find(
    (problem) => problem.startsWith("The exp") || problem.startsWith("The nbf"),
  );
  if (broken) {
    return {
      state: "unreadable",
      label: "Cannot check",
      detail: `${broken} The token's dates cannot be checked.`,
    };
  }
  if (exp && nowSeconds >= exp.seconds) {
    return {
      state: "expired",
      label: "Expired",
      detail: `Expired ${formatDuration(nowSeconds - exp.seconds)} ago, at ${exp.utc}.`,
    };
  }
  if (nbf && nowSeconds < nbf.seconds) {
    return {
      state: "not-yet-valid",
      label: "Not valid yet",
      detail: `Becomes valid in ${formatDuration(nbf.seconds - nowSeconds)}, at ${nbf.utc}.`,
    };
  }
  if (exp) {
    return {
      state: "valid",
      label: "Valid now",
      detail: `Expires in ${formatDuration(exp.seconds - nowSeconds)}, at ${exp.utc}.`,
    };
  }
  return {
    state: "no-expiry",
    label: "No expiry",
    detail: "The payload has no exp claim, so by its own dates this token never expires.",
  };
}

/** A span as a reader says it, with its two largest units: "2 hours 5 minutes", "1 day", "45 seconds". */
export function formatDuration(totalSeconds: number): string {
  let left = Math.floor(Math.max(0, totalSeconds));
  if (left === 0) return "less than a second";
  const units: ReadonlyArray<[string, number]> = [
    ["day", DAY],
    ["hour", HOUR],
    ["minute", MINUTE],
    ["second", SECOND],
  ];
  const words: string[] = [];
  for (const [name, size] of units) {
    const count = Math.floor(left / size);
    left -= count * size;
    if (count > 0 && words.length < 2) {
      words.push(`${count.toLocaleString("en-US")} ${name}${count === 1 ? "" : "s"}`);
    }
  }
  return words.join(" ");
}

/** A moment as "2033-05-18 03:33:20 UTC". `seconds` must be inside the range Date holds. */
export function formatUtc(seconds: number): string {
  return new Date(seconds * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.000Z$/, " UTC")
    .replace(/Z$/, " UTC");
}

function readTimeClaims(payload: Record<string, unknown>): {
  times: TimeClaim[];
  problems: string[];
} {
  const times: TimeClaim[] = [];
  const problems: string[] = [];
  for (const { name, label } of TIME_CLAIMS) {
    if (!Object.hasOwn(payload, name)) continue;
    const value = payload[name];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push(`The ${name} claim is not a number of seconds.`);
    } else if (Math.abs(value * 1000) > MAX_DATE_MS) {
      problems.push(`The ${name} claim is too far from 1970 to be a date.`);
    } else {
      times.push({ name, label, seconds: value, utc: formatUtc(value) });
    }
  }
  return { times, problems };
}

type Part =
  | { ok: true; json: string; value: Record<string, unknown> }
  | Extract<Result, { ok: false }>;

/** Reads a Base64URL part as UTF-8 JSON that holds an object. */
function readJsonPart(name: "header" | "payload", text: string): Part {
  const bytes = readBase64Url(name, text);
  if (!bytes.ok) return bytes;
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.bytes);
  } catch {
    return fail("malformed", `The ${name} decodes to bytes that are not valid UTF-8 text.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return fail("malformed", `The ${name} decodes to text that is not valid JSON.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("malformed", `The ${name} is JSON, but not a JSON object, which a token needs.`);
  }
  return { ok: true, json: indent(source), value: value as Record<string, unknown> };
}

type Bytes = { ok: true; bytes: Uint8Array } | Extract<Result, { ok: false }>;

/** Decodes Base64URL, which a token writes without padding. Trailing "=" is tolerated. */
function readBase64Url(name: string, text: string): Bytes {
  const body = text.replace(/=+$/, "");
  const bad = body.search(/[^A-Za-z0-9_-]/);
  if (bad >= 0) {
    const char = String.fromCodePoint(body.codePointAt(bad) ?? 0);
    const hint =
      char === "+" || char === "/"
        ? " That is standard Base64; a JWT uses Base64URL, which writes - and _ instead."
        : " A JWT part uses A to Z, a to z, 0 to 9, - and _ only.";
    return fail(
      "malformed",
      `Character ${bad + 1} of the ${name}, "${char}", is not Base64URL.${hint}`,
    );
  }
  if (body.length % 4 === 1) {
    return fail(
      "malformed",
      `The ${name} is cut short: it has a stray last character. A character may have been lost when the token was copied.`,
    );
  }
  const standard = body.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ok: true, bytes };
}

/**
 * Re-indents JSON that has already been parsed, by two spaces per level. It walks the text and
 * never converts a value, so a long number keeps every digit and a repeated key stays.
 */
function indent(source: string): string {
  let out = "";
  let depth = 0;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    if (char === '"') {
      let end = i + 1;
      while (source[end] !== '"') end += source[end] === "\\" ? 2 : 1;
      out += source.slice(i, end + 1);
      i = end;
    } else if (char === "{" || char === "[") {
      let next = i + 1;
      while (/\s/.test(source[next] ?? "")) next++;
      if (source[next] === (char === "{" ? "}" : "]")) {
        out += char + source[next];
        i = next;
      } else {
        depth++;
        out += char + newline();
      }
    } else if (char === "}" || char === "]") {
      depth--;
      out += newline() + char;
    } else if (char === ",") {
      out += char + newline();
    } else if (char === ":") {
      out += ": ";
    } else if (!/\s/.test(char)) {
      out += char;
    }
  }
  return out;
}

function fail(reason: Failure["reason"], error: string): Failure {
  return { ok: false, reason, error };
}

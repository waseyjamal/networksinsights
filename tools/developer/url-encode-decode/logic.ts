// Pure logic of URL Encode Decode: percent-encoding and decoding with the two standard JavaScript
// behaviours. "url" is encodeURI and decodeURI, for a whole address; "component" is
// encodeURIComponent and decodeURIComponent, for one piece of it, such as a query value.
//
// Both encode a character as the percent sign and the two hex digits of each byte of its UTF-8
// form. A space becomes %20, never "+", and "+" is never turned into a space.

export type Mode = "encode" | "decode";
export type Scope = "url" | "component";

export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  encode: "Encode",
  decode: "Decode",
};

export const SCOPE_LABELS: Readonly<Record<Scope, string>> = {
  url: "Whole URL (encodeURI)",
  component: "Component (encodeURIComponent)",
};

/** The longest text accepted, in characters. */
export const MAX_LENGTH = 1_000_000;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  mode: Mode;
  scope: Scope;
  text: string;
}

export type Result = { ok: true; output: string } | { ok: false; error: string };

/** The characters each encoder leaves as they are, besides letters and digits, for the page. */
export const KEPT_BY_URL = "- _ . ! ~ * ' ( ) ; / ? : @ & = + $ , #";
export const KEPT_BY_COMPONENT = "- _ . ! ~ * ' ( )";

/** The reserved characters that decoding a whole URL leaves percent-encoded. */
export const KEPT_ENCODED_BY_URL_DECODE = "; / ? : @ & = + $ , #";

/** The 1-based position of a UTF-16 index, counting a character outside the BMP once. */
function position(text: string, index: number): number {
  return Array.from(text.slice(0, index)).length + 1;
}

function shorten(text: string): string {
  const chars = Array.from(text);
  return chars.length > 24 ? `${chars.slice(0, 24).join("")}...` : text;
}

/** The first lone surrogate of `text` (half of a character outside the BMP), or -1. */
function loneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
      else return i;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return i;
    }
  }
  return -1;
}

/** Says what is wrong with the percent sequences of `text`, or returns null when they are fine. */
export function explainBadPercent(text: string): string | null {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "%" && !/^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      return `The "%" at character ${position(text, i)} is not followed by two hexadecimal digits (found "${shorten(text.slice(i, i + 3))}"). A percent sign must be written as %25 to stay a percent sign.`;
    }
  }
  for (const match of text.matchAll(/(?:%[0-9A-Fa-f]{2})+/g)) {
    try {
      decodeURIComponent(match[0]);
    } catch {
      return `The percent sequences starting at character ${position(text, match.index)} ("${shorten(match[0])}") are not valid UTF-8, so they do not stand for any text.`;
    }
  }
  return null;
}

/** Encodes or decodes `input.text`, or says why it cannot. */
export function run(input: Input): Result {
  const { mode, scope, text } = input;
  if (text.length > MAX_LENGTH) {
    return {
      ok: false,
      error: `The text has ${text.length.toLocaleString("en-US")} characters; the limit is 1,000,000.`,
    };
  }
  if (mode === "encode") {
    const bad = loneSurrogate(text);
    if (bad >= 0) {
      return {
        ok: false,
        error: `The character at position ${position(text, bad)} is half of a pair (a lone surrogate) and cannot be encoded as UTF-8.`,
      };
    }
    return { ok: true, output: scope === "url" ? encodeURI(text) : encodeURIComponent(text) };
  }
  const bad = explainBadPercent(text);
  if (bad) return { ok: false, error: bad };
  return { ok: true, output: scope === "url" ? decodeURI(text) : decodeURIComponent(text) };
}

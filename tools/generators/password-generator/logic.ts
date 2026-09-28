// Pure logic of "Password Generator": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// Randomness comes from crypto.getRandomValues, the operating system's cryptographic generator,
// which the browser, Web Workers and Cloudflare Workers all have. Math.random is never used. Each
// character is picked by rejection sampling, so every character of the pool is exactly as likely
// as every other (a plain `value % size` would favour the first characters). A password that
// misses one of the chosen kinds is thrown away and drawn again, which keeps every password that
// contains each chosen kind equally likely, and the strength is computed for exactly that set.

/** The kinds of character, in the order the workspace shows them. */
export const CHARACTER_KINDS = ["upper", "lower", "digits", "symbols"] as const;

export type CharacterKind = (typeof CHARACTER_KINDS)[number];

/**
 * The characters of each kind. The symbols are the ASCII punctuation that most sign-up forms
 * accept, without quotes, the backslash and the backtick, which break in shells, code and some
 * forms.
 */
export const CHARACTER_SETS: Readonly<Record<CharacterKind, string>> = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digits: "0123456789",
  symbols: "!#$%&()*+,-./:;<=>?@[]^_{|}~",
};

/** Each kind's label in the workspace. */
export const KIND_LABELS: Readonly<Record<CharacterKind, string>> = {
  upper: "Uppercase (A-Z)",
  lower: "Lowercase (a-z)",
  digits: "Numbers (0-9)",
  symbols: "Symbols (!#$%&…)",
};

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 128;
export const DEFAULT_LENGTH = 16;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
}

export type Strength = "weak" | "fair" | "strong" | "very-strong";

/** What the tool gives back: a password and its strength, or why there is none. */
export type Result =
  | { ok: true; password: string; bits: number; strength: Strength }
  | { ok: false; error: string };

/** Fills an array with random 32-bit values, as crypto.getRandomValues does. */
export type RandomSource = (array: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>;

/** Each rating's label in the workspace. */
export const STRENGTH_LABELS: Readonly<Record<Strength, string>> = {
  weak: "Weak",
  fair: "Fair",
  strong: "Strong",
  "very-strong": "Very strong",
};

/**
 * The lowest number of bits of entropy for each rating above "weak". A password of 80 bits or more
 * is "very strong", from 60 "strong", from 40 "fair", and anything less "weak".
 */
export const STRENGTH_THRESHOLDS: Readonly<Record<Exclude<Strength, "weak">, number>> = {
  fair: 40,
  strong: 60,
  "very-strong": 80,
};

/**
 * How many passwords may be drawn before giving up on one that holds every chosen kind. With the
 * shortest length and all four kinds, about half the draws qualify, so a real random source never
 * comes near it; it only stops a broken source from looping for ever.
 */
const MAX_DRAWS = 1000;

const TWO_TO_32 = 2 ** 32;

/** A new password for the options, or the reason there is none. */
export function run(input: Input, random: RandomSource = systemRandom): Result {
  const error = validate(input);
  if (error !== null) return { ok: false, error };
  const sets = chosenSets(input);
  const pool = sets.join("");
  for (let draw = 0; draw < MAX_DRAWS; draw++) {
    let password = "";
    for (let index = 0; index < input.length; index++) {
      password += pool.charAt(randomIndex(pool.length, random));
    }
    if (sets.every((set) => [...set].some((char) => password.includes(char)))) {
      const bits = entropyBits(
        input.length,
        sets.map((set) => set.length),
      );
      return { ok: true, password, bits, strength: strengthOf(bits) };
    }
  }
  return {
    ok: false,
    error: "The random number source did not work. Reload the page and try again.",
  };
}

/** Why the options cannot make a password, or null when they can. */
export function validate(input: Input): string | null {
  if (!Number.isInteger(input.length) || input.length < MIN_LENGTH || input.length > MAX_LENGTH) {
    return `Choose a length from ${MIN_LENGTH} to ${MAX_LENGTH} characters.`;
  }
  if (chosenSets(input).length === 0) return "Choose at least one kind of character.";
  return null;
}

/** The rating of a password with this many bits of entropy. */
export function strengthOf(bits: number): Strength {
  if (bits >= STRENGTH_THRESHOLDS["very-strong"]) return "very-strong";
  if (bits >= STRENGTH_THRESHOLDS.strong) return "strong";
  if (bits >= STRENGTH_THRESHOLDS.fair) return "fair";
  return "weak";
}

/**
 * The entropy, in bits, of a password drawn uniformly from every string of `length` characters
 * that holds at least one character of each set: log2 of how many such strings there are. The
 * count comes from inclusion-exclusion over the sets a string could miss, written as a fraction of
 * all strings over the pool so that nothing overflows at 128 characters.
 */
export function entropyBits(length: number, setSizes: readonly number[]): number {
  const pool = setSizes.reduce((sum, size) => sum + size, 0);
  let fraction = 0;
  for (let mask = 0; mask < 1 << setSizes.length; mask++) {
    let missing = 0;
    let count = 0;
    setSizes.forEach((size, index) => {
      if (mask & (1 << index)) {
        missing += size;
        count++;
      }
    });
    fraction += (count % 2 === 0 ? 1 : -1) * ((pool - missing) / pool) ** length;
  }
  return length * Math.log2(pool) + Math.log2(fraction);
}

/** A uniform random integer from 0 to size - 1, without modulo bias. */
export function randomIndex(size: number, random: RandomSource): number {
  // Values at or above the largest multiple of size would favour the smallest results: draw again.
  const limit = TWO_TO_32 - (TWO_TO_32 % size);
  const buffer = new Uint32Array(1);
  for (;;) {
    const value = random(buffer)[0] ?? 0;
    if (value < limit) return value % size;
  }
}

function chosenSets(input: Input): string[] {
  return CHARACTER_KINDS.filter((kind) => input[kind]).map((kind) => CHARACTER_SETS[kind]);
}

function systemRandom(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> {
  return crypto.getRandomValues(array);
}

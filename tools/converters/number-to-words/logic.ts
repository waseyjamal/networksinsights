// Pure logic of Number to Words. Whole numbers are BigInts from the first digit to the last, so no
// digit is ever lost to floating point. Tens and units are joined with a hyphen (twenty-four) and no
// "and" is put after "hundred", in the American style.

export type System = "indian" | "international";
export type Style = "words" | "rupees" | "dollars";

export const SYSTEMS = ["indian", "international"] as const satisfies readonly System[];
export const STYLES = ["words", "rupees", "dollars"] as const satisfies readonly Style[];

/** The largest whole part the tool writes, and the most digits after the point in plain words. */
export const MAX = 999_999_999_999_999n;
export const MAX_DECIMALS = 10;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  text: string;
  system: System;
  style: Style;
}

export type Result = { ok: true; words: string } | { ok: false; error: string };

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 1 to 999 in words. */
function underThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest] as string);
    else {
      const unit = rest % 10;
      parts.push(`${TENS[Math.floor(rest / 10)]}${unit > 0 ? `-${ONES[unit]}` : ""}`);
    }
  }
  return parts.join(" ");
}

const INTERNATIONAL: readonly [bigint, string][] = [
  [10n ** 12n, "trillion"],
  [10n ** 9n, "billion"],
  [10n ** 6n, "million"],
  [10n ** 3n, "thousand"],
];

const INDIAN: readonly [bigint, string][] = [
  [10n ** 7n, "crore"],
  [10n ** 5n, "lakh"],
  [10n ** 3n, "thousand"],
];

/** A whole number from 0 up to MAX in words. */
export function wholeToWords(value: bigint, system: System): string {
  if (value === 0n) return "zero";
  const scale = system === "indian" ? INDIAN : INTERNATIONAL;
  const parts: string[] = [];
  let rest = value;
  for (const [size, name] of scale) {
    if (rest >= size) {
      // Above a crore the count of crores is itself written in the Indian system: "one lakh crore".
      parts.push(`${wholeToWords(rest / size, system)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0n) parts.push(underThousand(Number(rest)));
  return parts.join(" ");
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The number written in words, in the chosen system and style, or what is wrong with it. */
export function run(input: Input): Result {
  const raw = input.text.trim().replace(/^\+/, "");
  if (raw === "") return { ok: false, error: "Enter a number." };
  const match = /^(-?)(\d[\d,]*)(?:\.(\d+))?$/.exec(raw);
  if (!match || /,,|,$/.test(match[2] as string)) {
    return {
      ok: false,
      error:
        "That is not a number. Use digits, commas between groups and one decimal point, such as 12,34,567.89.",
    };
  }
  const negative = match[1] === "-";
  const whole = BigInt((match[2] as string).replaceAll(",", ""));
  const fraction = match[3] ?? "";
  if (whole > MAX) {
    return {
      ok: false,
      error: "The number is too large; the largest supported is 999,999,999,999,999.",
    };
  }

  if (input.style === "words") {
    if (fraction.length > MAX_DECIMALS) {
      return { ok: false, error: `Use at most ${MAX_DECIMALS} digits after the decimal point.` };
    }
    let words = wholeToWords(whole, input.system);
    if (fraction !== "") {
      words += ` point ${[...fraction].map((digit) => ONES[Number(digit)]).join(" ")}`;
    }
    const isZero = whole === 0n && /^0*$/.test(fraction);
    return { ok: true, words: capital(negative && !isZero ? `minus ${words}` : words) };
  }

  if (negative) return { ok: false, error: "A cheque amount cannot be negative." };
  if (fraction.length > 2) {
    return { ok: false, error: "A money amount has at most two digits after the decimal point." };
  }
  const cents = Number(fraction.padEnd(2, "0"));
  if (input.style === "rupees") {
    const paise = cents > 0 ? ` and ${wholeToWords(BigInt(cents), input.system)} paise` : "";
    return { ok: true, words: `Rupees ${wholeToWords(whole, input.system)}${paise} only` };
  }
  const dollars = `${wholeToWords(whole, input.system)} ${whole === 1n ? "dollar" : "dollars"}`;
  const centWords =
    cents > 0
      ? ` and ${wholeToWords(BigInt(cents), input.system)} ${cents === 1 ? "cent" : "cents"}`
      : "";
  return { ok: true, words: capital(`${dollars}${centWords}`) };
}

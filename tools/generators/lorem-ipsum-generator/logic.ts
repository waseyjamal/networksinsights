// Pure logic of Filler Text Generator: filler text built from our own list of Latin words. The
// words are picked by a small seeded random generator (mulberry32), so one seed always gives the
// same text: the page can render it on the server and the browser shows the same thing.

export type Unit = "paragraphs" | "sentences" | "words";
export const UNITS = ["paragraphs", "sentences", "words"] as const satisfies readonly Unit[];

/** The most of each unit the tool makes at once. Our own choice. */
export const MAX_COUNT: Readonly<Record<Unit, number>> = {
  paragraphs: 100,
  sentences: 1000,
  words: 10000,
};

/** The classic opening, used when asked to start with it. */
export const CLASSIC = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
const CLASSIC_WORDS = [
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
];

/** Our own word list: plain Latin words, all lower case. */
export const WORDS = [
  "ad",
  "aliquam",
  "amor",
  "animus",
  "aqua",
  "arbor",
  "ars",
  "audio",
  "aurum",
  "bellum",
  "bonus",
  "caelum",
  "canis",
  "carmen",
  "causa",
  "civis",
  "clarus",
  "cor",
  "corpus",
  "cras",
  "cura",
  "dies",
  "domus",
  "donum",
  "dux",
  "ego",
  "et",
  "facilis",
  "fama",
  "felix",
  "fides",
  "filius",
  "flumen",
  "forma",
  "fortis",
  "frater",
  "gens",
  "gloria",
  "gratia",
  "hora",
  "ignis",
  "in",
  "iter",
  "lex",
  "liber",
  "locus",
  "lux",
  "magnus",
  "manus",
  "mare",
  "mater",
  "mens",
  "miles",
  "modus",
  "mons",
  "mundus",
  "natura",
  "nauta",
  "nec",
  "nox",
  "novus",
  "nunc",
  "opus",
  "orbis",
  "pater",
  "pax",
  "per",
  "porta",
  "primus",
  "puer",
  "quies",
  "ratio",
  "rex",
  "sed",
  "semper",
  "silva",
  "sol",
  "spes",
  "tempus",
  "terra",
  "urbs",
  "ut",
  "verbum",
  "veritas",
  "via",
  "vita",
  "vox",
] as const;

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  unit: Unit;
  count: string;
  classic: boolean;
  seed: number;
}

export type Result =
  | { ok: true; paragraphs: string[]; words: number }
  | { ok: false; error: string };

/** A random number generator in [0, 1) from a 32-bit seed (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Builds the text; every sentence has 6 to 14 words, every paragraph 4 to 7 sentences. */
export function run(input: Input): Result {
  const t = input.count.trim();
  const max = MAX_COUNT[input.unit];
  if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > max) {
    return {
      ok: false,
      error: `Enter a whole number of ${input.unit} from 1 to ${max.toLocaleString("en-US")}.`,
    };
  }
  const count = Number(t);
  const next = random(input.seed);
  const between = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
  const word = () => WORDS[Math.floor(next() * WORDS.length)] as string;
  const sentence = (length: number) => {
    const list = Array.from({ length }, word);
    if (length > 7 && next() < 0.5) list[between(2, length - 3)] += ",";
    return `${capital(list.join(" "))}.`;
  };

  if (input.unit === "words") {
    const list = Array.from({ length: count }, word);
    if (input.classic)
      list.splice(0, Math.min(count, CLASSIC_WORDS.length), ...CLASSIC_WORDS.slice(0, count));
    const text = `${capital(list.join(" "))}.`;
    return { ok: true, paragraphs: [text], words: count };
  }

  const sentences = (n: number) => Array.from({ length: n }, () => sentence(between(6, 14)));
  const paragraphs =
    input.unit === "sentences"
      ? [sentences(count)]
      : Array.from({ length: count }, () => sentences(between(4, 7)));
  if (input.classic) (paragraphs[0] as string[])[0] = CLASSIC;
  const texts = paragraphs.map((list) => list.join(" "));
  const words = texts.reduce((sum, text) => sum + text.split(" ").length, 0);
  return { ok: true, paragraphs: texts, words };
}

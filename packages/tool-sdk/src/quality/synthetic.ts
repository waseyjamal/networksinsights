// Synthetic tool pages for the similarity tests and the timing benchmark (ADR 0036). Seeded, so a
// run is the same on every machine. Pages look like real ones to a shingle counter: words follow
// a Zipf-like curve, and a small pool of boilerplate sentences turns up across many pages, the way
// "your file never leaves your browser" would in a real tool set.

/** A small seeded random number generator: the same seed gives the same sequence. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCABULARY = 3000;
const BOILERPLATE_SENTENCES = 40;

/** A word from a Zipf-like distribution: a few words are common, most are rare. */
function word(random: () => number): string {
  return `w${Math.floor(VOCABULARY ** random())}`;
}

function sentence(random: () => number, length: number): string[] {
  return Array.from({ length }, () => word(random));
}

/** One planted near-duplicate: which page it copies and how many words were changed. */
export interface PlantedDuplicate {
  original: number;
  copy: number;
  /** Share of words replaced. About 0.02 leaves a score near 0.85; 0.14 leaves one near 0.35. */
  changed: number;
}

export interface SyntheticSet {
  pages: string[][];
  planted: PlantedDuplicate[];
}

/**
 * `count` pages of about 250 words each. The last `duplicates` pages are copies of the first
 * `duplicates` pages with a growing share of words replaced.
 */
export function syntheticPages(count: number, duplicates = 0, seed = 1): SyntheticSet {
  const random = mulberry32(seed);
  const boilerplate = Array.from({ length: BOILERPLATE_SENTENCES }, () => sentence(random, 12));
  const pages: string[][] = [];

  for (let i = 0; i < count - duplicates; i++) {
    const page: string[] = [];
    for (let s = 0; s < 20; s++) {
      const shared = random() < 0.15;
      const words = shared
        ? (boilerplate[Math.floor(random() * BOILERPLATE_SENTENCES)] as string[])
        : sentence(random, 8 + Math.floor(random() * 10));
      page.push(...words);
    }
    pages.push(page);
  }

  const planted: PlantedDuplicate[] = [];
  for (let d = 0; d < duplicates; d++) {
    const changed = 0.02 + (0.12 * d) / Math.max(1, duplicates - 1);
    const copy = (pages[d] as string[]).map((w) => (random() < changed ? word(random) : w));
    planted.push({ original: d, copy: pages.length, changed });
    pages.push(copy);
  }
  return { pages, planted };
}

// Near-duplicate detection (ADR 0036).
//
// Measure: the Jaccard similarity of two texts' word shingles. A shingle is four consecutive
// words, hashed to 32 bits. Score = |A ∩ B| / |A ∪ B|, from 0 (nothing shared) to 1 (identical).
// Two pages that swap only the tool name score about 0.7 to 0.8, because a name touches four
// shingles per mention and the rest of the text is unchanged. Two pages written separately about
// related tools score far lower. ADR 0036 records the measured gap and the threshold.
//
// Speed: comparing every pair exactly is n²/2 set merges, fine at 1,000 pages and slow at 10,000.
// So a MinHash sketch (256 hashes per page) and locality-sensitive hashing (128 bands of 2 rows)
// pick the candidate pairs first, and only candidates are scored exactly. A pair with score s is
// a candidate with probability 1 - (1 - s²)^128: 0.99999 at s = 0.3 and higher above it, so the
// approximation all but never loses a pair at the threshold, and the score that is reported is
// always exact.

/** Words per shingle. */
export const SHINGLE_SIZE = 4;

/** A pair of pages at or above this score fails the build (ADR 0036). */
export const NEAR_DUPLICATE_THRESHOLD = 0.3;

const HASHES = 256;
const BAND_ROWS = 2;

/** A page pair found similar. `a` and `b` are indexes into the list that was given. */
export interface SimilarPair {
  a: number;
  b: number;
  score: number;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return hash >>> 0;
}

/** The finalizer of MurmurHash3: spreads the bits of a 32-bit integer. */
function mix(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A fixed pseudo-random sequence, so signatures are the same on every machine and run. */
function seeds(count: number): Uint32Array {
  const out = new Uint32Array(count);
  let state = 0x9e3779b9;
  for (let i = 0; i < count; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    out[i] = mix(state);
  }
  return out;
}
const SEEDS = seeds(HASHES);

/**
 * The sorted, de-duplicated shingle hashes of a list of words. A text shorter than one shingle
 * is a single shingle of itself, so two identical short texts still compare equal.
 */
export function shingleSet(words: readonly string[], size = SHINGLE_SIZE): Uint32Array {
  if (words.length === 0) return new Uint32Array(0);
  const wordHashes = words.map((word) => fnv1a(word.toLowerCase()));
  const width = Math.min(size, wordHashes.length);
  const hashes = new Set<number>();
  for (let i = 0; i + width <= wordHashes.length; i++) {
    let hash = 0x811c9dc5;
    for (let j = 0; j < width; j++) {
      hash = Math.imul(hash ^ (wordHashes[i + j] as number), 0x01000193);
    }
    hashes.add(mix(hash));
  }
  return Uint32Array.from(hashes).sort();
}

/** Jaccard similarity of two sorted sets, by merging them. */
export function jaccard(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let shared = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as number;
    const y = b[j] as number;
    if (x === y) {
      shared++;
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return shared / (a.length + b.length - shared);
}

/** The MinHash signature of a set: for each hash function, the smallest hash of any member. */
function signature(set: Uint32Array): Uint32Array {
  const sig = new Uint32Array(HASHES).fill(0xffffffff);
  for (let i = 0; i < set.length; i++) {
    const member = set[i] as number;
    for (let h = 0; h < HASHES; h++) {
      const value = mix(member ^ (SEEDS[h] as number));
      if (value < (sig[h] as number)) sig[h] = value;
    }
  }
  return sig;
}

/** The exact score of every pair that could reach the threshold, found through LSH. */
export function findSimilarPairs(
  sets: readonly Uint32Array[],
  threshold = NEAR_DUPLICATE_THRESHOLD,
): SimilarPair[] {
  const n = sets.length;
  const signatures = sets.map(signature);
  const candidates = new Set<number>();

  for (let start = 0; start < HASHES; start += BAND_ROWS) {
    const buckets = new Map<number, number[]>();
    for (let doc = 0; doc < n; doc++) {
      if ((sets[doc] as Uint32Array).length === 0) continue;
      const sig = signatures[doc] as Uint32Array;
      let key = 0;
      for (let row = 0; row < BAND_ROWS; row++) key = mix(key ^ (sig[start + row] as number));
      const bucket = buckets.get(key);
      if (bucket) bucket.push(doc);
      else buckets.set(key, [doc]);
    }
    for (const bucket of buckets.values()) {
      for (let x = 0; x < bucket.length; x++) {
        for (let y = x + 1; y < bucket.length; y++) {
          candidates.add((bucket[x] as number) * n + (bucket[y] as number));
        }
      }
    }
  }

  const pairs: SimilarPair[] = [];
  for (const key of candidates) {
    const a = Math.floor(key / n);
    const b = key % n;
    const setA = sets[a] as Uint32Array;
    const setB = sets[b] as Uint32Array;
    // Jaccard can never exceed the size ratio, so most unrelated pairs stop here.
    if (Math.min(setA.length, setB.length) / Math.max(setA.length, setB.length) < threshold) {
      continue;
    }
    const score = jaccard(setA, setB);
    if (score >= threshold) pairs.push({ a, b, score });
  }
  return pairs.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);
}

/** Every pair compared exactly. The reference the fast path is tested and timed against. */
export function findSimilarPairsBruteForce(
  sets: readonly Uint32Array[],
  threshold = NEAR_DUPLICATE_THRESHOLD,
): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  for (let a = 0; a < sets.length; a++) {
    for (let b = a + 1; b < sets.length; b++) {
      const score = jaccard(sets[a] as Uint32Array, sets[b] as Uint32Array);
      if (score >= threshold) pairs.push({ a, b, score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);
}

/** Every page at or above the threshold against one page. One exact pass, no sketches needed. */
export function findSimilarTo(
  sets: readonly Uint32Array[],
  target: number,
  threshold = NEAR_DUPLICATE_THRESHOLD,
): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  const own = sets[target] as Uint32Array;
  for (let other = 0; other < sets.length; other++) {
    if (other === target) continue;
    const score = jaccard(own, sets[other] as Uint32Array);
    if (score >= threshold) {
      pairs.push({ a: Math.min(target, other), b: Math.max(target, other), score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);
}

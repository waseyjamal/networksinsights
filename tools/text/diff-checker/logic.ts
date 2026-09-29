// Pure logic of "Text Diff Checker": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
//
// The texts are split into lines and compared with Myers' O(ND) difference algorithm, in its
// linear-space form (find the middle snake, then compare each half). Before that, the lines both
// texts start and end with are set aside, and so are the lines only one text has, because they can
// never match; a long text with few changes is compared over a small remainder. The comparison is a
// generator that pauses every so often, so a caller can keep the page responsive on a very large
// text and drop the run when the text changes. A comparison that would take too long stops at a
// fixed amount of work and says so: the lines it did not get to compare are shown as removed and
// added.

/** What the tool accepts. Keep it in step with `input` in tool.config.ts. */
export interface Input {
  original: string;
  modified: string;
}

/** What a line is: only in the modified text, only in the original, or in both. */
export type DiffKind = "added" | "removed" | "same";

/** One line of the comparison. Line numbers are 1-based; a line only one text has has one number. */
export interface DiffLine {
  kind: DiffKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** The comparison of two texts. */
export interface DiffResult {
  /** Every line of both texts, in reading order: removed lines come before the added ones that replace them. */
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: number;
  /** True when the work limit was reached: some lines that match may be shown as removed and added. */
  approximate: boolean;
}

/** How many units of work `diffInSteps` does between two pauses: a few milliseconds. */
export const STEP_WORK = 400_000;

/** The most work one comparison does before it settles for an approximate answer. */
export const MAX_WORK = 60_000_000;

const LINE_BREAK = /\r\n|\r|\n/;

/**
 * The lines of a text. Any line break (Windows, Unix or old Mac) ends a line, a text with no
 * characters has no lines, and the line break that ends the last line does not start another.
 */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(LINE_BREAK);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The comparison of one pair of texts, all at once. */
export function run(input: Input): DiffResult {
  const steps = diffInSteps(input, Number.POSITIVE_INFINITY);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/**
 * The comparison of one pair of texts, in steps of about `stepWork` units of work: the generator
 * yields after each step and returns the result. The result is the same as `run()` for any step
 * size.
 */
export function* diffInSteps(
  input: Input,
  stepWork = STEP_WORK,
  maxWork = MAX_WORK,
): Generator<void, DiffResult> {
  const oldLines = splitLines(input.original);
  const newLines = splitLines(input.modified);

  // Each distinct line becomes a number, so the comparison compares numbers, not strings.
  const ids = new Map<string, number>();
  const idOf = (line: string): number => {
    if (!ids.has(line)) ids.set(line, ids.size);
    return ids.get(line) ?? 0;
  };
  const oldIds = oldLines.map(idOf);
  const newIds = newLines.map(idOf);

  let head = 0;
  while (head < oldIds.length && head < newIds.length && oldIds[head] === newIds[head]) head++;
  let oldEnd = oldIds.length;
  let newEnd = newIds.length;
  while (oldEnd > head && newEnd > head && oldIds[oldEnd - 1] === newIds[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  // Lines only one text has cannot match, so they stay out of the search.
  const inOld = new Uint8Array(ids.size);
  const inNew = new Uint8Array(ids.size);
  for (let i = head; i < oldEnd; i++) inOld[oldIds[i] ?? 0] = 1;
  for (let i = head; i < newEnd; i++) inNew[newIds[i] ?? 0] = 1;
  const search = { a: [] as number[], b: [] as number[], aAt: [] as number[], bAt: [] as number[] };
  for (let i = head; i < oldEnd; i++) {
    const id = oldIds[i] ?? 0;
    if (inNew[id]) {
      search.a.push(id);
      search.aAt.push(i);
    }
  }
  for (let i = head; i < newEnd; i++) {
    const id = newIds[i] ?? 0;
    if (inOld[id]) {
      search.b.push(id);
      search.bAt.push(i);
    }
  }

  const context: Context = {
    a: search.a,
    b: search.b,
    matchA: [],
    matchB: [],
    work: 0,
    nextPause: stepWork,
    stepWork,
    maxWork,
    approximate: false,
  };
  yield* compare(context, 0, search.a.length, 0, search.b.length);

  const lines: DiffLine[] = [];
  let removed = 0;
  let added = 0;
  let unchanged = 0;
  let oldAt = 0;
  let newAt = 0;
  const same = () => {
    lines.push({
      kind: "same",
      text: oldLines[oldAt] ?? "",
      oldLine: oldAt + 1,
      newLine: newAt + 1,
    });
    oldAt++;
    newAt++;
    unchanged++;
  };
  const remove = () => {
    lines.push({ kind: "removed", text: oldLines[oldAt] ?? "", oldLine: oldAt + 1 });
    oldAt++;
    removed++;
  };
  const add = () => {
    lines.push({ kind: "added", text: newLines[newAt] ?? "", newLine: newAt + 1 });
    newAt++;
    added++;
  };

  while (oldAt < head) same();
  for (let match = 0; match < context.matchA.length; match++) {
    const matchOld = search.aAt[context.matchA[match] ?? 0] ?? 0;
    const matchNew = search.bAt[context.matchB[match] ?? 0] ?? 0;
    while (oldAt < matchOld) remove();
    while (newAt < matchNew) add();
    same();
  }
  while (oldAt < oldEnd) remove();
  while (newAt < newEnd) add();
  while (oldAt < oldLines.length) same();

  return { lines, added, removed, unchanged, approximate: context.approximate };
}

/**
 * One line per row, in the unified diff style without the headers: "+" before an added line, "-"
 * before a removed one, a space before an unchanged one. Lines end with a line feed.
 */
export function formatDiff(lines: readonly DiffLine[]): string {
  const sign: Record<DiffKind, string> = { added: "+", removed: "-", same: " " };
  let out = "";
  for (const line of lines) out += `${sign[line.kind]}${line.text}\n`;
  return out;
}

/** The state of one comparison, shared by the steps of the search. */
interface Context {
  a: number[];
  b: number[];
  /** Positions in `a` and `b` of the lines that match, in order, one entry per matching pair. */
  matchA: number[];
  matchB: number[];
  work: number;
  nextPause: number;
  stepWork: number;
  maxWork: number;
  approximate: boolean;
}

/** Finds the matching lines of a[aLo, aHi) and b[bLo, bHi) and records them in order. */
function* compare(
  context: Context,
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): Generator<void, void> {
  const { a, b, matchA, matchB } = context;
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    matchA.push(aLo++);
    matchB.push(bLo++);
  }
  let tail = 0;
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
    tail++;
  }
  if (aLo < aHi && bLo < bHi) {
    const split = yield* middle(context, aLo, aHi, bLo, bHi);
    if (split) {
      yield* compare(context, aLo, aLo + split.x, bLo, bLo + split.y);
      yield* compare(context, aLo + split.x, aHi, bLo + split.y, bHi);
    }
  }
  for (let i = 0; i < tail; i++) {
    matchA.push(aHi + i);
    matchB.push(bHi + i);
  }
}

/**
 * The middle snake of a[aLo, aHi) and b[bLo, bHi): a point, relative to the start of each, that a
 * shortest edit path passes through. Two searches run at once, one forward from the start and one
 * backward from the end, until they meet. Nothing when the ranges share no line or the work limit
 * is reached.
 */
function* middle(
  context: Context,
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
): Generator<void, { x: number; y: number } | null> {
  if (context.work > context.maxWork) {
    context.approximate = true;
    return null;
  }
  const { a, b } = context;
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD;
  const forward = new Int32Array(size).fill(-1);
  const backward = new Int32Array(size).fill(-1);
  forward[offset + 1] = 0;
  backward[offset + 1] = 0;
  const delta = n - m;
  // With an odd delta the paths can only meet while the forward search moves.
  const front = delta % 2 !== 0;
  let forwardStart = 0;
  let forwardEnd = 0;
  let backwardStart = 0;
  let backwardEnd = 0;

  for (let d = 0; d < maxD; d++) {
    if (context.work > context.maxWork) {
      context.approximate = true;
      return null;
    }
    for (let k = -d + forwardStart; k <= d - forwardEnd; k += 2) {
      const at = offset + k;
      let x: number;
      if (k === -d || (k !== d && (forward[at - 1] ?? -1) < (forward[at + 1] ?? -1))) {
        x = forward[at + 1] ?? 0;
      } else {
        x = (forward[at - 1] ?? 0) + 1;
      }
      let y = x - k;
      const from = x;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      context.work += x - from + 1;
      forward[at] = x;
      if (x > n) {
        forwardEnd += 2;
      } else if (y > m) {
        forwardStart += 2;
      } else if (front) {
        const other = offset + delta - k;
        if (other >= 0 && other < size && (backward[other] ?? -1) !== -1) {
          if (x >= n - (backward[other] ?? 0)) return { x, y };
        }
      }
    }
    for (let k = -d + backwardStart; k <= d - backwardEnd; k += 2) {
      const at = offset + k;
      let x: number;
      if (k === -d || (k !== d && (backward[at - 1] ?? -1) < (backward[at + 1] ?? -1))) {
        x = backward[at + 1] ?? 0;
      } else {
        x = (backward[at - 1] ?? 0) + 1;
      }
      let y = x - k;
      const from = x;
      while (x < n && y < m && a[aLo + n - x - 1] === b[bLo + m - y - 1]) {
        x++;
        y++;
      }
      context.work += x - from + 1;
      backward[at] = x;
      if (x > n) {
        backwardEnd += 2;
      } else if (y > m) {
        backwardStart += 2;
      } else if (!front) {
        const other = offset + delta - k;
        if (other >= 0 && other < size && (forward[other] ?? -1) !== -1) {
          const forwardX = forward[other] ?? 0;
          if (forwardX >= n - x) return { x: forwardX, y: forwardX - (other - offset) };
        }
      }
    }
    if (context.work >= context.nextPause) {
      context.nextPause = context.work + context.stepWork;
      yield;
    }
  }
  return null;
}

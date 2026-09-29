import { describe, expect, it } from "vitest";
import { type DiffLine, diffInSteps, formatDiff, run, splitLines } from "./logic";

/** The kind and text of every line, without the numbers. */
const shape = (lines: readonly DiffLine[]) => lines.map((line) => [line.kind, line.text]);

/** Rebuilds both texts from a result: the original from same + removed, the modified from same + added. */
function rebuild(lines: readonly DiffLine[]) {
  return {
    original: lines.filter((line) => line.kind !== "added").map((line) => line.text),
    modified: lines.filter((line) => line.kind !== "removed").map((line) => line.text),
  };
}

/** The length of the longest common subsequence, by the plain table: the reference for the search. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      row[j] =
        a[i - 1] === b[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
    }
    previous = row;
  }
  return previous[b.length] ?? 0;
}

/** A small deterministic generator, so a failing case can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("splitLines", () => {
  it("splits on every kind of line break", () => {
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("gives no lines for an empty text", () => {
    expect(splitLines("")).toEqual([]);
  });

  it("does not count the line break that ends the last line as another line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb\n\n")).toEqual(["a", "b", ""]);
    expect(splitLines("\n")).toEqual([""]);
  });

  it("keeps blank lines and the spaces on a line", () => {
    expect(splitLines("a\n\n  b  ")).toEqual(["a", "", "  b  "]);
  });
});

describe("run", () => {
  it("finds the added, removed and unchanged lines of a typical change", () => {
    const result = run({
      original: "The river rose overnight.\nBy morning, the old bridge was gone.\nNobody was hurt.",
      modified:
        "The river rose overnight.\nBy morning, the old bridge was closed.\nNobody was hurt.\nHelp is coming.",
    });
    expect(result.lines).toEqual([
      { kind: "same", text: "The river rose overnight.", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "By morning, the old bridge was gone.", oldLine: 2 },
      { kind: "added", text: "By morning, the old bridge was closed.", newLine: 2 },
      { kind: "same", text: "Nobody was hurt.", oldLine: 3, newLine: 3 },
      { kind: "added", text: "Help is coming.", newLine: 4 },
    ]);
    expect([result.added, result.removed, result.unchanged]).toEqual([2, 1, 2]);
    expect(result.approximate).toBe(false);
  });

  it("finds nothing to report for an empty pair", () => {
    expect(run({ original: "", modified: "" })).toEqual({
      lines: [],
      added: 0,
      removed: 0,
      unchanged: 0,
      approximate: false,
    });
  });

  it("marks every line unchanged when the texts are the same", () => {
    const result = run({ original: "a\nb\nc", modified: "a\nb\nc" });
    expect(result.unchanged).toBe(3);
    expect([result.added, result.removed]).toEqual([0, 0]);
  });

  it("marks every line added when the original is empty, and removed when the modified is", () => {
    expect(shape(run({ original: "", modified: "a\nb" }).lines)).toEqual([
      ["added", "a"],
      ["added", "b"],
    ]);
    expect(shape(run({ original: "a\nb", modified: "" }).lines)).toEqual([
      ["removed", "a"],
      ["removed", "b"],
    ]);
  });

  it("marks every line removed and added when the texts share none", () => {
    const result = run({ original: "a\nb", modified: "c\nd\ne" });
    expect(shape(result.lines)).toEqual([
      ["removed", "a"],
      ["removed", "b"],
      ["added", "c"],
      ["added", "d"],
      ["added", "e"],
    ]);
    expect(result.approximate).toBe(false);
  });

  it("treats Windows, Unix and old Mac line breaks alike", () => {
    const result = run({ original: "a\r\nb\r\nc", modified: "a\nb\rc" });
    expect(result.unchanged).toBe(3);
  });

  it("ignores the line break that ends the last line", () => {
    expect(run({ original: "a\nb", modified: "a\nb\n" }).unchanged).toBe(2);
  });

  it("sees a change in white space as a change", () => {
    const result = run({ original: "a b", modified: "a  b" });
    expect(shape(result.lines)).toEqual([
      ["removed", "a b"],
      ["added", "a  b"],
    ]);
  });

  it("tells a blank line from no line", () => {
    const result = run({ original: "a\nb", modified: "a\n\nb" });
    expect(shape(result.lines)).toEqual([
      ["same", "a"],
      ["added", ""],
      ["same", "b"],
    ]);
  });

  it("numbers the lines of each text from 1, with a number only for the text that has the line", () => {
    const result = run({ original: "x\ny\nz", modified: "x\nz\nw" });
    expect(result.lines).toEqual([
      { kind: "same", text: "x", oldLine: 1, newLine: 1 },
      { kind: "removed", text: "y", oldLine: 2 },
      { kind: "same", text: "z", oldLine: 3, newLine: 2 },
      { kind: "added", text: "w", newLine: 3 },
    ]);
  });

  it("keeps a moved line as one removed and one added line", () => {
    const result = run({ original: "a\nb\nc\nd", modified: "b\nc\nd\na" });
    expect([result.added, result.removed, result.unchanged]).toEqual([1, 1, 3]);
  });

  it("keeps text that looks like markup as text", () => {
    const result = run({ original: "<b>x</b>", modified: "<i>x</i>" });
    expect(shape(result.lines)).toEqual([
      ["removed", "<b>x</b>"],
      ["added", "<i>x</i>"],
    ]);
  });

  it("keeps emoji and Chinese text whole", () => {
    const result = run({ original: "👨‍👩‍👧 你好\n🇮🇳", modified: "👨‍👩‍👧 你好\n👍🏽" });
    expect(shape(result.lines)).toEqual([
      ["same", "👨‍👩‍👧 你好"],
      ["removed", "🇮🇳"],
      ["added", "👍🏽"],
    ]);
  });

  it("compares repeated lines correctly", () => {
    const result = run({ original: "a\na\na\nb", modified: "a\nb\na\na" });
    const rebuilt = rebuild(result.lines);
    expect(rebuilt).toEqual({ original: ["a", "a", "a", "b"], modified: ["a", "b", "a", "a"] });
    expect(result.unchanged).toBe(lcsLength(rebuilt.original, rebuilt.modified));
  });

  it("gives a shortest list of changes, and rebuilds both texts, on random texts", () => {
    const next = random(20260929);
    const alphabet = ["a", "b", "c", "d", "e", "", "  "];
    for (let round = 0; round < 300; round++) {
      const build = () =>
        Array.from(
          { length: Math.floor(next() * 14) },
          () => alphabet[Math.floor(next() * alphabet.length)] ?? "",
        );
      const original = build();
      const modified = build();
      const result = run({ original: original.join("\n"), modified: modified.join("\n") });
      // A text that ends in an empty line loses it in splitLines, so compare with the split texts.
      const expectedOriginal = splitLines(original.join("\n"));
      const expectedModified = splitLines(modified.join("\n"));
      expect(rebuild(result.lines)).toEqual({
        original: expectedOriginal,
        modified: expectedModified,
      });
      expect(result.unchanged).toBe(lcsLength(expectedOriginal, expectedModified));
      expect(result.added + result.unchanged).toBe(expectedModified.length);
      expect(result.removed + result.unchanged).toBe(expectedOriginal.length);
    }
  });

  it("gives the same result in steps of any size", () => {
    const original = Array.from({ length: 300 }, (_, index) => `line ${index % 37}`).join("\n");
    const modified = Array.from({ length: 280 }, (_, index) => `line ${(index * 3) % 41}`).join(
      "\n",
    );
    const whole = run({ original, modified });
    for (const stepWork of [1, 50, 5000]) {
      const steps = diffInSteps({ original, modified }, stepWork);
      let pauses = 0;
      let step = steps.next();
      while (!step.done) {
        pauses++;
        step = steps.next();
      }
      expect(step.value).toEqual(whole);
      if (stepWork === 1) expect(pauses).toBeGreaterThan(0);
    }
  });

  it("stops at the work limit, says so, and still accounts for every line", () => {
    const original = Array.from({ length: 400 }, (_, index) => `line ${index % 50}`).join("\n");
    const modified = Array.from({ length: 400 }, (_, index) => `line ${(index * 7) % 50}`).join(
      "\n",
    );
    const steps = diffInSteps({ original, modified }, 1_000, 100);
    let step = steps.next();
    while (!step.done) step = steps.next();
    const result = step.value;
    expect(result.approximate).toBe(true);
    expect(result.removed + result.unchanged).toBe(400);
    expect(result.added + result.unchanged).toBe(400);
    expect(rebuild(result.lines)).toEqual({
      original: splitLines(original),
      modified: splitLines(modified),
    });
    expect(run({ original, modified }).approximate).toBe(false);
  });
});

describe("formatDiff", () => {
  it("writes a plus, a minus or a space before every line", () => {
    const result = run({ original: "a\nb", modified: "a\nc" });
    expect(formatDiff(result.lines)).toBe(" a\n-b\n+c\n");
  });

  it("writes nothing for no lines", () => {
    expect(formatDiff([])).toBe("");
  });
});

describe("large texts", () => {
  /** About `bytes` bytes of numbered lines, with a change every `every` lines. */
  function text(bytes: number, every: number, change: string): string {
    const lines: string[] = [];
    let size = 0;
    for (let index = 0; size < bytes; index++) {
      const line =
        index % every === 0
          ? `${change} ${index} the quick brown fox`
          : `line ${index} the quick brown fox`;
      lines.push(line);
      size += line.length + 1;
    }
    return lines.join("\n");
  }

  it("compares two 500 KB texts with scattered changes exactly", { tags: ["slow"] }, () => {
    const original = text(500_000, 10, "old");
    const modified = text(500_000, 10, "new");
    const started = performance.now();
    const result = run({ original, modified });
    const elapsed = performance.now() - started;
    expect(result.approximate).toBe(false);
    expect(result.removed).toBe(result.added);
    expect(result.removed).toBeGreaterThan(1000);
    expect(result.unchanged).toBeGreaterThan(10000);
    expect(elapsed).toBeLessThan(10_000);
  });

  it("compares two 500 KB texts that share nothing", { tags: ["slow"] }, () => {
    const original = text(500_000, 1, "old");
    const modified = text(500_000, 1, "new");
    const result = run({ original, modified });
    expect(result.approximate).toBe(false);
    expect(result.unchanged).toBe(0);
    expect(result.removed).toBe(splitLines(original).length);
  });

  it("compares two 500 KB texts with a change in the middle at once", { tags: ["slow"] }, () => {
    const original = text(500_000, 1_000_000, "old");
    const lines = splitLines(original);
    lines[Math.floor(lines.length / 2)] = "a changed line";
    const result = run({ original, modified: lines.join("\n") });
    expect(result.approximate).toBe(false);
    expect([result.added, result.removed]).toEqual([1, 1]);
  });

  it("stays exact on 500 KB texts of short repeating lines", { tags: ["slow"] }, () => {
    const original = Array.from({ length: 100_000 }, (_, index) => `${index % 7}`).join("\n");
    const modified = Array.from(
      { length: 100_000 },
      (_, index) => `${(index + (index > 50_000 ? 1 : 0)) % 7}`,
    ).join("\n");
    const result = run({ original, modified });
    const rebuilt = rebuild(result.lines);
    expect(rebuilt.original).toEqual(splitLines(original));
    expect(rebuilt.modified).toEqual(splitLines(modified));
  });
});

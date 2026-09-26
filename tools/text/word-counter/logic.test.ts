import { describe, expect, it } from "vitest";
import { countInSteps, formatDuration, readingSeconds, run, WORDS_PER_MINUTE } from "./logic";

function drain(text: string, stepSize: number): { counts: ReturnType<typeof run>; steps: number } {
  const generator = countInSteps(text, stepSize);
  let steps = 1;
  let step = generator.next();
  while (!step.done) {
    steps++;
    step = generator.next();
  }
  return { counts: step.value, steps };
}

describe("run", () => {
  it("counts a typical text", () => {
    const text = "The quick brown fox jumps over the lazy dog. It was not amused!\n\nThe end.";
    expect(run({ text })).toEqual({
      words: 15,
      characters: text.length,
      charactersNoSpaces: text.replace(/\s/g, "").length,
      sentences: 3,
      paragraphs: 2,
      readingSeconds: 4,
    });
  });

  it("gives zero for every count of an empty text", () => {
    expect(run({ text: "" })).toEqual({
      words: 0,
      characters: 0,
      charactersNoSpaces: 0,
      sentences: 0,
      paragraphs: 0,
      readingSeconds: 0,
    });
  });

  it("counts only characters for white space", () => {
    expect(run({ text: "  \n\t \n\n " })).toEqual({
      words: 0,
      characters: 8,
      charactersNoSpaces: 0,
      sentences: 0,
      paragraphs: 0,
      readingSeconds: 0,
    });
  });

  it("counts an emoji of several code points as one character and no word", () => {
    // A family (man, ZWJ, woman, ZWJ, girl), a flag, a thumbs up with a skin tone.
    const counts = run({ text: "Hi 👨‍👩‍👧 🇮🇳 👍🏽" });
    expect(counts.characters).toBe(8);
    expect(counts.charactersNoSpaces).toBe(5);
    expect(counts.words).toBe(1);
  });

  it("counts a combining accent with its letter", () => {
    const counts = run({ text: "café déjà vu" });
    expect(counts.characters).toBe(12);
    expect(counts.words).toBe(3);
  });

  it("splits Chinese and Japanese text, which has no spaces, into words and sentences", () => {
    const chinese = run({ text: "我喜欢读书。你呢？" });
    expect(chinese.characters).toBe(9);
    expect(chinese.words).toBeGreaterThan(2);
    expect(chinese.words).toBeLessThan(7);
    expect(chinese.sentences).toBe(2);

    const japanese = run({ text: "今日は良い天気です。" });
    expect(japanese.characters).toBe(10);
    expect(japanese.words).toBeGreaterThan(1);
    expect(japanese.sentences).toBe(1);
  });

  it("counts numbers, contractions and hyphenated words as one word each", () => {
    expect(run({ text: "It's 3.14, not 1,000." }).words).toBe(4);
    expect(run({ text: "don't e-mail a well-known state-of-the-art tool" }).words).toBe(6);
  });

  it("splits words at a slash, a spaced dash and a double hyphen", () => {
    expect(run({ text: "22/7 and/or" }).words).toBe(4);
    expect(run({ text: "yes - no -- maybe" }).words).toBe(3);
    expect(run({ text: "yes--no" }).words).toBe(2);
  });

  it("does not count punctuation alone as a sentence", () => {
    expect(run({ text: "Hello. ... !!! World?" }).sentences).toBe(2);
  });

  it("ends a sentence at a line break", () => {
    expect(run({ text: "A heading\nThe first line of text." }).sentences).toBe(2);
  });

  it("separates paragraphs by blank lines, including lines with only spaces and CRLF", () => {
    expect(run({ text: "One\nstill one\n\nTwo" }).paragraphs).toBe(2);
    expect(run({ text: "One\r\n\r\nTwo\r\n  \r\nThree\n\n\n\n" }).paragraphs).toBe(3);
    expect(run({ text: "\n\nOnly one\n\n" }).paragraphs).toBe(1);
  });
  it("gives the counts that the Examples section of the page shows", () => {
    const text =
      "The river rose overnight. By morning, the old bridge was gone.\n\nNobody was hurt.";
    expect(run({ text })).toEqual({
      words: 14,
      characters: 80,
      charactersNoSpaces: 66,
      sentences: 3,
      paragraphs: 2,
      readingSeconds: 4,
    });
  });
});

describe("reading time", () => {
  it(`uses ${WORDS_PER_MINUTE} words per minute, rounded up to the second`, () => {
    expect(WORDS_PER_MINUTE).toBe(238);
    expect(readingSeconds(0)).toBe(0);
    expect(readingSeconds(1)).toBe(1);
    expect(readingSeconds(238)).toBe(60);
    expect(readingSeconds(239)).toBe(61);
    expect(readingSeconds(2380)).toBe(600);
  });

  it("formats a duration for a result tile", () => {
    expect(formatDuration(0)).toBe("0 sec");
    expect(formatDuration(45)).toBe("45 sec");
    expect(formatDuration(180)).toBe("3 min");
    expect(formatDuration(185)).toBe("3 min 5 sec");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3720)).toBe("1 h 2 min");
  });
});

describe("countInSteps", () => {
  const sample =
    "The quick brown fox jumps over the lazy dog. 你好世界，这是一个测试。 👨‍👩‍👧 café!\r\n\r\nNew paragraph, 42 words? ";

  it("gives the same counts as run() for any step size", () => {
    const text = sample.repeat(40);
    const whole = run({ text });
    for (const stepSize of [1, 7, 64, 500, 4096]) {
      const { counts, steps } = drain(text, stepSize);
      expect(counts).toEqual(whole);
      if (stepSize < 500) expect(steps).toBeGreaterThan(1);
    }
  });

  it("never splits a character or a word between two steps", () => {
    const text = "a👨‍👩‍👧 b́c 👍🏽d ".repeat(50);
    expect(drain(text, 3).counts).toEqual(run({ text }));
  });

  it("handles a text with nowhere to split as one step", () => {
    const text = "x".repeat(200);
    const { counts, steps } = drain(text, 10);
    expect(steps).toBe(1);
    expect(counts.words).toBe(1);
    expect(counts.characters).toBe(200);
  });

  it("counts 1 MB of mixed text in steps that each stay short", () => {
    const text = sample.repeat(Math.ceil(1_000_000 / sample.length)).slice(0, 1_000_000);
    const generator = countInSteps(text);
    let longest = 0;
    let steps = 0;
    for (;;) {
      const started = performance.now();
      const step = generator.next();
      longest = Math.max(longest, performance.now() - started);
      steps++;
      if (step.done) {
        expect(step.value.characters).toBeGreaterThan(900_000);
        expect(step.value.words).toBeGreaterThan(100_000);
        break;
      }
    }
    expect(steps).toBeGreaterThan(20);
    // Generous for a slow CI machine; the point is that no single step handles the whole text.
    expect(longest).toBeLessThan(500);
  });
});

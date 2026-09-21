import { describe, expect, it } from "vitest";
import type { ToolEntry } from "../validate";
import { fixtureEntries, pageSources } from "./fixtures";
import {
  checkQuality,
  checkQualityWarnings,
  FIRST_SENTENCE_MAX_WORDS,
  firstSentence,
  QUALITY_GATES,
} from "./gates";

// The answer-first rule (ADR 0044): the first sentence of the intro has at most 30 words, and
// should name the tool. The first is a failure; the second is advice.

const page = pageSources["word-counter"] ?? "";
const [template] = fixtureEntries("answer-first", "pass");
if (!template) throw new Error("the answer-first fixture is missing");

/** The word counter fixture with its intro replaced. */
const withIntro = (intro: string): ToolEntry =>
  ({ ...template, content: page.replace(/^[^\n]*(?:\n[^\n]+)*/, intro) }) as ToolEntry;

const words = (count: number) =>
  Array.from({ length: count }, (_, i) => `word${"abcdefghij"[i % 10]}`).join(" ");

const failures = (entry: ToolEntry) =>
  checkQuality([entry], { gates: ["answer-first"] }).map((violation) => violation.problem);
const advice = (entry: ToolEntry) =>
  checkQualityWarnings([entry]).map((violation) => violation.problem);

describe("the first sentence", () => {
  it("is the text up to the first full stop, question mark or exclamation mark", () => {
    expect(firstSentence("Count words. Then more.")).toBe("Count words.");
    expect(firstSentence("Can it count? Yes it can.")).toBe("Can it count?");
    expect(firstSentence("Wow! Really.")).toBe("Wow!");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
  });

  it("reads prose, not markup: emphasis, links and code do not count as words", () => {
    expect(firstSentence("**Word counter** turns [text](/x/) into `numbers`. More.")).toBe(
      "Word counter turns text into numbers.",
    );
  });

  it("is empty for an empty intro", () => {
    expect(firstSentence("")).toBe("");
  });
});

describe("answer-first: at most 30 words in the first sentence", () => {
  it("allows exactly 30 words", () => {
    expect(FIRST_SENTENCE_MAX_WORDS).toBe(30);
    expect(
      failures(withIntro(`${words(30)}. Then a second sentence of any length at all.`)),
    ).toEqual([]);
  });

  it("fails 31 words, and says how many and what to do", () => {
    const problems = failures(withIntro(`${words(31)}. Then a second sentence.`));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("has 31 words; the maximum is 30");
    const [violation] = checkQuality([withIntro(`${words(31)}. Then more.`)], {
      gates: ["answer-first"],
    });
    expect(violation?.fix).toContain("at most 30 words");
    expect(violation?.file).toBe("content/en.mdx");
  });

  it("looks only at the first sentence: a long second sentence is fine", () => {
    expect(failures(withIntro(`Short one. ${words(80)}.`))).toEqual([]);
  });

  it("counts a first sentence that runs on with no full stop until the next paragraph", () => {
    expect(failures(withIntro(words(45)))).toHaveLength(1);
  });

  it("passes its passing fixture and fails its failing fixture", () => {
    expect(
      checkQuality(fixtureEntries("answer-first", "pass"), { gates: ["answer-first"] }),
    ).toEqual([]);
    expect(
      checkQuality(fixtureEntries("answer-first", "fail"), { gates: ["answer-first"] }).length,
    ).toBeGreaterThan(0);
  });
});

describe("answer-first-name: the first sentence names the tool", () => {
  it("is advice, never a failure", () => {
    const gate = QUALITY_GATES.find((item) => item.id === "answer-first-name");
    expect(gate?.severity).toBe("warning");
    const entry = withIntro("Count the words in any text as you type. A second sentence follows.");
    expect(checkQuality([entry]).map((violation) => violation.gate)).not.toContain(
      "answer-first-name",
    );
    expect(advice(entry)).toHaveLength(1);
  });

  it("warns when the name is missing, and quotes the sentence", () => {
    const [problem] = advice(withIntro("Count the words in any text. A second sentence."));
    expect(problem).toContain('does not contain the tool\'s name "Word counter"');
    expect(problem).toContain("Count the words in any text.");
  });

  it("is quiet when the name is there, in any case and whatever the punctuation", () => {
    expect(
      advice(withIntro("Word counter counts the words in any text. A second sentence.")),
    ).toEqual([]);
    expect(advice(withIntro("Use the WORD COUNTER to check a text. A second sentence."))).toEqual(
      [],
    );
  });

  it("does not take the name from a longer word", () => {
    expect(advice(withIntro("Wordcounters are common. A second sentence."))).toHaveLength(1);
  });

  it("looks only at the first sentence", () => {
    expect(
      advice(withIntro("Count the words in any text. The Word counter does it.")),
    ).toHaveLength(1);
  });

  it("is checked by its own passing and failing fixtures", () => {
    expect(checkQualityWarnings(fixtureEntries("answer-first-name", "pass"))).toEqual([]);
    expect(
      checkQualityWarnings(fixtureEntries("answer-first-name", "fail")).length,
    ).toBeGreaterThan(0);
  });
});

describe("the two gates together", () => {
  it("a tool can fail one and be advised on the other", () => {
    const entry = withIntro(`${words(35)}. More.`);
    expect(failures(entry)).toHaveLength(1);
    expect(advice(entry)).toHaveLength(1);
  });

  it("leave a tool with no content to the contract", () => {
    const entry = { ...template, content: undefined } as ToolEntry;
    expect(failures(entry)).toEqual([]);
    expect(advice(entry)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ISLAND_SOURCE, REQUIRED_FILES } from "../files";
import { formatViolation, type ToolEntry } from "../validate";
import { fixtureEntries, fixtureGates, pageSources } from "./fixtures";
import {
  checkQuality,
  findPlaceholder,
  MIN_WORDS,
  parseFaq,
  QUALITY_GATES,
  runQualityGates,
  UNFINISHED_MARKER,
} from "./gates";
import { NEAR_DUPLICATE_THRESHOLD } from "./similarity";

// Every gate has a passing fixture and a failing fixture (fixtures/gates/<gate>/pass|fail/), and
// this file runs each one through that gate alone, so a failure names the gate that broke.

/** What one gate says about one fixture case, as the messages an owner would read. */
function run(gate: string, kind: "pass" | "fail") {
  const entries = fixtureEntries(gate, kind);
  const [result] = runQualityGates(entries, { gates: [gate] });
  expect(result?.gate.id).toBe(gate);
  return { entries, violations: result?.violations ?? [] };
}

describe("the fixtures cover every gate", () => {
  it("has a passing and a failing fixture for each gate, and no fixture for a missing gate", () => {
    const ids = QUALITY_GATES.map((gate) => gate.id).sort();
    expect(fixtureGates()).toEqual(ids);
    for (const id of ids) {
      expect(fixtureEntries(id, "pass").length, `${id} has a passing fixture`).toBeGreaterThan(0);
      expect(fixtureEntries(id, "fail").length, `${id} has a failing fixture`).toBeGreaterThan(0);
    }
  });

  it("gives every gate an id, a title and a rule to print", () => {
    for (const gate of QUALITY_GATES) {
      expect(gate.id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(gate.title.length).toBeGreaterThan(10);
      expect(gate.rule.length).toBeGreaterThan(20);
    }
  });
});

describe.each(QUALITY_GATES.map((gate) => gate.id))("gate %s", (id) => {
  it("passes its passing fixture", () => {
    const { violations } = run(id, "pass");
    expect(violations.map(formatViolation)).toEqual([]);
  });

  it("fails its failing fixture, and every message names the tool, the file and a fix", () => {
    const { violations } = run(id, "fail");
    expect(violations.length).toBeGreaterThan(0);
    for (const violation of violations) {
      expect(violation.gate).toBe(id);
      expect(violation.dir).toMatch(/^fixtures\/gates\/[a-z-]+\/fail\//);
      expect(violation.file).toBeTruthy();
      expect(violation.fix).toBeTruthy();
      const text = formatViolation(violation);
      expect(text).toContain(`Quality gate "${id}"`);
      expect(text).toContain(violation.dir);
      expect(text).toContain("Fix:");
    }
  });
});

describe("min-words", () => {
  it("names the section, the count and the minimum", () => {
    const { violations } = run("min-words", "fail");
    const problems = violations.map((violation) => violation.problem);
    expect(problems).toContain(`the intro has 2 words of prose; the minimum is ${MIN_WORDS.intro}`);
    expect(problems.join("\n")).toContain('the "How to use" section has 6 words');
    expect(problems.join("\n")).toContain('the "Limits" section has 6 words');
    // The sections that are long enough are not mentioned.
    expect(problems.join("\n")).not.toContain('"Examples"');
  });

  it("does not count code blocks", () => {
    const words = "word ".repeat(60);
    const body = `Intro. ${words}\n\n## How to use\n\n${words}\n\n## Examples\n\n\`\`\`\n${words}\n\`\`\`\nOne.\n\n## Limits\n\n${words}\n\n## FAQ\n\n### A?\n\n${words}`;
    const entries: ToolEntry[] = [
      { ...fixtureEntries("min-words", "pass")[0], content: body } as ToolEntry,
    ];
    const problems = checkQuality(entries, { gates: ["min-words"] }).map((v) => v.problem);
    expect(problems).toEqual([
      `the "Examples" section has 1 word of prose; the minimum is ${MIN_WORDS.Examples}`,
    ]);
  });

  it("leaves an empty section to the placeholders gate", () => {
    const { violations } = run("min-words", "fail");
    expect(violations.some((violation) => violation.problem.includes("is empty"))).toBe(false);
  });
});

describe("placeholders", () => {
  it("finds TODO, coming soon, an empty section and lorem ipsum, and says which section", () => {
    const { violations } = run("placeholders", "fail");
    const problems = violations.map((violation) => violation.problem).join("\n");
    expect(problems).toContain('the "How to use" section still has the placeholder text "TODO"');
    expect(problems).toContain(
      'the "Examples" section still has the placeholder text "Coming soon"',
    );
    expect(problems).toContain('the "Limits" section is empty');
    expect(problems).toContain('the "FAQ" section still has the placeholder text "Lorem ipsum"');
  });

  it("finds a placeholder in the manifest as well", () => {
    const { violations } = run("placeholders", "fail");
    expect(
      violations.some(
        (violation) => violation.file === "tool.config.ts" && violation.problem.includes('"TBD"'),
      ),
    ).toBe(true);
  });

  it("recognises each placeholder phrase", () => {
    for (const text of [
      "TODO write this",
      "This is TBD.",
      "FIXME later",
      "Lorem ipsum dolor",
      "dolor sit amet",
      "Coming soon!",
      "coming  soon",
      "To be written.",
      "to be added",
      "[insert example here]",
    ]) {
      expect(findPlaceholder(text), text).toBeTruthy();
    }
  });

  it("does not flag ordinary words that look similar", () => {
    for (const text of [
      "A to-do list keeps tasks.",
      "The todo app is separate.",
      "Soon after, the file downloads.",
      "The result is coming from your browser.",
    ]) {
      expect(findPlaceholder(text), text).toBeUndefined();
    }
  });

  it("ignores a placeholder that is inside a code block", () => {
    const content = `${pageSources["word-counter"]}\n\`\`\`\nLorem ipsum TODO\n\`\`\`\n`;
    const entry = { ...fixtureEntries("placeholders", "pass")[0], content } as ToolEntry;
    expect(checkQuality([entry], { gates: ["placeholders"] })).toEqual([]);
  });
});

describe("unfinished-code", () => {
  it("names the file and the line of the generator marker", () => {
    const { violations } = run("unfinished-code", "fail");
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("logic.ts");
    expect(violations[0]?.problem).toBe(
      `logic.ts still has the generator's ${UNFINISHED_MARKER} marker on line 1`,
    );
  });
});

describe("faq-structure", () => {
  it("wants a question mark, a real answer and at least two pairs", () => {
    const { violations } = run("faq-structure", "fail");
    const problems = violations.map((violation) => violation.problem);
    expect(problems).toContain(
      'the "FAQ" section has 1 question-and-answer pair; the minimum is 2',
    );
    expect(problems).toContain(
      'the FAQ question "Is it private" does not end with a question mark',
    );
    expect(problems).toContain('the answer to "Is it private" has 1 word; the minimum is 5');
  });

  it("reads each H3 as a question and the text under it as the answer", () => {
    expect(parseFaq("### One?\n\nAnswer one.\n\n### Two?\n\nAnswer\ntwo.\n")).toEqual([
      { question: "One?", answer: "Answer one." },
      { question: "Two?", answer: "Answer\ntwo." },
    ]);
  });

  it("does not read a heading inside a code block as a question", () => {
    expect(parseFaq("### Real?\n\n```\n### Not a question\n```\n")).toHaveLength(1);
  });
});

describe("faq-repeats", () => {
  it("names the section a repeated sentence came from", () => {
    const { violations } = run("faq-repeats", "fail");
    const problems = violations.map((violation) => violation.problem);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('the FAQ repeats a sentence from the "How to use" section');
    expect(problems[1]).toContain("the FAQ repeats a sentence from the intro");
  });

  it("ignores a short sentence that repeats by chance", () => {
    const content = `Intro that says enough words to be a fair introduction here.\n\n## How to use\n\nYes, it is free.\n\n## Examples\n\nText.\n\n## Limits\n\nText.\n\n## FAQ\n\n### Cost?\n\nYes, it is free.\n`;
    const entry = { ...fixtureEntries("faq-repeats", "pass")[0], content } as ToolEntry;
    expect(checkQuality([entry], { gates: ["faq-repeats"] })).toEqual([]);
  });

  it("sees through case, punctuation and spacing", () => {
    const content = `Intro.\n\n## How to use\n\nPaste your text, then read the count above the box!\n\n## Examples\n\nText.\n\n## Limits\n\nText.\n\n## FAQ\n\n### How?\n\npaste your   TEXT then read the count above the box\n`;
    const entry = { ...fixtureEntries("faq-repeats", "pass")[0], content } as ToolEntry;
    expect(checkQuality([entry], { gates: ["faq-repeats"] })).toHaveLength(1);
  });
});

describe("unique-name-and-summary", () => {
  it("catches the same name in another word order, and a near-identical summary", () => {
    const { violations } = run("unique-name-and-summary", "fail");
    const problems = violations.map((violation) => violation.problem).join("\n");
    expect(problems).toContain('name "Counter word" is the same as the name of word-counter');
    expect(problems).toContain("summary is ");
    expect(problems).toContain("the same as the summary of");
    // Both tools are told, so whichever the owner opens, they see the other.
    expect(new Set(violations.map((violation) => violation.dir)).size).toBe(2);
  });

  it("leaves an identical summary to the contract, which has its own message", () => {
    const [first] = fixtureEntries("unique-name-and-summary", "pass");
    const copy = {
      ...first,
      dir: "fixtures/copy/text/other",
      manifest: { ...(first?.manifest as object), id: "other", name: "Other tool" },
    } as ToolEntry;
    const found = checkQuality([first as ToolEntry, copy], { gates: ["unique-name-and-summary"] });
    expect(found).toEqual([]);
  });
});

describe("near-duplicate", () => {
  it("prints both tool ids and the score", () => {
    const { violations } = run("near-duplicate", "fail");
    expect(violations).toHaveLength(2);
    const [first, second] = violations;
    expect(first?.problem).toMatch(
      /^the page is a near-duplicate of png-to-jpg \(fixtures\/gates\/near-duplicate\/fail\/png-to-jpg\): similarity 0\.\d\d, the limit is 0\.30$/,
    );
    expect(second?.problem).toContain("near-duplicate of jpg-to-png");
  });

  it("passes two independently written pages about closely related tools", () => {
    const { violations } = run("near-duplicate", "pass");
    expect(violations).toEqual([]);
  });

  it("with a focus, reports only on the focused tool", () => {
    const entries = fixtureEntries("near-duplicate", "fail");
    const focus = entries[0]?.dir as string;
    const found = checkQuality(entries, { focus: [focus], gates: ["near-duplicate"] });
    expect(found.map((violation) => violation.dir)).toEqual([focus]);
  });

  it("uses the threshold that ADR 0036 records", () => {
    expect(NEAR_DUPLICATE_THRESHOLD).toBe(0.3);
  });
});

describe("the good pages", () => {
  const names = Object.keys(pageSources).sort();

  function pageEntries(): ToolEntry[] {
    return names.map((name) => ({
      dir: `fixtures/pages/text/${name}`,
      manifest: {
        id: name,
        name: name.replaceAll("-", " "),
        category: "text",
        summary: `Fixture page for the tool called ${name.replaceAll("-", " ")}, used in tests only.`,
        tags: ["fixture"],
        runtime: "client",
        status: "beta",
        input: z.object({}),
        related: [],
        added: "2026-09-20",
        updated: "2026-09-20",
      },
      files: [...REQUIRED_FILES],
      content: pageSources[name],
      island: ISLAND_SOURCE,
      sources: {},
    }));
  }

  it("are all there: four pairs of closely related tools", () => {
    expect(names).toEqual([
      "base64-decode",
      "base64-encode",
      "character-counter",
      "jpg-to-png",
      "merge-pdf",
      "png-to-jpg",
      "split-pdf",
      "word-counter",
    ]);
  });

  it("pass every content gate together, so the gates agree with real writing", () => {
    const found = checkQuality(pageEntries(), {
      gates: ["min-words", "placeholders", "faq-structure", "faq-repeats", "near-duplicate"],
    });
    expect(found.map(formatViolation)).toEqual([]);
  });
});

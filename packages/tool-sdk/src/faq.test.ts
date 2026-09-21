import { describe, expect, it } from "vitest";
import { faqPairs, toPlainText } from "./faq";

describe("toPlainText", () => {
  it("keeps the words of a link and drops its address", () => {
    expect(toPlainText("See [the privacy page](/privacy/) for more.")).toBe(
      "See the privacy page for more.",
    );
  });

  it("drops emphasis marks, inline code ticks and HTML tags, without leaving a gap before punctuation", () => {
    expect(toPlainText("It is **fast**, *simple* and `free`.")).toBe(
      "It is fast, simple and free.",
    );
    expect(toPlainText("It is __fast__ and _simple_.")).toBe("It is fast and simple.");
    expect(toPlainText("Press <kbd>Enter</kbd>.")).toBe("Press Enter.");
  });

  it("leaves underscores inside words alone", () => {
    expect(toPlainText("Use snake_case_names here.")).toBe("Use snake_case_names here.");
  });

  it("joins paragraphs and list items with one space", () => {
    expect(toPlainText("First paragraph.\n\nSecond paragraph.")).toBe(
      "First paragraph. Second paragraph.",
    );
    expect(toPlainText("Options:\n\n- one\n- two\n1. three")).toBe("Options: one two three");
  });

  it("removes images, which a reader sees as a picture and not as text", () => {
    expect(toPlainText("Look: ![a chart](/chart.png) here.")).toBe("Look: here.");
  });

  it("keeps the code inside a fenced block, without the fence", () => {
    expect(toPlainText("Run:\n\n```sh\nnpm test\n```\n\nDone.")).toBe("Run: npm test Done.");
  });

  it("copes with Windows line endings and runs of white space", () => {
    expect(toPlainText("a\r\n\r\n   b   c")).toBe("a b c");
  });
});

describe("faqPairs", () => {
  const mdx = `Intro sentence.

## How to use

Words.

## FAQ

### Is it **free**?

Yes. Every tool is free, and there is [nothing to sign up for](/about/).

### Does it upload my file?

No. The work happens in your browser.
It never leaves your \`device\`.
`;

  it("reads each question and the plain text of its answer, in order", () => {
    expect(faqPairs(mdx)).toEqual([
      {
        question: "Is it free?",
        answer: "Yes. Every tool is free, and there is nothing to sign up for.",
      },
      {
        question: "Does it upload my file?",
        answer: "No. The work happens in your browser. It never leaves your device.",
      },
    ]);
  });

  it("is empty when the content has no FAQ", () => {
    expect(faqPairs("Intro.\n\n## How to use\n\nWords.\n")).toEqual([]);
    expect(faqPairs("")).toEqual([]);
  });

  it("ignores an H3 that is in another section", () => {
    expect(faqPairs("Intro.\n\n## Examples\n\n### Not a question?\n\nText.\n")).toEqual([]);
  });
});

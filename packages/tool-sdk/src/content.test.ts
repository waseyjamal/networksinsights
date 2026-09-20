import { describe, expect, it } from "vitest";
import { checkContent, outlineContent, REQUIRED_SECTIONS } from "./content";

const sections = (...names: string[]) =>
  names.map((name) => `## ${name}\n\nSome words.\n`).join("\n");

const valid = `An intro paragraph that says what the tool does.\n\n${sections(...REQUIRED_SECTIONS)}`;

describe("outlineContent", () => {
  it("separates the intro from the H2 sections", () => {
    const outline = outlineContent(valid);
    expect(outline.intro).toBe("An intro paragraph that says what the tool does.");
    expect(outline.sections).toEqual([...REQUIRED_SECTIONS]);
    expect(outline.hasH1).toBe(false);
  });

  it("ignores frontmatter", () => {
    const outline = outlineContent(`---\ntitle: x\n---\n${valid}`);
    expect(outline.intro).toBe("An intro paragraph that says what the tool does.");
    expect(outline.sections).toEqual([...REQUIRED_SECTIONS]);
  });

  it("does not read a heading inside a fenced code block", () => {
    const withFence = `Intro.\n\n\`\`\`md\n## Not a heading\n\`\`\`\n\n${sections(...REQUIRED_SECTIONS)}`;
    expect(outlineContent(withFence).sections).toEqual([...REQUIRED_SECTIONS]);
  });
});

describe("checkContent", () => {
  it("passes a file with an intro and the four sections in order", () => {
    expect(checkContent(valid)).toEqual([]);
  });

  it("passes the same file with Windows line endings", () => {
    expect(checkContent(valid.replaceAll("\n", "\r\n"))).toEqual([]);
  });

  it("requires an intro paragraph before the first H2", () => {
    expect(checkContent(sections(...REQUIRED_SECTIONS)).join()).toContain("intro paragraph");
  });

  it("refuses an H1, because the page template renders the one H1", () => {
    expect(checkContent(`# Word counter\n\n${valid}`).join()).toContain("must not contain an H1");
  });

  it("names the missing section", () => {
    const problems = checkContent(`Intro.\n\n${sections("How to use", "Examples", "Limits")}`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"How to use", "Examples", "Limits", "FAQ"');
    expect(problems[0]).toContain('"How to use", "Examples", "Limits"');
  });

  it("refuses the right sections in the wrong order", () => {
    const problems = checkContent(
      `Intro.\n\n${sections("Examples", "How to use", "Limits", "FAQ")}`,
    );
    expect(problems.join()).toContain("in that order");
  });

  it("refuses an extra section: more depth goes under an H3", () => {
    const problems = checkContent(`Intro.\n\n${sections(...REQUIRED_SECTIONS, "Pricing")}`);
    expect(problems.join()).toContain("Pricing");
  });
});

// The shape every tool's content/en.mdx must have (ADR 0018, ADR 0033).
//
// Mission 9 adds word minimums and near-duplicate detection on top of these checks.

import { normalizeSource } from "./files";

/** The H2 sections every tool page has, in this order. */
export const REQUIRED_SECTIONS = ["How to use", "Examples", "Limits", "FAQ"] as const;

/** Fenced code blocks: a `## ` inside one is code, not a heading. */
const FENCE = /^(?:```|~~~)/;

/** Leading frontmatter, which the section rules ignore. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** One H2 section: its heading and everything under it, code blocks included. */
export interface ContentSection {
  name: string;
  body: string;
}

interface ContentOutline {
  /** The text before the first H2, with frontmatter removed. */
  intro: string;
  /** The H2 headings, in the order they appear. */
  sections: string[];
  /** True when the file contains an H1, which the page template owns. */
  hasH1: boolean;
}

/** The parts of an MDX file the contract and the quality gates read. */
export interface ContentParts extends ContentOutline {
  /** Each H2 section with its body, in the order they appear. */
  parts: ContentSection[];
}

/** Reads the parts of an MDX file, including the text of every section. */
export function readContent(mdx: string): ContentParts {
  const body = normalizeSource(mdx).replace(FRONTMATTER, "");
  const parts: Array<{ name: string; lines: string[] }> = [];
  const introLines: string[] = [];
  let hasH1 = false;
  let inFence = false;

  for (const line of body.split("\n")) {
    const current = parts.at(-1);
    if (FENCE.test(line.trim())) {
      inFence = !inFence;
      (current?.lines ?? introLines).push(line);
      continue;
    }
    if (!inFence) {
      const heading = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
      if (heading?.[1] === "#") hasH1 = true;
      if (heading?.[1] === "##") {
        parts.push({ name: heading[2] ?? "", lines: [] });
        continue;
      }
    }
    (current?.lines ?? introLines).push(line);
  }

  return {
    intro: introLines.join("\n").trim(),
    sections: parts.map((part) => part.name),
    hasH1,
    parts: parts.map((part) => ({ name: part.name, body: part.lines.join("\n").trim() })),
  };
}

/** Reads the parts of an MDX file the contract cares about. */
export function outlineContent(mdx: string): ContentOutline {
  const { intro, sections, hasH1 } = readContent(mdx);
  return { intro, sections, hasH1 };
}

/**
 * Every way the content breaks the contract, as sentences that finish "…: <problem>".
 * An empty array means the file is fine.
 */
export function checkContent(mdx: string): string[] {
  const problems: string[] = [];
  const { intro, sections, hasH1 } = outlineContent(mdx);
  const required = [...REQUIRED_SECTIONS];

  if (intro.length === 0) {
    problems.push("content/en.mdx must open with an intro paragraph, before the first H2");
  }
  if (hasH1) {
    problems.push(
      "content/en.mdx must not contain an H1: the page template renders the one H1, the tool name",
    );
  }
  if (sections.join("\n") !== required.join("\n")) {
    problems.push(
      `content/en.mdx must have exactly the H2 sections ${required.map((s) => `"${s}"`).join(", ")} in that order, but has ${
        sections.length > 0 ? sections.map((s) => `"${s}"`).join(", ") : "none"
      }`,
    );
  }
  return problems;
}

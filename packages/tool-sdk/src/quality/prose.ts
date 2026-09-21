// Turns MDX into the prose a reader reads, so the quality gates count and compare words, not
// markup (ADR 0036).
//
// "Prose" is everything except code: fenced code blocks, MDX imports and exports, JSX and HTML
// tags, comments and link addresses are dropped. Headings, list items, link text and inline code
// stay, because they are words a visitor reads.

import { normalizeSource } from "../files";

const FENCE_OPEN = /^\s*(```+|~~~+)/;
const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

/** A word: letters and digits, with inner apostrophes and hyphens kept (don't, well-known). */
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Removes fenced code blocks. A block closes on a fence of the same character, at least as long. */
export function stripFencedCode(markdown: string): string {
  const kept: string[] = [];
  let fence: string | undefined;
  for (const line of normalizeSource(markdown).split("\n")) {
    const opening = FENCE_OPEN.exec(line)?.[1];
    if (fence === undefined) {
      if (opening === undefined) kept.push(line);
      else fence = opening;
      continue;
    }
    const trimmed = line.trim();
    const closes = trimmed.length >= fence.length && [...trimmed].every((c) => c === fence?.[0]);
    if (closes) fence = undefined;
  }
  return kept.join("\n");
}

/** The prose of a Markdown or MDX text: no code, no markup, one line per block. */
export function toProse(markdown: string): string {
  return stripFencedCode(markdown.replace(FRONTMATTER, ""))
    .split("\n")
    .filter((line) => !/^\s*(?:import|export)\s/.test(line))
    .map((line) =>
      line
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<\/?[A-Za-z][^>]*>/g, " ")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^\s*>+\s?/, "")
        .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/, " ")
        .replace(/[|`*_~]+/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/** The words of a text, in order. */
export function wordsOf(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** How many words of prose the Markdown holds. Code blocks do not count. */
export function countProseWords(markdown: string): number {
  return wordsOf(toProse(markdown)).length;
}

/** Lowercased words joined by single spaces: two sentences that read the same compare equal. */
export function normalizeText(text: string): string {
  return wordsOf(text.toLowerCase()).join(" ");
}

/** The sentences of a prose text: split after . ! ? and at line breaks. */
export function sentencesOf(prose: string): string[] {
  return prose
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// The FAQ of a tool page as data: each question and the plain text of its answer (ADR 0039).
//
// The structured data of a page (FAQPage) must say exactly what the page says, so it is built from
// the same content/en.mdx the page is rendered from, not from a second copy. `toPlainText` turns
// the small part of Markdown an FAQ answer uses (links, inline code, emphasis, lists) into the
// text a reader sees.

import { readContent } from "./content";
import { parseFaq } from "./quality/gates";

/** One question and the plain text of its answer. */
export interface FaqEntry {
  question: string;
  answer: string;
}

/** Fenced code: the fence lines go, the code inside stays, because a reader sees it. */
const FENCE = /^\s*(?:```|~~~).*$/;

/**
 * The text a reader sees for a piece of Markdown: no link addresses, no emphasis marks, no
 * backticks, no list bullets, no HTML tags. Paragraphs and list items are joined with one space,
 * and runs of white space collapse to one.
 */
export function toPlainText(markdown: string): string {
  return markdown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !FENCE.test(line))
    .map((line) =>
      line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<\/?[A-Za-z][^>]*>/g, "")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^\s*>+\s?/, "")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(^|[\s(])[*_]([^*_\n]+?)[*_](?=[\s).,;:!?]|$)/g, "$1$2"),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The FAQ pairs of a content/en.mdx, in the order they appear. Empty when there is no FAQ. */
export function faqPairs(mdx: string): FaqEntry[] {
  const faq = readContent(mdx).parts.find((part) => part.name === "FAQ");
  if (!faq) return [];
  return parseFaq(faq.body).map((pair) => ({
    question: toPlainText(pair.question),
    answer: toPlainText(pair.answer),
  }));
}

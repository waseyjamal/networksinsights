// llms.txt, generated from the registry (ADR 0040), in the format of llmstxt.org: an H1 with the
// site name, a blockquote summary, then H2 sections that hold lists of `- [name](url): notes`.
//
// It is a cheap hedge and nothing more. Google says plainly that Search ignores the file; other
// assistants may read it. It lists only what a search engine may index, so a category with no
// tool yet is not in it, and nothing is written before launch.

import { categories, categoryHref } from "../../config/categories";
import { site, sitePages } from "../../config/site";
import type { Tool } from "../registry/build";
import { isCategoryIndexable } from "./sitemap";
import { pageUrl } from "./urls";

const link = (name: string, path: string, notes?: string) =>
  `- [${name}](${pageUrl(path)})${notes ? `: ${notes}` : ""}`;

export function buildLlmsTxt(tools: readonly Tool[]): string {
  const withTools = categories.filter((category) =>
    isCategoryIndexable(tools.filter((tool) => tool.manifest.category === category.id).length),
  );
  const sorted = [...tools].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  const lines = [`# ${site.name}`, "", `> ${site.description}`, ""];
  if (withTools.length > 0) {
    lines.push(
      "## Categories",
      "",
      ...withTools.map((category) =>
        link(category.name, categoryHref(category), category.description),
      ),
      "",
    );
  }
  if (sorted.length > 0) {
    lines.push(
      "## Tools",
      "",
      ...sorted.map((tool) => link(tool.manifest.name, tool.href, tool.manifest.summary)),
      "",
    );
  }
  lines.push(
    "## Optional",
    "",
    link("All tools", sitePages.tools.href),
    link("About", sitePages.about.href),
    link("Contact", sitePages.contact.href),
    link("Privacy", sitePages.privacy.href),
    link("Terms", sitePages.terms.href),
    "",
  );
  return lines.join("\n");
}

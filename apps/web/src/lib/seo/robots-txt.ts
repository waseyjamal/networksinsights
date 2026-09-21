// robots.txt, generated (ADR 0040). The rules come from config/crawlers.ts and the launch flag.
//
// Before launch the site allows crawling on purpose: a crawler that is blocked never reads the
// `noindex` tag on a page, so blocking would not keep the pages out of an index (ADR 0029). The
// `Sitemap:` line is added only after launch, because before it there is nothing to advertise.

import type { Crawler } from "../../config/crawlers";
import { SITEMAP_INDEX_PATH } from "./sitemap";
import { fileUrl } from "./urls";

export interface RobotsInput {
  launched: boolean;
  crawlers: readonly Crawler[];
  trainingPolicy: "allow" | "disallow";
}

/** One group of user agents that share a rule. */
function group(comment: string, tokens: readonly string[], rule: string): string[] {
  if (tokens.length === 0) return [];
  return [`# ${comment}`, ...tokens.map((token) => `User-agent: ${token}`), rule, ""];
}

export function buildRobotsTxt(input: RobotsInput): string {
  const tokensFor = (...purposes: Crawler["purpose"][]) =>
    input.crawlers.filter((crawler) => purposes.includes(crawler.purpose)).map((c) => c.token);
  const training = input.trainingPolicy === "allow" ? "Allow: /" : "Disallow: /";

  const lines = [
    "# NetworksInsights robots.txt. Generated from apps/web/src/config/crawlers.ts: do not edit by hand.",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    ...group(
      "Search engines, answer engines, assistants fetching a page for a person, and link previews.",
      tokensFor("search", "user", "preview"),
      "Allow: /",
    ),
    ...group(
      input.trainingPolicy === "allow"
        ? "Crawlers that collect pages to train models: allowed (trainingPolicy)."
        : "Crawlers that collect pages to train models: asked to stay away (trainingPolicy).",
      tokensFor("training"),
      training,
    ),
  ];
  if (input.launched) lines.push(`Sitemap: ${fileUrl(SITEMAP_INDEX_PATH)}`, "");
  return `${lines.join("\n").trimEnd()}\n`;
}

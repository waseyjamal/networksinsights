// The crawlers robots.txt names, in one list (ADR 0040). robots.txt is generated from it, so a
// crawler is added, allowed or blocked here and nowhere else.
//
// Every entry names the page where its operator documents the crawler. A crawler that is not
// documented by its operator is not listed: an invented user-agent token protects nothing.
//
// Two facts to keep in mind when reading a policy:
//  - robots.txt is a request, not a lock. Operators say their crawlers follow it, and two of them
//    (Perplexity-User and meta-externalfetcher) say that a fetch a person asked for may not.
//  - Blocking a training crawler does not remove a site from search. Google (Google-Extended) and
//    Apple (Applebot-Extended) both say so in their own documentation.

/** What a crawler is for. It decides which policy applies. */
export type CrawlerPurpose =
  /** Builds a search index or an answer engine's index. */
  | "search"
  /** Fetches a page because a person asked an assistant about it. */
  | "user"
  /** Collects pages to train a model. */
  | "training"
  /** Fetches a link to draw the preview card when someone shares it. */
  | "preview";

export interface Crawler {
  /** The user-agent token robots.txt matches. */
  token: string;
  operator: string;
  purpose: CrawlerPurpose;
  /** The operator's own page about this crawler. */
  source: string;
}

/**
 * What the site asks of crawlers that collect pages to train models. **The owner chose "allow"**
 * (ADR 0040): the site's value is its working tools, and being known to the models people ask is
 * worth more than withholding pages that contain little a model could not already learn. Change
 * this one constant to `"disallow"` and every training crawler below is asked to stay away.
 */
export const trainingPolicy: "allow" | "disallow" = "allow";

const OPENAI = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC =
  "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const GOOGLE =
  "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers";
const APPLE = "https://support.apple.com/en-us/119829";
const META = "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/";

export const crawlers: readonly Crawler[] = [
  // Search and answer engines: always allowed.
  { token: "Googlebot", operator: "Google", purpose: "search", source: GOOGLE },
  {
    token: "bingbot",
    operator: "Microsoft",
    purpose: "search",
    source: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
  },
  {
    token: "DuckDuckBot",
    operator: "DuckDuckGo",
    purpose: "search",
    source: "https://duckduckgo.com/duckduckgo-help-pages/results/duckduckbot",
  },
  { token: "Applebot", operator: "Apple", purpose: "search", source: APPLE },
  { token: "OAI-SearchBot", operator: "OpenAI", purpose: "search", source: OPENAI },
  { token: "Claude-SearchBot", operator: "Anthropic", purpose: "search", source: ANTHROPIC },
  {
    token: "PerplexityBot",
    operator: "Perplexity",
    purpose: "search",
    source: "https://docs.perplexity.ai/guides/bots",
  },
  { token: "meta-webindexer", operator: "Meta", purpose: "search", source: META },

  // Fetches a person asked for: always allowed.
  { token: "ChatGPT-User", operator: "OpenAI", purpose: "user", source: OPENAI },
  { token: "Claude-User", operator: "Anthropic", purpose: "user", source: ANTHROPIC },
  {
    token: "Perplexity-User",
    operator: "Perplexity",
    purpose: "user",
    source: "https://docs.perplexity.ai/guides/bots",
  },
  { token: "meta-externalfetcher", operator: "Meta", purpose: "user", source: META },

  // Link previews: always allowed, so a shared link shows its card.
  { token: "facebookexternalhit", operator: "Meta", purpose: "preview", source: META },

  // Training: `trainingPolicy` decides.
  { token: "GPTBot", operator: "OpenAI", purpose: "training", source: OPENAI },
  { token: "ClaudeBot", operator: "Anthropic", purpose: "training", source: ANTHROPIC },
  { token: "Google-Extended", operator: "Google", purpose: "training", source: GOOGLE },
  { token: "Applebot-Extended", operator: "Apple", purpose: "training", source: APPLE },
  { token: "meta-externalagent", operator: "Meta", purpose: "training", source: META },
  {
    token: "CCBot",
    operator: "Common Crawl",
    purpose: "training",
    source: "https://commoncrawl.org/faq",
  },
  {
    // Amazon says Amazonbot improves its products and "may be used to train Amazon AI models".
    // It is one token for both, so it follows the training policy.
    token: "Amazonbot",
    operator: "Amazon",
    purpose: "training",
    source: "https://developer.amazon.com/amazonbot",
  },
];

import { describe, expect, it } from "vitest";
import { type Crawler, crawlers, trainingPolicy } from "../../config/crawlers";
import { buildRobotsTxt } from "./robots-txt";

const sitemapLine = "Sitemap: https://networksinsights.com/sitemap-index.xml";

/** The groups of a robots.txt: the user agents of each and its rules. */
function groups(text: string) {
  const out: Array<{ agents: string[]; rules: string[] }> = [];
  let current: { agents: string[]; rules: string[] } | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      if (line === "") current = undefined;
      continue;
    }
    const [field = "", ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (field.toLowerCase() === "user-agent") {
      if (!current) {
        current = { agents: [], rules: [] };
        out.push(current);
      }
      current.agents.push(value);
    } else if (current) {
      current.rules.push(`${field}: ${value}`);
    }
  }
  return out;
}

const withPolicy = (launched: boolean, policy: "allow" | "disallow") =>
  buildRobotsTxt({ launched, crawlers, trainingPolicy: policy });

describe("robots.txt before launch", () => {
  const text = withPolicy(false, "allow");

  it("allows crawling, so crawlers can read the noindex tags (ADR 0029)", () => {
    const star = groups(text).find((group) => group.agents.includes("*"));
    expect(star?.rules).toEqual(["Allow: /"]);
    expect(text).not.toMatch(/^Disallow: \/\s*$/m);
  });

  it("does not advertise a sitemap", () => {
    expect(text).not.toContain("Sitemap:");
    expect(text).not.toContain("sitemap");
  });
});

describe("robots.txt after launch", () => {
  const text = withPolicy(true, "allow");

  it("allows crawling and names the sitemap index, once, as an absolute URL", () => {
    expect(groups(text).find((group) => group.agents.includes("*"))?.rules).toEqual(["Allow: /"]);
    expect(text.match(/^Sitemap:/gm)).toHaveLength(1);
    expect(text).toContain(sitemapLine);
  });

  it("differs from the pre-launch file by the Sitemap line and nothing else", () => {
    expect(text.replace(`${sitemapLine}\n`, "").trimEnd()).toBe(
      withPolicy(false, "allow").trimEnd(),
    );
  });
});

describe("the AI crawlers", () => {
  it("allows every search, assistant and preview crawler, in either policy", () => {
    for (const policy of ["allow", "disallow"] as const) {
      const parsed = groups(withPolicy(true, policy));
      for (const crawler of crawlers.filter((item) => item.purpose !== "training")) {
        const group = parsed.find((item) => item.agents.includes(crawler.token));
        expect(group?.rules, `${crawler.token} with trainingPolicy ${policy}`).toEqual([
          "Allow: /",
        ]);
      }
    }
  });

  it("follows the training policy for every training crawler", () => {
    for (const [policy, rule] of [
      ["allow", "Allow: /"],
      ["disallow", "Disallow: /"],
    ] as const) {
      const parsed = groups(withPolicy(true, policy));
      const training = crawlers.filter((item) => item.purpose === "training");
      expect(training.length).toBeGreaterThan(0);
      for (const crawler of training) {
        expect(
          parsed.find((item) => item.agents.includes(crawler.token))?.rules,
          `${crawler.token} with trainingPolicy ${policy}`,
        ).toEqual([rule]);
      }
    }
  });

  it("is set to allow, the owner's choice recorded in ADR 0040", () => {
    expect(trainingPolicy).toBe("allow");
  });

  it("names each crawler once", () => {
    const tokens = groups(withPolicy(true, "allow")).flatMap((group) => group.agents);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toContain("*");
    for (const crawler of crawlers) expect(tokens).toContain(crawler.token);
  });

  it("lists the crawlers that the operators document", () => {
    const tokens = crawlers.map((crawler) => crawler.token);
    for (const token of [
      "Googlebot",
      "bingbot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "GPTBot",
      "Claude-SearchBot",
      "Claude-User",
      "ClaudeBot",
      "PerplexityBot",
      "Perplexity-User",
      "Google-Extended",
      "Applebot",
      "Applebot-Extended",
      "meta-externalagent",
      "CCBot",
      "Amazonbot",
    ]) {
      expect(tokens, token).toContain(token);
    }
  });
});

describe("the crawler list itself", () => {
  const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

  it("has a valid, unique token for every entry (matched without regard to case)", () => {
    const seen = new Set<string>();
    for (const crawler of crawlers) {
      expect(crawler.token, crawler.token).toMatch(tokenPattern);
      const key = crawler.token.toLowerCase();
      expect(seen.has(key), `${crawler.token} is listed twice`).toBe(false);
      seen.add(key);
    }
  });

  it("names the operator's own page for every crawler", () => {
    for (const crawler of crawlers) {
      expect(crawler.source, crawler.token).toMatch(/^https:\/\//);
      expect(crawler.operator.length, crawler.token).toBeGreaterThan(1);
    }
  });

  it("uses only the purposes robots.txt knows how to treat", () => {
    const purposes: Crawler["purpose"][] = ["search", "user", "training", "preview"];
    for (const crawler of crawlers) expect(purposes).toContain(crawler.purpose);
  });

  it("stays far below the 500 KiB that Google reads", () => {
    expect(Buffer.byteLength(withPolicy(true, "disallow"))).toBeLessThan(10 * 1024);
  });
});

import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/regex-tester/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { openTool } from "./tool-page";

// Regex Tester in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, tests the sample of its page,
// highlights the matches inside the test string and lists their index, text and groups, follows
// the g flag, explains a broken pattern or flag and recovers, renders visitor text as text,
// stays responsive on a 100 KB test string, sends nothing while typing, copies the pattern, and
// its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/regex-tester/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const DATE_PATTERN = "(?<year>\\d{4})-(?<month>\\d\\d)-(?<day>\\d\\d)";
const DATE_TEXT = "Released 2026-09-29, patched 2026-10-03.";

const pattern = (page: Page) => page.getByRole("textbox", { name: "Regular expression" });
const flags = (page: Page) => page.getByRole("textbox", { name: "Flags" });
const text = (page: Page) => page.getByRole("textbox", { name: "Test string" });
const summary = (page: Page) => page.locator("#regex-tester-summary");
const marks = (page: Page) => page.locator("#regex-tester-highlighted mark");
const rows = (page: Page) => page.locator("#regex-tester-list > li");

/**
 * Puts a long string in the Test string box the way a paste does: the value is set, then the input
 * event React listens to fires. Playwright's own `fill` takes seconds on 100 KB in a textarea, in
 * any page, and would measure Playwright and not the tool.
 */
async function paste(page: Page, value: string) {
  await page.evaluate((pasted) => {
    const box = document.querySelector<HTMLTextAreaElement>("#regex-tester-text");
    if (!box) throw new Error("no test string box");
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    set?.call(box, pasted);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Records CSP violations from before the first script runs. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI} ${event.sample}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/**
 * Opens the page and waits until the island answers. Astro drops `ssr` when React starts to
 * hydrate, not when it has finished: a fill in between is lost, and in WebKit on CI the pattern box
 * then stays empty. So a pattern is typed, again if need be, until the page reacts, then cleared.
 */
async function open(page: Page) {
  await openTool(page, PATH);
  const copy = page.getByRole("button", { name: "Copy pattern" });
  await expect(async () => {
    await pattern(page).fill("a");
    await expect(copy).toBeEnabled({ timeout: 1_000 });
  }).toPass();
  await pattern(page).fill("");
  await expect(copy).toBeDisabled();
}

test("hydrates, starts with the g flag, and tests the sample of its page", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await expect(flags(page)).toHaveValue("g");
  await expect(pattern(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Copy pattern" })).toBeDisabled();
  await expect(marks(page)).toHaveCount(0);
  await expect(page.locator("#regex-tester-error")).toHaveCount(0);

  await pattern(page).fill(DATE_PATTERN);
  await text(page).fill(DATE_TEXT);

  await expect(summary(page)).toHaveText("2 matches.");
  await expect(marks(page)).toHaveText(["2026-09-29", "2026-10-03"]);
  await expect(page.locator("#regex-tester-highlighted")).toHaveText(DATE_TEXT);

  await expect(rows(page)).toHaveCount(2);
  const first = rows(page).nth(0);
  await expect(first).toContainText("Match 1 at index 9 to 19");
  await expect(first).toContainText("2026-09-29");
  await expect(first).toContainText("Group 1 (year): 2026");
  await expect(first).toContainText("Group 2 (month): 09");
  await expect(first).toContainText("Group 3 (day): 29");
  await expect(rows(page).nth(1)).toContainText("Match 2 at index 29 to 39");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(pattern(page)).toHaveValue("");
  await expect(text(page)).toHaveValue("");
  await expect(flags(page)).toHaveValue("g");
  await expect(marks(page)).toHaveCount(0);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("follows the flags: no g finds one match, i, m, s and u change what matches", async ({
  page,
}) => {
  await open(page);
  await pattern(page).fill("a\\w");
  await text(page).fill("ab AC ad");

  await expect(marks(page)).toHaveText(["ab", "ad"]);
  await flags(page).fill("gi");
  await expect(marks(page)).toHaveText(["ab", "AC", "ad"]);

  await flags(page).fill("");
  await expect(marks(page)).toHaveText(["ab"]);
  await expect(summary(page)).toContainText("1 match.");
  await expect(summary(page)).toContainText(
    "Only the first match is found because the g flag is off.",
  );

  await pattern(page).fill("^\\w+$");
  await text(page).fill("one\ntwo");
  await flags(page).fill("g");
  await expect(summary(page)).toHaveText("No matches.");
  await flags(page).fill("gm");
  await expect(marks(page)).toHaveText(["one", "two"]);

  await pattern(page).fill("a.b");
  await text(page).fill("a\nb");
  await flags(page).fill("g");
  await expect(summary(page)).toHaveText("No matches.");
  await flags(page).fill("gs");
  await expect(summary(page)).toHaveText("1 match.");

  await pattern(page).fill("^.$");
  await text(page).fill("😀");
  await flags(page).fill("g");
  await expect(summary(page)).toHaveText("No matches.");
  await flags(page).fill("gu");
  await expect(marks(page)).toHaveText(["😀"]);
});

test("explains a broken pattern or flag, then recovers", async ({ page }) => {
  await open(page);
  await text(page).fill("some text");

  await pattern(page).fill("(unclosed");
  const patternError = page.locator("#regex-tester-pattern-error");
  await expect(patternError).toContainText("This is not a valid regular expression.");
  await expect(pattern(page)).toHaveAttribute("aria-invalid", "true");
  await expect(marks(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);

  await pattern(page).fill("(text)");
  await expect(patternError).toHaveCount(0);
  await expect(marks(page)).toHaveText(["text"]);

  await flags(page).fill("gx");
  await expect(page.locator("#regex-tester-flags-error")).toHaveText(
    'The flag "x" is not supported here. Use g, i, m, s or u.',
  );
  await expect(flags(page)).toHaveAttribute("aria-invalid", "true");
  await flags(page).fill("gg");
  await expect(page.locator("#regex-tester-flags-error")).toContainText("written twice");
  await flags(page).fill("g");
  await expect(page.locator("#regex-tester-flags-error")).toHaveCount(0);
  await expect(marks(page)).toHaveText(["text"]);
});

test("lists groups that did not take part and matches that are empty", async ({ page }) => {
  await open(page);
  await pattern(page).fill("(a)|(b)");
  await text(page).fill("b");
  await expect(rows(page).nth(0)).toContainText("Group 1: did not take part");
  await expect(rows(page).nth(0)).toContainText("Group 2: b");

  await pattern(page).fill("x*");
  await text(page).fill("axb");
  await expect(marks(page)).toHaveText(["x"]);
  await expect(summary(page)).toContainText("4 matches.");
  await expect(summary(page)).toContainText("3 of them are empty matches and are not highlighted.");
  await expect(rows(page).nth(0)).toContainText("(empty match)");
});

test("renders the test string and the matches as text, never as markup", async ({ page }) => {
  const violations = await watchViolations(page);
  await open(page);
  const hostile = "<img src=x onerror=\"document.title='pwned'\"> <b>bold</b>";
  await text(page).fill(`before ${hostile} after`);
  await pattern(page).fill("<[^>]+>");
  await expect(marks(page)).toHaveCount(3);
  await expect(page.locator("#regex-tester-highlighted")).toHaveText(`before ${hostile} after`);
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator("#regex-tester-highlighted b")).toHaveCount(0);
  await expect(rows(page).nth(0)).toContainText("<img src=x onerror=\"document.title='pwned'\">");
  await expect(page).not.toHaveTitle("pwned");
  expect(await violations()).toEqual([]);
});

test("stays responsive on a 100 KB test string and says when it lists only the first matches", async ({
  page,
}) => {
  await open(page);
  const line = "The quick brown fox 12345 jumps over the lazy dog.\n";
  const big = line.repeat(Math.ceil(100_000 / line.length) + 1);
  expect(big.length).toBeGreaterThan(100_000);

  await pattern(page).fill("\\b\\w+\\b");
  await paste(page, big);
  await expect(summary(page)).toContainText("The first 1,000 matches are shown; there are more.", {
    timeout: 10_000,
  });
  await expect(marks(page)).toHaveCount(1000);
  await expect(rows(page)).toHaveCount(1000);

  // The boxes keep answering while the result follows.
  await pattern(page).fill("fox (\\d+)");
  await expect(summary(page)).toContainText("The first 1,000 matches are shown", {
    timeout: 10_000,
  });
  await pattern(page).fill("zebra");
  await expect(summary(page)).toHaveText("No matches.", { timeout: 10_000 });
  await expect(marks(page)).toHaveCount(0);
  await expect(page.locator("#regex-tester-highlighted")).toHaveText(big.trimEnd());
});

test("refuses a test string over the limit and reads it again when it is shorter", async ({
  page,
}) => {
  await open(page);
  await pattern(page).fill("a");
  await paste(page, "b".repeat(500_001));
  await expect(page.locator("#regex-tester-error")).toContainText(
    "The test string is 500,001 characters, more than the 500,000 the tool reads.",
  );
  await text(page).fill("aa");
  await expect(page.locator("#regex-tester-error")).toHaveCount(0);
  await expect(marks(page)).toHaveText(["a", "a"]);
});

test("sends nothing while a pattern and a test string are typed", async ({ page }) => {
  await open(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await pattern(page).fill(DATE_PATTERN);
  await text(page).fill(DATE_TEXT);
  await expect(marks(page)).toHaveCount(2);
  await pattern(page).fill("(");
  await expect(page.locator("#regex-tester-pattern-error")).toBeVisible();
  expect(requests).toEqual([]);
});

test("copies the pattern to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  // The site's permissions policy does not let a page read the clipboard back, so the test records
  // what the page writes to it.
  await page.evaluate(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (value: string) => {
      copied.push(value);
      return write(value);
    };
  });
  await pattern(page).fill(DATE_PATTERN);
  await page.getByRole("button", { name: "Copy pattern" }).click();
  await expect(page.getByText("Pattern copied to the clipboard.")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual(
    [DATE_PATTERN],
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    // Reduced motion switches the button colour transitions off, so axe never measures contrast
    // in the middle of one.
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await open(page);

    // Empty, with matches (three of them, so both tones show), with an invalid pattern, with an
    // invalid flag, with no match, and over the limit.
    await pattern(page).fill("\\d+");
    await text(page).fill("a1 b22 c333 d4");
    await expect(marks(page)).toHaveCount(4);
    let results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await pattern(page).fill("(a)|(b)");
    await text(page).fill("b");
    await expect(rows(page)).toHaveCount(1);
    results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await pattern(page).fill("(");
    await expect(page.locator("#regex-tester-pattern-error")).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await pattern(page).fill("b");
    await flags(page).fill("z");
    await expect(page.locator("#regex-tester-flags-error")).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    await flags(page).fill("g");
    await paste(page, "b".repeat(500_001));
    await expect(page.locator("#regex-tester-error")).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
}

test("its structured data says what the page shows", async ({ page }) => {
  await open(page);
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(scripts).toHaveLength(1);
  const graph = jsonLdDocumentSchema.parse(JSON.parse(scripts[0] ?? ""))["@graph"];

  const app = graph.find((node) => node["@type"] === "WebApplication");
  if (!app || !("applicationCategory" in app)) throw new Error("no WebApplication node");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(app.name);
  expect(app.name).toBe(manifest.name);
  expect(app.url).toBe(`${site.url}${PATH}`);
  expect(app.description).toBe(manifest.summary);
  await expect(page.locator("main").getByText(manifest.summary).first()).toBeVisible();
  expect(app.dateModified).toBe(manifest.updated);
  expect("aggregateRating" in app).toBe(false);

  const faq = graph.find((node) => node["@type"] === "FAQPage");
  if (!faq || !("mainEntity" in faq)) throw new Error("no FAQPage node");
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(2);
  const pageText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const entry of faq.mainEntity) {
    await expect(page.getByRole("heading", { level: 3, name: entry.name })).toBeVisible();
    expect(pageText).toContain(entry.acceptedAnswer.text);
  }
});

test("Quick facts are the manifest's, in order", async ({ page }) => {
  await open(page);
  const section = page.getByRole("region", { name: "Quick facts" });
  const facts = quickFacts(manifest);
  await expect(section.locator("dt")).toHaveText(facts.map((fact) => fact.label));
  await expect(section.locator("dd")).toHaveText(facts.map((fact) => fact.value));
  await expect(section.locator("time")).toHaveAttribute("datetime", manifest.updated);
});

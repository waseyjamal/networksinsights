import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/text/case-converter/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// Case Converter in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, converts the example of its page
// in every case, keeps emoji and Chinese text whole, and its structured data and Quick facts match
// the page.

test.use({ baseURL: edgeURL });

const PATH = "/case-converter/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The title of the Examples section, and what the page says each case gives. */
const EXAMPLE = "the lord of the rings: the return of the king";

const box = (page: Page) => page.getByRole("textbox", { name: "Your text" });
const result = (page: Page) => page.locator("#case-converter-result");
const modeButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

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

/** Opens the page and waits until the island has hydrated (Astro drops `ssr` when it has). */
async function open(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("astro-island")).toHaveCount(1);
  await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
}

test("hydrates, converts the example of its page in every case, and clears", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  // UPPERCASE is chosen first, and nothing is converted before there is text.
  await expect(modeButton(page, "UPPERCASE")).toHaveAttribute("aria-pressed", "true");
  await expect(result(page)).toHaveValue("");

  await box(page).fill(EXAMPLE);
  await expect(result(page)).toHaveValue("THE LORD OF THE RINGS: THE RETURN OF THE KING");

  const cases: [string, string][] = [
    ["lowercase", "the lord of the rings: the return of the king"],
    ["Title Case", "The Lord of the Rings: The Return of the King"],
    ["Sentence case", "The lord of the rings: the return of the king"],
    ["camelCase", "theLordOfTheRingsTheReturnOfTheKing"],
    ["PascalCase", "TheLordOfTheRingsTheReturnOfTheKing"],
    ["snake_case", "the_lord_of_the_rings_the_return_of_the_king"],
    ["kebab-case", "the-lord-of-the-rings-the-return-of-the-king"],
  ];
  for (const [name, expected] of cases) {
    await modeButton(page, name).click();
    await expect(modeButton(page, name)).toHaveAttribute("aria-pressed", "true");
    await expect(modeButton(page, "UPPERCASE")).toHaveAttribute("aria-pressed", "false");
    await expect(result(page)).toHaveValue(expected);
  }

  // Typing updates the result live, with no button; the original text is never changed.
  await box(page).press("End");
  await box(page).pressSequentially(" again");
  await expect(result(page)).toHaveValue("the-lord-of-the-rings-the-return-of-the-king-again");
  await expect(box(page)).toHaveValue(`${EXAMPLE} again`);

  await page.getByRole("button", { name: "Clear text" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(result(page)).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("keeps emoji and Chinese text whole", async ({ page }) => {
  await open(page);
  await box(page).fill("hi 👨‍👩‍👧 🇮🇳 👍🏽 你好世界。bye");
  await expect(result(page)).toHaveValue("HI 👨‍👩‍👧 🇮🇳 👍🏽 你好世界。BYE");
  await modeButton(page, "Sentence case").click();
  await expect(result(page)).toHaveValue("Hi 👨‍👩‍👧 🇮🇳 👍🏽 你好世界。Bye");
  await modeButton(page, "snake_case").click();
  await expect(result(page)).toHaveValue("hi_你好世界_bye");
});

test("copies the result to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  const copy = page.getByRole("button", { name: "Copy result" });
  await expect(copy).toBeDisabled();
  await box(page).fill(EXAMPLE);
  await copy.click();
  await expect(page.getByText("Copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    await box(page).fill(EXAMPLE);
    await modeButton(page, "Title Case").click();
    await expect(result(page)).toHaveValue("The Lord of the Rings: The Return of the King");
    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
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
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const entry of faq.mainEntity) {
    await expect(page.getByRole("heading", { level: 3, name: entry.name })).toBeVisible();
    expect(text).toContain(entry.acceptedAnswer.text);
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

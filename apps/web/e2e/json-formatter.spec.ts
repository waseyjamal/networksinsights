import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/json-formatter/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// JSON Formatter in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, formats and minifies the example
// of its page, points at an error by line and column, stays responsive on 1 MB of JSON, and its
// structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/json-formatter/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The example of the page, and what Format with 2 spaces gives. */
const EXAMPLE = '{"name":"Ada","langs":["en","fr"],"active":true}';
const FORMATTED = [
  "{",
  '  "name": "Ada",',
  '  "langs": [',
  '    "en",',
  '    "fr"',
  "  ],",
  '  "active": true',
  "}",
].join("\n");

const box = (page: Page) => page.getByRole("textbox", { name: "Your JSON" });
const result = (page: Page) => page.locator("#json-formatter-result");
const indent = (page: Page) => page.getByRole("combobox", { name: "Indentation" });
const modeButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const stat = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

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

test("hydrates, formats and minifies the example of its page, and clears", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await expect(modeButton(page, "Format")).toHaveAttribute("aria-pressed", "true");
  await expect(result(page)).toHaveValue("");

  await box(page).fill(EXAMPLE);
  await expect(result(page)).toHaveValue(FORMATTED);
  await expect(stat(page, "lines")).toHaveText("8");
  await expect(stat(page, "characters")).toHaveText(String(FORMATTED.length));

  await indent(page).selectOption({ label: "4 spaces" });
  await expect(result(page)).toHaveValue(FORMATTED.replace(/^( +)/gm, "$1$1"));
  await indent(page).selectOption({ label: "Tab" });
  await expect(result(page)).toHaveValue(
    FORMATTED.replace(/^( +)/gm, (s) => "\t".repeat(s.length / 2)),
  );

  await modeButton(page, "Minify").click();
  await expect(modeButton(page, "Minify")).toHaveAttribute("aria-pressed", "true");
  await expect(modeButton(page, "Format")).toHaveAttribute("aria-pressed", "false");
  await expect(indent(page)).toBeDisabled();
  await expect(result(page)).toHaveValue(EXAMPLE);
  await expect(stat(page, "lines")).toHaveText("1");
  await expect(stat(page, "characters")).toHaveText("48");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(result(page)).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("names the line and column of an error and points at it", async ({ page }) => {
  await open(page);
  await box(page).fill('{\n  "name": "Ada",\n  "age": 36,\n}');
  await expect(page.locator("#json-formatter-error")).toHaveText(
    'Line 4, column 1: Remove the comma before "}": JSON does not allow a trailing comma.',
  );
  await expect(page.locator(".ni-alert pre")).toHaveText("}\n^");
  await expect(result(page)).toHaveValue("");
  await expect(stat(page, "lines")).toHaveText("0");

  // Fixing it brings the result back and the message goes.
  await box(page).fill('{\n  "name": "Ada",\n  "age": 36\n}');
  await expect(page.locator("#json-formatter-error")).toHaveCount(0);
  await expect(result(page)).toHaveValue('{\n  "name": "Ada",\n  "age": 36\n}');
});

test("formats 1 MB of JSON and keeps the page responsive", async ({ page }) => {
  await open(page);
  const size = await page.evaluate(() => {
    const record = { id: 12345, name: "Ada Lovelace", tags: ["math", "engines"], active: true };
    const text = JSON.stringify(Array.from({ length: 16_000 }, () => record));
    const box = document.querySelector<HTMLTextAreaElement>("#json-formatter-text");
    if (!box) throw new Error("no text box");
    // Set the value the way a paste does, so React sees the change.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    return text.length;
  });
  expect(size).toBeGreaterThan(1_000_000);
  // A long text is formatted in steps, with a message while they run.
  await expect(page.getByText("Formatting a long text…")).toBeVisible();
  await expect(stat(page, "lines")).toHaveText("144,002", { timeout: 15_000 });
  await expect(stat(page, "characters")).toHaveText("1,984,002");
  await expect(page.getByText("Formatting a long text…")).toHaveCount(0);

  await modeButton(page, "Minify").click();
  await expect(stat(page, "characters")).toHaveText("1,200,001", { timeout: 15_000 });
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
    await box(page).fill('{"a": 1,}');
    await expect(page.locator("#json-formatter-error")).toBeVisible();
    let results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await box(page).fill(EXAMPLE);
    await expect(result(page)).toHaveValue(FORMATTED);
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

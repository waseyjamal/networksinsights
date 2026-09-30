import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/color-design/color-converter/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// Color Converter in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, converts the examples of its page
// from each field, follows the color picker, explains invalid input while keeping the last color,
// copies one format, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/color-converter/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const field = (page: Page, name: "HEX" | "RGB" | "HSL") =>
  page.getByRole("textbox", { name, exact: true });
const swatch = (page: Page) => page.locator("#color-swatch");

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

test("renders its starting color without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(field(page, "HEX")).toHaveValue("#3b82f6");
  await expect(field(page, "RGB")).toHaveValue("rgb(59, 130, 246)");
  await expect(field(page, "HSL")).toHaveValue("hsl(217, 91%, 60%)");
  await context.close();
});

test("hydrates and converts the examples of its page from each field", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await field(page, "HEX").fill("#f80");
  await expect(field(page, "HEX")).toHaveValue("#f80");
  await expect(field(page, "RGB")).toHaveValue("rgb(255, 136, 0)");
  await expect(field(page, "HSL")).toHaveValue("hsl(32, 100%, 50%)");
  await expect(swatch(page)).toHaveCSS("background-color", "rgb(255, 136, 0)");
  await expect(swatch(page)).toHaveAttribute("aria-label", "Preview of the color #ff8800");

  await field(page, "HSL").fill("hsl(217, 91%, 60%)");
  await expect(field(page, "HEX")).toHaveValue("#3c83f6");
  await expect(field(page, "RGB")).toHaveValue("rgb(60, 131, 246)");

  await field(page, "RGB").fill("59 130 246");
  await expect(field(page, "HEX")).toHaveValue("#3b82f6");
  await expect(field(page, "HSL")).toHaveValue("hsl(217, 91%, 60%)");
  await expect(page.locator("#color-picker")).toHaveValue("#3b82f6");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("follows the color picker", async ({ page }) => {
  await open(page);
  await page.locator("#color-picker").fill("#00ff00");
  await expect(field(page, "HEX")).toHaveValue("#00ff00");
  await expect(field(page, "RGB")).toHaveValue("rgb(0, 255, 0)");
  await expect(field(page, "HSL")).toHaveValue("hsl(120, 100%, 50%)");
  await expect(swatch(page)).toHaveCSS("background-color", "rgb(0, 255, 0)");
});

test("explains invalid input and keeps the last color", async ({ page }) => {
  await open(page);
  await field(page, "HSL").fill("hsl(400, 50%, 50%)");
  await expect(page.locator("#color-hsl-error")).toHaveText(
    "The hue is 400; it must be from 0 to 360 degrees.",
  );
  await expect(field(page, "HSL")).toHaveAttribute("aria-invalid", "true");
  await expect(field(page, "HEX")).toHaveValue("#3b82f6");
  await expect(swatch(page)).toHaveCSS("background-color", "rgb(59, 130, 246)");

  await field(page, "HEX").fill("#12345");
  await expect(page.locator("#color-hex-error")).toHaveText(
    "A HEX color has 3 or 6 digits after the #, such as #3b82f6; this has 5.",
  );
  await expect(page.locator("#color-hsl-error")).toHaveCount(0);
  await field(page, "HEX").fill("#123456");
  await expect(page.locator("#color-hex-error")).toHaveCount(0);
  await expect(field(page, "RGB")).toHaveValue("rgb(18, 52, 86)");
  await expect(field(page, "HSL")).toHaveValue("hsl(210, 65%, 20%)");
});

test("copies one format to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  await page.getByRole("button", { name: "Copy RGB" }).click();
  await expect(page.getByText("RGB copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    // Reduced motion switches the button colour transitions off, so axe never measures contrast
    // halfway through one (as design-system.spec.ts does).
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await open(page);
    let results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await field(page, "RGB").fill("rgb(300, 0, 0)");
    await expect(page.locator("#color-rgb-error")).toBeVisible();
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
  const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const entry of faq.mainEntity) {
    await expect(page.getByRole("heading", { level: 3, name: entry.name })).toBeVisible();
    expect(main).toContain(entry.acceptedAnswer.text);
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

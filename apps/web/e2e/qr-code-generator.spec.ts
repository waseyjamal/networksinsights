import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/generators/qr-code-generator/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { openTool } from "./tool-page";

// QR Code Generator in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). The static HTML holds no code; after hydration
// typing draws one, the level and the size redraw it, a code too fine for the size is refused, the
// PNG download has the chosen size, and the structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/qr-code-generator/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EXAMPLE = "https://example.com/";

const box = (page: Page) => page.getByRole("textbox", { name: "Text or link" });
const level = (page: Page) => page.getByRole("combobox", { name: "Error correction" });
const size = (page: Page) => page.getByRole("combobox", { name: "Size" });
const code = (page: Page) => page.locator("#qr-code-generator-code");
const details = (page: Page) => page.locator("#qr-code-generator-details");

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
  await openTool(page, PATH);
}

/** The canvas's pixel at x, y: true when it is black. */
function isDark(page: Page, x: number, y: number) {
  return code(page).evaluate(
    (canvas: HTMLCanvasElement, [px, py]) => {
      const data = canvas.getContext("2d")?.getImageData(px ?? 0, py ?? 0, 1, 1).data;
      return data?.[0] === 0 && data[1] === 0 && data[2] === 0;
    },
    [x, y],
  );
}

test("the static HTML holds no code", async ({ request }) => {
  const html = await (await request.get(PATH)).text();
  expect(html).toContain('id="qr-code-generator-text"');
  expect(html).not.toContain("qr-code-generator-code");
});

test("draws a code as you type, redraws it for a new level and size, and refuses one too fine", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await expect(page.getByText("Type some text or a link to make its QR code.")).toBeVisible();
  await expect(code(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download PNG" })).toHaveCount(0);

  // The example of the page: version 2 at M, 25 modules drawn 7 pixels wide from 40 pixels in.
  await box(page).fill(EXAMPLE);
  await expect(details(page)).toHaveText("Version 2, 25 × 25 modules, level M.");
  await expect(code(page)).toHaveAttribute("width", "256");
  expect(await isDark(page, 40, 40)).toBe(true); // the corner of the top-left finder
  expect(await isDark(page, 39, 39)).toBe(false); // the quiet zone
  expect(await isDark(page, 40 + 7, 40 + 7)).toBe(false); // the finder's light ring

  await level(page).selectOption("H");
  await expect(details(page)).toHaveText("Version 3, 29 × 29 modules, level H.");

  await size(page).selectOption("512");
  await expect(code(page)).toHaveAttribute("width", "512");

  // 200 letters at H need 77 modules a side: too many for 128 pixels.
  await box(page).fill("a".repeat(200));
  await size(page).selectOption("128");
  await expect(page.getByText(/too many to draw at 128 pixels\. Choose 192 pixels/)).toBeVisible();
  await expect(code(page)).toHaveCount(0);
  await size(page).selectOption("192");
  await expect(details(page)).toHaveText("Version 15, 77 × 77 modules, level H.");

  // Emptied again: no code and the prompt.
  await box(page).fill("");
  await expect(code(page)).toHaveCount(0);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("downloads a PNG of the chosen size", async ({ page }) => {
  const violations = await watchViolations(page);
  await open(page);
  await box(page).fill(EXAMPLE);
  await size(page).selectOption("320");
  await expect(code(page)).toHaveAttribute("width", "320");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("qr-code-320px.png");
  const file = await readFile(await download.path());
  // The PNG signature, then the IHDR chunk's width and height.
  expect(file.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(file.readUInt32BE(16)).toBe(320);
  expect(file.readUInt32BE(20)).toBe(320);
  expect(await violations()).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    await box(page).fill(EXAMPLE);
    await expect(code(page)).toBeVisible();
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

import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/base64/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// Base64 Encoder / Decoder in the three engines, against `wrangler dev`, so the page runs under the
// real Content-Security-Policy and headers (e2e/edge.ts). It hydrates, encodes the example of its
// page in both alphabets, encodes a file, decodes text and binary data (downloading the file), names
// the character that breaks a decode, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/base64/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** A 1 by 1 PNG. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const modeButton = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const plain = (page: Page) => page.getByRole("textbox", { name: "Text to encode" });
const encoded = (page: Page) => page.getByRole("textbox", { name: "Base64 to decode" });
const result = (page: Page) => page.locator("#base64-result");
const decodedText = (page: Page) => page.locator("#base64-decoded");
const alphabet = (page: Page) => page.getByRole("combobox", { name: "Alphabet" });
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

test("hydrates, encodes the example of its page in both alphabets, decodes it back", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await expect(modeButton(page, "Encode")).toHaveAttribute("aria-pressed", "true");
  await plain(page).fill("Hello, world!");
  await expect(result(page)).toHaveValue("SGVsbG8sIHdvcmxkIQ==");
  await expect(stat(page, "input")).toHaveText("13 bytes");
  await expect(stat(page, "output")).toHaveText("20 characters");

  await alphabet(page).selectOption("url");
  await expect(result(page)).toHaveValue("SGVsbG8sIHdvcmxkIQ");
  await plain(page).fill("café");
  await expect(result(page)).toHaveValue("Y2Fmw6k");

  await modeButton(page, "Decode").click();
  await expect(alphabet(page)).toBeDisabled();
  await encoded(page).fill("SGVsbG8sIHdvcmxkIQ==");
  await expect(decodedText(page)).toHaveValue("Hello, world!");
  await expect(stat(page, "output")).toHaveText("13 bytes");

  // Each mode keeps its own input.
  await modeButton(page, "Encode").click();
  await expect(plain(page)).toHaveValue("café");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(plain(page)).toHaveValue("");
  await expect(result(page)).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("encodes a file", async ({ page }) => {
  await open(page);
  await page.locator("#base64-file").setInputFiles({
    name: "hello.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0xfb, 0xff, 0x00, 0x10]),
  });
  await expect(page.getByText("Encoding the file hello.bin (4 bytes).")).toBeVisible();
  await expect(result(page)).toHaveValue("+/8AEA==");
  await page.getByRole("button", { name: "Remove file" }).click();
  await expect(plain(page)).toBeVisible();
  await expect(result(page)).toHaveValue("");
});

test("refuses a file over 5 MB before reading it", async ({ page }) => {
  await open(page);
  await page.locator("#base64-file").setInputFiles({
    name: "big.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.locator("#base64-file-error")).toHaveText(
    "This is just over 5 MB, the most the tool works on.",
  );
});

test("decodes binary data to a download with the right type", async ({ page }) => {
  await open(page);
  await modeButton(page, "Decode").click();
  await encoded(page).fill(`data:image/png;base64,${PNG_BASE64}`);
  await expect(page.locator("#base64-binary")).toHaveText(
    "PNG image, 70 bytes. Download it to open it.",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download .png file" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("decoded.png");
  const bytes = readFileSync((await download.path()) ?? "");
  expect(bytes.toString("base64")).toBe(PNG_BASE64);
});

test("names the character that breaks a decode", async ({ page }) => {
  await open(page);
  await modeButton(page, "Decode").click();
  await encoded(page).fill("Zm9v*mFy");
  await expect(page.locator("#base64-error")).toHaveText(
    'Character 5, "*", is not Base64. Base64 uses A to Z, a to z, 0 to 9, + and / (or - and _ in Base64URL), and = at the end.',
  );
  await encoded(page).fill("Zm9vYmFy");
  await expect(page.locator("#base64-error")).toHaveCount(0);
  await expect(decodedText(page)).toHaveValue("foobar");
});

test("copies the result to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  const copy = page.getByRole("button", { name: "Copy result" });
  await expect(copy).toBeDisabled();
  await plain(page).fill("Hello, world!");
  await copy.click();
  await expect(page.getByText("Copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    await plain(page).fill("Hello, world!");
    await expect(result(page)).toHaveValue("SGVsbG8sIHdvcmxkIQ==");
    let results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await modeButton(page, "Decode").click();
    await encoded(page).fill("Zg=");
    await expect(page.locator("#base64-error")).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await encoded(page).fill(PNG_BASE64);
    await expect(page.locator("#base64-binary")).toBeVisible();
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

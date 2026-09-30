import { writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/hash-generator/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// Hash Generator in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, hashes the example of its page as
// it is typed, hashes a file read in chunks, refuses a file over 50 MB, copies one hash, and its
// structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/hash-generator/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const HELLO = {
  md5: "5d41402abc4b2a76b9719d911017c592",
  sha1: "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  sha512:
    "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043",
};

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const text = (page: Page) => page.getByRole("textbox", { name: "Text to hash" });
const hash = (page: Page, source: "text" | "file", algorithm: string) =>
  page.locator(`#hash-${source}-${algorithm}`);

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

test("hydrates and hashes the example of its page as it is typed", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await expect(tab(page, "Text")).toHaveAttribute("aria-selected", "true");
  await text(page).fill("hello");
  for (const [algorithm, value] of Object.entries(HELLO)) {
    await expect(hash(page, "text", algorithm)).toHaveValue(value);
  }
  await text(page).fill("Hello");
  await expect(hash(page, "text", "md5")).toHaveValue("8b1a9953c4611296a827abf8c47804d7");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(text(page)).toHaveValue("");
  await expect(hash(page, "text", "md5")).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("hashes a file and keeps the text tab as it was", async ({ page }) => {
  await open(page);
  await text(page).fill("hello");
  await tab(page, "File").click();
  await page.locator("#hash-file-input").setInputFiles({
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.locator("#hash-file-name")).toHaveText(
    "Hashes of the file hello.txt (5 bytes).",
  );
  for (const [algorithm, value] of Object.entries(HELLO)) {
    await expect(hash(page, "file", algorithm)).toHaveValue(value);
  }
  await page.getByRole("button", { name: "Remove file" }).click();
  await expect(hash(page, "file", "md5")).toHaveValue("");
  await tab(page, "Text").click();
  await expect(hash(page, "text", "md5")).toHaveValue(HELLO.md5);
});

test("hashes a file of several chunks", async ({ page }) => {
  await open(page);
  await tab(page, "File").click();
  // 9 MB of zeros: three chunks of the reader.
  await page.locator("#hash-file-input").setInputFiles({
    name: "zeros.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(9 * 1024 * 1024),
  });
  await expect(page.locator("#hash-file-name")).toHaveText("Hashes of the file zeros.bin (9 MB).");
  await expect(hash(page, "file", "md5")).toHaveValue("b82b4ab87e44976024abc14a1670dac0");
});

test("refuses a file over 50 MB before reading it", async ({ page }, testInfo) => {
  await open(page);
  await tab(page, "File").click();
  // Playwright passes a buffer of at most 50 MB, so the file goes through the disk.
  const big = testInfo.outputPath("big.bin");
  writeFileSync(big, new Uint8Array(50 * 1024 * 1024 + 1));
  await page.locator("#hash-file-input").setInputFiles(big);
  await expect(page.locator("#hash-file-error")).toHaveText(
    "This is just over 50 MB. The most the tool hashes is 50 MB.",
  );
  await expect(hash(page, "file", "md5")).toHaveValue("");
});

test("copies one hash to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  const copy = page.getByRole("button", { name: "Copy SHA-256" });
  await expect(copy).toBeDisabled();
  await text(page).fill("hello");
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.getByText("SHA-256 copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    // Reduced motion switches the button colour transitions off, so axe never measures contrast
    // halfway through one (as design-system.spec.ts does).
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await open(page);
    await text(page).fill("hello");
    await expect(hash(page, "text", "md5")).toHaveValue(HELLO.md5);
    let results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await tab(page, "File").click();
    await page.locator("#hash-file-input").setInputFiles({
      name: "hello.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(hash(page, "file", "md5")).toHaveValue(HELLO.md5);
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

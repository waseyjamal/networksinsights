import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/generators/password-generator/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// Password Generator in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). The static HTML holds no password; after
// hydration it draws one, draws again on every option change, refuses an empty choice and a length
// out of range, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/password-generator/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const SETS = {
  Uppercase: /[A-Z]/,
  Lowercase: /[a-z]/,
  Numbers: /[0-9]/,
  Symbols: /[!#$%&()*+,\-./:;<=>?@[\]^_{|}~]/,
};

const result = (page: Page) => page.locator("#password-generator-result");
const length = (page: Page) => page.getByRole("spinbutton", { name: "Length" });
const kind = (page: Page, name: keyof typeof SETS) => page.getByRole("checkbox", { name });
const strength = (page: Page) => page.locator("#password-generator-strength");

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

/** Opens the page and waits until the island has hydrated and drawn its first password. */
async function open(page: Page) {
  await page.goto(PATH);
  await expect(page.locator("astro-island")).toHaveCount(1);
  await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
  await expect(result(page)).toHaveValue(/^.{16}$/);
}

test("the static HTML holds no password", async ({ request }) => {
  const html = await (await request.get(PATH)).text();
  expect(html).toMatch(
    /id="password-generator-result"[^>]*value=""|value=""[^>]*id="password-generator-result"/,
  );
});

test("draws a password, draws again on every change, and refuses bad options", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  // All four kinds are ticked, and each appears in the first password.
  const first = await result(page).inputValue();
  for (const [name, pattern] of Object.entries(SETS)) {
    await expect(kind(page, name as keyof typeof SETS)).toBeChecked();
    expect(first).toMatch(pattern);
  }
  await expect(strength(page)).toContainText("Very strong");
  await expect(strength(page)).toContainText("about 103 bits");

  // Generate again gives a different password with the same settings.
  await page.getByRole("button", { name: "Generate again" }).click();
  await expect(result(page)).not.toHaveValue(first);
  await expect(result(page)).toHaveValue(/^.{16}$/);

  // A new length draws a new password straight away.
  await length(page).fill("32");
  await expect(result(page)).toHaveValue(/^.{32}$/);

  // Only numbers: digits only.
  for (const name of ["Uppercase", "Lowercase", "Symbols"] as const)
    await kind(page, name).uncheck();
  await expect(result(page)).toHaveValue(/^[0-9]{32}$/);

  // Nothing ticked: no password, a warning, and nothing to copy.
  await kind(page, "Numbers").uncheck();
  await expect(result(page)).toHaveValue("");
  await expect(page.getByText("Choose at least one kind of character.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy password" })).toBeDisabled();
  await kind(page, "Lowercase").check();
  await expect(result(page)).toHaveValue(/^[a-z]{32}$/);

  // A length out of range: no password and an error on the field.
  await length(page).fill("7");
  await expect(result(page)).toHaveValue("");
  await expect(page.getByText("Enter a whole number from 8 to 128.")).toBeVisible();
  await length(page).fill("128");
  await expect(result(page)).toHaveValue(/^[a-z]{128}$/);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("copies the password to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  await page.getByRole("button", { name: "Copy password" }).click();
  await expect(page.getByText("Copied to the clipboard.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
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

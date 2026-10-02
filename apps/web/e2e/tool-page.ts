import AxeBuilder from "@axe-core/playwright";
import { quickFacts, type ToolManifest } from "@networksinsights/tool-sdk";
import { expect, type Page } from "@playwright/test";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";

// What every tool spec repeats, kept in one place: opening a hydrated tool page, watching for CSP
// violations, the axe scan in both themes, and the checks of structured data and Quick facts
// against the manifest. A tool's own spec holds only what is particular to that tool.

export const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Records CSP violations from before the first script runs; call the result to read them. */
export async function watchViolations(page: Page) {
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
 * Waits until React has taken over every control of the island. Astro drops `ssr` before React has
 * finished hydrating, and a control used in that gap keeps what was typed in the DOM while the page
 * never hears of it (WebKit is slow enough to show it). React marks each element it has hydrated
 * with a `__reactProps$` property, so the island is ready when every control has one.
 */
export async function waitForHydration(page: Page) {
  await expect(page.locator("astro-island")).toHaveCount(1);
  await expect(page.locator("astro-island:not([ssr])")).toHaveCount(1);
  await page.waitForFunction(() => {
    const controls = document.querySelectorAll(
      "astro-island input, astro-island select, astro-island textarea, astro-island button",
    );
    return (
      controls.length > 0 &&
      [...controls].every((control) =>
        Object.keys(control).some((key) => key.startsWith("__reactProps$")),
      )
    );
  });
}

/**
 * Opens the page and waits until the island has hydrated. Not "load": it waits for every file, and
 * in Firefox one could hang past the test timeout (as csp.spec found); the island is what a test
 * needs, and waitForHydration waits for it.
 */
export async function openTool(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
}

/** Runs axe with the WCAG 2.2 AA tags and expects no violation. */
export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
}

/** Reduced motion switches the colour transitions off, so axe never measures one halfway. */
export async function useTheme(page: Page, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/** The page's JSON-LD says what the page shows: the same name, summary, date and FAQ. */
export async function expectStructuredData(page: Page, manifest: ToolManifest, path: string) {
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(scripts).toHaveLength(1);
  const graph = jsonLdDocumentSchema.parse(JSON.parse(scripts[0] ?? ""))["@graph"];

  const app = graph.find((node) => node["@type"] === "WebApplication");
  if (!app || !("applicationCategory" in app)) throw new Error("no WebApplication node");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(app.name);
  expect(app.name).toBe(manifest.name);
  expect(app.url).toBe(`${site.url}${path}`);
  expect(app.description).toBe(manifest.summary);
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
}

/** The Quick facts section is the manifest's, in order. */
export async function expectQuickFacts(page: Page, manifest: ToolManifest) {
  const section = page.getByRole("region", { name: "Quick facts" });
  const facts = quickFacts(manifest);
  await expect(section.locator("dt")).toHaveText(facts.map((fact) => fact.label));
  await expect(section.locator("dd")).toHaveText(facts.map((fact) => fact.value));
  await expect(section.locator("time")).toHaveAttribute("datetime", manifest.updated);
}

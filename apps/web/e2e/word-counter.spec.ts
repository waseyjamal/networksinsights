import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/text/word-counter/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";

// The first real tool, in the three engines, against `wrangler dev`, so the page runs under the
// real Content-Security-Policy and headers (e2e/edge.ts). It hydrates, counts what the page says
// it counts, stays responsive on 1 MB, and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/word-counter/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The passage of the Examples section, and the counts the page says it gives. */
const EXAMPLE =
  "The river rose overnight. By morning, the old bridge was gone.\n\nNobody was hurt.";

const box = (page: Page) => page.getByRole("textbox", { name: "Your text" });
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

test("hydrates, counts the example of its page, and clears", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  // Before any input every count is zero, and the page states the reading speed it uses.
  await expect(stat(page, "words")).toHaveText("0");
  await expect(page.getByText("Reading time assumes 238 words per minute.")).toBeVisible();

  await box(page).fill(EXAMPLE);
  await expect(stat(page, "words")).toHaveText("14");
  await expect(stat(page, "characters")).toHaveText("80");
  await expect(stat(page, "characters-no-spaces")).toHaveText("66");
  await expect(stat(page, "sentences")).toHaveText("3");
  await expect(stat(page, "paragraphs")).toHaveText("2");
  await expect(stat(page, "reading-time")).toHaveText("4 sec");

  // Typing one more word updates the counts live, with no button.
  await box(page).press("End");
  await box(page).pressSequentially(" Yes.");
  await expect(stat(page, "words")).toHaveText("15");
  await expect(stat(page, "sentences")).toHaveText("4");

  await page.getByRole("button", { name: "Clear text" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(stat(page, "words")).toHaveText("0");
  await expect(stat(page, "characters")).toHaveText("0");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("counts an emoji as one character and splits text with no spaces", async ({ page }) => {
  await open(page);
  await box(page).fill("Hi 👨‍👩‍👧 🇮🇳 👍🏽");
  await expect(stat(page, "characters")).toHaveText("8");
  await expect(stat(page, "characters-no-spaces")).toHaveText("5");
  await expect(stat(page, "words")).toHaveText("1");

  await box(page).fill("我喜欢读书。你呢？");
  await expect(stat(page, "characters")).toHaveText("9");
  await expect(stat(page, "sentences")).toHaveText("2");
  const words = Number(await stat(page, "words").textContent());
  expect(words).toBeGreaterThan(2);
  expect(words).toBeLessThan(7);
});

test("counts 1 MB of text without freezing the page", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  const unit = "The quick brown fox jumps over the lazy dog. 👍🏽 你好世界。\n\n";
  const repeats = Math.floor(1_000_000 / unit.length);

  // Paste the text in one input event, then record the gaps between animation frames until the
  // counts settle. The first frame after the paste carries the browser's own layout of 1 MB in a
  // textarea, which a page without any script pays too, so it is left out; every later gap is the
  // counting, and a frozen main thread would show as one long gap.
  const gaps = await page.evaluate(
    async ({ unit, repeats }) => {
      const area = document.querySelector("textarea");
      const words = document.querySelector('[data-stat="words"] dd');
      if (!area || !words) throw new Error("no workspace");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      const after: number[] = [];
      let last = 0;
      let running = true;
      const tick = (now: number) => {
        if (last > 0) after.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      setter?.call(area, unit.repeat(repeats));
      area.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(tick);
      const started = performance.now();
      while (words.textContent === "0" && performance.now() - started < 20_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      running = false;
      return after;
    },
    { unit, repeats },
  );

  // Two sentences and one paragraph per unit: the emoji and the Chinese text make the second.
  await expect(stat(page, "paragraphs")).toHaveText(repeats.toLocaleString("en-US"));
  await expect(stat(page, "sentences")).toHaveText((repeats * 2).toLocaleString("en-US"));
  const longest = Math.max(0, ...gaps.slice(1));
  console.log(
    `word-counter 1 MB: ${gaps.length} frames while counting, longest gap ${Math.round(longest)} ms`,
  );
  // Generous for slow CI machines: counting 1 MB in one piece takes several hundred ms.
  expect(longest).toBeLessThan(400);
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await open(page);
    await box(page).fill(EXAMPLE);
    await expect(stat(page, "words")).toHaveText("14");
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

  const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
  if (!crumbs || !("itemListElement" in crumbs)) throw new Error("no BreadcrumbList node");
  await expect(page.locator('nav[aria-label="Breadcrumb"] li')).toHaveText(
    crumbs.itemListElement.map((entry) => entry.name),
  );
});

test("Quick facts are the manifest's, in order", async ({ page }) => {
  await open(page);
  const section = page.getByRole("region", { name: "Quick facts" });
  const facts = quickFacts(manifest);
  await expect(section.locator("dt")).toHaveText(facts.map((fact) => fact.label));
  await expect(section.locator("dd")).toHaveText(facts.map((fact) => fact.value));
  await expect(section.locator("time")).toHaveAttribute("datetime", manifest.updated);
});

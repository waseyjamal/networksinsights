import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Locator, type Page, test } from "@playwright/test";
import manifest from "../../../tools/text/diff-checker/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { waitForHydration } from "./tool-page";

// Text Diff Checker in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, compares the example of its page,
// updates as the visitor types, stays usable while it compares two 500 KB texts, copies the diff,
// and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/diff-checker/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The two texts of the Examples section. */
const ORIGINAL = "Milk\nEggs\nBread\nButter";
const MODIFIED = "Milk\nBread\nButter\nJam";

const original = (page: Page) => page.getByRole("textbox", { name: "Original" });
const modified = (page: Page) => page.getByRole("textbox", { name: "Modified" });
const rows = (page: Page) => page.locator("#diff-checker-diff li");
const texts = (page: Page) => page.locator("#diff-checker-diff .ni-diff__text");
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
  await waitForHydration(page);
}

test("hydrates, compares the example of its page as it is typed, and clears", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  // Nothing is compared before there is text.
  await expect(stat(page, "added")).toHaveText("0");
  await expect(rows(page)).toHaveCount(0);

  await original(page).fill(ORIGINAL);
  await modified(page).fill(MODIFIED);
  await expect(stat(page, "added")).toHaveText("1");
  await expect(stat(page, "removed")).toHaveText("1");
  await expect(stat(page, "unchanged")).toHaveText("3");
  await expect(rows(page)).toHaveCount(5);
  await expect(texts(page)).toHaveText([
    "Unchanged: Milk",
    "Removed: Eggs",
    "Unchanged: Bread",
    "Unchanged: Butter",
    "Added: Jam",
  ]);
  expect(
    await rows(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-kind"))),
  ).toEqual(["same", "removed", "same", "same", "added"]);

  // Typing updates the diff live, with no button.
  await modified(page).press("End");
  await modified(page).pressSequentially("\nToast");
  await expect(stat(page, "added")).toHaveText("2");
  await expect(rows(page)).toHaveCount(6);

  // Only the changed lines.
  await page.getByLabel("Show only the changed lines").check();
  await expect(texts(page)).toHaveText(["Removed: Eggs", "Added: Jam", "Added: Toast"]);

  await page.getByRole("button", { name: "Clear both" }).click();
  await expect(original(page)).toHaveValue("");
  await expect(modified(page)).toHaveValue("");
  await expect(rows(page)).toHaveCount(0);
  await expect(stat(page, "added")).toHaveText("0");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("says when the two texts are identical", async ({ page }) => {
  await open(page);
  await original(page).fill(ORIGINAL);
  await modified(page).fill(ORIGINAL);
  await expect(page.getByText("The two texts are identical.")).toBeVisible();
  await expect(stat(page, "unchanged")).toHaveText("4");
});

test("stays usable while it compares two texts of 500 KB", async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  const build = (change: string) => {
    const lines: string[] = [];
    let size = 0;
    for (let index = 0; size < 500_000; index++) {
      const line =
        index % 10 === 0
          ? `${change} ${index} the quick brown fox`
          : `line ${index} the quick brown fox`;
      lines.push(line);
      size += line.length + 1;
    }
    return lines.join("\n");
  };
  // Playwright's fill types a long text through the browser one slice at a time, which takes
  // minutes at this size in any tool; set the value as a paste would, and let React see the input.
  const paste = (box: Locator, text: string) =>
    box.evaluate((element, value) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, text);
  await paste(original(page), build("old"));
  await paste(modified(page), build("new"));

  // The page answers while the comparison runs: a key press reaches the box before the result.
  await modified(page).press("End");
  await modified(page).pressSequentially("\nlast line");
  await expect(modified(page)).toHaveValue(/last line$/);

  await expect(stat(page, "removed")).not.toHaveText("0", { timeout: 60_000 });
  await expect(stat(page, "added")).not.toHaveText("0");
  await expect(stat(page, "unchanged")).not.toHaveText("0");
  // Only the first lines are drawn, and more on request.
  await expect(rows(page)).toHaveCount(1000);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(rows(page)).toHaveCount(2000);
});

test("copies the diff to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  // Reading the clipboard is blocked by the site's permissions policy, so the test records what
  // the page writes.
  await page.addInitScript(() => {
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { __copied: string }).__copied = text;
      await write(text);
    };
  });
  await open(page);
  const copy = page.getByRole("button", { name: "Copy diff" });
  await expect(copy).toBeDisabled();
  await original(page).fill(ORIGINAL);
  await modified(page).fill(MODIFIED);
  await copy.click();
  await expect(page.getByText("Copied to the clipboard.")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe(
    " Milk\n-Eggs\n Bread\n Butter\n+Jam\n",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    // Reduced motion switches the button colour transitions off, so axe never measures contrast
    // halfway through one (as design-system.spec.ts does).
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await open(page);
    await original(page).fill(ORIGINAL);
    await modified(page).fill(MODIFIED);
    await expect(rows(page)).toHaveCount(5);
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

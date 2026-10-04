import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/yaml-formatter/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// YAML Formatter against `wrangler dev` (real CSP and headers). The `yaml` library runs in the
// tool's worker, fetched only at the first text. The spec formats, re-indents and minifies the
// example of the page, names a duplicate key by line and column, keeps values as written, and
// takes exactly 500,000 characters but not one more.

test.use({ baseURL: edgeURL });

const PATH = "/yaml-formatter/";
const LIMIT = 500_000;

const EXAMPLE = "name: Ada\nlangs: [en, fr]\naddress: {city: London, zip: 007}\n";
const FORMATTED = "name: Ada\nlangs:\n  - en\n  - fr\naddress:\n  city: London\n  zip: 007\n";

const box = (page: Page) => page.getByRole("textbox", { name: "Your YAML" });
const result = (page: Page) => page.locator("#yaml-formatter-result");
const indent = (page: Page) => page.getByRole("combobox", { name: "Indentation" });
const mode = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const stat = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

/** Sets the text the way a paste does, in one input event: `fill` is too slow for 500,000. */
async function paste(page: Page, text: string) {
  await page.evaluate((value) => {
    const area = document.querySelector<HTMLTextAreaElement>("#yaml-formatter-text");
    if (!area) throw new Error("no text box");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

test("formats, re-indents and minifies the example, loading the library only then", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await openTool(page, PATH);
  expect(workers).toEqual([]);

  await box(page).fill(EXAMPLE);
  await expect(result(page)).toHaveValue(FORMATTED);
  expect(workers).toHaveLength(1);
  await expect(page.locator("#yaml-formatter-valid")).toHaveText("Valid YAML: 1 document.");
  await expect(stat(page, "lines")).toHaveText("7");
  await expect(stat(page, "characters")).toHaveText("66");

  await indent(page).selectOption({ label: "4 spaces" });
  await expect(result(page)).toHaveValue(FORMATTED.replace(/^( +)/gm, "$1$1"));

  await mode(page, "Minify").click();
  await expect(mode(page, "Minify")).toHaveAttribute("aria-pressed", "true");
  await expect(indent(page)).toBeDisabled();
  await expect(result(page)).toHaveValue(
    "{name: Ada, langs: [en, fr], address: {city: London, zip: 007}}\n",
  );
  await expect(stat(page, "lines")).toHaveText("1");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(result(page)).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("names a duplicate key and a tab by line and column, and points at them", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill(`${EXAMPLE}name: Bob\n`);
  await expect(page.locator("#yaml-formatter-error")).toHaveText(
    "Line 4, column 1: Map keys must be unique.",
  );
  await expect(page.locator(".ni-alert pre")).toHaveText("name: Bob\n^");
  await expect(result(page)).toHaveValue("");

  await box(page).fill("a: 1\n\tb: 2\n");
  await expect(page.locator("#yaml-formatter-error")).toContainText(
    "Line 2, column 1: Tabs are not allowed as indentation.",
  );

  await box(page).fill("# only a comment\n");
  await expect(page.locator("#yaml-formatter-error")).toHaveText(
    "There is no YAML here to format, only comments or blank lines.",
  );
});

test("keeps values as written and documents apart", async ({ page }) => {
  await openTool(page, PATH);
  const text = "big: 12345678901234567890\nhex: 0x1F\nexp: 1e5\nzip: 007\n---\nb: yes\n";
  await box(page).fill(text);
  await expect(result(page)).toHaveValue(text);
  await expect(page.locator("#yaml-formatter-valid")).toHaveText("Valid YAML: 2 documents.");
});

test("formats exactly 500,000 characters and refuses one more", async ({ page }) => {
  await openTool(page, PATH);
  const atLimit = `k: ${"a".repeat(LIMIT - 4)}\n`;
  expect(atLimit.length).toBe(LIMIT);
  await paste(page, atLimit);
  await expect(page.locator("#yaml-formatter-valid")).toHaveText("Valid YAML: 1 document.", {
    timeout: 60_000,
  });
  await expect(stat(page, "characters")).toHaveText("500,000");

  await paste(page, `${atLimit}b`);
  await expect(page.locator("#yaml-formatter-error")).toHaveText(
    "This text is longer than 500,000 characters. Split it into smaller parts.",
  );
  await expect(result(page)).toHaveValue("");
});

test("copies the result, or says plainly that the browser did not allow it", async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === "chromium") await context.grantPermissions(["clipboard-write"]);
  await openTool(page, PATH);
  const copy = page.getByRole("button", { name: "Copy result" });
  await expect(copy).toBeDisabled();
  await box(page).fill(EXAMPLE);
  await expect(result(page)).toHaveValue(FORMATTED);
  await copy.click();
  const said = page.getByText(
    /^(Copied to the clipboard\.|Your browser did not allow copying\. Select the result and copy it\.)$/,
  );
  await expect(said).toBeVisible();
  if (browserName === "chromium") await expect(said).toHaveText("Copied to the clipboard.");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with an error and a result, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await box(page).fill("a: 1\na: 2\n");
    await expect(page.locator("#yaml-formatter-error")).toBeVisible();
    await expectNoAxeViolations(page);
    await box(page).fill(EXAMPLE);
    await expect(page.locator("#yaml-formatter-valid")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

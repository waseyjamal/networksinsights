import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/xml-formatter/tool.config";
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

// XML Formatter against `wrangler dev` (real CSP and headers). The `xml-formatter` library runs in
// the tool's worker, fetched only at the first text. The spec formats, re-indents and minifies the
// example of the page, names the mismatched end tag of the page by line and column, refuses XML the
// library alone would accept, and takes exactly 500,000 characters but not one more.

test.use({ baseURL: edgeURL });

const PATH = "/xml-formatter/";
const LIMIT = 500_000;

const EXAMPLE = '<note id="7"><to>Ada</to><body>Hello</body><sent/></note>';
const FORMATTED = '<note id="7">\n  <to>Ada</to>\n  <body>Hello</body>\n  <sent/>\n</note>\n';

const box = (page: Page) => page.getByRole("textbox", { name: "Your XML" });
const result = (page: Page) => page.locator("#xml-formatter-result");
const indent = (page: Page) => page.getByRole("combobox", { name: "Indentation" });
const mode = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const stat = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const valid = (page: Page) => page.locator("#xml-formatter-valid");
const error = (page: Page) => page.locator("#xml-formatter-error");

/** Sets the text the way a paste does, in one input event: `fill` is too slow for 500,000. */
async function paste(page: Page, text: string) {
  await page.evaluate((value) => {
    const area = document.querySelector<HTMLTextAreaElement>("#xml-formatter-text");
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
  await expect(valid(page)).toHaveText("Well-formed XML: root element <note>, 4 elements.");
  await expect(stat(page, "lines")).toHaveText("5");
  await expect(stat(page, "characters")).toHaveText("68");

  await indent(page).selectOption({ label: "4 spaces" });
  await expect(result(page)).toHaveValue(FORMATTED.replace(/^( +)/gm, "$1$1"));
  await indent(page).selectOption({ label: "Tabs" });
  await expect(result(page)).toHaveValue(FORMATTED.replace(/^ {2}/gm, "\t"));

  await mode(page, "Minify").click();
  await expect(indent(page)).toBeDisabled();
  await expect(result(page)).toHaveValue(
    '<note id="7"><to>Ada</to><body>Hello</body><sent/></note>\n',
  );

  // Minify also drops comments.
  await box(page).fill("<a>\n  <!-- note -->\n  <b/>\n</a>");
  await expect(result(page)).toHaveValue("<a><b/></a>\n");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(result(page)).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("names the mismatched end tag of the page example, and points at it", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill("<note>\n  <to>Ada</from>\n</note>");
  await expect(error(page)).toHaveText(
    "Line 2, column 10: The end tag </from> does not match the open element <to>. Close <to> first.",
  );
  await expect(page.locator(".ni-alert pre")).toHaveText("  <to>Ada</from>\n         ^");
  await expect(result(page)).toHaveValue("");
});

test("refuses XML that is not well formed, which the library alone would print", async ({
  page,
}) => {
  await openTool(page, PATH);
  await box(page).fill("<a><b></a>");
  await expect(error(page)).toHaveText(
    "Line 1, column 7: The end tag </a> does not match the open element <b>. Close <b> first.",
  );
  await box(page).fill("<a x=1/>");
  await expect(error(page)).toHaveText(
    "Line 1, column 6: The value of the attribute x must be in quotes.",
  );
  await box(page).fill("<p>Tom &nbsp; Jerry</p>");
  await expect(error(page)).toHaveText("Line 1, column 8: The entity &nbsp; is not defined.");
  await box(page).fill("<br><p>Tom</p>");
  await expect(error(page)).toHaveText(
    "Line 1, column 1: The element <br> is never closed. Add </br>.",
  );
});

test("trims text at an end only when that end has a line break", async ({ page }) => {
  await openTool(page, PATH);
  await box(page).fill("<a>\n  <b> x  y </b>\n  <c>\n    1\n  </c>\n</a>");
  await expect(result(page)).toHaveValue("<a>\n  <b> x  y </b>\n  <c>1</c>\n</a>\n");
});

test("formats exactly 500,000 characters and refuses one more", async ({ page }) => {
  await openTool(page, PATH);
  const atLimit = `<a>${"x".repeat(LIMIT - 7)}</a>`;
  expect(atLimit.length).toBe(LIMIT);
  await paste(page, atLimit);
  await expect(valid(page)).toHaveText("Well-formed XML: root element <a>, 1 element.", {
    timeout: 60_000,
  });

  await paste(page, `${atLimit} `);
  await expect(error(page)).toHaveText(
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
    await box(page).fill("<a><b></a>");
    await expect(error(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await box(page).fill(EXAMPLE);
    await expect(valid(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

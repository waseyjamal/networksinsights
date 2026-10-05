import { expect, type Page, test } from "@playwright/test";
import { DIALECTS } from "../../../tools/developer/sql-formatter/logic";
import manifest from "../../../tools/developer/sql-formatter/tool.config";
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

// SQL Formatter against `wrangler dev` (real CSP and headers). The `sql-formatter` library runs in
// the tool's worker, fetched only at the first text. The spec formats the example of the page,
// offers exactly the twenty dialects the page lists, names the spot PostgreSQL cannot read, and
// takes exactly 200,000 characters but not one more.

test.use({ baseURL: edgeURL });

const PATH = "/sql-formatter/";
const LIMIT = 200_000;

const EXAMPLE =
  "select u.name, count(o.id) as orders from users u left join orders o on o.user_id = u.id where u.active = 1 group by u.name order by orders desc;";
const FORMATTED = [
  "SELECT",
  "  u.name,",
  "  COUNT(o.id) AS orders",
  "FROM",
  "  users u",
  "  LEFT JOIN orders o ON o.user_id = u.id",
  "WHERE",
  "  u.active = 1",
  "GROUP BY",
  "  u.name",
  "ORDER BY",
  "  orders DESC;",
  "",
].join("\n");

const box = (page: Page) => page.getByRole("textbox", { name: "Your SQL" });
const result = (page: Page) => page.locator("#sql-formatter-result");
const select = (page: Page, name: string) => page.getByRole("combobox", { name });
const stat = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);
const error = (page: Page) => page.locator("#sql-formatter-error");

/** Sets the text the way a paste does, in one input event: `fill` is too slow for 200,000. */
async function paste(page: Page, text: string) {
  await page.evaluate((value) => {
    const area = document.querySelector<HTMLTextAreaElement>("#sql-formatter-text");
    if (!area) throw new Error("no text box");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

test("formats the example of the page, loading the library only then", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await openTool(page, PATH);
  expect(workers).toEqual([]);

  await box(page).fill(EXAMPLE);
  await expect(result(page)).toHaveValue(FORMATTED);
  expect(workers).toHaveLength(1);
  await expect(stat(page, "lines")).toHaveText("12");
  await expect(stat(page, "characters")).toHaveText("160");

  await select(page, "Keyword case").selectOption({ label: "lower case" });
  await select(page, "Indentation").selectOption({ label: "4 spaces" });
  await expect(result(page)).toHaveValue(FORMATTED.toLowerCase().replace(/^( +)/gm, "$1$1"));
  await select(page, "Keyword case").selectOption({ label: "As written" });
  await select(page, "Indentation").selectOption({ label: "Tabs" });
  await expect(result(page)).toHaveValue(/^select\n\tu\.name,\n\tcount\(o\.id\) as orders\nfrom\n/);

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(result(page)).toHaveValue("");

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("offers exactly the twenty dialects the page lists", async ({ page }) => {
  await openTool(page, PATH);
  const options = await select(page, "Dialect").locator("option").allTextContents();
  expect(options).toEqual(Object.values(DIALECTS));
  expect(options).toHaveLength(20);
  const limits = await page
    .locator("h2", { hasText: "Limits" })
    .locator("xpath=following-sibling::p[1]")
    .textContent();
  for (const label of options) expect(limits, label).toContain(label);
  expect(limits).toContain("Twenty dialects");
});

test("formats for the chosen dialect, and names the spot PostgreSQL cannot read", async ({
  page,
}) => {
  await openTool(page, PATH);
  await select(page, "Dialect").selectOption({ label: "MySQL" });
  await box(page).fill("select `a` from t");
  await expect(result(page)).toHaveValue("SELECT\n  `a`\nFROM\n  t\n");

  await select(page, "Dialect").selectOption({ label: "PostgreSQL" });
  await expect(error(page)).toHaveText(
    "Line 1, column 8: This SQL could not be read as PostgreSQL. Check that every quote and bracket is closed, or pick the dialect your database uses.",
  );
  await expect(page.locator(".ni-alert pre")).toHaveText("select `a` from t\n       ^");
  await expect(result(page)).toHaveValue("");

  await select(page, "Dialect").selectOption({ label: "SQL Server (Transact-SQL)" });
  await box(page).fill("select [a] from t where x = N'y'");
  await expect(result(page)).toHaveValue("SELECT\n  [a]\nFROM\n  t\nWHERE\n  x = N'y'\n");
});

test("formats exactly 200,000 characters and refuses one more", async ({ page }) => {
  await openTool(page, PATH);
  const atLimit = `select '${"x".repeat(LIMIT - 9)}'`;
  expect(atLimit.length).toBe(LIMIT);
  await paste(page, atLimit);
  await expect(result(page)).toHaveValue(/^SELECT\n {2}'x+'\n$/, { timeout: 60_000 });

  await paste(page, `${atLimit} `);
  await expect(error(page)).toHaveText(
    "This text is longer than 200,000 characters. Split it into smaller parts.",
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
    await select(page, "Dialect").selectOption({ label: "PostgreSQL" });
    await box(page).fill("select `a` from t");
    await expect(error(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await box(page).fill(EXAMPLE);
    await expect(result(page)).toHaveValue(FORMATTED);
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

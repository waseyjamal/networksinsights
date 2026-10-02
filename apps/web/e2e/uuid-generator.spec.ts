import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/generators/uuid-generator/tool.config";
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

// UUID Generator in the three engines, against `wrangler dev` (real CSP and headers). It draws
// nothing in the static HTML, then draws version 4 and version 7 UUIDs in the formats the page
// describes, honours the count limits, applies each option without drawing again, copies all, and
// its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/uuid-generator/";
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const output = (page: Page) => page.locator("#uuid-output");
const lines = async (page: Page) => (await output(page).inputValue()).split("\n").filter(Boolean);

test("holds no UUID in the static HTML", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(PATH);
  await expect(output(page)).toHaveValue("");
  await context.close();
});

test("draws version 4 UUIDs and a new set on request", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(output(page)).not.toHaveValue("");
  const first = await lines(page);
  expect(first).toHaveLength(5);
  for (const uuid of first) expect(uuid).toMatch(V4);
  expect(new Set(first).size).toBe(5);

  await page.getByRole("button", { name: "Generate again" }).click();
  await expect.poll(() => lines(page)).not.toEqual(first);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("draws version 7 UUIDs that start with the clock and sort in order", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2023-11-14T22:13:20.000Z"));
  await openTool(page, PATH);
  await page.getByLabel("Version").selectOption("7");
  await page.locator("#uuid-count").fill("200");
  await expect.poll(async () => (await lines(page)).length).toBe(200);
  const uuids = await lines(page);
  for (const uuid of uuids) {
    expect(uuid).toMatch(V7);
    // 2023-11-14T22:13:20.000Z is 1700000000000 ms, 0x018bcfe56800.
    expect(uuid.startsWith("018bcfe5-6800-7")).toBe(true);
  }
  expect([...uuids].sort()).toEqual(uuids);
  expect(new Set(uuids).size).toBe(200);
});

test("accepts 1 and 1,000 and refuses the rest with a message", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#uuid-count").fill("1000");
  await expect.poll(async () => (await lines(page)).length).toBe(1000);
  await page.locator("#uuid-count").fill("1");
  await expect.poll(async () => (await lines(page)).length).toBe(1);

  const cases: Array<[string, string]> = [
    ["", "Enter how many UUIDs you want."],
    ["0", "Choose from 1 to 1000 UUIDs."],
    ["1001", "Choose from 1 to 1000 UUIDs."],
    ["2.5", "Use a whole number of UUIDs, such as 10."],
  ];
  for (const [text, message] of cases) {
    await page.locator("#uuid-count").fill(text);
    await expect(page.locator("#uuid-count-error")).toHaveText(message);
    await expect(page.getByRole("button", { name: "Generate again" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Copy all" })).toBeDisabled();
  }
});

test("each option rewrites the same UUIDs without drawing again", async ({ page }) => {
  await openTool(page, PATH);
  await expect(output(page)).not.toHaveValue("");
  const plain = await lines(page);

  await page.getByLabel("Uppercase").check();
  expect(await lines(page)).toEqual(plain.map((uuid) => uuid.toUpperCase()));
  await page.getByLabel("No hyphens").check();
  expect(await lines(page)).toEqual(plain.map((uuid) => uuid.toUpperCase().replaceAll("-", "")));
  await page.getByLabel("Braces").check();
  expect(await lines(page)).toEqual(
    plain.map((uuid) => `{${uuid.toUpperCase().replaceAll("-", "")}}`),
  );
  await page.getByLabel("Uppercase").uncheck();
  await page.getByLabel("No hyphens").uncheck();
  await page.getByLabel("Braces").uncheck();
  expect(await lines(page)).toEqual(plain);
});

test("copies all of them", async ({ page }) => {
  // The page may write to the clipboard but its policy blocks reading it back, so the test records
  // what is written.
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    navigator.clipboard.writeText = async (text: string) => {
      (window as unknown as { __copied: string[] }).__copied.push(text);
    };
  });
  await openTool(page, PATH);
  await expect(output(page)).not.toHaveValue("");
  await page.getByRole("button", { name: "Copy all" }).click();
  await expect(page.getByText("5 UUIDs copied to the clipboard.")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual([await output(page).inputValue()]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await expect(output(page)).not.toHaveValue("");
    await expectNoAxeViolations(page);
    await page.locator("#uuid-count").fill("0");
    await expect(page.locator("#uuid-count-error")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("its structured data says what the page shows", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
});

test("Quick facts are the manifest's, in order", async ({ page }) => {
  await openTool(page, PATH);
  await expectQuickFacts(page, manifest);
});

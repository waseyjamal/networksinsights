import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/generators/resume-builder/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { pdfPages } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Resume Builder against `wrangler dev` (real CSP and headers): the example of its page becomes a
// one-page A4 PDF whose text is real text in the order the page gives; characters the fonts cannot
// draw are named and refused; the 10-entry and 2,000-character limits at and over the edge.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/resume-builder/";
const result = (page: Page) => page.getByRole("list", { name: "Your resume" }).locator("li");
const make = (page: Page) => page.getByRole("button", { name: "Make PDF" });

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

/** The text drawn in a pdf-lib PDF: its content streams inflated, hex strings decoded, in order. */
function pdfText(pdf: Buffer): string[] {
  const out: string[] = [];
  const raw = pdf.toString("latin1");
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = streams.exec(raw); match; match = streams.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(match[1] ?? "", "latin1")).toString("latin1");
    } catch {
      body = match[1] ?? "";
    }
    for (const hex of body.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) {
      out.push(Buffer.from(hex[1] ?? "", "hex").toString("latin1"));
    }
  }
  return out;
}

test("the example of its page becomes a one-page A4 PDF of real text, in order", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(page.locator("#resume-preview")).toContainText(
    "sam@example.com | +44 7700 900123 | Leeds, UK",
  );
  await make(page).click();
  await expect(result(page)).toContainText("1 page", { timeout: 30_000 });
  const pdf = await download(page, "Sam-Lee-resume.pdf");
  expect((await pdfPages(pdf)).map((p) => [Math.round(p.width), Math.round(p.height)])).toEqual([
    [595, 842],
  ]);
  const text = pdfText(pdf);
  expect(text[0]).toBe("Sam Lee");
  expect(text[1]).toBe("sam@example.com | +44 7700 900123 | Leeds, UK");
  expect(text.filter((line) => /^[A-Z]+$/.test(line))).toEqual([
    "SUMMARY",
    "EXPERIENCE",
    "EDUCATION",
    "SKILLS",
  ]);
  expect(text).toContain("- Wrote the product setup guide");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("an empty section is left out, Letter paper is used, and accents are drawn", async ({
  page,
}) => {
  await openTool(page, PATH);
  await page.locator("#resume-summary").fill("");
  await expect(page.locator("#resume-preview")).not.toContainText("SUMMARY");
  await page.locator("#resume-name").fill("José Müller");
  await page.locator("#resume-paper").selectOption("letter");
  await make(page).click();
  const pdf = await download(page, "José-Müller-resume.pdf");
  expect((await pdfPages(pdf)).map((p) => [p.width, p.height])).toEqual([[612, 792]]);
  const text = pdfText(pdf);
  expect(text[0]).toBe("José Müller");
  expect(text).not.toContain("SUMMARY");
});

test("names the characters the fonts cannot draw and makes no PDF", async ({ page }) => {
  await openTool(page, PATH);
  await page.locator("#resume-name").fill("Łukasz 日本");
  await expect(page.locator("#resume-problems")).toHaveText(
    "The PDF fonts cannot draw these characters: Ł 日 本. They cover English and most Western European letters only. Replace them, or write the word in Latin letters.",
  );
  await expect(make(page)).toBeDisabled();
  await page.locator("#resume-name").fill("Lukasz");
  await expect(make(page)).toBeEnabled();
});

test("takes 10 jobs and a field of 2,000 characters, not one more", async ({ page }) => {
  await openTool(page, PATH);
  const add = page.getByRole("button", { name: "Add job" });
  for (let i = 0; i < 9; i++) await add.click();
  await expect(page.locator("#resume-experience-10-title")).toBeVisible();
  await expect(add).toBeDisabled();
  await page.locator("#resume-summary").fill("a".repeat(2001));
  await expect(page.locator("#resume-problems")).toHaveText(
    "Keep each field under 2000 characters.",
  );
  await page.locator("#resume-summary").fill(`${"word ".repeat(400)}`.trim().padEnd(2000, "x"));
  await expect(page.locator("#resume-problems")).toHaveCount(0);
  await make(page).click();
  await expect(result(page)).toContainText(/\d+ pages?/, { timeout: 30_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await make(page).click();
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
    await page.locator("#resume-name").fill("");
    await expect(page.locator("#resume-problems")).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

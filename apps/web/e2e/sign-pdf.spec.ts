import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/pdf/sign-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestJpg, makeTestPng, padTo } from "./support/test-image";
import { makeTestPdf, pdfImageCounts, pdfPages } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Sign PDF against `wrangler dev` (real CSP and headers): a typed, a drawn and an uploaded
// signature are put on real PDF pages by pdf-lib, imported on demand; the result is read back to
// see which page carries the picture. Also: the visual-signature notice, page numbers outside the
// PDF, an empty signature, the picture limits, protected and damaged PDFs, and the 50 MB limit.

test.use({ baseURL: edgeURL });
// PDF work and 50 MB files take longer than the default 30 seconds on a slow machine.
test.setTimeout(180_000);

const PATH = "/sign-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const PICTURE_LIMIT = 5 * 1024 * 1024;
const pdfInput = (page: Page) => page.locator("#sign-pdf-file");
const result = (page: Page) => page.getByRole("list", { name: "Signed PDF" }).locator("li");
const CONTRACT = makeTestPdf("contract.pdf", 2, { size: [612, 792] });

async function open(page: Page, file: Parameters<ReturnType<typeof pdfInput>["setInputFiles"]>[0]) {
  await pdfInput(page).setInputFiles(file);
  await expect(page.locator("#sign-pdf-original")).toBeVisible({ timeout: 60_000 });
}

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

test("says it is a visual signature only, not a certificate-based digital signature", async ({
  page,
}) => {
  await openTool(page, PATH);
  const notice = page.getByRole("status").filter({ hasText: "A visual signature only" });
  await expect(notice).toContainText("It is not a certificate-based digital signature");
  await expect(notice).toContainText("it does not prove who signed");
});

test("a typed name goes on the last page, as the page example says", async ({ page }) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await open(page, CONTRACT);
  await expect(page.locator("#sign-pdf-page")).toHaveValue("2");
  await page.locator("#sign-pdf-source").selectOption("type");
  await page.locator("#sign-pdf-typed").fill("Alex Doe");
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(result(page)).toContainText("Signature on page 2", { timeout: 60_000 });
  const bytes = await download(page, "contract-signed.pdf");
  expect(await pdfImageCounts(bytes)).toEqual([0, 1]);
  expect((await pdfPages(bytes)).map((p) => p.width)).toEqual([612, 612]);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("a drawn signature goes on page 1; an empty drawing is refused", async ({ page }) => {
  await openTool(page, PATH);
  await open(page, CONTRACT);
  await page.locator("#sign-pdf-page").fill("1");
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(page.getByRole("alert")).toHaveText("Draw, type or upload your signature first.");

  const pad = page.locator("#sign-pdf-pad");
  const box = await pad.boundingBox();
  if (!box) throw new Error("no pad");
  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
  await page.mouse.move(box.x + 220, box.y + 110, { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(result(page)).toContainText("Signature on page 1", { timeout: 60_000 });
  expect(await pdfImageCounts(await download(page, "contract-signed.pdf"))).toEqual([1, 0]);

  await page.getByRole("button", { name: "Clear the drawing" }).click();
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(page.getByRole("alert")).toHaveText("Draw, type or upload your signature first.");
});

test("an uploaded PNG works up to 5 MB; larger pictures and other types are refused", async ({
  page,
}) => {
  await openTool(page, PATH);
  await open(page, CONTRACT);
  await page.locator("#sign-pdf-source").selectOption("upload");
  const picture = await makeTestPng(page, "signature.png", { width: 300, height: 100 });
  const input = page.locator("#sign-pdf-picture");

  await input.setInputFiles(padTo({ ...picture, name: "huge.png" }, PICTURE_LIMIT + 1));
  await expect(page.getByRole("alert")).toHaveText(
    "huge.png: The signature picture is larger than 5 MB.",
  );
  await input.setInputFiles({ name: "sig.webp", mimeType: "image/webp", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert")).toHaveText(
    "sig.webp: The signature picture must be a PNG or JPG.",
  );

  await input.setInputFiles(padTo({ ...picture, name: "at-limit.png" }, PICTURE_LIMIT));
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(result(page)).toContainText("Signature on page 2", { timeout: 60_000 });

  await input.setInputFiles(await makeTestJpg(page, "scan.jpg", { width: 300, height: 100 }));
  await page.locator("#sign-pdf-position").selectOption("top-left");
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(result(page)).toContainText("Signature on page 2", { timeout: 60_000 });
  expect(await pdfImageCounts(await download(page, "contract-signed.pdf"))).toEqual([0, 1]);
});

test("refuses a page the PDF does not have, and signs a page the PDF shows turned", async ({
  page,
}) => {
  await openTool(page, PATH);
  await open(page, CONTRACT);
  await page.locator("#sign-pdf-source").selectOption("type");
  await page.locator("#sign-pdf-typed").fill("Alex Doe");
  await page.locator("#sign-pdf-page").fill("3");
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Choose a page from 1 to 2: this PDF has 2 pages.",
  );

  await open(page, makeTestPdf("turned.pdf", 1, { rotate: 90 }));
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(result(page)).toContainText("Signature on page 1", { timeout: 60_000 });
  const bytes = await download(page, "turned-signed.pdf");
  expect(await pdfImageCounts(bytes)).toEqual([1]);
  expect((await pdfPages(bytes))[0]?.rotation).toBe(90);
});

test("refuses a password-protected PDF and a damaged one", async ({ page }) => {
  await openTool(page, PATH);
  await pdfInput(page).setInputFiles(makeTestPdf("locked.pdf", 1, { encrypted: true }));
  await expect(
    page.getByText(
      "locked.pdf: This PDF is protected with a password. Remove the password in the program that made it, then try again.",
    ),
  ).toBeVisible({ timeout: 60_000 });
  await pdfInput(page).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 nothing"),
  });
  await expect(
    page.getByText("broken.pdf: This PDF could not be read. It may be damaged or not a real PDF."),
  ).toBeVisible({ timeout: 60_000 });
});

test("refuses a PDF one byte over 50 MB, and signs one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }).buffer);
  await pdfInput(page).setInputFiles(over);
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();

  const atLimit = testInfo.outputPath("big.pdf");
  writeFileSync(atLimit, makeTestPdf("big.pdf", 1, { padding: LIMIT }).buffer);
  await open(page, atLimit);
  await page.locator("#sign-pdf-source").selectOption("type");
  await page.locator("#sign-pdf-typed").fill("Alex Doe");
  await page.getByRole("button", { name: "Add signature" }).click();
  await expect(result(page)).toContainText("Signature on page 1", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with the pad and a result shown, ${theme} theme`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await open(page, CONTRACT);
    await expect(page.locator("#sign-pdf-pad")).toBeVisible();
    await expectNoAxeViolations(page);
    await page.locator("#sign-pdf-source").selectOption("type");
    await page.locator("#sign-pdf-typed").fill("Alex Doe");
    await page.getByRole("button", { name: "Add signature" }).click();
    await expect(result(page)).toBeVisible({ timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

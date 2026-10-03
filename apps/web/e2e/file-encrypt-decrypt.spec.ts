import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/file-encrypt-decrypt/tool.config";
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

// File Encrypt and Decrypt against `wrangler dev` (real CSP and headers): the example of its page
// round-trips with its documented header and size; a wrong password and a changed byte give one
// error and no file; the 100 MB limit at and over the edge; the password is kept nowhere.

test.use({ baseURL: edgeURL });
test.setTimeout(240_000);

const PATH = "/file-encrypt-decrypt/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const input = (page: Page) => page.locator("#crypt-file");
const result = (page: Page) => page.getByRole("list", { name: "Your file" }).locator("li");
const WRONG =
  "The file could not be decrypted. The password is wrong, or the file is damaged or was changed.";

async function download(page: Page, name: string) {
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  return readFileSync((await saved.path()) ?? "");
}

async function encryptFile(
  page: Page,
  file: Parameters<Page["setInputFiles"]>[1],
  password: string,
) {
  await page.locator("#crypt-mode").selectOption("encrypt");
  await input(page).setInputFiles(file);
  await page.locator("#crypt-password").fill(password);
  await page.locator("#crypt-confirm").fill(password);
  await page.getByRole("button", { name: "Encrypt", exact: true }).click();
}

async function decryptFile(
  page: Page,
  file: Parameters<Page["setInputFiles"]>[1],
  password: string,
) {
  await page.locator("#crypt-mode").selectOption("decrypt");
  await input(page).setInputFiles(file);
  await page.locator("#crypt-password").fill(password);
  await page.getByRole("button", { name: "Decrypt", exact: true }).click();
}

test("the example of its page round-trips, with the documented header and size", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  await expect(
    page.getByText("If you lose the password, the encrypted file cannot be recovered"),
  ).toBeVisible();
  const notes = { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello world") };
  await encryptFile(page, notes, "correct horse");
  const sealed = await download(page, "notes.txt.nienc");
  expect(sealed.length).toBe(71);
  expect(sealed.subarray(0, 4).toString("latin1")).toBe("NIEC");
  expect(sealed[4]).toBe(1);

  await encryptFile(page, notes, "correct horse");
  const again = await download(page, "notes.txt.nienc");
  expect(again.subarray(5, 33).equals(sealed.subarray(5, 33))).toBe(false);

  await decryptFile(
    page,
    { name: "notes.txt.nienc", mimeType: "application/octet-stream", buffer: sealed },
    "correct horse",
  );
  expect((await download(page, "notes.txt")).toString()).toBe("hello world");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
  const stored = await page.evaluate(() => [
    localStorage.length,
    sessionStorage.length,
    document.cookie,
    location.href,
  ]);
  expect(stored).toEqual([0, 0, "", expect.not.stringContaining("horse")]);
});

test("a wrong password, a changed byte and a file that is not .nienc give an error and no file", async ({
  page,
}) => {
  await openTool(page, PATH);
  await encryptFile(
    page,
    { name: "s.txt", mimeType: "text/plain", buffer: Buffer.from("secret") },
    "password1",
  );
  const sealed = await download(page, "s.txt.nienc");
  const file = { name: "s.txt.nienc", mimeType: "application/octet-stream", buffer: sealed };

  await decryptFile(page, file, "password2");
  await expect(page.getByRole("alert")).toHaveText(WRONG, { timeout: 30_000 });
  await expect(result(page)).toHaveCount(0);

  const changed = Buffer.from(sealed);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
  await decryptFile(page, { ...file, buffer: changed }, "password1");
  await expect(page.getByRole("alert")).toHaveText(WRONG, { timeout: 30_000 });
  await expect(result(page)).toHaveCount(0);

  await decryptFile(
    page,
    { name: "plain.txt", mimeType: "text/plain", buffer: Buffer.from("just some plain text here") },
    "password1",
  );
  await expect(page.getByRole("alert")).toHaveText("This is not a .nienc file made by this tool.", {
    timeout: 30_000,
  });
});

test("needs 8 characters and the same password twice to encrypt", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("a"),
  });
  const button = page.getByRole("button", { name: "Encrypt", exact: true });
  await page.locator("#crypt-password").fill("1234567");
  await page.locator("#crypt-confirm").fill("1234567");
  await expect(page.locator("#crypt-password-problem")).toHaveText(
    "Use a password of at least 8 characters.",
  );
  await expect(button).toBeDisabled();
  await page.locator("#crypt-password").fill("12345678");
  await expect(page.locator("#crypt-password-problem")).toHaveText(
    "The two passwords are not the same.",
  );
  await page.locator("#crypt-confirm").fill("12345678");
  await expect(button).toBeEnabled();
});

test("encrypts a file of exactly 100 MB and refuses one byte more", async ({ page }, testInfo) => {
  await openTool(page, PATH);
  const over = testInfo.outputPath("over.bin");
  writeFileSync(over, Buffer.alloc(LIMIT + 1));
  await input(page).setInputFiles(over);
  await expect(page.getByRole("alert")).toHaveText("This file is larger than 100 MB.");
  await expect(page.getByRole("button", { name: "Encrypt", exact: true })).toBeDisabled();

  const atLimit = testInfo.outputPath("at-limit.bin");
  writeFileSync(atLimit, Buffer.alloc(LIMIT));
  await encryptFile(page, atLimit, "password1");
  await expect(result(page)).toContainText("at-limit.bin.nienc", { timeout: 180_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with a result shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await encryptFile(
      page,
      { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
      "password1",
    );
    await expect(result(page)).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

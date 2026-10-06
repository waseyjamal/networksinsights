import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { init } from "../../../tools/node_modules/@embedpdf/pdfium/dist/index.cjs";
import manifest from "../../../tools/pdf/unlock-pdf/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { makeTestPdf, pdfTexts, type TestPdf } from "./support/test-pdf";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// Unlock PDF against `wrangler dev` (real CSP and headers). The locked PDFs are made here, so no
// binary fixture is kept: one that asks for a password to open (RC4, 40 bits, revision 2, written
// byte by byte below), one locked with AES-256 (PDFium in Node locks that one), and one that
// opens freely but has an owner password (support/test-pdf.ts). Each copy the tool gives back is
// read in Node with PDF.js and no password: it must open and hold the same text.

test.use({ baseURL: edgeURL });
test.setTimeout(180_000);

const PATH = "/unlock-pdf/";
const LIMIT = manifest.limits?.maxInputBytes ?? 0;
const file = (page: Page) => page.locator("#unlock-pdf-file");
const password = (page: Page) => page.locator("#unlock-pdf-password");
const results = (page: Page) => page.getByRole("list", { name: "Unlocked PDF" }).locator("li");

const PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
const FILE_ID = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const md5 = (...parts: Uint8Array[]) => {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};
const padded = (text: string) => {
  const bytes = Buffer.from(text, "latin1").subarray(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PADDING.subarray(0, 32 - bytes.length), bytes.length);
  return out;
};
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + (state[i] ?? 0)) & 0xff;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
    out[n] = (data[n] ?? 0) ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) & 0xff] ?? 0);
  }
  return out;
}

/** A PDF that asks for `user` before it opens (PDF 1.7, 7.6.3, revision 2), pages "Secret N". */
function lockedPdf(name: string, user: string, owner: string, pages: number): TestPdf {
  const permissions = -44;
  const ownerEntry = rc4(md5(padded(owner)).subarray(0, 5), padded(user));
  const p = Buffer.alloc(4);
  p.writeInt32LE(permissions);
  const key = md5(padded(user), ownerEntry, p, FILE_ID).subarray(0, 5);
  const userEntry = rc4(key, PADDING);
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, index) => `${4 + index * 2} 0 R`);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let index = 0; index < pages; index++) {
    const id = 4 + index * 2;
    objects[id] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] " +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    const text = `BT /F1 36 Tf 40 200 Td (Secret ${index + 1}) Tj ET`;
    const objectKey = md5(key, Uint8Array.from([(id + 1) & 0xff, 0, 0, 0, 0])).subarray(0, 10);
    const sealed = Buffer.from(rc4(objectKey, Buffer.from(text, "latin1")));
    objects[id + 1] =
      `<< /Length ${sealed.length} >>\nstream\n${sealed.toString("latin1")}\nendstream`;
  }
  const encrypt = 4 + pages * 2;
  const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
  objects[encrypt] =
    `<< /Filter /Standard /V 1 /R 2 /O <${hex(ownerEntry)}> /U <${hex(userEntry)}> /P ${permissions} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= encrypt; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${encrypt + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= encrypt; id++)
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out +=
    `trailer\n<< /Size ${encrypt + 1} /Root 1 0 R /Encrypt ${encrypt} 0 R ` +
    `/ID [<${hex(FILE_ID)}> <${hex(FILE_ID)}>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name, mimeType: "application/pdf", buffer: Buffer.from(out, "latin1") };
}

/** The same pages locked again by PDFium with AES-256 (revision 6). */
async function aesPdf(name: string, user: string): Promise<TestPdf> {
  const module = await init({ print: () => {}, printErr: () => {} });
  module.PDFiumExt_Init();
  const memory = module.pdfium.wasmExports as unknown as {
    malloc(size: number): number;
    memory: WebAssembly.Memory;
  };
  const source = lockedPdf("x.pdf", "", "boss", 2).buffer;
  const pointer = memory.malloc(source.length);
  new Uint8Array(memory.memory.buffer).set(source, pointer);
  const handle = module.FPDF_LoadMemDocument(pointer, source.length, "boss");
  module.EPDF_RemoveEncryption(handle);
  module.EPDF_SetEncryption(handle, user, "aes owner", -4);
  const writer = module.PDFiumExt_OpenFileWriter();
  module.PDFiumExt_SaveAsCopy(handle, writer);
  const size = module.PDFiumExt_GetFileWriterSize(writer);
  const out = memory.malloc(size);
  module.PDFiumExt_GetFileWriterData(writer, out, size);
  const buffer = Buffer.from(new Uint8Array(memory.memory.buffer).slice(out, out + size));
  // Opened again, the copy needs the password and uses the AES-256 handler, revision 6.
  const again = memory.malloc(buffer.length);
  new Uint8Array(memory.memory.buffer).set(buffer, again);
  expect(module.FPDF_LoadMemDocument(again, buffer.length, "")).toBe(0);
  const reopened = module.FPDF_LoadMemDocument(again, buffer.length, user);
  expect(module.FPDF_GetSecurityHandlerRevision(reopened)).toBe(6);
  return { name, mimeType: "application/pdf", buffer };
}

async function unlockAndRead(page: Page, name: string): Promise<{ texts: string[]; raw: string }> {
  await expect(results(page)).toHaveCount(1, { timeout: 60_000 });
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: `Download ${name}` }).click(),
  ]);
  expect(saved.suggestedFilename()).toBe(name);
  const bytes = readFileSync((await saved.path()) ?? "");
  return { texts: await pdfTexts(bytes), raw: bytes.toString("latin1") };
}

test("removes the open password with the right password, and the copy opens with none", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const locked = lockedPdf("statement.pdf", "open sesame", "bank", 2);
  await expect(pdfTexts(locked.buffer)).rejects.toThrow(/password/i);
  await openTool(page, PATH);
  await expect(
    page.getByText("This tool only works when you type the correct password."),
  ).toBeVisible();
  await file(page).setInputFiles(locked);
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(page.getByRole("alert")).toHaveText("Type the password of this PDF.");

  await password(page).fill("open-sesame");
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "That password is not right for this PDF. Check capital letters and spaces, then try again. This tool cannot find or guess a password.",
    { timeout: 60_000 },
  );
  await expect(results(page)).toHaveCount(0);

  await password(page).fill("open sesame");
  await password(page).press("Enter");
  await expect(results(page).first()).toContainText("2 pages", { timeout: 60_000 });
  await expect(results(page).first()).toContainText("opens with no password");
  const copy = await unlockAndRead(page, "statement-unlocked.pdf");
  expect(copy.texts).toEqual(["Secret 1", "Secret 2"]);
  expect(copy.raw).not.toMatch(/\/Encrypt\s/);
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("removes an AES-256 lock", async ({ page }) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(await aesPdf("aes.pdf", "Long pass 256"));
  await password(page).fill("Long pass 256");
  await page.getByRole("button", { name: "Remove password" }).click();
  const copy = await unlockAndRead(page, "aes-unlocked.pdf");
  expect(copy.texts).toEqual(["Secret 1", "Secret 2"]);
});

test("needs the owner password for a PDF that opens freely, and refuses one with no password", async ({
  page,
}) => {
  await openTool(page, PATH);
  await file(page).setInputFiles(makeTestPdf("limited.pdf", 1, { ownerPassword: "boss" }));
  await password(page).fill("guess");
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(page.getByRole("alert")).toContainText("That password is not right", {
    timeout: 60_000,
  });
  await password(page).fill("boss");
  await page.getByRole("button", { name: "Remove password" }).click();
  const copy = await unlockAndRead(page, "limited-unlocked.pdf");
  expect(copy.texts).toEqual(["Page 1"]);

  await file(page).setInputFiles(makeTestPdf("plain.pdf", 1));
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This PDF has no password, so there is nothing to remove.",
    { timeout: 60_000 },
  );
});

test("refuses a damaged PDF and one byte over 50 MB, and unlocks one of exactly 50 MB", async ({
  page,
}, testInfo) => {
  await openTool(page, PATH);
  await file(page).setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 nothing here at all"),
  });
  await password(page).fill("x");
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "This PDF could not be read. It may be damaged or not a real PDF.",
    { timeout: 60_000 },
  );

  const over = testInfo.outputPath("over.pdf");
  writeFileSync(over, makeTestPdf("over.pdf", 1, { padding: LIMIT + 1 }).buffer);
  await file(page).setInputFiles(over);
  await expect(page.getByText("over.pdf: This file is larger than 50 MB.")).toBeVisible();

  const atLimit = testInfo.outputPath("big.pdf");
  writeFileSync(
    atLimit,
    makeTestPdf("big.pdf", 2, { padding: LIMIT, ownerPassword: "boss" }).buffer,
  );
  await file(page).setInputFiles(atLimit);
  await expect(page.locator("#unlock-pdf-original")).toHaveText("big.pdf: 50 MB");
  await password(page).fill("boss");
  await page.getByRole("button", { name: "Remove password" }).click();
  await expect(results(page).first()).toContainText("2 pages", { timeout: 120_000 });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations with the copy shown, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await file(page).setInputFiles(lockedPdf("statement.pdf", "pw", "bank", 1));
    await password(page).fill("pw");
    await page.getByRole("button", { name: "Remove password" }).click();
    await expect(results(page)).toHaveCount(1, { timeout: 60_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts match the page and the manifest", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

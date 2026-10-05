import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { MESSAGES, readDirectory } from "../../../tools/converters/zip-create-extract/logic";
import manifest from "../../../tools/converters/zip-create-extract/tool.config";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { recordPath } from "./media";
import {
  expectNoAxeViolations,
  expectQuickFacts,
  expectStructuredData,
  openTool,
  useTheme,
  watchViolations,
} from "./tool-page";

// ZIP create and extract against `wrangler dev` (real CSP and headers). Every ZIP here is made at
// run time with fflate in Node, then patched where a test needs what fflate never writes: an
// encryption flag, a false size, a code page 437 name. Every file the page saves is read back and
// compared byte for byte.

test.use({ baseURL: edgeURL });
test.setTimeout(120_000);

const PATH = "/zip-create-extract/";
const CENTRAL = [0x50, 0x4b, 0x01, 0x02];
const LOCAL = [0x50, 0x4b, 0x03, 0x04];

function offsets(zip: Uint8Array, signature: number[]): number[] {
  const found: number[] = [];
  for (let at = 0; at + 4 <= zip.length; at++)
    if (signature.every((byte, i) => zip[at + i] === byte)) found.push(at);
  return found;
}

const view = (zip: Uint8Array) => new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
const asFile = (name: string, zip: Uint8Array) => ({
  name,
  mimeType: "application/zip",
  buffer: Buffer.from(zip),
});
const openZip = (page: Page) => page.locator("#zip-extract-file");

async function download(page: Page, label: string): Promise<Buffer> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: label, exact: true }).click(),
  ]);
  return readFileSync((await file.path()) ?? "");
}

test("opens a ZIP and saves each file whole, with repeats renamed and unsafe names cleaned", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  const text = "Notes ".repeat(2000);
  const zip = zipSync({
    "holiday/beach.txt": [strToU8("first"), { level: 0 }],
    "work/beach.txt": [strToU8(text), { level: 6 }],
    "../escape.txt": strToU8("climbed"),
    "folder/": new Uint8Array(0),
    // Two bytes the test turns into a code page 437 name: "caf" and 0x82 (é).
    "cafX.txt": strToU8("old windows"),
  });
  // Rename "cafX.txt" to "caf" + 0x82 + ".txt" in both headers, with no UTF-8 flag.
  for (const at of [...offsets(zip, LOCAL), ...offsets(zip, CENTRAL)]) {
    const isCentral = zip[at + 2] === 1;
    const nameAt = at + (isCentral ? 46 : 30);
    const name = new TextDecoder().decode(zip.subarray(nameAt, nameAt + 8));
    if (name === "cafX.txt") zip[nameAt + 3] = 0x82;
  }
  await openTool(page, PATH);
  await openZip(page).setInputFiles(asFile("photos.zip", zip));
  await expect(page.locator("#zip-extract-summary")).toHaveText(
    "photos.zip: 4 files in 1 folder, 11.7 KB unpacked",
  );
  await expect(page.locator("#zip-extract-list")).toContainText(
    "Another file has the same name, so this one is saved as beach (2).txt.",
  );
  await expect(page.locator("#zip-extract-list")).toContainText(
    "The name in the ZIP was made safe; it is saved as escape.txt.",
  );
  await expect(page.locator("#zip-extract-list")).toContainText("café.txt");

  expect((await download(page, "Download beach.txt")).toString()).toBe("first");
  expect((await download(page, "Download beach (2).txt")).toString()).toBe(text);
  expect((await download(page, "Download escape.txt")).toString()).toBe("climbed");
  expect((await download(page, "Download café.txt")).toString()).toBe("old windows");
  recordPath(testInfo, "extract stored and deflated files, compared byte for byte", "real");
  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("makes a ZIP, compressed or stored, that unpacks to the same files", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await openTool(page, PATH);
  await page.getByRole("tab", { name: "Make a ZIP" }).click();
  const report = "Quarterly report. ".repeat(500);
  await page.locator("#zip-create-files").setInputFiles([
    { name: "report.txt", mimeType: "text/plain", buffer: Buffer.from(report) },
    { name: "über.txt", mimeType: "text/plain", buffer: Buffer.from("umlaut") },
  ]);
  await page
    .locator("#zip-create-files")
    .setInputFiles([{ name: "report.txt", mimeType: "text/plain", buffer: Buffer.from("second") }]);
  await expect(page.locator("#zip-create-list li")).toHaveText([
    "report.txt",
    "über.txt",
    "report (2).txt",
  ]);
  for (const [method, code] of [
    ["deflate", 8],
    ["store", 0],
  ] as const) {
    await page.locator("#zip-create-method").selectOption(method);
    await page.getByRole("button", { name: "Make ZIP" }).click();
    const zip = new Uint8Array(await download(page, "Download files.zip"));
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(["report.txt", "über.txt", "report (2).txt"]);
    expect(new TextDecoder().decode(files["report.txt"])).toBe(report);
    expect(new TextDecoder().decode(files["über.txt"])).toBe("umlaut");
    expect(new TextDecoder().decode(files["report (2).txt"])).toBe("second");
    const central = offsets(zip, CENTRAL)[0] ?? 0;
    expect(view(zip).getUint16(central + 10, true)).toBe(code);
    const parsed = readDirectory(zip.subarray(central), 3);
    expect(parsed.ok && parsed.records[1]?.utf8).toBe(true);
    recordPath(testInfo, `create a ${method} ZIP, unpacked and compared`, "real");
  }
  expect(errors).toEqual([]);
});

test("refuses a tiny zip bomb by its declared size, before unpacking anything", async ({
  page,
}) => {
  recordPath(test.info(), "tiny zip bomb refused by declared size", "message");
  const zip = zipSync({ "bomb.bin": [new Uint8Array(4096), { level: 9 }] });
  expect(zip.length).toBeLessThan(250);
  view(zip).setUint32((offsets(zip, CENTRAL)[0] ?? 0) + 24, 0xfffffffe, true);
  await openTool(page, PATH);
  await openZip(page).setInputFiles(asFile("bomb.zip", zip));
  await expect(page.getByRole("status")).toContainText(
    `bomb.zip: ${MESSAGES.tooBig(0xfffffffe, "1 GB")}`,
  );
});

test("stops a file that unpacks to more than it declares, and one with a wrong checksum", async ({
  page,
}) => {
  recordPath(test.info(), "lying zip bomb stopped while unpacking", "message");
  // 8 MB of zeros deflates to about 8 KB; the ZIP then claims the file is 1,000 bytes.
  const zip = zipSync({
    "lie.bin": [new Uint8Array(8 * 1024 * 1024), { level: 9 }],
    "crc.txt": [strToU8("checked"), { level: 0 }],
  });
  const [lie, crc] = offsets(zip, CENTRAL);
  view(zip).setUint32((lie ?? 0) + 24, 1000, true);
  view(zip).setUint32((crc ?? 0) + 16, 0x12345678, true);
  await openTool(page, PATH);
  await openZip(page).setInputFiles(asFile("liar.zip", zip));
  await page.getByRole("button", { name: "Download lie.bin" }).click();
  await expect(page.locator('[data-entry="lie.bin"] [role="alert"]')).toHaveText(
    MESSAGES.bomb("lie.bin"),
  );
  await page.getByRole("button", { name: "Download crc.txt" }).click();
  await expect(page.locator('[data-entry="crc.txt"] [role="alert"]')).toHaveText(
    MESSAGES.badCrc("crc.txt"),
  );
});

test("refuses encrypted ZIPs, ZIP64, too many entries, and files that are not ZIPs", async ({
  page,
}) => {
  recordPath(test.info(), "refusals at the limits", "message");
  await openTool(page, PATH);
  const encrypted = zipSync({ "secret.txt": strToU8("secret") });
  view(encrypted).setUint16((offsets(encrypted, CENTRAL)[0] ?? 0) + 8, 1, true);
  await openZip(page).setInputFiles(asFile("locked.zip", encrypted));
  await expect(page.getByRole("status")).toContainText(`locked.zip: ${MESSAGES.encrypted}`);

  const big = zipSync({ "a.txt": strToU8("a") });
  view(big).setUint32((offsets(big, CENTRAL)[0] ?? 0) + 20, 0xffffffff, true);
  await openZip(page).setInputFiles(asFile("huge.zip", big));
  await expect(page.getByRole("status")).toContainText(`huge.zip: ${MESSAGES.zip64}`);

  const entries = (count: number) =>
    zipSync(
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}.txt`, new Uint8Array(0)])),
    );
  await openZip(page).setInputFiles(asFile("many.zip", entries(1001)));
  await expect(page.getByRole("status")).toContainText(`many.zip: ${MESSAGES.tooMany(1001, 1000)}`);
  await openZip(page).setInputFiles(asFile("full.zip", entries(1000)));
  await expect(page.locator("#zip-extract-summary")).toHaveText(
    "full.zip: 1000 files, 0 bytes unpacked",
  );

  await openZip(page).setInputFiles({
    name: "archive.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("not a zip at all"),
  });
  await expect(page.getByRole("status")).toContainText(`archive.zip: ${MESSAGES.notZip}`);
});

for (const theme of ["light", "dark"] as const) {
  test(`has no axe violations with a ZIP open, ${theme} theme`, async ({ page }) => {
    recordPath(test.info(), `axe, ${theme} theme`, "message");
    await useTheme(page, theme);
    await openTool(page, PATH);
    await openZip(page).setInputFiles(
      asFile("a.zip", zipSync({ "a.txt": strToU8("a"), "../b.txt": strToU8("b") })),
    );
    await expect(page.locator("#zip-extract-list")).toContainText("b.txt");
    await expectNoAxeViolations(page);
    await page.getByRole("tab", { name: "Make a ZIP" }).click();
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts come from the manifest", async ({ page }) => {
  recordPath(test.info(), "structured data and Quick facts", "message");
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
  await expect(page.getByRole("region", { name: "Quick facts" })).toContainText("Up to 500 MB");
});

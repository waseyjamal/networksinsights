import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import exifr from "exifr";
import {
  app1Exif,
  buildTiff,
  jpegBlocks,
  MESSAGES,
  pngBlocks,
} from "../../../tools/image/exif-viewer-remover/logic";
import manifest from "../../../tools/image/exif-viewer-remover/tool.config";
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

// EXIF Viewer & Remover against `wrangler dev` (real CSP and headers). The sample photos are made
// here: the browser under test encodes a 64 × 32 picture as JPG or PNG, and the test adds EXIF
// (camera, date, software, orientation, GPS), XMP, IPTC and a comment block to it. Every value is
// synthetic, the location is open sea near 0°, 0°, and nothing personal is in any file. The copy
// is read back with exifr in Node, and for a JPG its decoded pixels are compared with the input's.

test.use({ baseURL: edgeURL });

const PATH = "/exif-viewer-remover/";
const input = (page: Page) => page.locator("#exif-viewer-remover-file");

const latin1 = (text: string) => Buffer.from(text, "latin1");

function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  return Buffer.concat([head, payload]);
}

const TIFF = (orientation: number | null) =>
  buildTiff(
    [
      { tag: 0x010f, type: "ascii", value: "TestCam" },
      { tag: 0x0110, type: "ascii", value: "Model X1" },
      ...(orientation === null
        ? []
        : [{ tag: 0x0112, type: "short" as const, value: [orientation] }]),
      { tag: 0x0131, type: "ascii", value: "Synthetic 1.0" },
    ],
    {
      exif: [{ tag: 0x9003, type: "ascii", value: "2024:05:06 07:08:09" }],
      gps: [
        { tag: 0x0001, type: "ascii", value: "N" },
        { tag: 0x0002, type: "rational", value: [0, 1, 15, 1, 0, 1] },
        { tag: 0x0003, type: "ascii", value: "W" },
        { tag: 0x0004, type: "rational", value: [0, 1, 30, 1, 0, 1] },
      ],
    },
  );

const XMP = segment(
  0xe1,
  latin1(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:format="image/jpeg"/></rdf:RDF></x:xmpmeta>',
  ),
);
// IPTC record 2, dataset 120 (caption): "Synthetic caption".
const IPTC_RECORD = Buffer.concat([
  Buffer.from([0x1c, 2, 120, 0, 17]),
  latin1("Synthetic caption"),
]);
const IPTC = segment(
  0xed,
  Buffer.concat([
    latin1("Photoshop 3.0\u00008BIM"),
    Buffer.from([0x04, 0x04, 0, 0, 0, 0, 0, IPTC_RECORD.length]),
    IPTC_RECORD,
    Buffer.alloc(IPTC_RECORD.length % 2),
  ]),
);
const COMMENT = segment(0xfe, latin1("synthetic comment"));

/** A 64 × 32 picture, wider than tall, encoded by the browser under test. */
async function encode(page: Page, type: "image/jpeg" | "image/png"): Promise<Buffer> {
  const base64 = await page.evaluate(async (mime) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 32;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    for (let x = 0; x < 64; x += 8) {
      context.fillStyle = `rgb(${x * 4}, ${255 - x * 3}, ${(x * 7) % 256})`;
      context.fillRect(x, 0, 8, 32);
    }
    context.fillStyle = "black";
    context.fillRect(0, 0, 10, 10);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, mime, 0.9));
    const bytes = new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0));
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  }, type);
  return Buffer.from(base64, "base64");
}

/** The browser's JPG with the metadata blocks put in after its JFIF block. */
async function sampleJpeg(page: Page, orientation: number | null): Promise<Buffer> {
  const plain = await encode(page, "image/jpeg");
  let at = 2;
  while (plain[at + 1] === 0xe0) at += 2 + plain.readUInt16BE(at + 2);
  const exif = Buffer.from(app1Exif(TIFF(orientation)));
  return Buffer.concat([plain.subarray(0, at), exif, XMP, IPTC, COMMENT, plain.subarray(at)]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([latin1(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The browser's PNG with an eXIf chunk (the same tags, GPS included) and a tEXt chunk. */
async function samplePng(page: Page): Promise<Buffer> {
  const plain = await encode(page, "image/png");
  const ihdrEnd = 8 + 12 + plain.readUInt32BE(8);
  return Buffer.concat([
    plain.subarray(0, ihdrEnd),
    pngChunk("eXIf", Buffer.from(TIFF(null))),
    pngChunk("tEXt", latin1("Comment\0synthetic comment")),
    plain.subarray(ihdrEnd),
  ]);
}

/** The pixels the browser decodes from each file, as it shows them (orientation applied). */
function decodedPixels(page: Page, files: Buffer[]) {
  return page.evaluate(
    async (list) => {
      const out: Array<{ width: number; height: number; data: number[] }> = [];
      for (const base64 of list) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context?.drawImage(bitmap, 0, 0);
        const data = context?.getImageData(0, 0, bitmap.width, bitmap.height).data ?? [];
        out.push({ width: bitmap.width, height: bitmap.height, data: [...data] });
      }
      return out;
    },
    files.map((file) => file.toString("base64")),
  );
}

async function download(page: Page, name: string): Promise<Buffer> {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name }).click(),
  ]);
  return readFileSync((await file.path()) ?? "");
}

test("shows the tags and the location of a JPG, and removes them without re-encoding", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await openTool(page, PATH);
  const photo = await sampleJpeg(page, 6);
  // The sample is what the test says it is.
  const before = await exifr.parse(photo, { gps: true, xmp: true, iptc: true });
  expect(before.Make).toBe("TestCam");
  expect(before.latitude).toBeCloseTo(0.25, 6);

  await input(page).setInputFiles({ name: "sample.jpg", mimeType: "image/jpeg", buffer: photo });
  const table = page.locator("#exif-viewer-remover-tags");
  await expect(table).toBeVisible({ timeout: 30_000 });
  const rows = await table
    .locator("tbody tr")
    .evaluateAll((trs) => trs.map((tr) => [...tr.children].map((cell) => cell.textContent)));
  expect(rows).toEqual([
    ["Camera", "TestCam Model X1"],
    ["Date taken", "2024-05-06 07:08:09"],
    ["Software", "Synthetic 1.0"],
    ["Orientation", "6: Turned 90° clockwise"],
    ["GPS location", "0.250000° N, 0.500000° W"],
  ]);
  await expect(page.locator("#exif-viewer-remover-gps")).toBeVisible();
  await expect(page.getByText("This photo reveals a location")).toBeVisible();
  // The browser's own encoder may add an ICC profile, which is listed and kept.
  const listed = jpegBlocks(new Uint8Array(photo));
  expect(listed.slice(0, 4)).toEqual(["EXIF", "XMP", "IPTC", "Comment"]);
  await expect(page.locator("#exif-viewer-remover-blocks")).toHaveText(
    `Metadata blocks found: ${listed.join(", ")}.`,
  );
  await expect(page.locator("#exif-viewer-remover-orientation")).toBeVisible();
  await expect(page.locator("#exif-viewer-remover-method")).toContainText("not re-encoded");

  const copy = await download(page, "Download JPG");
  const after = await exifr.parse(copy, {
    gps: true,
    xmp: true,
    iptc: true,
    translateValues: false,
  });
  // Only the orientation is left, so the copy shows the right way up.
  expect(after).toEqual({ Orientation: 6 });
  expect(await exifr.gps(copy)).toBeUndefined();
  expect(jpegBlocks(new Uint8Array(copy))).toEqual(
    listed.includes("ICC colour profile") ? ["EXIF", "ICC colour profile"] : ["EXIF"],
  );
  expect(copy.includes(latin1("http://ns.adobe.com/"))).toBe(false);
  expect(copy.includes(latin1("Synthetic"))).toBe(false);
  expect(copy.includes(latin1("TestCam"))).toBe(false);

  // Same pixels, shown the same way: 32 × 64 for both, turned by the kept tag.
  const [original, cleaned] = await decodedPixels(page, [photo, copy]);
  expect(original?.width).toBe(32);
  expect(original?.height).toBe(64);
  expect(cleaned?.width).toBe(original?.width);
  expect(cleaned?.height).toBe(original?.height);
  expect(cleaned?.data).toEqual(original?.data);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("writes no EXIF at all when the JPG needs no turning, and the pixels stay identical", async ({
  page,
}) => {
  await openTool(page, PATH);
  const photo = await sampleJpeg(page, null);
  await input(page).setInputFiles({ name: "flat.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.locator("#exif-viewer-remover-gps")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#exif-viewer-remover-orientation")).toHaveCount(0);

  const copy = await download(page, "Download JPG");
  expect(await exifr.parse(copy, { gps: true, xmp: true, iptc: true })).toBeUndefined();
  const kept = jpegBlocks(new Uint8Array(photo)).includes("ICC colour profile");
  expect(jpegBlocks(new Uint8Array(copy))).toEqual(kept ? ["ICC colour profile"] : []);
  const [original, cleaned] = await decodedPixels(page, [photo, copy]);
  expect(cleaned?.width).toBe(64);
  expect(cleaned?.data).toEqual(original?.data);
});

test("redraws a PNG with metadata as a new PNG without any, and says so", async ({ page }) => {
  await openTool(page, PATH);
  const photo = await samplePng(page);
  expect((await exifr.gps(photo))?.latitude).toBeCloseTo(0.25, 6);
  await input(page).setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: photo });
  const listed = pngBlocks(new Uint8Array(photo));
  expect(listed.slice(0, 2)).toEqual(["EXIF", "Text"]);
  await expect(page.locator("#exif-viewer-remover-blocks")).toHaveText(
    `Metadata blocks found: ${listed.join(", ")}.`,
    { timeout: 30_000 },
  );
  await expect(page.locator("#exif-viewer-remover-blocks-warning")).toBeVisible();
  await expect(page.locator("#exif-viewer-remover-method")).toContainText(
    "redrawn through the browser canvas",
  );

  const copy = await download(page, "Download PNG");
  expect([...copy.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  // WebKit's encoder writes its own sRGB profile into every PNG; no block of the sample is left.
  const blocks = pngBlocks(new Uint8Array(copy));
  expect(blocks.filter((block) => block !== "ICC colour profile")).toEqual([]);
  // exifr reports the PNG header (size, bit depth); no tag of the sample may be left.
  const after = (await exifr.parse(copy, { gps: true, xmp: true, iptc: true })) ?? {};
  for (const key of ["Make", "Model", "Software", "latitude", "longitude", "GPSLatitude"]) {
    expect(after).not.toHaveProperty(key);
  }
  expect(await exifr.gps(copy)).toBeUndefined();
  expect(copy.includes(latin1("TestCam"))).toBe(false);
});

test("refuses a file that is not a photo", async ({ page }) => {
  await openTool(page, PATH);
  await input(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("text"),
  });
  await expect(page.locator("#exif-viewer-remover-error")).toHaveText(MESSAGES.type);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openTool(page, PATH);
    await input(page).setInputFiles({
      name: "sample.jpg",
      mimeType: "image/jpeg",
      buffer: await sampleJpeg(page, 6),
    });
    await expect(page.locator("#exif-viewer-remover-gps")).toBeVisible({ timeout: 30_000 });
    await expectNoAxeViolations(page);
  });
}

test("structured data and Quick facts are the manifest's", async ({ page }) => {
  await openTool(page, PATH);
  await expectStructuredData(page, manifest, PATH);
  await expectQuickFacts(page, manifest);
});

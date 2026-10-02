import type { Page } from "@playwright/test";

// A photo-like test image, drawn in the browser under test and encoded there as PNG, so no binary
// fixture (and no licence question) is kept in the repository. It is deterministic: gradients,
// shapes and a seeded grain, 1200 by 800 pixels unless asked otherwise, with a transparent corner to check that a JPG
// result gets a white background.

export interface TestImage {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export async function makeTestPng(
  page: Page,
  name = "test-photo.png",
  size: { width: number; height: number } = { width: 1200, height: 800 },
): Promise<TestImage> {
  const base64 = await page.evaluate(async ({ width, height }) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "rgb(40, 90, 170)");
    sky.addColorStop(0.6, "rgb(230, 170, 120)");
    sky.addColorStop(1, "rgb(60, 110, 60)");
    context.fillStyle = sky;
    context.fillRect(0, 0, width, height);
    for (let i = 0; i < 40; i++) {
      context.beginPath();
      context.fillStyle = `rgba(${(i * 53) % 255}, ${(i * 97) % 255}, ${(i * 31) % 255}, 0.5)`;
      context.arc((i * 137) % width, (i * 71) % height, 20 + ((i * 13) % 90), 0, Math.PI * 2);
      context.fill();
    }
    // Seeded grain, as a camera sensor gives: it is what makes a PNG photo large.
    const pixels = context.getImageData(0, 0, width, height);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const grain = (seed >>> 24) % 17;
      pixels.data[i] = Math.min(255, (pixels.data[i] ?? 0) + grain);
      pixels.data[i + 1] = Math.min(255, (pixels.data[i + 1] ?? 0) + grain);
      pixels.data[i + 2] = Math.min(255, (pixels.data[i + 2] ?? 0) + grain);
    }
    context.putImageData(pixels, 0, 0);
    context.clearRect(0, 0, 80, 80);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }, size);
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

/**
 * The same file, made exactly `bytes` long with zeros after its end. Image decoders stop at the end
 * marker (PNG IEND, JPEG EOI), so the picture still reads: it tests a size limit with a file that
 * is really at the limit, not only a number.
 */
export function padTo<T extends { buffer: Buffer }>(file: T, bytes: number): T {
  if (bytes < file.buffer.length) throw new Error("the file is already larger");
  return {
    ...file,
    buffer: Buffer.concat([file.buffer, Buffer.alloc(bytes - file.buffer.length)]),
  };
}

/** A plain JPG drawn in the browser under test: a gradient, `width` by `height` pixels. */
export async function makeTestJpg(
  page: Page,
  name: string,
  size: { width: number; height: number },
): Promise<TestImage> {
  const base64 = await page.evaluate(async ({ width, height }) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    const fill = context.createLinearGradient(0, 0, width, height);
    fill.addColorStop(0, "rgb(200, 60, 40)");
    fill.addColorStop(1, "rgb(40, 60, 200)");
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }, size);
  return { name, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

/**
 * The same JPG with an EXIF orientation tag, as a phone camera writes it: 6 means "turn 90°
 * clockwise to show", so a 200 by 100 picture is shown 100 by 200.
 */
export function withExifOrientation(jpg: TestImage, orientation: number): TestImage {
  // TIFF header (little endian), one IFD entry: tag 0x0112, type SHORT, count 1, the value.
  const tiff = Buffer.from([
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x12,
    0x01,
    0x03,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
  // After the SOI marker (FF D8).
  const buffer = Buffer.concat([jpg.buffer.subarray(0, 2), app1, jpg.buffer.subarray(2)]);
  return { ...jpg, buffer };
}

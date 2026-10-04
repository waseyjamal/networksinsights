// PDFs with real pictures for Compress PDF, made while the test runs so no large file is kept in
// the repository. The browser under test draws the pictures (busy, photo-like noise, so they are
// as hard to compress as photos) and encodes them; pdf-lib, the library the PDF tools use, puts
// them on A4 pages with lines of Helvetica text under them.

import type { Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "../../../../tools/node_modules/pdf-lib/cjs/index.js";
import type { TestPdf } from "./test-pdf";

export interface PictureSpec {
  width: number;
  height: number;
  /** "photo" is busy noise as JPEG; "smooth" a plain gradient as JPEG; "transparent" a PNG with alpha. */
  kind: "photo" | "smooth" | "transparent";
  /** Width on the page, in points (1/72 inch). The height keeps the picture's proportions. */
  shownWidth: number;
}

/** Draws one picture in the page and returns its encoded bytes. */
async function draw(page: Page, picture: PictureSpec, seed: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width, height, kind, seed }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no 2d context");
      const fill = context.createLinearGradient(0, 0, width, height);
      fill.addColorStop(0, `hsl(${seed * 40}, 70%, 50%)`);
      fill.addColorStop(1, `hsl(${seed * 40 + 120}, 60%, 30%)`);
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      if (kind !== "smooth") {
        for (let i = 0; i < 400; i++) {
          context.fillStyle = `hsla(${(i * 37 + seed * 11) % 360}, 60%, ${30 + (i % 50)}%, 0.5)`;
          context.beginPath();
          context.arc((i * 997) % width, (i * 613) % height, 20 + (i % 90), 0, 7);
          context.fill();
        }
        const pixels = context.getImageData(0, 0, width, height);
        let state = seed * 9301 + 49297;
        for (let i = 0; i < pixels.data.length; i += 4) {
          state = (state * 9301 + 49297) % 233280;
          const noise = (state / 233280 - 0.5) * 40;
          pixels.data[i] = (pixels.data[i] ?? 0) + noise;
          pixels.data[i + 1] = (pixels.data[i + 1] ?? 0) + noise;
          pixels.data[i + 2] = (pixels.data[i + 2] ?? 0) + noise;
          if (kind === "transparent") pixels.data[i + 3] = (i / 4) % width < width / 2 ? 255 : 120;
        }
        context.putImageData(pixels, 0, 0);
      }
      const blob = await canvas.convertToBlob(
        kind === "transparent" ? { type: "image/png" } : { type: "image/jpeg", quality: 0.95 },
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    },
    { ...picture, seed },
  );
  return Buffer.from(base64, "base64");
}

/**
 * A PDF with one picture at the top of each A4 page and `lines` lines of text under it, each
 * reading "Page N line M: selectable text survives compression."
 */
export async function makePhotoPdf(
  page: Page,
  name: string,
  pictures: readonly PictureSpec[],
  lines = 12,
): Promise<TestPdf> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [index, picture] of pictures.entries()) {
    const bytes = await draw(page, picture, index + 1);
    const image =
      picture.kind === "transparent"
        ? await document.embedPng(bytes)
        : await document.embedJpg(bytes);
    const sheet = document.addPage([595, 842]);
    const height = (picture.shownWidth * picture.height) / picture.width;
    sheet.drawImage(image, { x: 50, y: 792 - height, width: picture.shownWidth, height });
    for (let line = 0; line < lines; line++) {
      sheet.drawText(`Page ${index + 1} line ${line + 1}: selectable text survives compression.`, {
        x: 50,
        y: 760 - height - line * 22,
        size: 11,
        font,
      });
    }
  }
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await document.save()) };
}

/** The test PDF of the page example: six 3000 by 2000 photos and one transparent picture. */
export const EXAMPLE_PICTURES: readonly PictureSpec[] = [
  ...Array.from({ length: 6 }, () => ({
    width: 3000,
    height: 2000,
    kind: "photo" as const,
    shownWidth: 297.5,
  })),
  { width: 800, height: 600, kind: "transparent", shownWidth: 297.5 },
];

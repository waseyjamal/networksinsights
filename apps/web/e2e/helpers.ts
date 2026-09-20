import { readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { toBytes } from "../src/lib/color";
import { parseTokens, type Theme, themeColors } from "../src/lib/tokens";

// The expected colors come from the same tokens.css the site is built from.
const tokens = parseTokens(
  readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
);

/** The page background of a theme as sRGB bytes. */
export function expectedBackground(theme: Theme): [number, number, number] {
  const bg = themeColors(tokens, theme).get("bg");
  if (!bg) throw new Error("tokens.css has no --bg token");
  return toBytes(bg);
}

/** The painted background of <body> as sRGB bytes, converted by the browser itself. */
export async function bodyBackground(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!context) throw new Error("No 2d canvas context");
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  });
}

/** Collects console errors, uncaught exceptions and failed requests. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()}`));
  return errors;
}

export const compressed = {
  gzip: (data: Buffer | string) => gzipSync(data, { level: 9 }).length,
  brotli: (data: Buffer | string) =>
    brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
};

/**
 * Records every stylesheet, script and font response of one page load. Bodies are read lazily,
 * only by the test that needs them: fetching all of them eagerly makes some engines hang when the
 * browser context is torn down.
 */
export function collectResponses(page: Page) {
  const items: Array<{ url: string; type: string; body: () => Promise<Buffer> }> = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (["stylesheet", "script", "font"].includes(type)) {
      items.push({ url: response.url(), type, body: () => response.body() });
    }
  });
  return items;
}

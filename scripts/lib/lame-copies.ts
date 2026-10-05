// The LAME check (ADR 0064): the built site must carry exactly one copy of the LAME MP3 encoder,
// the unmodified mp3.wasm in its vendor folder. LAME is LGPL, and the site's promise is that it is
// a separate file anyone can replace; a second copy inlined into a JavaScript bundle (as base64,
// which wasm-media-encoders' own `createMp3Encoder` would bring in) would break that promise.
// `pnpm check:budgets` runs it on the build output.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Strings LAME 3.100 compiles into its encoder; any one of them marks a copy. */
export const LAME_SIGNATURES = ["LAME encoding library", "lame.sf.net"] as const;

/** The one place LAME may be, relative to the build output. */
export const LAME_WASM_PATH = "vendor/wasm-media-encoders/0.7.0/mp3.wasm";

/** Files that could hold code: scripts, WebAssembly, pages and data. */
const SCANNED = /\.(m?js|wasm|html|json|txt|css)$/i;

/** Runs of base64 long enough to hold a compiled encoder. */
const BASE64_RUN = /[A-Za-z0-9+/]{1000,}={0,2}/g;

function holdsLame(bytes: Buffer): boolean {
  const text = bytes.toString("latin1");
  return LAME_SIGNATURES.some((signature) => text.includes(signature));
}

/** Whether a file holds LAME, as raw bytes or inside a base64 run. */
export function containsLame(bytes: Buffer): boolean {
  if (holdsLame(bytes)) return true;
  for (const [run] of bytes.toString("latin1").matchAll(BASE64_RUN)) {
    // A run cut at any length decodes; only whole groups of four are kept.
    if (holdsLame(Buffer.from(run.slice(0, run.length - (run.length % 4)), "base64"))) return true;
  }
  return false;
}

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (SCANNED.test(entry.name)) yield path;
  }
}

export interface LameReport {
  /** Every file holding LAME, relative to the build output, with forward slashes. */
  copies: string[];
  ok: boolean;
}

export function checkLameCopies(distDir: string): LameReport {
  const copies: string[] = [];
  for (const path of files(distDir)) {
    if (containsLame(readFileSync(path)))
      copies.push(relative(distDir, path).replaceAll("\\", "/"));
  }
  copies.sort();
  return { copies, ok: copies.length === 1 && copies[0] === LAME_WASM_PATH };
}

export function formatLameReport(report: LameReport): string {
  if (report.ok) return `LAME: exactly one copy, the unmodified ${LAME_WASM_PATH} (ADR 0064).`;
  const found = report.copies.length === 0 ? "none" : report.copies.join(", ");
  return `LAME: expected exactly one copy, ${LAME_WASM_PATH}, and found: ${found}. Load the encoder with createEncoder("audio/mpeg", <the vendored URL>), never createMp3Encoder, which inlines a second copy (ADR 0064).`;
}

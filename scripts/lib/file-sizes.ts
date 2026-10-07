// The file size check (ADR 0068): Cloudflare serves no single static file over 25 MiB, so a
// bigger file in the build would fail the deploy or vanish from the site. A model that is larger
// is served in parts that the browser joins (Whisper's decoder). `pnpm check:budgets` runs it on
// the build output.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Cloudflare's limit for one static file. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface FileSizeReport {
  /** Files over the limit, relative to the build output, with their size. */
  over: Array<{ path: string; bytes: number }>;
  /** The largest file, to show how close the build is. */
  largest: { path: string; bytes: number } | undefined;
  ok: boolean;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

export function checkFileSizes(distDir: string): FileSizeReport {
  const over: FileSizeReport["over"] = [];
  let largest: FileSizeReport["largest"];
  for (const path of walk(distDir)) {
    const bytes = statSync(path).size;
    const file = { path: relative(distDir, path).replaceAll("\\", "/"), bytes };
    if (!largest || bytes > largest.bytes) largest = file;
    if (bytes > MAX_FILE_BYTES) over.push(file);
  }
  over.sort((a, b) => a.path.localeCompare(b.path));
  return { over, largest, ok: over.length === 0 };
}

const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;

export function formatFileSizeReport(report: FileSizeReport): string {
  if (report.ok) {
    const largest = report.largest
      ? `; the largest is ${report.largest.path}, ${mib(report.largest.bytes)}`
      : "";
    return `File sizes: no file is over 25 MiB${largest} (ADR 0068).`;
  }
  const lines = ["File sizes (ADR 0068): Cloudflare serves no file over 25 MiB."];
  for (const file of report.over) {
    lines.push(
      `  ${file.path} is ${mib(file.bytes)}. Serve it in parts the browser joins, as Whisper's decoder is.`,
    );
  }
  return lines.join("\n");
}

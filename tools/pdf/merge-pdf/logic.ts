// Pure logic of "Merge PDF": the file rules and the order of the list, with no DOM, no network
// and no top-level statements (docs/tool-contract.md, "logic.ts: what pure means"). worker.ts
// joins the files with pdf-lib (ADR 0057).

export const LIMITS = {
  /** 50 MB per PDF. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 20,
} as const;

/** What the page sends the worker: the files, in the order of the list. */
export interface Job {
  files: Array<{ name: string; data: Blob }>;
}

/** What the worker sends back. */
export interface JobResult {
  blob: Blob;
  pages: number;
}

/** Kept for the manifest's input schema: the PDFs, in order, by name. */
export interface Input {
  order: string[];
}

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  tooManyFiles: (count: number) => `Only ${count} PDFs can be merged at once.`,
  needTwo: "Add at least two PDFs to merge.",
  encrypted: (name: string) =>
    `${name} is protected with a password. Remove the password in the program that made it, then add it again.`,
  unreadable: (name: string) => `${name} could not be read. It may be damaged or not a real PDF.`,
  failed: "The PDFs could not be merged.",
} as const;

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

export interface Rejected {
  name: string;
  reason: string;
}

/** Splits added files into the ones taken and the ones refused, with the reason. */
export function checkFiles<F extends { name: string; type: string; size: number }>(
  files: readonly F[],
  already = 0,
): { accepted: F[]; rejected: Rejected[] } {
  const accepted: F[] = [];
  const rejected: Rejected[] = [];
  for (const file of files) {
    if (!isPdf(file)) {
      rejected.push({ name: file.name, reason: MESSAGES.notAPdf });
    } else if (file.size > LIMITS.maxInputBytes) {
      rejected.push({
        name: file.name,
        reason: MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes)),
      });
    } else if (already + accepted.length >= LIMITS.maxFiles) {
      rejected.push({ name: file.name, reason: MESSAGES.tooManyFiles(LIMITS.maxFiles) });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}

/** The list with the item at `index` moved by `by` places (-1 up, 1 down); unchanged at an end. */
export function move<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** The name of the merged file: the first PDF's name with `-merged`. */
export function outputName(firstName: string | undefined): string {
  const base = (firstName ?? "").replace(/\.pdf$/i, "").trim();
  return `${base || "document"}-merged.pdf`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function pagesLabel(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

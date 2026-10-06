// Pure logic of "Unlock PDF": the file rules, the messages, the checks made on the unlocked copy
// and its name, with no DOM, no network and no top-level statements (docs/tool-contract.md).
// worker.ts opens the PDF with PDFium and the password the visitor typed, removes the protection,
// then opens the copy again with PDF.js to prove it needs no password (ADR 0057, ADR 0062).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
} as const;

/** PDF.js's data files, served from this site (ADR 0057). Keep the version in step with pdfjs-dist. */
export const PDFJS_ASSETS = "/vendor/pdfjs/6.3.289/";

/** Kept for the manifest's input schema. */
export interface Input {
  password: string;
}

export interface Job {
  file: Blob;
  password: string;
}

export interface JobResult {
  bytes: Uint8Array;
  pages: number;
  /** "open" when the PDF asked for a password to open; "owner" when it opened but limited changes. */
  kind: ProtectionKind;
}

export type ProtectionKind = "open" | "owner";

/** What PDF.js found in a file: its pages and their text, or that it still needs a password. */
export type Reading = { locked: true } | { locked: false; texts: string[] };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  noPassword: "Type the password of this PDF.",
  wrongPassword:
    "That password is not right for this PDF. Check capital letters and spaces, then try again. This tool cannot find or guess a password.",
  notProtected: "This PDF has no password, so there is nothing to remove.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  failed: "The password could not be removed from this PDF.",
  notVerified:
    "The unlocked copy did not pass the final check, so it was not given back. Your PDF may use a feature this tool cannot handle.",
} as const;

export function isPdf(file: { name: string; type: string }): boolean {
  if (file.type === "application/pdf") return true;
  return file.type === "" && /\.pdf$/i.test(file.name);
}

export function checkFile(file: { name: string; type: string; size: number }): string | undefined {
  if (!isPdf(file)) return MESSAGES.notAPdf;
  if (file.size > LIMITS.maxInputBytes) return MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes));
  return;
}

/** The password as typed: never trimmed, as a space can be part of a password. */
export function checkPassword(password: string): string | undefined {
  if (password === "") return MESSAGES.noPassword;
  return;
}

/**
 * The copy is given back only when PDF.js opens it with no password, finds as many pages as the
 * original had, and reads the same text on every page as it read in the original.
 */
export function verified(original: Reading, copy: Reading): boolean {
  if (original.locked || copy.locked) return false;
  if (original.texts.length === 0 || copy.texts.length !== original.texts.length) return false;
  return copy.texts.every((text, index) => text === original.texts[index]);
}

/** `report.pdf` becomes `report-unlocked.pdf`. */
export function unlockedName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-unlocked.pdf`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

// Pure logic of "PDF Metadata Editor": the file rules, the fields it edits and how they are checked,
// with no DOM, no network and no top-level statements (docs/tool-contract.md). worker.ts reads and
// writes the document information dictionary with pdf-lib (ADR 0057).

export const LIMITS = {
  /** 50 MB, one PDF at a time. */
  maxInputBytes: 50 * 1024 * 1024,
  maxFiles: 1,
  /** The longest value of one field, in characters. */
  maxFieldChars: 2000,
} as const;

/** The fields of the document information dictionary that the tool edits, in page order. */
export const FIELDS = ["title", "author", "subject", "keywords", "creator", "producer"] as const;
export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator (the program that made the original)",
  producer: "Producer (the program that wrote the PDF)",
};

/** The key of each field in the PDF's Info dictionary. */
export const INFO_KEYS: Record<Field, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
};

export type Values = Record<Field, string>;

/** Kept for the manifest's input schema. */
export interface Input extends Values {
  removeDates: boolean;
}

export interface Metadata {
  values: Values;
  /** ISO 8601, or "" when the PDF has none. */
  created: string;
  modified: string;
  /** Whether the document catalog has an XMP metadata stream. */
  hasXmp: boolean;
}

export type Job =
  | { kind: "open"; file: Blob }
  | { kind: "save"; file: Blob; values: Values; removeDates: boolean };

export type JobResult =
  | { kind: "open"; pages: number; metadata: Metadata }
  | { kind: "save"; blob: Blob; metadata: Metadata };

export const MESSAGES = {
  notAPdf: "This file is not a PDF.",
  tooLarge: (limit: string) => `This file is larger than ${limit}.`,
  encrypted:
    "This PDF is protected with a password. Remove the password in the program that made it, then try again.",
  unreadable: "This PDF could not be read. It may be damaged or not a real PDF.",
  tooLong: (field: Field) =>
    `${FIELD_LABELS[field].replace(/ \(.*\)$/, "")} is longer than ${LIMITS.maxFieldChars.toString()} characters.`,
  failed: "The PDF could not be saved.",
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

/** Trims every value, and refuses one that is too long. An empty value removes the field. */
export function cleanValues(
  values: Values,
): { ok: true; values: Values } | { ok: false; error: string } {
  const clean = {} as Values;
  for (const field of FIELDS) {
    // Line breaks become spaces: the fields are single lines in every reader.
    const value = values[field].replace(/[\r\n\t]+/g, " ").trim();
    if (value.length > LIMITS.maxFieldChars) return { ok: false, error: MESSAGES.tooLong(field) };
    clean[field] = value;
  }
  return { ok: true, values: clean };
}

export const emptyValues = (): Values => ({
  title: "",
  author: "",
  subject: "",
  keywords: "",
  creator: "",
  producer: "",
});

/** "2024-03-05T10:20:30.000Z" as "2024-03-05 10:20:30 UTC"; "" stays "". */
export function formatDate(iso: string): string {
  if (iso === "") return "";
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** `report.pdf` becomes `report-metadata.pdf`. */
export function outputName(inputName: string): string {
  const base = inputName.replace(/\.pdf$/i, "").trim() || "document";
  return `${base}-metadata.pdf`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

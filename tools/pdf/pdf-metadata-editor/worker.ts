import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";
import {
  cleanValues,
  FIELDS,
  INFO_KEYS,
  type Job,
  type JobResult,
  MESSAGES,
  type Metadata,
  type Values,
} from "./logic";

// The Web Worker of "PDF Metadata Editor" (ADR 0051, ADR 0057). pdf-lib reads the document
// information dictionary (Info). Saving writes each field typed, removes each field left empty,
// and removes the document's own XMP metadata stream from the catalog and from the file, because
// readers often show XMP before Info and it would still hold the old values. XMP attached to pages,
// pictures or fonts is not touched. pdf-lib is told not to write its own producer or dates.

async function load(file: Blob): Promise<PDFDocument> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted);
    document.getPageCount();
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.unreadable);
  }
  return document;
}

/** The Info dictionary, created when the PDF has none. */
function info(document: PDFDocument): PDFDict {
  const { context } = document;
  const existing = context.trailerInfo.Info ? context.lookup(context.trailerInfo.Info) : undefined;
  if (existing instanceof PDFDict) return existing;
  const created = context.obj({});
  context.trailerInfo.Info = context.register(created);
  return created;
}

function read(document: PDFDocument): Metadata {
  const values = {} as Values;
  for (const field of FIELDS) {
    const key = PDFName.of(INFO_KEYS[field]);
    const value = info(document).lookup(key);
    values[field] =
      value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
  }
  return {
    values,
    created: document.getCreationDate()?.toISOString() ?? "",
    modified: document.getModificationDate()?.toISOString() ?? "",
    hasXmp: document.catalog.has(PDFName.of("Metadata")),
  };
}

defineWorker<Job, JobResult>(async (job) => {
  const document = await load(job.file);
  if (job.kind === "open") {
    return { kind: "open", pages: document.getPageCount(), metadata: read(document) };
  }
  const cleaned = cleanValues(job.values);
  if (!cleaned.ok) throw new ToolError(cleaned.error);
  const dictionary = info(document);
  for (const field of FIELDS) {
    const key = PDFName.of(INFO_KEYS[field]);
    const value = cleaned.values[field];
    if (value === "") dictionary.delete(key);
    else dictionary.set(key, PDFHexString.fromText(value));
  }
  if (job.removeDates) {
    dictionary.delete(PDFName.of("CreationDate"));
    dictionary.delete(PDFName.of("ModDate"));
  }
  const xmpKey = PDFName.of("Metadata");
  const xmp = document.catalog.get(xmpKey);
  if (xmp) {
    document.catalog.delete(xmpKey);
    if (xmp instanceof PDFRef) document.context.delete(xmp);
  }
  let saved: Uint8Array;
  try {
    saved = await document.save({ updateFieldAppearances: false });
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
  const blob = new Blob([saved as BlobPart], { type: "application/pdf" });
  // Read the saved file back, so the page shows what is really in it.
  return { kind: "save", blob, metadata: read(await load(blob)) };
});

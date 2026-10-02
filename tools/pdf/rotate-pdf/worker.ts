import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { degrees, PDFDocument } from "pdf-lib";
import { type Job, type JobResult, MESSAGES, turned } from "./logic";

// The Web Worker of "Rotate PDF" (ADR 0051, ADR 0057). pdf-lib counts the pages when a PDF is
// opened, then sets the rotation of the chosen pages and saves the file. Nothing is redrawn: a
// page's rotation is one number in the PDF. pdf-lib loads with this worker, so its code is fetched
// only once the visitor chooses a PDF.

async function open(file: Blob): Promise<PDFDocument> {
  let document: PDFDocument;
  let pages: number;
  try {
    document = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted);
    // A damaged file can load and still have no page tree: counting the pages finds out.
    pages = document.getPageCount();
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.unreadable);
  }
  if (pages === 0) throw new ToolError(MESSAGES.noPages);
  return document;
}

defineWorker<Job, JobResult>(async (job, { signal }) => {
  const document = await open(job.file);
  if (job.kind === "count") return { kind: "count", pages: document.getPageCount() };
  signal.throwIfAborted();
  const all = document.getPages();
  for (const number of job.pages) {
    const page = all[number - 1];
    if (page) page.setRotation(degrees(turned(page.getRotation().angle, job.turn)));
  }
  const bytes = await document.save();
  return {
    kind: "rotate",
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
  };
});

import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument } from "pdf-lib";
import { indicesOf, type Job, type JobResult, MESSAGES } from "./logic";

// The Web Worker of "Split PDF" (ADR 0051, ADR 0057). pdf-lib counts the pages when a PDF is
// opened, then copies each range into a new PDF of its own. pdf-lib loads with this worker, so its
// code is fetched only once the visitor chooses a PDF.

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

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const source = await open(job.file);
  if (job.kind === "count") return { kind: "count", pages: source.getPageCount() };

  const parts: Array<{ range: (typeof job.ranges)[number]; blob: Blob }> = [];
  for (const [index, range] of job.ranges.entries()) {
    signal.throwIfAborted();
    progress({ done: index, total: job.ranges.length, stage: "Writing the parts" });
    const part = await PDFDocument.create();
    let pages: Awaited<ReturnType<PDFDocument["copyPages"]>>;
    try {
      pages = await part.copyPages(source, indicesOf(range));
    } catch {
      throw new ToolError(MESSAGES.unreadable);
    }
    for (const page of pages) part.addPage(page);
    const bytes = await part.save();
    parts.push({
      range,
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    });
  }
  progress({ done: job.ranges.length, total: job.ranges.length });
  return { kind: "split", parts };
});

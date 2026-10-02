import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument } from "pdf-lib";
import { type Job, type JobResult, MESSAGES } from "./logic";

// The Web Worker of "Merge PDF" (ADR 0051, ADR 0057). pdf-lib opens each PDF in the order given,
// copies all of its pages into one new document and saves it. pdf-lib loads with this worker,
// so its code is fetched only when the visitor merges.

/** Opens a PDF, refusing a password-protected or unreadable one with its name. */
async function open(name: string, data: Blob): Promise<PDFDocument> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(await data.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted(name));
    // A damaged file can load and still have no page tree: counting the pages finds out.
    document.getPageCount();
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.unreadable(name));
  }
  return document;
}

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  if (job.files.length < 2) throw new ToolError(MESSAGES.needTwo);
  const total = job.files.length + 1;
  const merged = await PDFDocument.create();
  for (const [index, file] of job.files.entries()) {
    signal.throwIfAborted();
    progress({ done: index, total, stage: `Adding ${file.name}` });
    const source = await open(file.name, file.data);
    let pages: Awaited<ReturnType<PDFDocument["copyPages"]>>;
    try {
      pages = await merged.copyPages(source, source.getPageIndices());
    } catch {
      throw new ToolError(MESSAGES.unreadable(file.name));
    }
    for (const page of pages) merged.addPage(page);
  }
  signal.throwIfAborted();
  progress({ done: job.files.length, total, stage: "Saving" });
  const bytes = await merged.save();
  progress({ done: total, total });
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    pages: merged.getPageCount(),
  };
});

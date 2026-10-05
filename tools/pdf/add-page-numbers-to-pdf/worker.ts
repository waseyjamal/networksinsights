import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { type Job, type JobResult, MESSAGES, placeText } from "./logic";

// The Web Worker of "Add Page Numbers to PDF" (ADR 0051, ADR 0057). pdf-lib counts the pages when
// a PDF is opened, then draws each number in Helvetica, one of the 14 standard PDF fonts, so no
// font file is embedded or fetched. The rest of every page is left as it was.

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
  try {
    const font = await document.embedFont(StandardFonts.Helvetica);
    const all = document.getPages();
    for (const stamp of job.stamps) {
      signal.throwIfAborted();
      const page = all[stamp.page - 1];
      if (!page) continue;
      const box = page.getCropBox();
      const place = placeText(
        { ...box, rotation: page.getRotation().angle },
        job.position,
        font.widthOfTextAtSize(stamp.text, job.fontSize),
        job.fontSize,
        job.margin,
      );
      page.drawText(stamp.text, {
        x: place.x,
        y: place.y,
        size: job.fontSize,
        font,
        color: rgb(0, 0, 0),
        rotate: degrees(place.rotate),
      });
    }
    const bytes = await document.save();
    return {
      kind: "number",
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    };
  } catch (caught) {
    if (signal.aborted) throw caught;
    throw new ToolError(MESSAGES.failed);
  }
});

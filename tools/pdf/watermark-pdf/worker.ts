import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { type Job, type JobResult, MESSAGES, placements } from "./logic";

// The Web Worker of "Watermark PDF" (ADR 0051, ADR 0057). pdf-lib counts the pages when a PDF is
// opened, then draws the text on each chosen page in Helvetica Bold, one of the 14 standard PDF
// fonts, so no font file is embedded or fetched. The text is drawn over the page's content with
// the chosen opacity; nothing already on the page is changed.

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
  const { plan } = job;
  let copies = 0;
  try {
    const font = await document.embedFont(StandardFonts.HelveticaBold);
    const width = font.widthOfTextAtSize(plan.text, plan.fontSize);
    const all = document.getPages();
    for (const number of plan.pages) {
      signal.throwIfAborted();
      const page = all[number - 1];
      if (!page) continue;
      const box = { ...page.getCropBox(), rotation: page.getRotation().angle };
      for (const place of placements(box, plan.layout, plan.angle, width, plan.fontSize)) {
        page.drawText(plan.text, {
          x: place.x,
          y: place.y,
          size: plan.fontSize,
          font,
          color: rgb(...plan.rgb),
          opacity: plan.opacity,
          rotate: degrees(place.rotate),
        });
        copies++;
      }
    }
    const bytes = await document.save();
    return {
      kind: "watermark",
      blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
      copies,
    };
  } catch (caught) {
    if (signal.aborted) throw caught;
    throw new ToolError(MESSAGES.failed);
  }
});

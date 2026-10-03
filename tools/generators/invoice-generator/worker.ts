import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { check, type Job, type JobResult, layout, MESSAGES, PAGE } from "./logic";

// The Web Worker of "Invoice Generator" (ADR 0051, ADR 0057). pdf-lib loads with this worker, so its
// code is fetched only when the visitor asks for the PDF. The totals come from logic.ts, worked out
// in whole cents; this file only draws what layout() places, in the standard Helvetica fonts.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const checked = check(job);
  if (!checked.ok) {
    throw new ToolError(checked.problems[0] ?? Object.values(checked.errors)[0] ?? MESSAGES.failed);
  }
  progress({ done: 0, total: 2, stage: "Laying out" });
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pages = layout(job, checked.totals, (text, size, isBold) =>
    (isBold ? bold : regular).widthOfTextAtSize(text, size),
  );
  const ink = rgb(0.1, 0.1, 0.1);
  for (const marks of pages) {
    signal.throwIfAborted();
    const page = document.addPage([PAGE.width, PAGE.height]);
    for (const mark of marks) {
      if (mark.kind === "rule") {
        page.drawLine({
          start: { x: mark.x1, y: mark.y },
          end: { x: mark.x2, y: mark.y },
          thickness: 0.75,
          color: ink,
        });
      } else {
        page.drawText(mark.text, {
          x: mark.x,
          y: mark.y,
          size: mark.size,
          font: mark.bold ? bold : regular,
          color: ink,
        });
      }
    }
  }
  document.setTitle(`Invoice ${job.number.trim()}`);
  document.setCreator("NetworksInsights Invoice Generator");
  progress({ done: 1, total: 2, stage: "Saving" });
  const saved = await document.save();
  progress({ done: 2, total: 2 });
  return {
    blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    pages: document.getPageCount(),
  };
});

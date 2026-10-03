import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { check, type Job, type JobResult, layout, MESSAGES, PAPERS } from "./logic";

// The Web Worker of "Resume Builder" (ADR 0051, ADR 0057). pdf-lib loads with this worker, so its
// code is fetched only when the visitor asks for the PDF. Helvetica and Helvetica Bold are PDF
// standard fonts: nothing is embedded, and the text stays real, selectable text.

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  const problems = check(job);
  if (problems.length > 0) throw new ToolError(problems.join(" "));
  progress({ done: 0, total: 2, stage: "Laying out" });
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pages = layout(job, job.paper, (text, size, isBold) =>
    (isBold ? bold : regular).widthOfTextAtSize(text, size),
  );
  const paper = PAPERS[job.paper];
  const ink = rgb(0.1, 0.1, 0.1);
  try {
    for (const lines of pages) {
      signal.throwIfAborted();
      const page = document.addPage([paper.width, paper.height]);
      for (const line of lines) {
        page.drawText(line.text, {
          x: line.x,
          y: line.y,
          size: line.size,
          font: line.bold ? bold : regular,
          color: ink,
        });
      }
    }
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    throw new ToolError(MESSAGES.failed);
  }
  document.setTitle(`${job.name.trim()} resume`);
  document.setCreator("NetworksInsights Resume Builder");
  progress({ done: 1, total: 2, stage: "Saving" });
  const saved = await document.save();
  progress({ done: 2, total: 2 });
  return {
    blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    pages: document.getPageCount(),
  };
});

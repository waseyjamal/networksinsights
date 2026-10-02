import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { degrees, PDFDocument } from "pdf-lib";
import {
  checkPage,
  type Job,
  type JobResult,
  MESSAGES,
  placeOnPage,
  seenSize,
  signatureBox,
} from "./logic";

// The Web Worker of "Sign PDF" (ADR 0051, ADR 0057). pdf-lib counts the pages when a PDF is
// opened; then it puts the signature picture, made on the page, on the chosen page, upright as the
// page is seen, and saves the file. pdf-lib loads with this worker, so its code is fetched only
// once the visitor chooses a PDF. The result is a visual signature, not a digital certificate.

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
  const pages = document.getPageCount();
  if (job.kind === "count") return { kind: "count", pages };
  const problem = checkPage(job.page, pages);
  if (problem) throw new ToolError(problem);
  signal.throwIfAborted();

  const target = document.getPage(job.page - 1);
  const own = target.getSize();
  const rotation = target.getRotation().angle;
  const box = signatureBox(
    seenSize(own.width, own.height, rotation),
    job.size,
    job.position,
    job.width,
  );
  const place = placeOnPage(box, own, rotation);
  let image: Awaited<ReturnType<PDFDocument["embedPng"]>>;
  try {
    image = await document.embedPng(job.png);
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
  target.drawImage(image, {
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    rotate: degrees(place.rotate),
  });
  const bytes = await document.save();
  return {
    kind: "sign",
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
  };
});

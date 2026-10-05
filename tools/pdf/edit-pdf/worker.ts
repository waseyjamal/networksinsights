import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  degrees,
  LineCapStyle,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist";
// @ts-expect-error: pdfjs-dist ships no type declarations for its worker module.
import * as pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import {
  COLORS,
  checkPages,
  checkText,
  type Font,
  HIGHLIGHT,
  type Item,
  type Job,
  type JobResult,
  MESSAGES,
  type PageGeometry,
  PDFJS_ASSETS,
  PEN_WIDTH,
  type Picture,
  previewSize,
  textLines,
  toPdfBox,
  toPdfPoint,
} from "./logic";

// The Web Worker of "Edit PDF" (ADR 0051, ADR 0057). Opening a PDF checks it with pdf-lib (no
// encryption, a page count within the limit), then PDF.js keeps it open to draw one page at a
// time on an OffscreenCanvas, never larger than the preview limit. Saving loads the original
// again with pdf-lib and draws the visitor's items on top of each page's own content: nothing in
// the PDF is removed or changed. A PDF's own scripts never run (`isEvalSupported: false`).

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** Canvases for PDF.js, with no document. */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target: { canvas: OffscreenCanvas | null }, width: number, height: number) {
    if (!target.canvas) throw new Error("Canvas is not specified");
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }) {
    if (target.canvas) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    }
    target.canvas = null;
    target.context = null;
  }
}

/** No SVG filters in a worker: PDF.js then draws without them, as it does in Node. */
class NoFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  destroy() {}
}

/** The PDF being edited, kept open between jobs so each page is drawn without reading it again. */
let current: { task: PDFDocumentLoadingTask; document: PDFDocumentProxy } | null = null;

async function load(bytes: ArrayBuffer): Promise<PDFDocument> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new ToolError(MESSAGES.unreadable);
  }
  if (document.isEncrypted) throw new ToolError(MESSAGES.encrypted);
  return document;
}

async function open(file: Blob): Promise<number> {
  if (current) {
    await current.task.destroy();
    current = null;
  }
  const bytes = await file.arrayBuffer();
  let pages: number;
  try {
    pages = (await load(bytes.slice(0))).getPageCount();
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.unreadable);
  }
  const problem = checkPages(pages);
  if (problem) throw new ToolError(problem);
  const base = new URL(PDFJS_ASSETS, self.location.origin).href;
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: true,
    useWorkerFetch: true,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    verbosity: 0,
  } as Parameters<typeof getDocument>[0]);
  try {
    current = { task, document: await task.promise };
  } catch (caught) {
    await task.destroy();
    if ((caught as { name?: string }).name === "PasswordException")
      throw new ToolError(MESSAGES.encrypted);
    throw new ToolError(MESSAGES.unreadable);
  }
  return pages;
}

async function render(number: number) {
  if (!current) throw new ToolError(MESSAGES.renderFailed);
  const page = await current.document.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const size = previewSize(base.width, base.height);
    const viewport = page.getViewport({
      scale: Math.min(size.width / base.width, size.height / base.height),
    });
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    if (!context) throw new ToolError(MESSAGES.renderFailed);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "#ffffff",
    }).promise;
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    canvas.width = 0;
    canvas.height = 0;
    return {
      page: number,
      blob,
      seenWidth: base.width,
      seenHeight: base.height,
      pixelWidth: size.width,
      pixelHeight: size.height,
    };
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.renderFailed);
  } finally {
    page.cleanup();
  }
}

function geometry(page: PDFPage): PageGeometry {
  const box = page.getCropBox();
  return { ...box, rotation: page.getRotation().angle };
}

const color = (values: readonly number[]) => rgb(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);

async function save(job: Extract<Job, { kind: "save" }>): Promise<Blob> {
  for (const item of job.items) {
    if (item.kind !== "text") continue;
    const problem = checkText(item.text);
    if (problem) throw new ToolError(problem);
  }
  const document = await load(await job.file.arrayBuffer());
  const fonts = new Map<Font, PDFFont>();
  const font = async (name: Font) => {
    const known = fonts.get(name);
    if (known) return known;
    const standard = {
      helvetica: StandardFonts.Helvetica,
      times: StandardFonts.TimesRoman,
      courier: StandardFonts.Courier,
    }[name];
    const embedded = await document.embedFont(standard);
    fonts.set(name, embedded);
    return embedded;
  };
  const images = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  const picture = async (id: string) => {
    const known = images.get(id);
    if (known) return known;
    const found = job.pictures.find((entry: Picture) => entry.id === id);
    if (!found) throw new ToolError(MESSAGES.failed);
    const embedded =
      found.type === "png"
        ? await document.embedPng(found.bytes)
        : await document.embedJpg(found.bytes);
    images.set(id, embedded);
    return embedded;
  };

  for (const item of job.items as Item[]) {
    const page = document.getPage(item.page - 1);
    const where = geometry(page);
    if (item.kind === "text") {
      const chosen = await font(item.font);
      for (const line of textLines(item, where)) {
        if (line.line === "") continue;
        page.drawText(line.line, {
          x: line.x,
          y: line.y,
          size: item.size,
          font: chosen,
          color: color(COLORS[item.color].rgb),
          rotate: degrees(line.rotate),
        });
      }
    } else if (item.kind === "image") {
      const box = toPdfBox(item.box, where);
      page.drawImage(await picture(item.imageId), { ...box, rotate: degrees(box.rotate) });
    } else if (item.kind === "highlight" || item.kind === "whitebox") {
      const box = toPdfBox(item.box, where);
      page.drawRectangle({
        ...box,
        rotate: degrees(box.rotate),
        color: item.kind === "highlight" ? color(HIGHLIGHT.rgb) : rgb(1, 1, 1),
        opacity: item.kind === "highlight" ? HIGHLIGHT.opacity : 1,
        borderWidth: 0,
      });
    } else {
      const ink = color(COLORS[item.color].rgb);
      for (const stroke of item.strokes) {
        const points = stroke.map((point) => toPdfPoint(point.x, point.y, where));
        const first = points[0];
        if (!first) continue;
        if (points.length === 1) {
          page.drawCircle({ x: first.x, y: first.y, size: PEN_WIDTH / 2, color: ink });
          continue;
        }
        for (let index = 1; index < points.length; index++) {
          const start = points[index - 1];
          const end = points[index];
          if (!start || !end) continue;
          page.drawLine({
            start,
            end,
            thickness: PEN_WIDTH,
            color: ink,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    }
  }
  const bytes = await document.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
}

defineWorker<Job, JobResult>(async (job) => {
  if (job.kind === "open") return { kind: "open", pages: await open(job.file) };
  if (job.kind === "render") return { kind: "render", view: await render(job.page) };
  try {
    return { kind: "save", blob: await save(job) };
  } catch (caught) {
    throw caught instanceof ToolError ? caught : new ToolError(MESSAGES.failed);
  }
});

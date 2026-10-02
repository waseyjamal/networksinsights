// Small, real PDF files written here, byte by byte, so no binary fixture (and no licence question)
// is kept in the repository. Each page says "Page N" in Helvetica, so a test can tell the pages
// apart after merging, splitting or rotating. The cross-reference table holds the true offsets,
// so any reader opens them without repair. pdfPages() reads a result back with pdf-lib, the library
// the tools use, from the tools package.

import { PDFDict, PDFDocument, PDFName } from "../../../../tools/node_modules/pdf-lib/cjs/index.js";

export interface TestPdf {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface TestPdfOptions {
  /** Page width and height in points (1/72 inch). Default 300 by 400. */
  size?: [number, number];
  /** Extra bytes in an unused stream, to make a file of an exact size. */
  padding?: number;
  /** Marks the file as password protected (a Standard security handler in the trailer). */
  encrypted?: boolean;
  /** The label on each page, before its number. Default "Page". */
  label?: string;
  /** Every page shown turned by this many degrees clockwise (/Rotate). */
  rotate?: 0 | 90 | 180 | 270;
}

/** A PDF of `pages` pages. */
export function makeTestPdf(name: string, pages: number, options: TestPdfOptions = {}): TestPdf {
  const [width, height] = options.size ?? [300, 400];
  const label = options.label ?? "Page";
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then two objects a page: the page and its content.
  const firstPage = 4;
  for (let i = 0; i < pages; i++) pageIds.push(firstPage + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let i = 0; i < pages; i++) {
    const id = firstPage + i * 2;
    const text = `BT /F1 36 Tf 40 ${height / 2} Td (${label} ${i + 1}) Tj ET`;
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Rotate ${options.rotate ?? 0} ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${text.length} >>\nstream\n${text}\nendstream`;
  }
  let next = firstPage + pages * 2;
  let encryptId = 0;
  if (options.encrypted) {
    encryptId = next++;
    const key = "0".repeat(64);
    objects[encryptId] = `<< /Filter /Standard /V 1 /R 2 /O <${key}> /U <${key}> /P -44 >>`;
  }

  const head = "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n";
  const parts: Buffer[] = [Buffer.from(head, "latin1")];
  let offset = parts[0]?.length ?? 0;
  const offsets: number[] = [];
  const write = (chunk: Buffer) => {
    parts.push(chunk);
    offset += chunk.length;
  };
  for (let id = 1; id < next; id++) {
    offsets[id] = offset;
    write(Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, "latin1"));
  }

  const trailerFor = (count: number, startxref: number) =>
    Buffer.from(
      `trailer\n<< /Size ${count} /Root 1 0 R${encryptId ? ` /Encrypt ${encryptId} 0 R /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]` : ""} >>\nstartxref\n${startxref}\n%%EOF\n`,
      "latin1",
    );
  const xrefFor = (count: number) => {
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let id = 1; id < count; id++) {
      table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    }
    return Buffer.from(table, "latin1");
  };

  if (options.padding !== undefined) {
    // An unused stream of zeros, sized so the whole file is exactly as long as asked.
    const id = next++;
    offsets[id] = offset;
    const open = Buffer.from(`${id} 0 obj\n<< /Length LENGTH >>\nstream\n`, "latin1");
    const close = Buffer.from("\nendstream\nendobj\n", "latin1");
    const header = (length: number) =>
      Buffer.from(open.toString("latin1").replace("LENGTH", String(length)), "latin1");
    // The file size depends on the digits of the length and of startxref: settle both.
    let length = 0;
    for (let tries = 0; tries < 8; tries++) {
      const startxref = offset + header(length).length + length + close.length;
      const rest = xrefFor(next).length + trailerFor(next, startxref).length;
      length = options.padding - (startxref - length) - rest;
    }
    if (length < 0) throw new Error("padding too small for this PDF");
    write(header(length));
    write(Buffer.alloc(length));
    write(close);
  }
  const startxref = offset;
  write(xrefFor(next));
  write(trailerFor(next, startxref));
  const buffer = Buffer.concat(parts);
  if (options.padding !== undefined && buffer.length !== options.padding) {
    throw new Error(`padded PDF is ${buffer.length} bytes, not ${options.padding}`);
  }
  return { name, mimeType: "application/pdf", buffer };
}

export interface PageFacts {
  width: number;
  height: number;
  rotation: number;
}

/** The size and rotation of every page of a PDF, in order. */
export async function pdfPages(buffer: Buffer | Uint8Array): Promise<PageFacts[]> {
  const document = await PDFDocument.load(buffer);
  return document.getPages().map((page) => {
    const { width, height } = page.getSize();
    return {
      width: Math.round(width),
      height: Math.round(height),
      rotation: page.getRotation().angle,
    };
  });
}

/** How many pictures (image XObjects) each page of a PDF draws from, in order. */
export async function pdfImageCounts(buffer: Buffer | Uint8Array): Promise<number[]> {
  const document = await PDFDocument.load(buffer);
  return document.getPages().map((page) => {
    const xObjects = page.node.Resources()?.lookup(PDFName.of("XObject"));
    return xObjects instanceof PDFDict ? xObjects.keys().length : 0;
  });
}

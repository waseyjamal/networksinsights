// Small, real PDF files written here, byte by byte, so no binary fixture (and no licence question)
// is kept in the repository. Each page says "Page N" in Helvetica, so a test can tell the pages
// apart after merging, splitting or rotating. The cross-reference table holds the true offsets,
// so any reader opens them without repair. pdfPages() reads a result back with pdf-lib, the library
// the tools use, from the tools package.

import { createHash } from "node:crypto";
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
  /**
   * Really encrypts the file (RC4, 40 bits, revision 2) with this owner password and an empty user
   * password, so any reader opens it without asking: it is protected only against changes.
   */
  ownerPassword?: string;
  /** The label on each page, before its number. Default "Page". */
  label?: string;
  /** Every page shown turned by this many degrees clockwise (/Rotate). */
  rotate?: 0 | 90 | 180 | 270;
}

/** The first part of the file identifier in the trailer, which encryption keys depend on. */
const FILE_ID = Uint8Array.from([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

/** The 32 bytes a PDF password is padded with (PDF 1.7, 7.6.3.3). */
const PASSWORD_PADDING = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const md5 = (...parts: Uint8Array[]) => {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
};

function padded(password: string): Uint8Array {
  const bytes = Buffer.from(password, "latin1").subarray(0, 32);
  const out = new Uint8Array(32);
  out.set(bytes);
  out.set(PASSWORD_PADDING.subarray(0, 32 - bytes.length), bytes.length);
  return out;
}

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (state[i] ?? 0) + (key[i % key.length] ?? 0)) & 0xff;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + (state[i] ?? 0)) & 0xff;
    [state[i], state[j]] = [state[j] ?? 0, state[i] ?? 0];
    out[n] = (data[n] ?? 0) ^ (state[((state[i] ?? 0) + (state[j] ?? 0)) & 0xff] ?? 0);
  }
  return out;
}

/** The O and U entries and the file key of revision 2, with an empty user password. */
function standardSecurity(ownerPassword: string, id: Uint8Array, permissions: number) {
  const owner = rc4(md5(padded(ownerPassword)).subarray(0, 5), padded(""));
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, permissions, true);
  const key = md5(padded(""), owner, p, id).subarray(0, 5);
  return { owner, user: rc4(key, PASSWORD_PADDING), key };
}

/** The RC4 key of one object (PDF 1.7, 7.6.2, algorithm 1). */
function objectKey(fileKey: Uint8Array, id: number): Uint8Array {
  const salt = Uint8Array.from([id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, 0, 0]);
  return md5(fileKey, salt).subarray(0, Math.min(fileKey.length + 5, 16));
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
  if (options.ownerPassword !== undefined) {
    encryptId = next++;
    const security = standardSecurity(options.ownerPassword, FILE_ID, -44);
    objects[encryptId] =
      `<< /Filter /Standard /V 1 /R 2 /O <${hex(security.owner)}> /U <${hex(security.user)}> /P -44 >>`;
    for (let i = 0; i < pages; i++) {
      const id = firstPage + i * 2 + 1;
      const text = `BT /F1 36 Tf 40 ${height / 2} Td (${label} ${i + 1}) Tj ET`;
      const sealed = rc4(objectKey(security.key, id), Buffer.from(text, "latin1"));
      objects[id] =
        `<< /Length ${sealed.length} >>\nstream\n${Buffer.from(sealed).toString("latin1")}\nendstream`;
    }
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
      `trailer\n<< /Size ${count} /Root 1 0 R${encryptId ? ` /Encrypt ${encryptId} 0 R /ID [<${hex(FILE_ID)}> <${hex(FILE_ID)}>]` : ""} >>\nstartxref\n${startxref}\n%%EOF\n`,
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

/** The text of every page of a PDF, as PDF.js reads it (the legacy build runs in Node). */
export async function pdfTexts(buffer: Buffer | Uint8Array): Promise<string[]> {
  const pdfjs = await import("../../../../tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  try {
    const document = await task.promise;
    const texts: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      texts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
    }
    return texts;
  } finally {
    await task.destroy();
  }
}

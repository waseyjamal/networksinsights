import {
  Alert,
  Button,
  DrawPad,
  type DrawPadHandle,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  Select,
  saveFile,
} from "@ui";
import { useRef, useState } from "react";
import {
  checkPage,
  checkPdf,
  checkPicture,
  formatSize,
  inkBox,
  LIMITS,
  MESSAGES,
  outputName,
  POSITIONS,
  type Position,
  parseNumber,
  placeOnPage,
  SOURCES,
  type Source,
  seenSize,
  signatureBox,
  WIDTHS,
  type Width,
} from "./logic";

// The workspace of Sign PDF. The signature is drawn on the DrawPad, typed and drawn as text, or
// uploaded; it becomes a PNG on a transparent background. pdf-lib, imported when the visitor
// chooses a PDF, puts that picture on the chosen page (ADR 0057). It is a visual signature only.

type PdfLib = typeof import("pdf-lib");

interface Pdf {
  file: File;
  bytes: ArrayBuffer;
  pages: number;
}

interface Output {
  blob: Blob;
  name: string;
  page: number;
}

/** A message of this tool, never a library's own words. */
class Refusal extends Error {}

async function load(lib: PdfLib, bytes: ArrayBuffer) {
  let document: Awaited<ReturnType<PdfLib["PDFDocument"]["load"]>>;
  let pages: number;
  try {
    document = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (document.isEncrypted) throw new Refusal(MESSAGES.encrypted);
    pages = document.getPageCount();
  } catch (caught) {
    throw caught instanceof Refusal ? caught : new Refusal(MESSAGES.unreadable);
  }
  if (pages === 0) throw new Refusal(MESSAGES.noPages);
  return document;
}

/** A canvas cut down to its ink, as PNG bytes and size, or nothing when it is empty. */
async function trimmed(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) return;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const box = inkBox(pixels.data, canvas.width, canvas.height);
  if (!box) return;
  const out = document.createElement("canvas");
  out.width = box.width;
  out.height = box.height;
  out
    .getContext("2d")
    ?.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) return;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: box.width, height: box.height };
}

/** Typed text drawn as a signature: the site's font, slanted, in black on transparent. */
function typedCanvas(text: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const font = `italic 96px ${family}`;
  const measure = canvas.getContext("2d");
  if (measure) measure.font = font;
  canvas.width = Math.ceil((measure?.measureText(text).width ?? 400) + 40);
  canvas.height = 140;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = font;
    context.fillStyle = "#000000";
    context.textBaseline = "middle";
    context.fillText(text, 20, 70);
  }
  return canvas;
}

/** An uploaded picture on a canvas, upright. */
async function pictureCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export default function ToolUi() {
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [pdfError, setPdfError] = useState("");
  const [source, setSource] = useState<Source>("draw");
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState("");
  const [picture, setPicture] = useState<File | null>(null);
  const [pictureError, setPictureError] = useState("");
  const [pageText, setPageText] = useState("1");
  const [position, setPosition] = useState<Position>("bottom-right");
  const [width, setWidth] = useState<Width>("30");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const pad = useRef<DrawPadHandle>(null);

  const openPdf = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    setError("");
    const problem = checkPdf(file);
    if (problem) {
      setPdfError(`${file.name}: ${problem}`);
      return;
    }
    setBusy(true);
    try {
      const lib = await import("pdf-lib");
      const bytes = await file.arrayBuffer();
      const document = await load(lib, bytes.slice(0));
      setPdf({ file, bytes, pages: document.getPageCount() });
      setPageText(String(document.getPageCount()));
      setPdfError("");
    } catch (caught) {
      setPdf(null);
      setPdfError(
        `${file.name}: ${caught instanceof Refusal ? caught.message : MESSAGES.unreadable}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const choosePicture = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    const problem = checkPicture(file);
    setPictureError(problem ? `${file.name}: ${problem}` : "");
    setPicture(problem ? null : file);
  };

  /** The signature as a trimmed PNG, from whichever source is chosen. */
  const signature = async () => {
    if (source === "draw") {
      const canvas = pad.current?.canvas;
      return canvas && hasInk ? trimmed(canvas) : undefined;
    }
    if (source === "type") return typed.trim() ? trimmed(typedCanvas(typed.trim())) : undefined;
    if (!picture) return;
    let canvas: HTMLCanvasElement;
    try {
      canvas = await pictureCanvas(picture);
    } catch {
      throw new Refusal(MESSAGES.pictureUnreadable);
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    };
  };

  const sign = async () => {
    if (!pdf) return;
    setOutput(null);
    const page = parseNumber(pageText);
    const pageProblem = checkPage(page, pdf.pages);
    if (pageProblem || page === undefined) {
      setError(pageProblem ?? MESSAGES.page(pdf.pages));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const mark = await signature();
      if (!mark) throw new Refusal(MESSAGES.noSignature);
      const lib = await import("pdf-lib");
      const document = await load(lib, pdf.bytes.slice(0));
      const target = document.getPage(page - 1);
      const own = target.getSize();
      const rotation = target.getRotation().angle;
      const seen = seenSize(own.width, own.height, rotation);
      const box = signatureBox(seen, mark, position, width);
      const place = placeOnPage(box, own, rotation);
      const image = await document.embedPng(mark.bytes);
      target.drawImage(image, {
        x: place.x,
        y: place.y,
        width: place.width,
        height: place.height,
        rotate: lib.degrees(place.rotate),
      });
      const bytes = await document.save();
      setOutput({
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
        name: outputName(pdf.file.name),
        page,
      });
    } catch (caught) {
      setError(caught instanceof Refusal ? caught.message : MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Alert tone="info" title="A visual signature only">
        Sign PDF places a picture of your signature on the page. It is not a certificate-based
        digital signature: it does not prove who signed, and it does not stop later changes to the
        file.
      </Alert>

      <Dropzone
        id="sign-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop the PDF to sign here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void openPdf(files)}
      />
      {pdfError && (
        <Alert tone="warning" title="This file was not opened">
          {pdfError}
        </Alert>
      )}

      {pdf && (
        <>
          <p className="text-sm text-fg-muted" id="sign-pdf-original">
            {pdf.file.name}: {pdf.pages} {pdf.pages === 1 ? "page" : "pages"},{" "}
            {formatSize(pdf.file.size)}
          </p>

          <Select
            id="sign-pdf-source"
            label="Your signature"
            value={source}
            onChange={(event) => {
              setSource(event.target.value as Source);
              setError("");
            }}
          >
            {(Object.keys(SOURCES) as Source[]).map((key) => (
              <option key={key} value={key}>
                {SOURCES[key]}
              </option>
            ))}
          </Select>

          {source === "draw" && (
            <div className="grid gap-2">
              <DrawPad
                id="sign-pdf-pad"
                label="Draw your signature"
                hint="Use a mouse, a finger or a pen. No keyboard? Choose Type it or Upload a picture."
                handle={pad}
                onChange={setHasInk}
              />
              <div>
                <Button size="sm" variant="secondary" onClick={() => pad.current?.clear()}>
                  Clear the drawing
                </Button>
              </div>
            </div>
          )}
          {source === "type" && (
            <Input
              id="sign-pdf-typed"
              label="Type your name"
              hint="It is drawn in a slanted style in black."
              maxLength={60}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
          {source === "upload" && (
            <>
              <Dropzone
                id="sign-pdf-picture"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                multiple={false}
                title={picture ? `Chosen: ${picture.name}` : "Drop a picture of your signature"}
                hint="PNG or JPG, up to 5 MB. A PNG with a transparent background looks best."
                onFiles={choosePicture}
              />
              {pictureError && (
                <p className="text-sm text-danger-text" role="alert">
                  {pictureError}
                </p>
              )}
            </>
          )}

          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Input
              id="sign-pdf-page"
              label="Page"
              hint={`1 to ${pdf.pages}`}
              inputMode="numeric"
              value={pageText}
              onChange={(event) => setPageText(event.target.value)}
            />
            <Select
              id="sign-pdf-position"
              label="Place"
              value={position}
              onChange={(event) => setPosition(event.target.value as Position)}
            >
              {(Object.keys(POSITIONS) as Position[]).map((key) => (
                <option key={key} value={key}>
                  {POSITIONS[key]}
                </option>
              ))}
            </Select>
            <Select
              id="sign-pdf-width"
              label="Size"
              value={width}
              onChange={(event) => setWidth(event.target.value as Width)}
            >
              {(Object.keys(WIDTHS) as Width[]).map((key) => (
                <option key={key} value={key}>
                  {WIDTHS[key]}
                </option>
              ))}
            </Select>
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void sign()}>
              Add signature
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Signed PDF">
          <FileResult
            name={output.name}
            meta={`Signature on page ${output.page}, ${formatSize(output.blob.size)}`}
            state="done"
            icon="pdf"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "application/pdf" })}
              >
                Download
              </Button>
            }
          />
        </FileResultList>
      )}
    </>
  );
}

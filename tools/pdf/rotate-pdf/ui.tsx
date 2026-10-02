import { Alert, Button, Dropzone, FileResult, FileResultList, Input, Select, saveFile } from "@ui";
import { useState } from "react";
import {
  allPages,
  checkFile,
  formatSize,
  LIMITS,
  MESSAGES,
  outputName,
  pagesLabel,
  parsePages,
  TURNS,
  type Turn,
  turned,
  type Which,
} from "./logic";

// The workspace of Rotate PDF. Turning a page only changes a number in the PDF, so the job is
// light and runs on this page; pdf-lib is imported when the visitor chooses a PDF, so its code is
// not part of the page load (ADR 0057).

type PdfLib = typeof import("pdf-lib");

interface Source {
  file: File;
  bytes: ArrayBuffer;
  pages: number;
}

interface Output {
  blob: Blob;
  name: string;
  turnedPages: number;
}

/** A message of this tool, never a library's own words. */
class Refusal extends Error {}

/** Opens a PDF with pdf-lib, refusing what it cannot work on with a message for the visitor. */
async function load(lib: PdfLib, bytes: ArrayBuffer) {
  let document: Awaited<ReturnType<PdfLib["PDFDocument"]["load"]>>;
  let pages: number;
  try {
    document = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (document.isEncrypted) throw new Refusal(MESSAGES.encrypted);
    // A damaged file can load and still have no page tree: counting the pages finds out.
    pages = document.getPageCount();
  } catch (caught) {
    throw caught instanceof Refusal ? caught : new Refusal(MESSAGES.unreadable);
  }
  if (pages === 0) throw new Refusal(MESSAGES.noPages);
  return document;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [turn, setTurn] = useState<Turn>("90");
  const [which, setWhich] = useState<Which>("all");
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setBusy(true);
    try {
      const lib = await import("pdf-lib");
      const bytes = await file.arrayBuffer();
      const document = await load(lib, bytes.slice(0));
      setSource({ file, bytes, pages: document.getPageCount() });
      setFileError("");
    } catch (caught) {
      setSource(null);
      setFileError(
        `${file.name}: ${caught instanceof Refusal ? caught.message : MESSAGES.unreadable}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!source) return;
    setOutput(null);
    let pages = allPages(source.pages);
    if (which === "chosen") {
      const parsed = parsePages(chosen, source.pages);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      pages = parsed.pages;
    }
    setError("");
    setBusy(true);
    try {
      const lib = await import("pdf-lib");
      const document = await load(lib, source.bytes.slice(0));
      const all = document.getPages();
      for (const number of pages) {
        const page = all[number - 1];
        if (page) page.setRotation(lib.degrees(turned(page.getRotation().angle, turn)));
      }
      const bytes = await document.save();
      setOutput({
        blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
        name: outputName(source.file.name),
        turnedPages: pages.length,
      });
    } catch (caught) {
      setError(caught instanceof Refusal ? caught.message : MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="rotate-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="rotate-pdf-original">
            {source.file.name}: {pagesLabel(source.pages)}, {formatSize(source.file.size)}
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Select
              id="rotate-pdf-turn"
              label="Turn"
              value={turn}
              onChange={(event) => setTurn(event.target.value as Turn)}
            >
              {(Object.keys(TURNS) as Turn[]).map((key) => (
                <option key={key} value={key}>
                  {TURNS[key]}
                </option>
              ))}
            </Select>
            <Select
              id="rotate-pdf-which"
              label="Pages"
              value={which}
              onChange={(event) => {
                setWhich(event.target.value as Which);
                setError("");
              }}
            >
              <option value="all">All pages</option>
              <option value="chosen">Only the pages I choose</option>
            </Select>
          </div>
          {which === "chosen" && (
            <Input
              id="rotate-pdf-pages"
              label="Pages to turn"
              hint="For example 1, 3-4, or 7- for page 7 to the end"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            />
          )}
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void rotate()}>
              Rotate
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
        <FileResultList label="Rotated PDF">
          <FileResult
            name={output.name}
            meta={`${pagesLabel(output.turnedPages)} turned, ${formatSize(output.blob.size)}`}
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

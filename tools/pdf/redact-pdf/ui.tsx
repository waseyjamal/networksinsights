import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  PageCanvas,
  type PageCanvasItem,
  Progress,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  type Box,
  boxFrom,
  checkBoxes,
  checkFile,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  moveBox,
  outputName,
  redactedPages,
} from "./logic";

// The workspace of Redact PDF. Choosing a PDF starts worker.ts, which counts its pages and draws
// one page at a time as a preview; the visitor drags boxes over it with PageCanvas, as fractions
// of the page. Redact sends the boxes to the worker, which burns them into pictures of those pages
// and builds the new PDF. PDF.js and pdf-lib load only with the worker (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const expected = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

interface Shown {
  page: number;
  url: string;
  ratio: number;
}

interface Output {
  blob: Blob;
  name: string;
  redacted: number[];
  pages: number;
}

export default function ToolUi() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(0);
  const [pageNo, setPageNo] = useState(1);
  const [shown, setShown] = useState<Shown | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"draw" | "select">("draw");
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const nextId = useRef(1);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(
    () => () => {
      if (shownRef.current) URL.revokeObjectURL(shownRef.current.url);
    },
    [],
  );

  const show = async (page: number) => {
    try {
      const result = await client.run({ kind: "render", page });
      if (result.kind !== "render") return;
      if (shownRef.current) URL.revokeObjectURL(shownRef.current.url);
      setShown({
        page,
        url: URL.createObjectURL(result.view.blob),
        ratio: result.view.seenWidth / result.view.seenHeight,
      });
      setPageNo(page);
    } catch (caught) {
      setError(expected(caught, MESSAGES.renderFailed));
    }
  };

  const open = async (files: File[]) => {
    const chosen = files[0];
    if (!chosen) return;
    setOutput(null);
    setError("");
    setBoxes([]);
    const problem = checkFile(chosen);
    if (problem) {
      setFile(null);
      setFileError(`${chosen.name}: ${problem}`);
      return;
    }
    try {
      const result = await client.run({ kind: "open", file: chosen });
      if (result.kind !== "open") return;
      setFileError("");
      setFile(chosen);
      setPages(result.pages);
      await show(1);
    } catch (caught) {
      setFile(null);
      setFileError(`${chosen.name}: ${expected(caught, MESSAGES.unreadable)}`);
    }
  };

  const change = (next: Box[]) => {
    setOutput(null);
    setError("");
    setBoxes(next);
  };

  const addBox = () => {
    const id = `box-${nextId.current++}`;
    setOutput(null);
    setError("");
    setBoxes((list) => [...list, { id, page: pageNo, x: 0.35, y: 0.45, width: 0.3, height: 0.1 }]);
    setSelected(id);
    setMode("select");
  };

  const redact = async () => {
    if (!file) return;
    setOutput(null);
    const problem = checkBoxes(boxes);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { kind: "redact", file, boxes },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (result.kind === "redact") {
        setOutput({
          blob: result.blob,
          name: outputName(file.name),
          redacted: result.redacted,
          pages: result.pages,
        });
      }
    } catch (caught) {
      setError(expected(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const onPage = boxes.filter((box) => box.page === pageNo);
  const items: PageCanvasItem[] = onPage.map((box, index) => ({
    id: box.id,
    label: `Black box ${index + 1} on page ${box.page}`,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    content: <span className="block h-full w-full bg-black" />,
  }));
  const marked = redactedPages(boxes);

  return (
    <>
      <Alert tone="info" title="Real redaction">
        Each page with a box becomes a picture with the box burned in, so the covered text is gone,
        and the rest of the text on that page can no longer be selected or searched. Pages without
        boxes are copied unchanged.
      </Alert>
      <Dropzone
        id="redact-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)} and ${LIMITS.maxPages} pages`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {file && shown && (
        <>
          <p className="text-sm text-fg-muted" id="redact-pdf-original">
            {file.name}: {pages} {pages === 1 ? "page" : "pages"}, {formatSize(file.size)}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={pageNo <= 1}
              onClick={() => void show(pageNo - 1)}
            >
              Previous page
            </Button>
            <span className="text-sm" id="redact-pdf-page">
              Page {pageNo} of {pages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={pageNo >= pages}
              onClick={() => void show(pageNo + 1)}
            >
              Next page
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Boxes">
            <Button
              size="sm"
              variant={mode === "draw" ? "primary" : "secondary"}
              aria-pressed={mode === "draw"}
              onClick={() => setMode("draw")}
            >
              Draw boxes
            </Button>
            <Button
              size="sm"
              variant={mode === "select" ? "primary" : "secondary"}
              aria-pressed={mode === "select"}
              onClick={() => setMode("select")}
            >
              Move boxes
            </Button>
            <Button size="sm" variant="secondary" onClick={addBox}>
              Add a box
            </Button>
            {selected && onPage.some((box) => box.id === selected) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  change(boxes.filter((box) => box.id !== selected));
                  setSelected(null);
                }}
              >
                Remove selected box
              </Button>
            )}
          </div>
          <PageCanvas
            id="redact-pdf-canvas"
            label={`Page ${pageNo}`}
            hint="In Draw boxes, drag from one corner to the other. In Move boxes, drag a box or use the arrow keys; Delete removes it."
            src={shown.url}
            aspectRatio={shown.ratio}
            items={items}
            selectedId={selected}
            mode={mode}
            onSelect={setSelected}
            onMove={(id, x, y) =>
              change(boxes.map((box) => (box.id === id ? moveBox(box, x, y) : box)))
            }
            onDelete={(id) => change(boxes.filter((box) => box.id !== id))}
            onStroke={(points) => {
              const box = boxFrom(`box-${nextId.current++}`, pageNo, points);
              if (box) change([...boxes, box]);
            }}
          />
          <p className="text-sm text-fg-muted" id="redact-pdf-summary">
            {boxes.length === 0
              ? "No boxes yet."
              : `${boxes.length} ${boxes.length === 1 ? "box" : "boxes"} on ${
                  marked.length === 1 ? "page" : "pages"
                } ${marked.join(", ")}.`}
          </p>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void redact()}>
              Redact
            </Button>
          </div>
        </>
      )}

      {busy && <Progress value={progress} label="Redacting the pages" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Redacted PDF">
          <FileResult
            name={output.name}
            meta={`${output.pages} ${output.pages === 1 ? "page" : "pages"}, ${
              output.redacted.length
            } redacted (${output.redacted.join(", ")}), ${formatSize(output.blob.size)}`}
            state="done"
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

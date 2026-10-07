import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  PageCanvas,
  type PageCanvasItem,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatMm,
  formatSize,
  type Job,
  type JobResult,
  keptArea,
  LIMITS,
  type Input as MarginText,
  MESSAGES,
  outputName,
  POINTS_PER_MM,
  pagesLabel,
  parseMargins,
  SIDES,
  type Side,
} from "./logic";

// The workspace of Crop PDF. Choosing a PDF starts worker.ts, which checks it with pdf-lib and
// draws its first page with PDF.js; the margins typed in millimetres are shown on that page with
// PageCanvas as the kept area, which can also be dragged. Crop sends the margins to the worker,
// which sets every page's boxes. The PDF code loads only with the worker (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
  url: string;
  seenWidth: number;
  seenHeight: number;
}

interface Output {
  blob: Blob;
  name: string;
  pages: number;
}

const LABELS: Record<Side, string> = {
  top: "Top (mm)",
  right: "Right (mm)",
  bottom: "Bottom (mm)",
  left: "Left (mm)",
};

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

const mm = (points: number) => String(Math.round((points / POINTS_PER_MM) * 10) / 10);

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [margins, setMargins] = useState<MarginText>({
    top: "10",
    right: "10",
    bottom: "10",
    left: "10",
  });
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(
    () => () => {
      if (sourceRef.current?.url) URL.revokeObjectURL(sourceRef.current.url);
    },
    [],
  );

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
      const result = await client.run({ kind: "open", file });
      if (result.kind !== "open") return;
      if (sourceRef.current?.url) URL.revokeObjectURL(sourceRef.current.url);
      setSource({
        file,
        pages: result.pages,
        url: result.preview.blob ? URL.createObjectURL(result.preview.blob) : "",
        seenWidth: result.preview.seenWidth,
        seenHeight: result.preview.seenHeight,
      });
      setFileError("");
    } catch (caught) {
      setSource(null);
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setBusy(false);
    }
  };

  const parsed = parseMargins(margins);
  const kept =
    source && parsed.ok ? keptArea(source.seenWidth, source.seenHeight, parsed.margins) : null;

  const crop = async () => {
    if (!source) return;
    setOutput(null);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await client.run({
        kind: "crop",
        file: source.file,
        margins: parsed.margins,
      });
      if (result.kind === "crop") {
        setOutput({ blob: result.blob, name: outputName(source.file.name), pages: result.pages });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const items: PageCanvasItem[] =
    kept && kept.width > 0 && kept.height > 0
      ? [
          {
            id: "kept",
            label: "Area to keep",
            x: kept.x,
            y: kept.y,
            width: kept.width,
            height: kept.height,
            content: <span className="block h-full w-full border-2 border-brand" />,
          },
        ]
      : [];

  return (
    <>
      <Dropzone
        id="crop-pdf-file"
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
          <p className="text-sm text-fg-muted" id="crop-pdf-original">
            {`${source.file.name}: ${pagesLabel(source.pages)}, first page ${formatMm(source.seenWidth)} × ${formatMm(source.seenHeight)}`}
          </p>
          <div className="grid items-start gap-4 grid-cols-2 sm:grid-cols-4">
            {SIDES.map((side) => (
              <Input
                key={side}
                id={`crop-pdf-${side}`}
                label={LABELS[side]}
                inputMode="decimal"
                value={margins[side]}
                onChange={(event) => setMargins({ ...margins, [side]: event.target.value })}
              />
            ))}
          </div>
          {!source.url && (
            <p className="text-sm text-fg-muted" id="crop-pdf-no-preview">
              {MESSAGES.noPreview}
            </p>
          )}
          <PageCanvas
            id="crop-pdf-canvas"
            label="First page, with the area to keep outlined"
            hint="The outlined area is kept on every page. Drag it, or focus it and use the arrow keys, to move it."
            src={source.url || undefined}
            aspectRatio={source.seenWidth / source.seenHeight}
            items={items}
            onMove={(_, x, y) => {
              if (!kept) return;
              const width = kept.width * source.seenWidth;
              const height = kept.height * source.seenHeight;
              const left = Math.min(x * source.seenWidth, source.seenWidth - width);
              const top = Math.min(y * source.seenHeight, source.seenHeight - height);
              setMargins({
                left: mm(left),
                top: mm(top),
                right: mm(Math.max(0, source.seenWidth - left - width)),
                bottom: mm(Math.max(0, source.seenHeight - top - height)),
              });
            }}
          />
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void crop()}>
              Crop
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
        <FileResultList label="Cropped PDF">
          <FileResult
            name={output.name}
            meta={`${pagesLabel(output.pages)} cropped, ${formatSize(output.blob.size)}`}
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

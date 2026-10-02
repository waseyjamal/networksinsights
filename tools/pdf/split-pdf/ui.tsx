import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useState } from "react";
import {
  checkFile,
  everyPage,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  type Mode,
  parseRanges,
  partName,
  type Range,
  rangeLabel,
} from "./logic";

// The workspace of Split PDF. Choosing a PDF starts worker.ts, which counts its pages with
// pdf-lib; Split then writes one PDF per range. The PDF code loads only when a PDF is chosen.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
}

interface Part {
  range: Range;
  blob: Blob;
  name: string;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<Mode>("ranges");
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [parts, setParts] = useState<Part[]>([]);
  const [error, setError] = useState("");

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setParts([]);
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setFileError("");
    setOpening(true);
    try {
      const result = await client.run({ kind: "count", file });
      if (result.kind === "count") setSource({ file, pages: result.pages });
    } catch (caught) {
      setSource(null);
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setOpening(false);
    }
  };

  const split = async () => {
    if (!source) return;
    setParts([]);
    let chosen: Range[];
    if (mode === "every") {
      chosen = everyPage(source.pages);
    } else {
      const parsed = parseRanges(ranges, source.pages);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      chosen = parsed.ranges;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { kind: "split", file: source.file, ranges: chosen },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (result.kind === "split") {
        setParts(
          result.parts.map((part) => ({ ...part, name: partName(source.file.name, part.range) })),
        );
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="split-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {opening && <p className="text-sm text-fg-muted">Opening the PDF…</p>}
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="split-pdf-original">
            {source.file.name}: {source.pages} {source.pages === 1 ? "page" : "pages"},{" "}
            {formatSize(source.file.size)}
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Select
              id="split-pdf-mode"
              label="Split by"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as Mode);
                setError("");
              }}
            >
              <option value="ranges">Page ranges</option>
              <option value="every">Every page</option>
            </Select>
            {mode === "ranges" && (
              <Input
                id="split-pdf-ranges"
                label="Pages"
                hint="Each range becomes its own PDF: 1-3, 5, 8- (8 to the end)"
                value={ranges}
                onChange={(event) => setRanges(event.target.value)}
              />
            )}
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void split()}>
              Split
            </Button>
          </div>
        </>
      )}

      {busy && <Progress value={progress} label="Splitting the PDF" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {parts.length > 0 && (
        <FileResultList label="Split PDFs">
          {parts.map((part) => (
            <FileResult
              key={part.name}
              name={part.name}
              meta={`${rangeLabel(part.range)}, ${formatSize(part.blob.size)}`}
              state="done"
              icon="pdf"
              actions={
                <Button
                  size="sm"
                  aria-label={`Download ${part.name}`}
                  onClick={() => saveFile(part.blob, part.name, { type: "application/pdf" })}
                >
                  Download
                </Button>
              }
            />
          ))}
        </FileResultList>
      )}
    </>
  );
}

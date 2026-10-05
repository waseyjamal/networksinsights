import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  type Job,
  type JobResult,
  LEVEL_KEYS,
  LEVELS,
  type Level,
  LIMITS,
  MESSAGES,
  outputName,
  pagesLabel,
  picturesLabel,
  savingLabel,
} from "./logic";

// The workspace of Compress PDF. Compress sends the PDF and the level to worker.ts, which loads
// PDFium (WebAssembly) on the first job and recompresses the pictures page by page (ADR 0062).
// The result is offered only when it is smaller than the original; otherwise the page says so.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const failure = (caught: unknown) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed;

export default function ToolUi() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [level, setLevel] = useState<Level>("recommended");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(JobResult & { name: string }) | null>(null);
  const [error, setError] = useState("");
  const job = useRef<AbortController | null>(null);

  const choose = (files: File[]) => {
    const chosen = files[0];
    if (!chosen) return;
    setResult(null);
    setError("");
    const problem = checkFile(chosen);
    if (problem) {
      setFile(null);
      setFileError(`${chosen.name}: ${problem}`);
      return;
    }
    setFileError("");
    setFile(chosen);
  };

  const compress = async () => {
    if (!file) return;
    const controller = new AbortController();
    job.current = controller;
    setResult(null);
    setError("");
    setProgress(0);
    setBusy(true);
    try {
      const answer = await client.run(
        { file, level },
        {
          signal: controller.signal,
          onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)),
        },
      );
      setResult({ ...answer, name: outputName(file.name) });
    } catch (caught) {
      if (!controller.signal.aborted) setError(`${file.name}: ${failure(caught)}`);
    } finally {
      setBusy(false);
    }
  };

  const images = result?.images;

  return (
    <>
      <Dropzone
        id="compress-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)} and ${LIMITS.maxPages} pages`}
        onFiles={choose}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {file && (
        <>
          <p className="text-sm text-fg-muted" id="compress-pdf-original">
            {file.name}: {formatSize(file.size)}
          </p>
          <Select
            id="compress-pdf-level"
            label="Compression"
            hint="Pictures shown at more than this resolution are made smaller. Text is never changed."
            value={level}
            disabled={busy}
            onChange={(event) => setLevel(event.target.value as Level)}
          >
            {LEVEL_KEYS.map((key) => (
              <option key={key} value={key}>
                {LEVELS[key].label}
              </option>
            ))}
          </Select>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void compress()}>
              Compress
            </Button>
            {busy && (
              <Button variant="ghost" onClick={() => job.current?.abort()}>
                Cancel
              </Button>
            )}
          </div>
          {busy && <Progress value={progress} label="Compressing pages" />}
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {result && images && (
        <p className="text-sm text-fg-muted" id="compress-pdf-summary">
          {pagesLabel(result.pages)}, {picturesLabel(images.found)} found: {images.recompressed}{" "}
          recompressed, {images.transparent} with transparency kept, {images.kept} kept as they
          were.
        </p>
      )}

      {result && !result.blob && (
        <Alert tone="info" title="Not smaller">
          {MESSAGES.notSmaller}
        </Alert>
      )}

      {result?.blob && (
        <FileResultList label="Compressed PDF">
          <FileResult
            name={result.name}
            meta={`${formatSize(result.inputBytes)} to ${formatSize(result.outputBytes)}, ${savingLabel(result.inputBytes, result.outputBytes)}`}
            state="done"
            icon="pdf"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${result.name}`}
                onClick={() => {
                  if (result.blob) saveFile(result.blob, result.name, { type: "application/pdf" });
                }}
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

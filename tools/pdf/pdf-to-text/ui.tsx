import {
  Alert,
  Button,
  Checkbox,
  createWorkerClient,
  Dropzone,
  Input,
  Progress,
  Select,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useState } from "react";
import {
  checkFile,
  countWords,
  emptyPages,
  formatSize,
  hasNoText,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  type PageText,
  pagesForRun,
  textName,
  toText,
  type Which,
} from "./logic";

// The workspace of PDF to Text. Choosing a PDF starts worker.ts, which counts its pages with
// PDF.js; Get text reads the chosen pages there and sends back each page's text. PDF.js loads only
// with the worker, after the visitor chooses a PDF (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [opening, setOpening] = useState(false);
  const [which, setWhich] = useState<Which>("all");
  const [chosen, setChosen] = useState("");
  const [markPages, setMarkPages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [read, setRead] = useState<PageText[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setRead(null);
    setError("");
    setMessage("");
    const problem = checkFile(file);
    if (problem) {
      setSource(null);
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

  const extract = async () => {
    if (!source) return;
    setRead(null);
    setMessage("");
    const run = pagesForRun(which, chosen, source.pages);
    if (!run.ok) {
      setError(run.error);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { kind: "read", file: source.file, pages: run.pages },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (result.kind === "read") setRead(result.pages);
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const text = read ? toText(read, markPages) : "";
  const blank = read ? emptyPages(read) : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Text copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it.");
    }
  };

  return (
    <>
      <Dropzone
        id="pdf-to-text-file"
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
          <p className="text-sm text-fg-muted" id="pdf-to-text-original">
            {source.file.name}: {source.pages} {source.pages === 1 ? "page" : "pages"},{" "}
            {formatSize(source.file.size)}
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Select
              id="pdf-to-text-which"
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
            {which === "chosen" && (
              <Input
                id="pdf-to-text-pages"
                label="Pages to read"
                hint="For example 1, 3-4, or 7- for page 7 to the end"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
              />
            )}
          </div>
          <Checkbox
            id="pdf-to-text-mark"
            label="Start each page with a line such as --- Page 2 ---"
            checked={markPages}
            onChange={(event) => setMarkPages(event.target.checked)}
          />
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void extract()}>
              Get text
            </Button>
          </div>
        </>
      )}

      {busy && <Progress value={progress} label="Reading the pages" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {read && source && hasNoText(read) && (
        <Alert tone="warning" title="No text found">
          {MESSAGES.noText} <a href="/ocr/">Open the OCR tool</a>.
        </Alert>
      )}

      {read && source && !hasNoText(read) && (
        <>
          <p className="text-sm text-fg-muted" id="pdf-to-text-summary">
            {read.length} {read.length === 1 ? "page" : "pages"} read, {countWords(text)} words
            {blank.length > 0 &&
              `. No text on ${blank.length === 1 ? "page" : "pages"} ${blank.join(", ")}: ${
                blank.length === 1 ? "it may be a picture" : "they may be pictures"
              }`}
            .
          </p>
          <Textarea id="pdf-to-text-result" label="Text found" readOnly rows={14} value={text} />
          <div className="ni-workspace__actions">
            <Button variant="primary" onClick={() => void copy()}>
              Copy text
            </Button>
            <Button
              onClick={() =>
                saveFile(
                  new Blob([text], { type: "text/plain;charset=utf-8" }),
                  textName(source.file.name),
                  {
                    type: "text/plain",
                  },
                )
              }
            >
              Download .txt
            </Button>
          </div>
          {message && (
            <p className="text-sm text-fg-muted" role="status">
              {message}
            </p>
          )}
        </>
      )}
    </>
  );
}

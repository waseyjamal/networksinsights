import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useState } from "react";
import {
  allPages,
  checkFile,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  pagesLabel,
  parsePages,
  TURNS,
  type Turn,
  type Which,
} from "./logic";

// The workspace of Rotate PDF. Choosing a PDF starts worker.ts, which counts its pages with
// pdf-lib; Rotate sends it the pages and the turn. The PDF code loads only with the worker, after
// the visitor chooses a PDF (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
}

interface Output {
  blob: Blob;
  name: string;
  turnedPages: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

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
      const result = await client.run({ kind: "count", file });
      if (result.kind === "count") setSource({ file, pages: result.pages });
      setFileError("");
    } catch (caught) {
      setSource(null);
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
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
      const result = await client.run({ kind: "rotate", file: source.file, pages, turn });
      if (result.kind === "rotate") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name),
          turnedPages: pages.length,
        });
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

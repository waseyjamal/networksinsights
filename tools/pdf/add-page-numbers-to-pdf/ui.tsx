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
  checkFile,
  FONT_SIZE,
  FORMATS,
  type Format,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MARGIN,
  MESSAGES,
  outputName,
  POSITIONS,
  type Position,
  pagesLabel,
  planStamps,
  type Settings,
  type Which,
} from "./logic";

// The workspace of Add Page Numbers to PDF. Choosing a PDF starts worker.ts, which counts its pages
// with pdf-lib; Add numbers sends it the numbers to draw, worked out here by planStamps. The PDF
// code loads only with the worker, after the visitor chooses a PDF (ADR 0057).

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
  numbered: number;
  first: string;
  last: string;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

const INITIAL: Settings = {
  format: "number",
  start: "1",
  firstPage: "1",
  fontSize: String(FONT_SIZE.initial),
  margin: String(MARGIN.initial),
  which: "all",
  pages: "",
};

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [position, setPosition] = useState<Position>("bottom-center");
  const [settings, setSettings] = useState<Settings>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");

  const set = (key: keyof Settings, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setError("");
  };

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

  const number = async () => {
    if (!source) return;
    setOutput(null);
    const plan = planStamps(settings, source.pages);
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await client.run({
        kind: "number",
        file: source.file,
        stamps: plan.stamps,
        position,
        fontSize: plan.fontSize,
        margin: plan.margin,
      });
      if (result.kind === "number") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name),
          numbered: plan.stamps.length,
          first: plan.stamps[0]?.text ?? "",
          last: plan.stamps.at(-1)?.text ?? "",
        });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const whole = (key: keyof Settings, label: string, hint: string) => (
    <Input
      id={`add-page-numbers-to-pdf-${key}`}
      label={label}
      hint={hint}
      inputMode="numeric"
      value={settings[key]}
      onChange={(event) => set(key, event.target.value)}
    />
  );

  return (
    <>
      <Dropzone
        id="add-page-numbers-to-pdf-file"
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
          <p className="text-sm text-fg-muted" id="add-page-numbers-to-pdf-original">
            {source.file.name}: {pagesLabel(source.pages)}, {formatSize(source.file.size)}
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Select
              id="add-page-numbers-to-pdf-position"
              label="Position"
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
              id="add-page-numbers-to-pdf-format"
              label="Format"
              value={settings.format}
              onChange={(event) => set("format", event.target.value as Format)}
            >
              {(Object.keys(FORMATS) as Format[]).map((key) => (
                <option key={key} value={key}>
                  {FORMATS[key]}
                </option>
              ))}
            </Select>
            {whole("start", "Start number", "The number the first numbered page carries")}
            {whole("firstPage", "First page to number", "Pages before it get no number")}
            {whole(
              "fontSize",
              "Font size (points)",
              `${FONT_SIZE.min} to ${FONT_SIZE.max}; 72 points are one inch`,
            )}
            {whole(
              "margin",
              "Margin (points)",
              `${MARGIN.min} to ${MARGIN.max} from the page edge`,
            )}
            <Select
              id="add-page-numbers-to-pdf-which"
              label="Pages"
              value={settings.which}
              onChange={(event) => set("which", event.target.value as Which)}
            >
              <option value="all">All pages</option>
              <option value="chosen">Only the pages I choose</option>
            </Select>
            {settings.which === "chosen" && (
              <Input
                id="add-page-numbers-to-pdf-pages"
                label="Pages to number"
                hint="For example 2-5, 8, or 3- for page 3 to the end"
                value={settings.pages}
                onChange={(event) => set("pages", event.target.value)}
              />
            )}
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void number()}>
              Add numbers
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
        <FileResultList label="Numbered PDF">
          <FileResult
            name={output.name}
            meta={`${pagesLabel(output.numbered)} numbered, ${formatSize(output.blob.size)}`}
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
          >
            <span className="text-sm text-fg-muted">
              First number: {output.first}. Last number: {output.last}.
            </span>
          </FileResult>
        </FileResultList>
      )}
    </>
  );
}

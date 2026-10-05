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
  ANGLE,
  checkFile,
  FONT_SIZE,
  formatSize,
  type Job,
  type JobResult,
  type Layout,
  LIMITS,
  MAX_TEXT,
  MESSAGES,
  OPACITY,
  outputName,
  pagesLabel,
  planWatermark,
  type Settings,
  type Which,
} from "./logic";

// The workspace of Watermark PDF. Choosing a PDF starts worker.ts, which counts its pages with
// pdf-lib; Add watermark checks the settings here (planWatermark) and sends them to the worker,
// which draws the text. The PDF code loads only with the worker (ADR 0057).

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
  pages: number;
  copies: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

const INITIAL: Settings = {
  text: "CONFIDENTIAL",
  fontSize: String(FONT_SIZE.initial),
  color: "#808080",
  opacity: String(OPACITY.initial),
  angle: String(ANGLE.initial),
  layout: "single",
  which: "all",
  pages: "",
};

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
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

  const watermark = async () => {
    if (!source) return;
    setOutput(null);
    const planned = planWatermark(settings, source.pages);
    if (!planned.ok) {
      setError(planned.error);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await client.run({ kind: "watermark", file: source.file, plan: planned.plan });
      if (result.kind === "watermark") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name),
          pages: planned.plan.pages.length,
          copies: result.copies,
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
      id={`watermark-pdf-${key}`}
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
        id="watermark-pdf-file"
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
          <p className="text-sm text-fg-muted" id="watermark-pdf-original">
            {source.file.name}: {pagesLabel(source.pages)}, {formatSize(source.file.size)}
          </p>
          <Input
            id="watermark-pdf-text"
            label="Watermark text"
            hint={`One line, up to ${MAX_TEXT} characters: Latin letters, digits and common punctuation`}
            value={settings.text}
            onChange={(event) => set("text", event.target.value)}
          />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {whole("fontSize", "Font size (points)", `${FONT_SIZE.min} to ${FONT_SIZE.max}`)}
            <Input
              id="watermark-pdf-color"
              label="Colour (hex)"
              hint="For example #808080 for grey or #cc0000 for red"
              value={settings.color}
              onChange={(event) => set("color", event.target.value)}
            />
            {whole(
              "opacity",
              "Opacity (percent)",
              `${OPACITY.min} to ${OPACITY.max}; lower is fainter`,
            )}
            {whole(
              "angle",
              "Angle (degrees)",
              `${ANGLE.min} to ${ANGLE.max}; positive turns counterclockwise`,
            )}
            <Select
              id="watermark-pdf-layout"
              label="Layout"
              value={settings.layout}
              onChange={(event) => set("layout", event.target.value as Layout)}
            >
              <option value="single">Once, in the centre</option>
              <option value="tiled">Tiled across the page</option>
            </Select>
            <Select
              id="watermark-pdf-which"
              label="Pages"
              value={settings.which}
              onChange={(event) => set("which", event.target.value as Which)}
            >
              <option value="all">All pages</option>
              <option value="chosen">Only the pages I choose</option>
            </Select>
            {settings.which === "chosen" && (
              <Input
                id="watermark-pdf-pages"
                label="Pages to watermark"
                hint="For example 1, 3-4, or 7- for page 7 to the end"
                value={settings.pages}
                onChange={(event) => set("pages", event.target.value)}
              />
            )}
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void watermark()}>
              Add watermark
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
        <FileResultList label="Watermarked PDF">
          <FileResult
            name={output.name}
            meta={`${pagesLabel(output.pages)} watermarked, ${output.copies} ${output.copies === 1 ? "copy" : "copies"} of the text, ${formatSize(output.blob.size)}`}
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

import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Progress,
  Select,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useRef, useState } from "react";
import {
  checkFile,
  ENGINE_BYTES,
  firstDownloadBytes,
  formatSize,
  type InputKind,
  isEmptyResult,
  type Job,
  type JobResult,
  joinPages,
  LANGUAGE_CHOICES,
  LANGUAGES,
  type LanguageChoice,
  LIMITS,
  MAX_PAGES,
  MESSAGES,
  textName,
} from "./logic";

// The workspace of OCR image to text. Read text sends the file to worker.ts, which loads Tesseract
// and the chosen language data from this site on first use, then reads the photo or each PDF page.
// Nothing of the OCR engine loads with the page (ADR 0051, ADR 0060).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  kind: InputKind;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [language, setLanguage] = useState<LanguageChoice>("eng");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const job = useRef<AbortController | null>(null);

  const choose = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setText("");
    setError("");
    setMessage("");
    const checked = checkFile(file);
    if (!checked.ok) {
      setSource(null);
      setFileError(`${file.name}: ${checked.error}`);
      return;
    }
    setFileError("");
    setSource({ file, kind: checked.kind });
  };

  const start = async () => {
    if (!source) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setStage("Starting");
    setText("");
    setError("");
    setMessage("");
    try {
      const result = await client.run(
        { file: source.file, kind: source.kind, language },
        {
          signal: controller.signal,
          onProgress: ({ done, total, stage: now }) => {
            setProgress(Math.round((done / total) * 100));
            if (now) setStage(now);
          },
        },
      );
      if (isEmptyResult(result.pages)) setError(MESSAGES.nothingFound);
      else setText(joinPages(result.pages, source.kind));
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      if (job.current === controller) job.current = null;
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Text copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it.");
    }
  };

  const sizes = `First use downloads the OCR engine (up to ${formatSize(ENGINE_BYTES)}) and the language data: English ${formatSize(LANGUAGES.eng.bytes)}, Hindi ${formatSize(LANGUAGES.hin.bytes)}.`;

  return (
    <>
      <Dropzone
        id="ocr-file"
        accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf"
        multiple={false}
        title="Drop a photo, a scan or a PDF here"
        hint={`or click to choose. PNG, JPG, WebP or PDF, up to ${formatSize(LIMITS.maxInputBytes)}; a PDF of up to ${MAX_PAGES} pages`}
        onFiles={choose}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not added">
          {fileError}
        </Alert>
      )}
      {source && (
        <p className="text-sm text-fg-muted" id="ocr-source">
          {source.file.name}, {formatSize(source.file.size)}
        </p>
      )}

      <Select
        id="ocr-language"
        label="Language of the text"
        hint={sizes}
        value={language}
        onChange={(event) => setLanguage(event.target.value as LanguageChoice)}
      >
        {(Object.keys(LANGUAGE_CHOICES) as LanguageChoice[]).map((key) => (
          <option key={key} value={key}>
            {LANGUAGE_CHOICES[key].label}
          </option>
        ))}
      </Select>
      <p className="text-sm text-fg-muted" id="ocr-download">
        This choice downloads up to {formatSize(firstDownloadBytes(language))} the first time.
      </p>

      <div className="ni-workspace__actions">
        <Button variant="primary" loading={busy} disabled={!source} onClick={() => void start()}>
          Read text
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => job.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>

      {busy && <Progress value={progress} label={stage} />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {text && (
        <>
          <Textarea id="ocr-text" label="Text found" readOnly rows={12} value={text} />
          <div className="ni-workspace__actions">
            <Button variant="primary" onClick={() => void copy()}>
              Copy text
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                source &&
                saveFile(new Blob([text], { type: "text/plain" }), textName(source.file.name), {
                  type: "text/plain",
                })
              }
            >
              Download .txt
            </Button>
          </div>
        </>
      )}
      <p className="text-sm" aria-live="polite">
        {message}
      </p>
    </>
  );
}

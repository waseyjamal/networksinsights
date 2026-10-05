import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Progress,
  Select,
  saveFile,
  Tabs,
  WorkerJobError,
} from "@ui";
import { useRef, useState } from "react";
import {
  formatSize,
  isZipFile,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  METHODS,
  type Method,
  type Plan,
  planCreate,
  type ZipFile,
} from "./logic";

// The workspace of ZIP create and extract: one tab makes a ZIP from files, the other opens a ZIP
// and saves the files inside it one at a time. fflate runs in the worker, which loads on the
// first job, never with the page.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const message = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

function Create() {
  const [files, setFiles] = useState<File[]>([]);
  const [method, setMethod] = useState<Method>("deflate");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Blob | null>(null);
  const job = useRef<AbortController | null>(null);
  const plan = planCreate(files);

  const add = (chosen: File[]) => {
    setResult(null);
    setError("");
    setFiles((current) => [...current, ...chosen]);
  };

  const start = async () => {
    if (!plan.ok || files.length === 0) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setError("");
    setResult(null);
    try {
      const answer = await client.run(
        {
          kind: "create",
          files,
          names: plan.files.map((file) => file.name),
          modified: files.map((file) => file.lastModified),
          method,
        },
        {
          signal: controller.signal,
          onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)),
        },
      );
      if (answer.kind === "create") setResult(answer.blob);
    } catch (caught) {
      if (!controller.signal.aborted) setError(message(caught, MESSAGES.failed));
    } finally {
      if (job.current === controller) job.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Dropzone
        id="zip-create-files"
        multiple
        title="Drop files here"
        hint={`or click to choose. Up to ${LIMITS.maxFiles.toLocaleString("en")} files and ${formatSize(LIMITS.maxInputBytes)} in all`}
        onFiles={add}
      />
      {!plan.ok && (
        <Alert tone="warning" title="These files cannot go in one ZIP">
          {plan.message}
        </Alert>
      )}
      {plan.ok && files.length > 0 && (
        <>
          <p className="text-sm text-fg-muted" id="zip-create-summary">
            {files.length} {files.length === 1 ? "file" : "files"}, {formatSize(plan.totalBytes)}
          </p>
          <ul className="grid gap-1 text-sm" id="zip-create-list">
            {plan.files.map((file) => (
              <li key={file.index}>{file.name}</li>
            ))}
          </ul>
        </>
      )}
      <Select
        id="zip-create-method"
        label="How to store the files"
        value={method}
        hint="Compressed makes text and documents smaller. Stored is faster and suits photos and videos, which are compressed already."
        onChange={(event) => setMethod(event.target.value as Method)}
      >
        {(Object.keys(METHODS) as Method[]).map((key) => (
          <option key={key} value={key}>
            {METHODS[key].label}
          </option>
        ))}
      </Select>
      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!plan.ok || files.length === 0}
          onClick={() => void start()}
        >
          Make ZIP
        </Button>
        {files.length > 0 && !busy && (
          <Button
            variant="ghost"
            onClick={() => {
              setFiles([]);
              setResult(null);
            }}
          >
            Clear files
          </Button>
        )}
        {busy && (
          <Button variant="ghost" onClick={() => job.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>
      {busy && <Progress value={progress} label="Adding files" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="grid gap-3" id="zip-create-result">
          <p className="text-sm">files.zip, {formatSize(result.size)}</p>
          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              onClick={() => saveFile(result, "files.zip", { type: "application/zip" })}
            >
              Download files.zip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Extract() {
  const [zip, setZip] = useState<File | null>(null);
  const [plan, setPlan] = useState<Extract<Plan, { ok: true }> | null>(null);
  const [reading, setReading] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [working, setWorking] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [status, setStatus] = useState("");

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setZip(null);
    setPlan(null);
    setErrors({});
    setStatus("");
    if (!isZipFile(file)) {
      setRefusal(`${file.name}: ${MESSAGES.notZip}`);
      return;
    }
    if (file.size > LIMITS.maxInputBytes) {
      setRefusal(`${file.name}: ${MESSAGES.tooLarge(formatSize(LIMITS.maxInputBytes))}`);
      return;
    }
    setRefusal("");
    setReading(true);
    try {
      const answer = await client.run({ kind: "list", file });
      if (answer.kind !== "list") return;
      if (!answer.plan.ok) {
        setRefusal(`${file.name}: ${answer.plan.message}`);
        return;
      }
      setZip(file);
      setPlan(answer.plan);
    } catch (caught) {
      setRefusal(`${file.name}: ${message(caught, MESSAGES.notZip)}`);
    } finally {
      setReading(false);
    }
  };

  const save = async (entry: ZipFile) => {
    if (!zip) return;
    setWorking(entry.index);
    setStatus("");
    try {
      const answer = await client.run({ kind: "extract", file: zip, entry });
      if (answer.kind !== "extract") return;
      setErrors(({ [entry.index]: _gone, ...rest }) => rest);
      saveFile(answer.blob, entry.saveAs);
      setStatus(`${entry.saveAs} was extracted.`);
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [entry.index]: message(caught, MESSAGES.badCrc(entry.path)),
      }));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="grid gap-4">
      <Dropzone
        id="zip-extract-file"
        accept=".zip,application/zip,application/x-zip-compressed"
        multiple={false}
        title="Drop a ZIP file here"
        hint={`or click to choose. Up to ${formatSize(LIMITS.maxInputBytes)}, ${LIMITS.maxFiles.toLocaleString("en")} entries and ${formatSize(LIMITS.maxUnpackedBytes)} unpacked`}
        onFiles={(files) => void open(files)}
      />
      {reading && <Progress label="Reading the ZIP" />}
      {refusal && (
        <Alert tone="warning" title="This ZIP was not opened">
          {refusal}
        </Alert>
      )}
      {zip && plan && (
        <>
          <p className="text-sm text-fg-muted" id="zip-extract-summary">
            {zip.name}: {plan.files.length} {plan.files.length === 1 ? "file" : "files"}
            {plan.folders > 0
              ? ` in ${plan.folders} ${plan.folders === 1 ? "folder" : "folders"}`
              : ""}
            , {formatSize(plan.unpackedBytes)} unpacked
          </p>
          <ul className="grid gap-3" id="zip-extract-list">
            {plan.files.map((entry) => (
              <li key={entry.index} className="grid gap-1" data-entry={entry.path}>
                <span className="text-sm">
                  {entry.path}, {formatSize(entry.size)}
                </span>
                {entry.cleaned && (
                  <span className="text-sm text-fg-muted">
                    The name in the ZIP was made safe; it is saved as {entry.saveAs}.
                  </span>
                )}
                {!entry.cleaned && entry.saveAs !== entry.path.split("/").pop() && (
                  <span className="text-sm text-fg-muted">
                    Another file has the same name, so this one is saved as {entry.saveAs}.
                  </span>
                )}
                {entry.problem ? (
                  <span className="text-sm text-fg-muted">Not extracted. {entry.problem}</span>
                ) : (
                  <div>
                    <Button
                      variant="secondary"
                      loading={working === entry.index}
                      disabled={working !== null}
                      onClick={() => void save(entry)}
                    >
                      Download {entry.saveAs}
                    </Button>
                  </div>
                )}
                {errors[entry.index] && (
                  <span className="text-sm text-danger-text" role="alert">
                    {errors[entry.index]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-sm" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

export default function ToolUi() {
  return (
    <Tabs
      id="zip-mode"
      label="What to do"
      tabs={[
        { id: "extract", label: "Open a ZIP", panel: <Extract /> },
        { id: "create", label: "Make a ZIP", panel: <Create /> },
      ]}
    />
  );
}

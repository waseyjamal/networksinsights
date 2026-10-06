import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  Progress,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useState } from "react";
import {
  checkFile,
  checkPassword,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  unlockedName,
} from "./logic";

// The workspace of Unlock PDF. The visitor chooses a PDF and types its password; worker.ts opens
// it with PDFium and that password only, removes the protection, and checks the copy with PDF.js
// before it is shown. Both engines load with the worker, on the first job (ADR 0057, ADR 0062).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Unlocked {
  blob: Blob;
  name: string;
  pages: number;
  kind: JobResult["kind"];
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Unlocked | null>(null);

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

  const unlock = async () => {
    if (!file) return;
    setResult(null);
    const problem = checkPassword(password);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const done = await client.run(
        { file, password },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      setResult({
        blob: new Blob([done.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
        name: unlockedName(file.name),
        pages: done.pages,
        kind: done.kind,
      });
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Alert tone="info" title="It does not crack passwords">
        This tool only works when you type the correct password. It never tries to find or guess
        one.
      </Alert>
      <Dropzone
        id="unlock-pdf-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={choose}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {file && (
        <>
          <p className="text-sm text-fg-muted" id="unlock-pdf-original">
            {file.name}: {formatSize(file.size)}
          </p>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <Input
              id="unlock-pdf-password"
              label="Password of this PDF"
              hint="The password you use to open it, or its owner password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div className="ni-workspace__actions">
              <Button variant="primary" type="submit" loading={busy}>
                Remove password
              </Button>
            </div>
          </form>
        </>
      )}

      {busy && <Progress value={progress} label="Removing the password" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {result && (
        <FileResultList label="Unlocked PDF">
          <FileResult
            name={result.name}
            meta={`${result.pages} ${result.pages === 1 ? "page" : "pages"}, ${formatSize(
              result.blob.size,
            )}, opens with no password`}
            state="done"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${result.name}`}
                onClick={() => saveFile(result.blob, result.name, { type: "application/pdf" })}
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

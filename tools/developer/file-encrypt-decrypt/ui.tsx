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
  checkPassword,
  formatSize,
  ITERATIONS,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  type Mode,
} from "./logic";

// The workspace of File Encrypt and Decrypt: the action, one file, the password, then the result
// to download. worker.ts runs PBKDF2 and AES-GCM. The password lives only in this component's
// state and the job sent to the worker; it is never logged, stored or put in a URL.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

export default function ToolUi() {
  const [mode, setMode] = useState<Mode>("encrypt");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<JobResult | null>(null);

  const fileProblem = file ? checkFile(mode, file) : null;
  const passwordProblem =
    password === "" && confirm === "" ? null : checkPassword(mode, password, confirm);
  const ready = file !== null && !fileProblem && checkPassword(mode, password, confirm) === null;

  const reset = () => {
    setOutput(null);
    setError("");
  };

  const start = async () => {
    if (!file || !ready) return;
    reset();
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { mode, file, name: file.name, password },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      setOutput(result);
    } catch (caught) {
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Alert tone="warning" title="There is no way back without the password">
        If you lose the password, the encrypted file cannot be recovered by anyone, including us.
      </Alert>
      <Select
        id="crypt-mode"
        label="Action"
        value={mode}
        onChange={(event) => {
          setMode(event.target.value as Mode);
          setConfirm("");
          reset();
        }}
      >
        <option value="encrypt">Encrypt a file</option>
        <option value="decrypt">Decrypt a .nienc file</option>
      </Select>
      <Dropzone
        id="crypt-file"
        multiple={false}
        {...(mode === "decrypt" ? { accept: ".nienc" } : {})}
        title={mode === "encrypt" ? "Drop the file to encrypt" : "Drop the .nienc file"}
        hint={
          mode === "encrypt"
            ? `or click to choose. Any type, up to ${formatSize(LIMITS.maxInputBytes)}`
            : "or click to choose. A file this tool encrypted"
        }
        onFiles={(files) => {
          setFile(files[0] ?? null);
          reset();
        }}
      />
      {file && (
        <p className="text-sm">
          File: {file.name}, {formatSize(file.size)}
        </p>
      )}
      {fileProblem && (
        <p className="text-sm text-danger-text" role="alert">
          {fileProblem}
        </p>
      )}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="crypt-password"
          label="Password"
          type="password"
          autoComplete={mode === "encrypt" ? "new-password" : "current-password"}
          hint={
            mode === "encrypt"
              ? "At least 8 characters, our own minimum. Longer is safer."
              : undefined
          }
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            reset();
          }}
        />
        {mode === "encrypt" && (
          <Input
            id="crypt-confirm"
            label="Password again"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value);
              reset();
            }}
          />
        )}
      </div>
      {passwordProblem && (password !== "" || mode === "encrypt") && (
        <p id="crypt-password-problem" className="text-sm text-fg-muted">
          {passwordProblem}
        </p>
      )}
      <div className="ni-workspace__actions">
        <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void start()}>
          {mode === "encrypt" ? "Encrypt" : "Decrypt"}
        </Button>
      </div>
      {busy && (
        <Progress
          value={progress}
          label={`${mode === "encrypt" ? "Encrypting" : "Decrypting"}: ${ITERATIONS.toLocaleString("en")} rounds of PBKDF2 first`}
        />
      )}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {output && (
        <FileResultList label="Your file">
          <FileResult
            name={output.name}
            meta={formatSize(output.blob.size)}
            state="done"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() =>
                  saveFile(output.blob, output.name, { type: "application/octet-stream" })
                }
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

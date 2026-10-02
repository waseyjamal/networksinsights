import {
  Alert,
  Badge,
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
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  checkSettings,
  FITS,
  type Fit,
  formatKb,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MAX_SIDE,
  MESSAGES,
  outputName,
  parseNumber,
} from "./logic";

// The workspace of Photo and Signature Resizer. The visitor gives the pixels and the KB a form
// asks for; worker.ts draws the picture at that size and searches for the best JPG quality that
// fits. When nothing fits, the page says so with the smallest size it could reach.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Output {
  blob: Blob;
  url: string;
  name: string;
  width: number;
  height: number;
  maxKb: number;
}

export default function ToolUi() {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [maxKb, setMaxKb] = useState("");
  const [fit, setFit] = useState<Fit>("crop");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const outputRef = useRef(output);
  outputRef.current = output;

  useEffect(
    () => () => {
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    },
    [],
  );

  const dropOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    setOutput(null);
  };

  const open = (files: File[]) => {
    const next = files[0];
    if (!next) return;
    dropOutput();
    setError("");
    const problem = checkFile(next);
    if (problem) {
      setFileError(`${next.name}: ${problem}`);
      return;
    }
    setFileError("");
    setFile(next);
  };

  const make = async () => {
    if (!file) return;
    dropOutput();
    const settings = {
      width: parseNumber(width),
      height: parseNumber(height),
      maxKb: parseNumber(maxKb),
      fit,
    };
    const problem = checkSettings(settings);
    if (problem) {
      setError(problem);
      return;
    }
    const job = { ...settings, file } as Job;
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(job, {
        onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)),
      });
      if (!result.met) {
        setError(MESSAGES.notMet(job.maxKb, job.width, job.height, formatKb(result.smallestBytes)));
        return;
      }
      setOutput({
        blob: result.blob,
        url: URL.createObjectURL(result.blob),
        name: outputName(file.name, job.width, job.height),
        width: job.width,
        height: job.height,
        maxKb: job.maxKb,
      });
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
      <Dropzone
        id="psr-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop your photo or signature here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={open}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}
      {file && (
        <p className="text-sm text-fg-muted" id="psr-original">
          {file.name}, {formatSize(file.size)}
        </p>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Input
          id="psr-width"
          label="Width (pixels)"
          hint={`1 to ${MAX_SIDE}`}
          inputMode="numeric"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        />
        <Input
          id="psr-height"
          label="Height (pixels)"
          hint={`1 to ${MAX_SIDE}`}
          inputMode="numeric"
          value={height}
          onChange={(event) => setHeight(event.target.value)}
        />
        <Input
          id="psr-kb"
          label="Maximum size (KB)"
          hint="As the form states it"
          inputMode="numeric"
          value={maxKb}
          onChange={(event) => setMaxKb(event.target.value)}
        />
      </div>
      <Select
        id="psr-fit"
        label="When the shape differs"
        value={fit}
        onChange={(event) => setFit(event.target.value as Fit)}
      >
        {(Object.keys(FITS) as Fit[]).map((key) => (
          <option key={key} value={key}>
            {FITS[key]}
          </option>
        ))}
      </Select>
      <div className="ni-workspace__actions">
        <Button variant="primary" loading={busy} disabled={!file} onClick={() => void make()}>
          Make the file
        </Button>
      </div>
      {busy && <Progress value={progress} label="Finding the best quality that fits" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && file && (
        <FileResultList label="Resized file">
          <FileResult
            name={output.name}
            meta={`${output.width} × ${output.height} pixels, ${formatKb(output.blob.size)}`}
            state="done"
            previewSrc={output.url}
            previewAlt={`Resized preview of ${file.name}`}
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "image/jpeg" })}
              >
                Download
              </Button>
            }
          >
            <Badge tone="success">Under {output.maxKb} KB</Badge>
          </FileResult>
        </FileResultList>
      )}
    </>
  );
}

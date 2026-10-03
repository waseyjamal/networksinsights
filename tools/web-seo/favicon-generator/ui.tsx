import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  linkTags,
  MESSAGES,
  manifestIcons,
} from "./logic";

// The workspace of Favicon Generator: one image in, then each icon as its own download and the
// tags to paste. worker.ts draws the sizes and writes favicon.ico, so this page stays light.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Shown extends JobResult {
  source: string;
  previews: string[];
}

export default function ToolUi() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Shown | null>(null);
  const urls = useRef<string[]>([]);

  const release = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
  };
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const make = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    release();
    setResult(null);
    const refused = checkFile(file);
    if (refused) {
      setError(`${file.name}: ${refused}`);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const made = await client.run(
        { image: file },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      const previews = made.files.map((entry) => URL.createObjectURL(entry.blob));
      urls.current = previews;
      setResult({ ...made, source: file.name, previews });
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
        id="favicon-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop one image here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}. A square image works best.`}
        onFiles={(files) => void make(files)}
      />
      {busy && <Progress value={progress} label="Making the icons" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          {result.cropped && (
            <Alert tone="info" title="The image was not square">
              {result.source} is {result.width} by {result.height} pixels. The icons use the largest
              square at its centre, so the edges of the longer side are cut off.
            </Alert>
          )}
          <FileResultList label="Your icons">
            {result.files.map((entry, index) => (
              <FileResult
                key={entry.name}
                name={entry.name}
                meta={`${entry.name === "favicon.ico" ? "16, 32 and 48 pixels" : `${entry.size} × ${entry.size} pixels`}, ${formatSize(entry.blob.size)}`}
                previewSrc={result.previews[index]}
                previewAlt={`Preview of ${entry.name}`}
                state="done"
                actions={
                  <Button
                    size="sm"
                    aria-label={`Download ${entry.name}`}
                    onClick={() => saveFile(entry.blob, entry.name, { type: entry.blob.type })}
                  >
                    Download
                  </Button>
                }
              />
            ))}
          </FileResultList>
          <Textarea
            id="favicon-tags"
            label="Tags for the head of every page"
            className="font-mono"
            readOnly
            rows={5}
            value={linkTags()}
          />
          <Textarea
            id="favicon-manifest"
            label="Icons for a web app manifest"
            className="font-mono"
            readOnly
            rows={8}
            value={manifestIcons()}
          />
        </>
      )}
    </>
  );
}

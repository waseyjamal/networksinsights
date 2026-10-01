import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Progress,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFiles,
  downloadSize,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  percentOf,
} from "./logic";

// The workspace of Background Remover. The photo goes to worker.ts, which downloads the model on
// the first use and does all the work; the page keeps the two previews and the download. The
// worker, ONNX Runtime and the model load only when a visitor adds a photo (ADR 0051, ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

type State =
  | { status: "idle" }
  | { status: "working"; stage: string; percent: number }
  | { status: "done"; blob: Blob; url: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export default function ToolUi() {
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });
  const [notice, setNotice] = useState("");
  const job = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);

  // Previews are object URLs: give their memory back when the page goes.
  useEffect(
    () => () => {
      job.current?.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  };

  const forget = () => {
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current = [];
  };

  const start = async (file: File) => {
    const controller = new AbortController();
    job.current = controller;
    setState({ status: "working", stage: "Starting", percent: 0 });
    try {
      const output = await client.run(
        { file },
        {
          signal: controller.signal,
          onProgress: ({ done, total, stage }) =>
            setState({
              status: "working",
              stage: stage ?? "Working",
              percent: percentOf(done, total),
            }),
        },
      );
      if (job.current !== controller) return;
      setState({ status: "done", blob: output.blob, url: objectUrl(output.blob) });
      setNotice("Background removed.");
    } catch (caught) {
      // Replaced by a new photo or cleared: the page already shows what comes next.
      if (job.current !== controller) return;
      if (controller.signal.aborted) {
        setState({ status: "cancelled" });
        setNotice("Cancelled.");
        return;
      }
      const message =
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed;
      setState({ status: "error", message });
    }
    if (job.current === controller) job.current = null;
  };

  /** Stops the running job without reporting it as cancelled. */
  const drop = () => {
    const controller = job.current;
    job.current = null;
    controller?.abort();
  };

  const add = (files: File[]) => {
    const checked = checkFiles(files);
    if (!checked.file) {
      setState({ status: "error", message: checked.error });
      return;
    }
    drop();
    forget();
    setPhoto({ file: checked.file, url: objectUrl(checked.file) });
    void start(checked.file);
  };

  const cancel = () => job.current?.abort();

  const clear = () => {
    drop();
    forget();
    setPhoto(null);
    setState({ status: "idle" });
  };

  const working = state.status === "working";

  return (
    <>
      <Alert tone="info" title="The first use downloads the model">
        The first photo needs an internet connection: it downloads the AI model and its runtime,
        about {downloadSize()}, from this site. Your photo is not uploaded. It stays on this device.
      </Alert>

      <Dropzone
        id="background-remover-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop a photo here"
        hint={`or click to choose. One JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={add}
      />

      {state.status === "error" && (
        <Alert tone="danger" title="The background was not removed">
          {state.message}
        </Alert>
      )}

      {working && (
        <div className="grid gap-2">
          <Progress value={state.percent} label={state.stage} />
          <p className="text-sm text-fg-muted">
            {state.stage}… {state.percent}%
          </p>
          <div>
            <Button size="sm" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {photo && (
        <section aria-labelledby="background-remover-result" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="background-remover-result" className="text-lg">
              Before and after
            </h3>
            <div className="flex flex-wrap gap-2">
              {state.status === "cancelled" && (
                <Button size="sm" variant="secondary" onClick={() => void start(photo.file)}>
                  Try again
                </Button>
              )}
              {state.status === "done" && (
                <Button
                  size="sm"
                  aria-label={`Download ${outputName(photo.file.name)}`}
                  onClick={() =>
                    saveFile(state.blob, outputName(photo.file.name), { type: "image/png" })
                  }
                >
                  Download PNG
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={clear}>
                Clear
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <figure className="grid gap-2">
              <img
                src={photo.url}
                alt={`Original: ${photo.file.name}`}
                className="max-h-96 w-full rounded-md border border-border bg-surface-sunken object-contain"
              />
              <figcaption className="text-sm text-fg-muted">Before</figcaption>
            </figure>
            <figure className="grid gap-2">
              {state.status === "done" ? (
                <img
                  src={state.url}
                  alt={`${photo.file.name} with the background removed`}
                  className="max-h-96 w-full rounded-md border border-border bg-surface-sunken object-contain"
                  data-testid="background-remover-after"
                />
              ) : (
                <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-border text-sm text-fg-muted">
                  {working ? "Working…" : "No result yet"}
                </div>
              )}
              <figcaption className="text-sm text-fg-muted">After (transparent PNG)</figcaption>
            </figure>
          </div>
        </section>
      )}

      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </>
  );
}

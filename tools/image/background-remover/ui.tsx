import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  ENGINE,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  MODEL,
  outputName,
} from "./logic";

// The workspace of Background Remover. The picture goes to worker.ts, which loads the engine and
// the MODNet model on the first run (ADR 0066); the page shows the progress, the result and the
// download.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type State =
  | { status: "idle" }
  | { status: "working"; file: File; progress: number; stage: string }
  | { status: "done"; file: File; blob: Blob; url: string; width: number; height: number }
  | { status: "error"; file: File; message: string };

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export default function ToolUi() {
  const [state, setState] = useState<State>({ status: "idle" });
  const job = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);

  useEffect(
    () => () => {
      job.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const reset = () => {
    job.current?.abort();
    job.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };

  const start = async (file: File) => {
    reset();
    const refused = checkFile(file);
    if (refused) {
      setState({ status: "error", file, message: refused });
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    setState({ status: "working", file, progress: 0, stage: "Reading" });
    try {
      const output = await client.run(
        { file },
        {
          signal: controller.signal,
          onProgress: ({ done, total, stage }) =>
            setState({
              status: "working",
              file,
              progress: Math.round((done / total) * 100),
              stage: stage ?? "Working",
            }),
        },
      );
      url.current = URL.createObjectURL(output.blob);
      setState({
        status: "done",
        file,
        blob: output.blob,
        url: url.current,
        width: output.width,
        height: output.height,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message =
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed;
      setState({ status: "error", file, message });
    } finally {
      if (job.current === controller) job.current = null;
    }
  };

  const cancel = () => {
    reset();
    setState({ status: "idle" });
  };

  return (
    <>
      <Alert tone="info" title="Best for people">
        <span id="background-remover-mode">
          The model was trained on portraits. It finds people well; other subjects, such as
          products, animals or objects a person holds, may be cut badly or left out.
        </span>
      </Alert>
      <p id="background-remover-download" className="text-sm text-fg-muted">
        The first run downloads {formatSize(MODEL.bytes + ENGINE.bytes)}: the model and the engine
        that runs it. Your browser keeps them for the next picture.
      </p>
      <Dropzone
        id="background-remover-file"
        accept={ACCEPT}
        multiple={false}
        disabled={state.status === "working"}
        title="Drop a photo of a person here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} and ${LIMITS.maxPixels / 1_000_000} megapixels`}
        onFiles={(files) => {
          const [file] = files;
          if (file) void start(file);
        }}
      />

      {state.status === "error" && (
        <Alert tone="warning" title="The background was not removed">
          <span id="background-remover-error">{state.message}</span>
        </Alert>
      )}

      {(state.status === "working" || state.status === "done") && (
        <FileResultList label="Picture without background">
          <FileResult
            name={state.file.name}
            state={state.status}
            meta={
              state.status === "done"
                ? `${state.width} × ${state.height} pixels, ${formatSize(state.file.size)} → ${formatSize(state.blob.size)}`
                : formatSize(state.file.size)
            }
            previewSrc={state.status === "done" ? state.url : undefined}
            previewAlt={
              state.status === "done"
                ? `Preview of ${state.file.name} without its background`
                : undefined
            }
            actions={
              state.status === "done" ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    saveFile(state.blob, outputName(state.file.name), { type: "image/png" })
                  }
                >
                  Download PNG
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
              )
            }
          >
            {state.status === "working" && (
              <>
                <Progress
                  value={state.progress}
                  label={`Removing the background of ${state.file.name}`}
                />
                <span id="background-remover-stage" className="text-sm text-fg-muted">
                  {state.stage}
                </span>
              </>
            )}
          </FileResult>
        </FileResultList>
      )}

      <p className="sr-only" aria-live="polite">
        {state.status === "done" ? `Done: ${state.width} × ${state.height} pixels.` : ""}
      </p>
    </>
  );
}

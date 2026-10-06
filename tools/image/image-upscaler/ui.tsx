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
  type Device,
  ENGINE,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  MODEL,
  outputName,
  pixelLimit,
} from "./logic";

// The workspace of Image Upscaler. The picture goes to worker.ts, which loads the engine and the
// model on the first run (ADR 0066); the page shows the progress, the result and the download.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type State =
  | { status: "idle" }
  | { status: "working"; file: File; progress: number; stage: string }
  | { status: "done"; file: File; blob: Blob; url: string; width: number; height: number }
  | { status: "error"; file: File; message: string };

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** What the page can learn about the device. `deviceMemory` is missing in Safari and Firefox. */
function readDevice(): Device {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    touchPrimary: window.matchMedia("(pointer: coarse)").matches,
    deviceMemory: typeof memory === "number" ? memory : undefined,
  };
}

export default function ToolUi() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [device, setDevice] = useState<Device>({ touchPrimary: false });
  const job = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);

  useEffect(() => {
    setDevice(readDevice());
    return () => {
      job.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

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
        { file, device: readDevice() },
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

  const limit = pixelLimit(device);

  return (
    <>
      <p id="image-upscaler-download" className="text-sm text-fg-muted">
        The first run downloads {formatSize(MODEL.bytes + ENGINE.bytes)}: the model and the engine
        that runs it. Your browser keeps them for the next picture.
      </p>
      <Dropzone
        id="image-upscaler-file"
        accept={ACCEPT}
        multiple={false}
        disabled={state.status === "working"}
        title="Drop a picture here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} and ${(limit / 1_000_000).toLocaleString("en-US")} megapixels on this device`}
        onFiles={(files) => {
          const [file] = files;
          if (file) void start(file);
        }}
      />

      {state.status === "error" && (
        <Alert tone="warning" title="The picture was not upscaled">
          <span id="image-upscaler-error">{state.message}</span>
        </Alert>
      )}

      {(state.status === "working" || state.status === "done") && (
        <FileResultList label="Upscaled picture">
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
              state.status === "done" ? `Upscaled preview of ${state.file.name}` : undefined
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
                <Progress value={state.progress} label={`Upscaling ${state.file.name}`} />
                <span id="image-upscaler-stage" className="text-sm text-fg-muted">
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

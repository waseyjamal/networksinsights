import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  DEFAULT_PRESET,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  PRESETS,
  type Preset,
  traceSize,
} from "./logic";

// The workspace of Image to SVG. The page decodes the picture and scales it to at most about
// 2 megapixels on a canvas (some browsers have no canvas inside a worker); worker.ts traces the
// pixels and writes the SVG. The preview shows the SVG through an <img>, where no script can run.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Picture {
  file: File;
  width: number;
  height: number;
  traced: { width: number; height: number; scaled: boolean };
  pixels: Uint8ClampedArray;
}

type State =
  | { status: "idle" }
  | { status: "working"; picture: Picture; progress: number }
  | { status: "done"; picture: Picture; blob: Blob; url: string; paths: number }
  | { status: "error"; name: string; message: string };

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

async function decode(file: File): Promise<Picture> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    if (width * height > LIMITS.maxPixels) throw new Error(MESSAGES.tooManyPixels);
    const traced = traceSize(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = traced.width;
    canvas.height = traced.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error(MESSAGES.failed);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, traced.width, traced.height);
    const pixels = context.getImageData(0, 0, traced.width, traced.height).data;
    return { file, width, height, traced, pixels };
  } finally {
    bitmap.close();
  }
}

export default function ToolUi() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);
  const job = useRef<AbortController | null>(null);
  const url = useRef<string | null>(null);
  const picture = useRef<Picture | null>(null);

  const reset = () => {
    job.current?.abort();
    job.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };

  useEffect(
    () => () => {
      job.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const trace = async (source: Picture, chosen: Preset) => {
    reset();
    const controller = new AbortController();
    job.current = controller;
    setState({ status: "working", picture: source, progress: 0 });
    try {
      const output = await client.run(
        {
          width: source.traced.width,
          height: source.traced.height,
          pixels: source.pixels,
          preset: chosen,
        },
        {
          signal: controller.signal,
          onProgress: ({ done, total }) =>
            setState({
              status: "working",
              picture: source,
              progress: Math.round((done / total) * 100),
            }),
        },
      );
      const blob = new Blob([output.svg], { type: "image/svg+xml" });
      url.current = URL.createObjectURL(blob);
      setState({ status: "done", picture: source, blob, url: url.current, paths: output.paths });
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message =
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed;
      setState({ status: "error", name: source.file.name, message });
    } finally {
      if (job.current === controller) job.current = null;
    }
  };

  const open = async (file: File) => {
    reset();
    picture.current = null;
    const refused = checkFile(file);
    if (refused) {
      setState({ status: "error", name: file.name, message: refused });
      return;
    }
    let decoded: Picture;
    try {
      decoded = await decode(file);
    } catch (caught) {
      const message =
        caught instanceof Error && caught.message === MESSAGES.tooManyPixels
          ? caught.message
          : MESSAGES.unreadable;
      setState({ status: "error", name: file.name, message });
      return;
    }
    picture.current = decoded;
    await trace(decoded, preset);
  };

  const choose = (next: Preset) => {
    setPreset(next);
    if (picture.current) void trace(picture.current, next);
  };

  const shown = state.status === "working" || state.status === "done" ? state.picture : null;

  return (
    <>
      <Dropzone
        id="image-to-svg-file"
        accept={ACCEPT}
        multiple={false}
        disabled={state.status === "working"}
        title="Drop an image here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}. Above about 2 megapixels it is scaled down before tracing.`}
        onFiles={(files) => {
          const [file] = files;
          if (file) void open(file);
        }}
      />

      <Select
        id="image-to-svg-preset"
        label="Colours"
        hint="Each colour becomes one layer of shapes. More colours give a larger file."
        value={preset}
        onChange={(event) => choose(event.target.value as Preset)}
      >
        {(Object.keys(PRESETS) as Preset[]).map((key) => (
          <option key={key} value={key}>
            {PRESETS[key].label}
          </option>
        ))}
      </Select>

      {state.status === "error" && (
        <Alert tone="warning" title="The image was not traced">
          <span id="image-to-svg-error">{state.message}</span>
        </Alert>
      )}

      {shown?.traced.scaled && (
        <Alert tone="info" title="Scaled down before tracing">
          <span id="image-to-svg-scaled">
            The picture is {shown.width} × {shown.height} pixels, more than about 2 megapixels, so
            it was traced at {shown.traced.width} × {shown.traced.height} pixels.
          </span>
        </Alert>
      )}

      {shown && (
        <FileResultList label="SVG file">
          <FileResult
            name={outputName(shown.file.name)}
            state={state.status === "done" ? "done" : "working"}
            meta={
              state.status === "done"
                ? `${shown.traced.width} × ${shown.traced.height}, ${state.paths} shapes, SVG size ${formatSize(state.blob.size)}`
                : `${shown.traced.width} × ${shown.traced.height}`
            }
            previewSrc={state.status === "done" ? state.url : undefined}
            previewAlt={
              state.status === "done"
                ? `Preview of the SVG traced from ${shown.file.name}`
                : undefined
            }
            actions={
              state.status === "done" ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    saveFile(state.blob, outputName(shown.file.name), { type: "image/svg+xml" })
                  }
                >
                  Download SVG ({formatSize(state.blob.size)})
                </Button>
              ) : undefined
            }
          >
            {state.status === "working" && (
              <Progress value={state.progress} label={`Tracing ${shown.file.name}`} />
            )}
          </FileResult>
        </FileResultList>
      )}

      <p className="sr-only" aria-live="polite">
        {state.status === "done" ? `Traced. SVG size ${formatSize(state.blob.size)}.` : ""}
      </p>
    </>
  );
}

import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Input,
  Progress,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkClip,
  checkFile,
  DEFAULTS,
  formatSeconds,
  formatSize,
  frameDelay,
  frameTimes,
  gifSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  type Probe,
} from "./logic";

// The workspace of Video to GIF. Choosing a video starts the worker, which reads only the file's
// headers; this page then asks the browser, with WebCodecs, whether it can decode the video, and
// says so plainly when it cannot. Mediabunny and gifenc load in the worker on that first file,
// never with the page (ADR 0051, ADR 0061).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

/** Whether this browser can decode the video and draw its frames in a worker. */
async function support(probe: Probe): Promise<string | undefined> {
  const config = probe.video?.decoderConfig;
  if (typeof OffscreenCanvas === "undefined") return MESSAGES.noCanvas;
  if (!config || typeof VideoDecoder === "undefined") return MESSAGES.cannotDecode;
  try {
    const answer = await VideoDecoder.isConfigSupported(config as unknown as VideoDecoderConfig);
    return answer.supported === true ? undefined : MESSAGES.cannotDecode;
  } catch {
    return MESSAGES.cannotDecode;
  }
}

interface Source {
  file: File;
  probe: Probe;
  unsupported?: string | undefined;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [start, setStart] = useState(String(DEFAULTS.start));
  const [length, setLength] = useState(String(DEFAULTS.length));
  const [width, setWidth] = useState(String(DEFAULTS.width));
  const [fps, setFps] = useState(String(DEFAULTS.fps));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    blob: Blob;
    url: string;
    name: string;
    frames: number;
    width: number;
    height: number;
  } | null>(null);
  const [message, setMessage] = useState("");
  const job = useRef<AbortController | null>(null);

  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const choose = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    job.current?.abort();
    setSource(null);
    setResult(null);
    setError("");
    setMessage("");
    const refused = checkFile(file);
    if (refused) {
      setFileError(`${file.name}: ${refused}`);
      return;
    }
    setFileError("");
    setReading(true);
    try {
      const answer = await client.run({ kind: "probe", file });
      if (answer.kind !== "probe") return;
      if (!answer.probe.video) {
        setFileError(`${file.name}: ${MESSAGES.noVideo}`);
        return;
      }
      setSource({ file, probe: answer.probe, unsupported: await support(answer.probe) });
    } catch (caught) {
      setFileError(
        `${file.name}: ${caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.unreadable}`,
      );
    } finally {
      setReading(false);
    }
  };

  const settings = {
    start: Number(start),
    length: Number(length),
    width: Number(width),
    fps: Number(fps),
  };
  const problems = source ? checkClip(settings, source.probe.durationSeconds) : {};
  const valid = Object.keys(problems).length === 0;
  const video = source?.probe.video;
  const size = video && valid ? gifSize(video.width, video.height, settings.width) : undefined;
  const times =
    source && valid
      ? frameTimes(
          settings.start,
          settings.length,
          settings.fps,
          source.probe.durationSeconds,
          source.probe.startSeconds,
        )
      : [];

  const make = async () => {
    if (!source || !size || source.unsupported || times.length === 0) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setStage("Starting");
    setResult(null);
    setError("");
    setMessage("");
    try {
      const answer = await client.run(
        {
          kind: "convert",
          file: source.file,
          times,
          width: size.width,
          height: size.height,
          delay: frameDelay(settings.fps),
        },
        {
          signal: controller.signal,
          onProgress: ({ done, total, stage: now }) => {
            setProgress(Math.round((done / total) * 100));
            if (now) setStage(now);
          },
        },
      );
      if (answer.kind !== "convert") return;
      setResult({
        blob: answer.blob,
        url: URL.createObjectURL(answer.blob),
        name: outputName(source.file.name),
        frames: answer.frames,
        width: size.width,
        height: size.height,
      });
      setMessage("The GIF is ready.");
    } catch (caught) {
      if (controller.signal.aborted) {
        setMessage("Stopped. Nothing was saved.");
        return;
      }
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      if (job.current === controller) job.current = null;
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="video-to-gif-file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm,.mkv"
        multiple={false}
        title="Drop a video here"
        hint={`or click to choose. MP4, MOV or WebM, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void choose(files)}
      />
      {reading && <Progress label="Reading the video" />}
      {fileError && (
        <Alert tone="warning" title="This video was not added">
          {fileError}
        </Alert>
      )}

      {source && video && (
        <>
          <p className="text-sm text-fg-muted" id="video-to-gif-source">
            {source.file.name}, {formatSize(source.file.size)},{" "}
            {formatSeconds(source.probe.durationSeconds)}, {video.width} × {video.height} pixels
          </p>
          {source.unsupported ? (
            <Alert tone="warning" title="Your browser cannot do this" id="video-to-gif-support">
              {source.unsupported}
            </Alert>
          ) : (
            <>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <Input
                  id="video-to-gif-start"
                  label="Start at (seconds)"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={start}
                  error={problems.start}
                  onChange={(event) => setStart(event.target.value)}
                />
                <Input
                  id="video-to-gif-length"
                  label="Length (seconds)"
                  type="number"
                  inputMode="decimal"
                  min={LIMITS.minClipSeconds}
                  max={LIMITS.maxClipSeconds}
                  step="any"
                  value={length}
                  hint={`Up to ${LIMITS.maxClipSeconds} seconds.`}
                  error={problems.length}
                  onChange={(event) => setLength(event.target.value)}
                />
                <Input
                  id="video-to-gif-width"
                  label="Width (pixels)"
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.minWidth}
                  max={LIMITS.maxWidth}
                  step={1}
                  value={width}
                  hint={`Up to ${LIMITS.maxWidth} pixels. The height keeps the picture's shape.`}
                  error={problems.width}
                  onChange={(event) => setWidth(event.target.value)}
                />
                <Input
                  id="video-to-gif-fps"
                  label="Frames a second"
                  type="number"
                  inputMode="numeric"
                  min={LIMITS.minFps}
                  max={LIMITS.maxFps}
                  step={1}
                  value={fps}
                  hint={`Up to ${LIMITS.maxFps}.`}
                  error={problems.fps}
                  onChange={(event) => setFps(event.target.value)}
                />
              </div>
              {size && (
                <p className="text-sm text-fg-muted" id="video-to-gif-plan">
                  {times.length} {times.length === 1 ? "frame" : "frames"}, {size.width} ×{" "}
                  {size.height} pixels
                </p>
              )}
            </>
          )}
        </>
      )}

      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!source || Boolean(source.unsupported) || !valid}
          onClick={() => void make()}
        >
          Make GIF
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

      {result && (
        <div className="grid gap-3" id="video-to-gif-result">
          <img
            src={result.url}
            alt={`The GIF made from ${source?.file.name ?? "the video"}`}
            width={result.width}
            height={result.height}
            className="h-auto max-w-full rounded-md border border-border"
          />
          <p className="text-sm">
            {result.name}, {result.frames} frames, {result.width} × {result.height} pixels,{" "}
            {formatSize(result.blob.size)}
          </p>
          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              onClick={() => saveFile(result.blob, result.name, { type: "image/gif" })}
            >
              Download {result.name}
            </Button>
          </div>
        </div>
      )}
      <p className="text-sm" aria-live="polite">
        {message}
      </p>
    </>
  );
}

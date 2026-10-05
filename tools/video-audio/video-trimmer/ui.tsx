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
import { useEffect, useRef, useState } from "react";
import {
  CONTAINERS,
  checkCut,
  checkFile,
  durationMs,
  ENCODER_CODECS,
  formatSeconds,
  formatSize,
  formatTime,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  MODES,
  type Mode,
  outputName,
  type Probe,
} from "./logic";

// The workspace of Video Trimmer. Choosing a video starts the worker, which reads only the file's
// headers; this page then asks the browser, with WebCodecs, whether it can decode the video and
// encode it again, and offers the exact cut only when it can. The fast cut copies and needs no
// codec. Mediabunny loads in the worker on that first file, never with the page (ADR 0051,
// ADR 0061).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

async function ask(check: () => Promise<{ supported?: boolean }>): Promise<boolean> {
  try {
    return (await check()).supported === true;
  } catch {
    return false;
  }
}

/** The Mediabunny codec to encode an exact cut with, or null when this browser cannot. */
async function exactCodec(probe: Probe): Promise<string | null> {
  const video = probe.video;
  if (!video?.decoderConfig) return null;
  if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined") return null;
  const config = video.decoderConfig;
  if (!(await ask(() => VideoDecoder.isConfigSupported(config as unknown as VideoDecoderConfig))))
    return null;
  for (const choice of ENCODER_CODECS[probe.container]) {
    const supported = await ask(() =>
      VideoEncoder.isConfigSupported({
        codec: choice.webcodecs,
        width: video.width,
        height: video.height,
        bitrate: 2_000_000,
      }),
    );
    if (supported) return choice.codec;
  }
  return null;
}

interface Source {
  file: File;
  url: string;
  probe: Probe;
  durationMs: number;
  codec: string | null;
}

interface Output {
  blob: Blob;
  name: string;
  mode: Mode;
  askedMs: number;
  startMs: number;
  durationMs: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [mode, setMode] = useState<Mode>("fast");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const player = useRef<HTMLVideoElement>(null);
  const job = useRef<AbortController | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(
    () => () => {
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    },
    [],
  );

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setReading(true);
    try {
      const result = await client.run({ kind: "probe", file });
      if (result.kind !== "probe") return;
      const codec = await exactCodec(result.probe);
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
      const length = durationMs(result.probe.durationSeconds);
      setSource({
        file,
        url: URL.createObjectURL(file),
        probe: result.probe,
        durationMs: length,
        codec,
      });
      setMode(codec ? mode : "fast");
      setStart("0");
      setEnd(formatTime(length));
      setFileError("");
    } catch (caught) {
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setReading(false);
    }
  };

  const takeTime = (which: "start" | "end") => {
    const now = player.current?.currentTime ?? 0;
    const text = formatTime(Math.round(now * 1000));
    if (which === "start") setStart(text);
    else setEnd(text);
    setError("");
  };

  const trim = async () => {
    if (!source) return;
    setOutput(null);
    const cut = checkCut(start, end, source.durationMs);
    if (!cut.ok) {
      setError(cut.error);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    const controller = new AbortController();
    job.current = controller;
    try {
      const result = await client.run(
        {
          kind: "trim",
          file: source.file,
          startMs: cut.startMs,
          endMs: cut.endMs,
          mode,
          codec: mode === "exact" ? source.codec : null,
        },
        {
          signal: controller.signal,
          onProgress: ({ done, total }) =>
            setProgress(total ? Math.round((done / total) * 100) : 0),
        },
      );
      if (result.kind === "trim") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name, source.probe.container),
          mode,
          askedMs: cut.startMs,
          startMs: result.startMs,
          durationMs: result.durationMs,
        });
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const video = source?.probe.video;

  return (
    <>
      <Dropzone
        id="video-trimmer-file"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
        multiple={false}
        title="Drop a video here"
        hint={`or click to choose. MP4, MOV or WebM, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {reading && <Progress label="Reading the video" />}
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && video && (
        <>
          <p className="text-sm text-fg-muted" id="video-trimmer-source">
            {source.file.name}: {formatTime(source.durationMs)} long, {video.width} × {video.height}{" "}
            pixels, {formatSize(source.file.size)}
          </p>
          {/* biome-ignore lint/a11y/useMediaCaption: the visitor's own video has no captions to offer. */}
          <video
            ref={player}
            src={source.url}
            controls
            preload="none"
            className="w-full rounded-md border border-border"
            style={{ maxHeight: "20rem" }}
          />
          {!source.codec && (
            <Alert tone="info" title="Only the fast cut here" id="video-trimmer-support">
              {MESSAGES.noExact}
            </Alert>
          )}
          <Select
            id="video-trimmer-mode"
            label="Cut"
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
          >
            <option value="fast">{MODES.fast}</option>
            {source.codec && <option value="exact">{MODES.exact}</option>}
          </Select>
          <div className="grid items-end gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Input
                id="video-trimmer-start"
                label="Start"
                hint="Seconds, such as 12.5, or minutes and seconds, such as 1:05"
                value={start}
                onChange={(event) => {
                  setStart(event.target.value);
                  setError("");
                }}
              />
              <Button size="sm" variant="ghost" onClick={() => takeTime("start")}>
                Use the player's time as start
              </Button>
            </div>
            <div className="grid gap-2">
              <Input
                id="video-trimmer-end"
                label="End"
                hint={`Up to ${formatTime(source.durationMs)}`}
                value={end}
                onChange={(event) => {
                  setEnd(event.target.value);
                  setError("");
                }}
              />
              <Button size="sm" variant="ghost" onClick={() => takeTime("end")}>
                Use the player's time as end
              </Button>
            </div>
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void trim()}>
              Trim video
            </Button>
            {busy && (
              <Button variant="ghost" onClick={() => job.current?.abort()}>
                Cancel
              </Button>
            )}
          </div>
          {busy && <Progress value={progress} label="Trimming the video" />}
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Trimmed video">
          <FileResult
            name={output.name}
            meta={`${formatSeconds(output.durationMs)} long, from ${formatTime(output.startMs)} of the original, ${formatSize(output.blob.size)}`}
            state="done"
            icon="video-audio"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() =>
                  saveFile(output.blob, output.name, {
                    type: output.name.endsWith(".webm")
                      ? CONTAINERS.webm.mime
                      : CONTAINERS.mp4.mime,
                  })
                }
              >
                Download
              </Button>
            }
          >
            {output.mode === "fast" && output.startMs < output.askedMs && (
              <span className="text-sm text-fg-muted" id="video-trimmer-keyframe">
                The fast cut starts at the key frame at {formatTime(output.startMs)}, before the{" "}
                {formatTime(output.askedMs)} you chose. Use the exact cut to start on that frame.
              </span>
            )}
          </FileResult>
        </FileResultList>
      )}
    </>
  );
}

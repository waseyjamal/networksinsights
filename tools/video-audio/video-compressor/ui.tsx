import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Input,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useRef, useState } from "react";
import {
  AUDIO_BITRATE,
  type AudioPlan,
  bitrateForTarget,
  CONTAINERS,
  type ContainerChoice,
  type ContainerKind,
  checkFile,
  checkProbe,
  checkTarget,
  containerChoices,
  formatDuration,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  outputSize,
  type Probe,
  QUALITIES,
  type QualityKind,
  RESOLUTIONS,
  type ResolutionKind,
  type Support,
} from "./logic";

// The workspace of Video compressor. Choosing a video starts the worker, which reads only the
// file's headers; this page then asks the browser, with WebCodecs, whether it can decode the video
// and encode H.264, VP9, AAC and Opus at the output size, and offers only what it can really
// write. Mediabunny loads in the worker on that first file, never with the page (ADR 0051,
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

/** H.264 at High, Main and Baseline profiles (level 4.0 holds 1080p), and VP9 profile 0. */
const AVC = ["avc1.640028", "avc1.4d0028", "avc1.42e028"];
const VP9 = ["vp09.00.40.08"];

async function canEncodeVideo(codecs: string[], width: number, height: number) {
  if (typeof VideoEncoder === "undefined") return false;
  for (const codec of codecs) {
    if (await ask(() => VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 2e6 })))
      return true;
  }
  return false;
}

/** What this browser can do for this video at this output size, asked with WebCodecs. */
async function browserSupport(probe: Probe, width: number, height: number): Promise<Support> {
  const video = probe.video?.decoderConfig ?? null;
  const audio = probe.audio?.decoderConfig ?? null;
  const channels = Math.min(Math.max(probe.audio?.channels ?? 2, 1), 2);
  const hasAudioEncoder = typeof AudioEncoder !== "undefined";
  return {
    decodeVideo:
      typeof VideoDecoder !== "undefined" &&
      video !== null &&
      (await ask(() => VideoDecoder.isConfigSupported(video as unknown as VideoDecoderConfig))),
    decodeAudio:
      typeof AudioDecoder !== "undefined" &&
      audio !== null &&
      (await ask(() => AudioDecoder.isConfigSupported(audio as unknown as AudioDecoderConfig))),
    encodeAvc: await canEncodeVideo(AVC, width, height),
    encodeVp9: await canEncodeVideo(VP9, width, height),
    encodeAac:
      hasAudioEncoder &&
      (await ask(() =>
        AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: 48_000,
          numberOfChannels: channels,
          bitrate: AUDIO_BITRATE,
        }),
      )),
    encodeOpus:
      hasAudioEncoder &&
      (await ask(() =>
        AudioEncoder.isConfigSupported({
          codec: "opus",
          sampleRate: 48_000,
          numberOfChannels: channels,
          bitrate: AUDIO_BITRATE,
        }),
      )),
  };
}

const AUDIO_NOTES: Record<AudioPlan, string> = {
  none: "This video has no sound.",
  copy: "The sound is copied as it is.",
  encode: "The sound is encoded again at 128 kbit/s.",
  drop: "Your browser cannot keep the sound in this format, so the new video will be silent.",
};

interface Source {
  file: File;
  probe: Probe;
  /** Support asked at each resolution, since an encoder may take one size and not another. */
  choices: Record<ResolutionKind, ContainerChoice[]>;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [container, setContainer] = useState<ContainerKind>("mp4");
  const [mode, setMode] = useState<"quality" | "size">("quality");
  const [quality, setQuality] = useState<QualityKind>("medium");
  const [target, setTarget] = useState("10");
  const [resolution, setResolution] = useState<ResolutionKind>("keep");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    blob: Blob;
    name: string;
    kind: ContainerKind;
    width: number;
    height: number;
    audioKept: boolean;
    target?: number | undefined;
  } | null>(null);
  const [message, setMessage] = useState("");
  const job = useRef<AbortController | null>(null);

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
      const probe = answer.probe;
      const problem = checkProbe(probe);
      if (problem || !probe.video) {
        setFileError(`${file.name}: ${problem ?? MESSAGES.noVideo}`);
        return;
      }
      const choices = {} as Record<ResolutionKind, ContainerChoice[]>;
      for (const key of Object.keys(RESOLUTIONS) as ResolutionKind[]) {
        const size = outputSize(probe.video.width, probe.video.height, key);
        choices[key] = containerChoices(
          probe,
          await browserSupport(probe, size.width, size.height),
        );
      }
      setSource({ file, probe, choices });
      const first = choices[resolution].find((choice) => choice.available);
      if (first) setContainer(first.kind);
      // Start the target at about half the file, a common aim.
      const half = Math.round((file.size / 2 / 1024 / 1024) * 10) / 10;
      setTarget(String(Math.max(LIMITS.minTargetMegabytes, half)));
    } catch (caught) {
      setFileError(
        `${file.name}: ${caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.unreadable}`,
      );
    } finally {
      setReading(false);
    }
  };

  const choices = source?.choices[resolution] ?? [];
  const chosen = choices.find((choice) => choice.kind === container);
  const nothing = source !== null && !choices.some((choice) => choice.available);
  const size =
    source?.probe.video &&
    outputSize(source.probe.video.width, source.probe.video.height, resolution);
  const targetNumber = Number(target);
  const targetError =
    source && chosen && mode === "size"
      ? checkTarget(targetNumber, source.file.size, source.probe.durationSeconds, chosen.audio)
      : undefined;

  const start = async () => {
    if (!source || !chosen?.available || !size || targetError) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setProgress(0);
    setStage("Starting");
    setResult(null);
    setError("");
    setMessage("");
    const byTarget = mode === "size";
    try {
      const answer = await client.run(
        {
          kind: "convert",
          file: source.file,
          container,
          width: size.width,
          height: size.height,
          quality: byTarget
            ? bitrateForTarget(
                targetNumber,
                source.probe.durationSeconds,
                chosen.audio,
                AUDIO_BITRATE,
              )
            : quality,
          audio: chosen.audio,
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
        name: outputName(source.file.name, container),
        kind: container,
        width: answer.width,
        height: answer.height,
        audioKept: answer.audioKept,
        target: byTarget ? targetNumber : undefined,
      });
      setMessage("The compressed video is ready.");
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

  const smaller = result && source ? result.blob.size < source.file.size : false;

  return (
    <>
      <Dropzone
        id="video-compressor-file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm,.mkv"
        multiple={false}
        title="Drop a video here"
        hint={`or click to choose. MP4, MOV or WebM, up to ${formatSize(LIMITS.maxInputBytes)}, ${formatDuration(LIMITS.maxDurationSeconds)} and 4K`}
        onFiles={(files) => void choose(files)}
      />
      {reading && <Progress label="Reading the video" />}
      {fileError && (
        <Alert tone="warning" title="This video was not added">
          {fileError}
        </Alert>
      )}

      {source?.probe.video && (
        <>
          <p className="text-sm text-fg-muted" id="video-compressor-source">
            {source.file.name}, {formatSize(source.file.size)},{" "}
            {formatDuration(source.probe.durationSeconds)}, {source.probe.video.width} ×{" "}
            {source.probe.video.height} pixels
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Select
              id="video-compressor-resolution"
              label="Resolution"
              hint={size ? `The new video is ${size.width} × ${size.height} pixels.` : undefined}
              value={resolution}
              onChange={(event) => setResolution(event.target.value as ResolutionKind)}
            >
              {(Object.keys(RESOLUTIONS) as ResolutionKind[]).map((key) => (
                <option key={key} value={key}>
                  {RESOLUTIONS[key].label}
                </option>
              ))}
            </Select>
            {!nothing && (
              <Select
                id="video-compressor-container"
                label="Save as"
                hint={chosen ? AUDIO_NOTES[chosen.audio] : undefined}
                value={container}
                onChange={(event) => setContainer(event.target.value as ContainerKind)}
              >
                {choices
                  .filter((choice) => choice.available)
                  .map((choice) => (
                    <option key={choice.kind} value={choice.kind}>
                      {CONTAINERS[choice.kind].label}
                    </option>
                  ))}
              </Select>
            )}
          </div>
          {nothing && (
            <Alert tone="warning" title="Your browser cannot do this" id="video-compressor-support">
              {MESSAGES.noOutput}
            </Alert>
          )}
          {choices
            .filter((choice) => !choice.available)
            .map((choice) => (
              <p key={choice.kind} className="text-sm text-fg-muted" data-unavailable={choice.kind}>
                {CONTAINERS[choice.kind].label} is not offered: {choice.reason}
              </p>
            ))}
          {!nothing && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Select
                id="video-compressor-mode"
                label="Compress by"
                value={mode}
                onChange={(event) => setMode(event.target.value as "quality" | "size")}
              >
                <option value="quality">Quality</option>
                <option value="size">Target size (approximate)</option>
              </Select>
              {mode === "quality" ? (
                <Select
                  id="video-compressor-quality"
                  label="Quality"
                  value={quality}
                  onChange={(event) => setQuality(event.target.value as QualityKind)}
                >
                  {(Object.keys(QUALITIES) as QualityKind[]).map((key) => (
                    <option key={key} value={key}>
                      {QUALITIES[key].label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="video-compressor-target"
                  label="Target size in MB"
                  type="number"
                  inputMode="decimal"
                  min={LIMITS.minTargetMegabytes}
                  step="any"
                  value={target}
                  hint="The file comes out near this size, not exactly on it."
                  error={targetError}
                  onChange={(event) => setTarget(event.target.value)}
                />
              )}
            </div>
          )}
        </>
      )}

      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!source || !chosen?.available || Boolean(targetError)}
          onClick={() => void start()}
        >
          Compress video
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

      {result && source && (
        <div className="grid gap-3" id="video-compressor-result">
          <p className="text-sm">
            {result.name}, {result.width} × {result.height} pixels, {formatSize(source.file.size)} →{" "}
            {formatSize(result.blob.size)}
            {smaller
              ? ` (${Math.round((1 - result.blob.size / source.file.size) * 100)}% smaller)`
              : ""}
            {result.target !== undefined ? `, aimed at about ${result.target} MB` : ""}
          </p>
          {!smaller && (
            <Alert tone="warning" title="The new file is not smaller">
              This video was already well compressed. Try Low quality, a lower resolution or a
              target size.
            </Alert>
          )}
          {!result.audioKept && source.probe.audio && (
            <p className="text-sm text-fg-muted">The new video has no sound.</p>
          )}
          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              onClick={() =>
                saveFile(result.blob, result.name, { type: CONTAINERS[result.kind].mime })
              }
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

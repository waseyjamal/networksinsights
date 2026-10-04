import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useRef, useState } from "react";
import {
  type AudioDecoderConfigLike,
  checkFile,
  checkProbe,
  formatDuration,
  formatSize,
  isPcm,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  OUTPUTS,
  type OutputChoice,
  type OutputKind,
  outputChoices,
  outputName,
  type Probe,
  type Support,
} from "./logic";

// The workspace of Video to audio. Choosing a video starts the worker, which reads only the
// file's headers; this page then asks the browser, with WebCodecs, whether it can decode the sound
// and encode AAC, and offers only the outputs it can really write. Mediabunny loads in the worker
// on that first file, never with the page (ADR 0051, ADR 0061).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

/** Whether the browser decodes this audio track. PCM needs no decoder. */
async function canDecode(codec: string | null, config: AudioDecoderConfigLike | null) {
  if (isPcm(codec)) return true;
  if (!config || typeof AudioDecoder === "undefined") return false;
  try {
    return (await AudioDecoder.isConfigSupported(config as AudioDecoderConfig)).supported === true;
  } catch {
    return false;
  }
}

/** Whether the browser encodes AAC-LC at this rate and channel count. */
async function canEncodeAac(sampleRate: number, channels: number) {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const config = {
      codec: "mp4a.40.2",
      sampleRate: [44100, 48000].includes(sampleRate) ? sampleRate : 48000,
      numberOfChannels: Math.min(Math.max(channels, 1), 2),
      bitrate: 128_000,
    };
    return (await AudioEncoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

interface Source {
  file: File;
  probe: Probe;
  choices: OutputChoice[];
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [output, setOutput] = useState<OutputKind>("m4a");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    blob: Blob;
    name: string;
    kind: OutputKind;
    copied: boolean;
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
      if (problem) {
        setFileError(`${file.name}: ${problem}`);
        return;
      }
      const audio = probe.audio;
      const support: Support = {
        decodeAudio: audio ? await canDecode(audio.codec, audio.decoderConfig) : false,
        encodeAac: audio ? await canEncodeAac(audio.sampleRate, audio.channels) : false,
      };
      const choices = outputChoices(probe, support);
      setSource({ file, probe, choices });
      const first = choices.find((choice) => choice.available);
      if (first) setOutput(first.kind);
    } catch (caught) {
      setFileError(
        `${file.name}: ${caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.unreadable}`,
      );
    } finally {
      setReading(false);
    }
  };

  const chosen = source?.choices.find((choice) => choice.kind === output);
  const nothing = source !== null && !source.choices.some((choice) => choice.available);

  const start = async () => {
    if (!source || !chosen?.available) return;
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
        { kind: "convert", file: source.file, output, copy: chosen.copy },
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
        name: outputName(source.file.name, output),
        kind: output,
        copied: answer.copied,
      });
      setMessage("The audio is ready.");
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
        id="video-to-audio-file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm,.mkv"
        multiple={false}
        title="Drop a video here"
        hint={`or click to choose. MP4, MOV or WebM, up to ${formatSize(LIMITS.maxInputBytes)} and ${formatDuration(LIMITS.maxDurationSeconds)}`}
        onFiles={(files) => void choose(files)}
      />
      {reading && <Progress label="Reading the video" />}
      {fileError && (
        <Alert tone="warning" title="This video was not added">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="video-to-audio-source">
            {source.file.name}, {formatSize(source.file.size)},{" "}
            {formatDuration(source.probe.durationSeconds)}, sound:{" "}
            {source.probe.audio?.codec ?? "none"}
          </p>
          {nothing ? (
            <Alert tone="warning" title="Your browser cannot do this" id="video-to-audio-support">
              {MESSAGES.noOutput}
            </Alert>
          ) : (
            <Select
              id="video-to-audio-output"
              label="Save as"
              value={output}
              hint={
                chosen?.kind === "m4a" && chosen.copy
                  ? "The AAC sound is copied as it is: no quality is lost and it is quick."
                  : chosen?.kind === "m4a"
                    ? "The sound is encoded again as AAC at 128 kbit/s."
                    : "WAV keeps every sample and is about 10 MB a minute."
              }
              onChange={(event) => setOutput(event.target.value as OutputKind)}
            >
              {source.choices
                .filter((choice) => choice.available)
                .map((choice) => (
                  <option key={choice.kind} value={choice.kind}>
                    {OUTPUTS[choice.kind].label}
                  </option>
                ))}
            </Select>
          )}
          {source.choices
            .filter((choice) => !choice.available)
            .map((choice) => (
              <p key={choice.kind} className="text-sm text-fg-muted" data-unavailable={choice.kind}>
                {OUTPUTS[choice.kind].label} is not offered: {choice.reason}
              </p>
            ))}
        </>
      )}

      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!source || !chosen?.available}
          onClick={() => void start()}
        >
          Extract audio
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
        <div className="grid gap-3" id="video-to-audio-result">
          <p className="text-sm">
            {result.name}, {formatSize(result.blob.size)}
            {result.copied ? ", copied without re-encoding" : ""}
          </p>
          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              onClick={() =>
                saveFile(result.blob, result.name, { type: OUTPUTS[result.kind].mime })
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

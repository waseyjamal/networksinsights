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
  BITRATES,
  type Bitrate,
  checkFile,
  checkProbe,
  DEFAULT_BITRATE,
  estimateBytes,
  formatDuration,
  formatSize,
  isPcm,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  type Probe,
} from "./logic";

// The workspace of Video to MP3. Choosing a video starts the worker, which reads only the file's
// headers; this page then asks the browser, with WebCodecs, whether it can decode the sound, and
// offers the MP3 only when it can. Mediabunny and the LAME encoder load in the worker, never with
// the page (ADR 0061, ADR 0064).

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

interface Source {
  file: File;
  probe: Probe;
  decodable: boolean;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [bitrate, setBitrate] = useState<Bitrate>(DEFAULT_BITRATE);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
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
      const problem = checkProbe(answer.probe);
      if (problem) {
        setFileError(`${file.name}: ${problem}`);
        return;
      }
      const audio = answer.probe.audio;
      const decodable = audio ? await canDecode(audio.codec, audio.decoderConfig) : false;
      setSource({ file, probe: answer.probe, decodable });
    } catch (caught) {
      setFileError(
        `${file.name}: ${caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.unreadable}`,
      );
    } finally {
      setReading(false);
    }
  };

  const start = async () => {
    if (!source?.decodable) return;
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
        { kind: "convert", file: source.file, bitrate },
        {
          signal: controller.signal,
          onProgress: ({ done, total, stage: now }) => {
            setProgress(Math.round((done / total) * 100));
            if (now) setStage(now);
          },
        },
      );
      if (answer.kind !== "convert") return;
      setResult({ blob: answer.blob, name: outputName(source.file.name) });
      setMessage("The MP3 is ready.");
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
        id="video-to-mp3-file"
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
          <p className="text-sm text-fg-muted" id="video-to-mp3-source">
            {source.file.name}, {formatSize(source.file.size)},{" "}
            {formatDuration(source.probe.durationSeconds)}, sound:{" "}
            {source.probe.audio?.codec ?? "none"}
          </p>
          {source.decodable ? (
            <Select
              id="video-to-mp3-bitrate"
              label="MP3 quality"
              value={String(bitrate)}
              hint={`About ${formatSize(estimateBytes(source.probe.durationSeconds, bitrate))} at this quality.`}
              onChange={(event) => setBitrate(Number(event.target.value) as Bitrate)}
            >
              {BITRATES.map((value) => (
                <option key={value} value={value}>
                  {value} kbit/s
                </option>
              ))}
            </Select>
          ) : (
            <Alert tone="warning" title="Your browser cannot do this" id="video-to-mp3-support">
              {MESSAGES.cannotDecode}
            </Alert>
          )}
        </>
      )}

      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!source?.decodable}
          onClick={() => void start()}
        >
          Make MP3
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
        <div className="grid gap-3" id="video-to-mp3-result">
          <p className="text-sm">
            {result.name}, {formatSize(result.blob.size)}
          </p>
          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              onClick={() => saveFile(result.blob, result.name, { type: "audio/mpeg" })}
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

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

// The workspace of Audio converter. Choosing a file starts the worker, which reads only its
// headers; this page then asks the browser, with WebCodecs, whether it can decode the sound and
// encode Opus and AAC, and offers only the formats it can really write. Mediabunny and the FLAC
// encoder load in the worker on that first file, never with the page (ADR 0051, ADR 0061).

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

/** What this browser can do for this file, asked with WebCodecs. */
async function browserSupport(probe: Probe): Promise<Support> {
  const config = probe.decoderConfig;
  const hasDecoder = typeof AudioDecoder !== "undefined";
  const hasEncoder = typeof AudioEncoder !== "undefined";
  const channels = Math.min(Math.max(probe.channels, 1), 2);
  const aacRate = [44_100, 48_000].includes(probe.sampleRate) ? probe.sampleRate : 48_000;
  return {
    decode:
      isPcm(probe.codec) ||
      (hasDecoder &&
        config !== null &&
        (await ask(() =>
          AudioDecoder.isConfigSupported(config as AudioDecoderConfigLike as AudioDecoderConfig),
        ))),
    encodeOpus:
      hasEncoder &&
      (await ask(() =>
        AudioEncoder.isConfigSupported({
          codec: "opus",
          sampleRate: 48_000,
          numberOfChannels: channels,
          bitrate: 128_000,
        }),
      )),
    encodeAac:
      hasEncoder &&
      (await ask(() =>
        AudioEncoder.isConfigSupported({
          codec: "mp4a.40.2",
          sampleRate: aacRate,
          numberOfChannels: channels,
          bitrate: 128_000,
        }),
      )),
    wasm: typeof WebAssembly === "object" && typeof Worker !== "undefined",
  };
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
  const [output, setOutput] = useState<OutputKind>("flac");
  const [bitrate, setBitrate] = useState<Bitrate>("128");
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
      const problem = checkProbe(answer.probe);
      if (problem) {
        setFileError(`${file.name}: ${problem}`);
        return;
      }
      const choices = outputChoices(answer.probe, await browserSupport(answer.probe));
      setSource({ file, probe: answer.probe, choices });
      const current = choices.find((choice) => choice.kind === output && choice.available);
      const first = current ?? choices.find((choice) => choice.available);
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
  const lossy = !OUTPUTS[output].lossless;

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
        { kind: "convert", file: source.file, output, bitrate: BITRATES[bitrate].value },
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
      setMessage("The converted file is ready.");
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
        id="audio-converter-file"
        accept="audio/wav,audio/flac,audio/ogg,audio/mp4,audio/x-m4a,audio/webm,.wav,.flac,.ogg,.oga,.opus,.m4a,.aac,.weba,.webm"
        multiple={false}
        title="Drop an audio file here"
        hint={`or click to choose. WAV, FLAC, OGG, M4A or WebM, up to ${formatSize(LIMITS.maxInputBytes)} and ${formatDuration(LIMITS.maxDurationSeconds)}`}
        onFiles={(files) => void choose(files)}
      />
      {reading && <Progress label="Reading the file" />}
      {fileError && (
        <Alert tone="warning" title="This file was not added">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="audio-converter-source">
            {source.file.name}, {formatSize(source.file.size)},{" "}
            {formatDuration(source.probe.durationSeconds)}, {source.probe.codec ?? "unknown"},{" "}
            {source.probe.sampleRate} Hz
          </p>
          {nothing ? (
            <Alert tone="warning" title="Your browser cannot do this" id="audio-converter-support">
              {MESSAGES.noOutput}
            </Alert>
          ) : (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Select
                id="audio-converter-output"
                label="Convert to"
                value={output}
                hint={
                  chosen?.copy
                    ? "Same kind of sound as the file: it is copied as it is, with no loss."
                    : undefined
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
              <Select
                id="audio-converter-bitrate"
                label="Bitrate"
                disabled={!lossy || chosen?.copy}
                hint={
                  !lossy
                    ? "Lossless formats keep every sample, so they have no bitrate setting."
                    : chosen?.copy
                      ? "A copy keeps the bitrate of the file."
                      : undefined
                }
                value={bitrate}
                onChange={(event) => setBitrate(event.target.value as Bitrate)}
              >
                {(Object.keys(BITRATES) as Bitrate[]).map((key) => (
                  <option key={key} value={key}>
                    {BITRATES[key].label}
                  </option>
                ))}
              </Select>
            </div>
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
          Convert
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
        <div className="grid gap-3" id="audio-converter-result">
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

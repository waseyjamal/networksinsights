import {
  Alert,
  Button,
  Checkbox,
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
import { useState } from "react";
import {
  type AudioDecoderConfigLike,
  checkFile,
  checkLength,
  checkSettings,
  DEFAULTS,
  formatSeconds,
  formatSize,
  isPcm,
  type Job,
  type JobResult,
  KEPT_PAUSE,
  LIMITS,
  MESSAGES,
  OUTPUTS,
  type OutputId,
  outputName,
  PEAK_TARGET_DB,
  type Probe,
  RANGES,
  type Report,
} from "./logic";

// The workspace of Audio Silence Remover. Choosing a recording starts the worker, which reads its
// headers; this page asks the browser, with WebCodecs, whether it decodes the sound and which of
// AAC and Opus it can encode, and offers only those besides WAV. Mediabunny loads in the worker
// on the first file (ADR 0061).

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

async function canDecode(codec: string | null, config: AudioDecoderConfigLike | null) {
  if (isPcm(codec)) return true;
  if (!config || typeof AudioDecoder === "undefined") return false;
  return ask(() => AudioDecoder.isConfigSupported(config as AudioDecoderConfig));
}

async function outputsFor(probe: Probe): Promise<OutputId[]> {
  const found: OutputId[] = ["wav"];
  if (typeof AudioEncoder === "undefined") return found;
  const numberOfChannels = Math.min(2, probe.channels);
  const config = (codec: string, sampleRate: number) => ({
    codec,
    sampleRate,
    numberOfChannels,
    bitrate: 128_000,
  });
  if (await ask(() => AudioEncoder.isConfigSupported(config("mp4a.40.2", probe.sampleRate))))
    found.push("m4a");
  if (await ask(() => AudioEncoder.isConfigSupported(config("opus", 48_000)))) found.push("ogg");
  return found;
}

interface Source {
  file: File;
  probe: Probe;
  decodable: boolean;
  outputs: OutputId[];
}

interface Output extends Report {
  blob: Blob;
  name: string;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;
const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [threshold, setThreshold] = useState(String(DEFAULTS.threshold));
  const [minSilence, setMinSilence] = useState(String(DEFAULTS.minSilence));
  const [normalize, setNormalize] = useState(true);
  const [output, setOutputId] = useState<OutputId>("wav");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Output | null>(null);

  const problems = checkSettings(number(threshold), number(minSilence));

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setResult(null);
    setError("");
    setSource(null);
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    try {
      const answer = await client.run({ kind: "probe", file });
      if (answer.kind !== "probe") return;
      const tooLong = checkLength(answer.probe.durationSeconds);
      if (tooLong) {
        setFileError(`${file.name}: ${tooLong}`);
        return;
      }
      const decodable = await canDecode(answer.probe.codec, answer.probe.decoderConfig);
      const outputs = await outputsFor(answer.probe);
      setFileError("");
      setSource({ file, probe: answer.probe, decodable, outputs });
      setOutputId("wav");
    } catch (caught) {
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    }
  };

  const clean = async () => {
    if (!source) return;
    setResult(null);
    const problem = problems.threshold ?? problems.minSilence;
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const done = await client.run(
        {
          kind: "clean",
          file: source.file,
          threshold: number(threshold),
          minSilence: number(minSilence),
          normalize,
          output,
        },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (done.kind === "clean") {
        setResult({ ...done, name: outputName(source.file.name, output) });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Alert tone="info" title="It removes silence, not noise">
        Hum, hiss, wind and background chatter stay as they are. Only parts quieter than the
        threshold are cut.
      </Alert>
      <Dropzone
        id="audio-silence-remover-file"
        accept="audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/opus,audio/webm,.wav,.m4a,.ogg,.oga,.opus,.webm,.weba"
        multiple={false}
        title="Drop a recording here"
        hint={`or click to choose. WAV, M4A, OGG or WebM, up to ${formatSize(LIMITS.maxInputBytes)} and 10 minutes`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <p className="text-sm text-danger-text" role="status" id="audio-silence-remover-file-error">
          {fileError}
        </p>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="audio-silence-remover-source">
            {source.file.name}: {formatSeconds(source.probe.durationSeconds)},{" "}
            {source.probe.sampleRate} Hz,{" "}
            {source.probe.channels === 1 ? "mono" : `${source.probe.channels} channels`},{" "}
            {formatSize(source.file.size)}
          </p>
          {!source.decodable ? (
            <Alert tone="warning" id="audio-silence-remover-support">
              {MESSAGES.cannotDecode}
            </Alert>
          ) : (
            <>
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Input
                  id="audio-silence-remover-threshold"
                  label="Threshold (dB)"
                  hint="Quieter than this counts as silence"
                  type="number"
                  min={RANGES.threshold.min}
                  max={RANGES.threshold.max}
                  value={threshold}
                  error={problems.threshold}
                  onChange={(event) => setThreshold(event.target.value)}
                />
                <Input
                  id="audio-silence-remover-min"
                  label="Shortest silence to cut (seconds)"
                  hint={`Longer pauses inside become ${KEPT_PAUSE} seconds`}
                  type="number"
                  step={0.1}
                  min={RANGES.minSilence.min}
                  max={RANGES.minSilence.max}
                  value={minSilence}
                  error={problems.minSilence}
                  onChange={(event) => setMinSilence(event.target.value)}
                />
                <Select
                  id="audio-silence-remover-output"
                  label="Save as"
                  hint="Only the formats your browser can write are listed"
                  value={output}
                  onChange={(event) => setOutputId(event.target.value as OutputId)}
                >
                  {source.outputs.map((key) => (
                    <option key={key} value={key}>
                      {OUTPUTS[key].label}
                    </option>
                  ))}
                </Select>
              </div>
              <Checkbox
                id="audio-silence-remover-normalize"
                label={`Normalise: bring the loudest peak to ${PEAK_TARGET_DB} dB`}
                checked={normalize}
                onChange={(event) => setNormalize(event.target.checked)}
              />
              <div className="ni-workspace__actions">
                <Button variant="primary" loading={busy} onClick={() => void clean()}>
                  Remove silence
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {busy && <Progress value={progress} label="Removing silence" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {result && (
        <FileResultList label="Trimmed recording">
          <FileResult
            name={result.name}
            meta={`${formatSeconds(result.beforeSeconds)} to ${formatSeconds(result.afterSeconds)}, ${
              result.gainDb === 0
                ? "volume unchanged"
                : `volume ${result.gainDb > 0 ? "+" : ""}${Math.round(result.gainDb * 10) / 10} dB`
            }, ${formatSize(result.blob.size)}`}
            state="done"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${result.name}`}
                onClick={() => saveFile(result.blob, result.name, { type: result.blob.type })}
              >
                Download
              </Button>
            }
          />
        </FileResultList>
      )}
    </>
  );
}

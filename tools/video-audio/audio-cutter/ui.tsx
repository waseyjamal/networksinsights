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
import { useState } from "react";
import {
  type AudioDecoderConfigLike,
  checkCut,
  checkFile,
  durationMs,
  formatSize,
  formatTime,
  isPcm,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  MODES,
  type Mode,
  modesFor,
  outputName,
  type Probe,
  supportNote,
} from "./logic";

// The workspace of Audio Cutter. Choosing a recording starts the worker, which reads only its
// headers and says whether the file can be cut by copying; this page then asks the browser, with
// WebCodecs, whether it can decode the sound, and offers only the ways to cut that will work.
// Mediabunny loads in the worker on that first file, never with the page (ADR 0051, ADR 0061).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

/** Whether the browser decodes this sound. PCM needs no decoder. */
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
  durationMs: number;
  modes: Mode[];
  note: string | undefined;
}

interface Output {
  blob: Blob;
  name: string;
  mode: Mode;
  durationMs: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [mode, setMode] = useState<Mode>("copy");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    setError("");
    setSource(null);
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setFileError("");
    setReading(true);
    try {
      const result = await client.run({ kind: "probe", file });
      if (result.kind !== "probe") return;
      const probe = result.probe;
      const decodable = await canDecode(probe.codec, probe.decoderConfig);
      const modes = modesFor(probe.copyable, decodable);
      const length = durationMs(probe.durationSeconds);
      setSource({
        file,
        probe,
        durationMs: length,
        modes,
        note: supportNote(probe.copyable, decodable),
      });
      setMode(modes[0] ?? "copy");
      setStart("0");
      setEnd(formatTime(length));
    } catch (caught) {
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setReading(false);
    }
  };

  const cut = async () => {
    if (!source) return;
    setOutput(null);
    const checked = checkCut(start, end, source.durationMs, mode);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { kind: "cut", file: source.file, startMs: checked.startMs, endMs: checked.endMs, mode },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (result.kind === "cut") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name, mode),
          mode,
          durationMs: result.durationMs,
        });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="audio-cutter-file"
        accept="audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,audio/opus,audio/webm,.wav,.m4a,.ogg,.oga,.opus,.webm,.weba"
        multiple={false}
        title="Drop a recording here"
        hint={`or click to choose. WAV, M4A, OGG or WebM, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {reading && <p className="text-sm text-fg-muted">Reading the recording…</p>}
      {fileError && (
        <p className="text-sm text-danger-text" role="status">
          {fileError}
        </p>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="audio-cutter-source">
            {source.file.name}: {formatTime(source.durationMs)} long, {source.probe.sampleRate} Hz,{" "}
            {source.probe.channels === 1 ? "mono" : `${source.probe.channels} channels`},{" "}
            {formatSize(source.file.size)}
          </p>
          {source.note && (
            <Alert tone={source.modes.length === 0 ? "warning" : "info"} id="audio-cutter-support">
              {source.note}
            </Alert>
          )}
          {source.modes.length > 0 && (
            <>
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Input
                  id="audio-cutter-start"
                  label="Start"
                  hint="Seconds, or minutes:seconds"
                  inputMode="decimal"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
                <Input
                  id="audio-cutter-end"
                  label="End"
                  hint={`At most ${formatTime(source.durationMs)}`}
                  inputMode="decimal"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
                <Select
                  id="audio-cutter-mode"
                  label="How to cut"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as Mode)}
                >
                  {source.modes.map((key) => (
                    <option key={key} value={key}>
                      {MODES[key]}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-sm text-fg-muted">
                {mode === "copy"
                  ? "The sound is copied as it is, so nothing is lost, but the cut falls on the nearest sound packet, a few hundredths of a second from the times you typed. The new file is M4A."
                  : `The sound is decoded and written as WAV, cut on the exact sample. WAV is large and uncompressed; an exact cut can be at most ${LIMITS.maxWavCutMs / 60_000} minutes long.`}
              </p>
              <div className="ni-workspace__actions">
                <Button variant="primary" loading={busy} onClick={() => void cut()}>
                  Cut
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {busy && <Progress value={progress} label="Cutting the recording" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Cut recording">
          <FileResult
            name={output.name}
            meta={`${formatTime(output.durationMs)} long, ${formatSize(output.blob.size)}, ${
              output.mode === "copy" ? "not re-encoded" : "16-bit WAV"
            }`}
            state="done"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: output.blob.type })}
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

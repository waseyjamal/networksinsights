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
import { useRef, useState } from "react";
import {
  type ClipInfo,
  channelLabel,
  checkFile,
  formatDuration,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  move,
  outputName,
  targetFormat,
  tooLong,
} from "./logic";

// The workspace of Audio Joiner. Each recording added starts a probe in worker.ts, which decodes
// its first piece of sound to learn its real sample rate and channels; the list can be reordered.
// Join sends the files in order with the joined file's format, which logic.ts chooses from the
// probes. Mediabunny loads only with the worker (ADR 0061).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Clip {
  id: number;
  file: File;
  info: ClipInfo | null;
  error: string;
}

interface Output {
  blob: Blob;
  name: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

const clipMeta = (clip: Clip) =>
  clip.error ||
  (clip.info
    ? `${formatDuration(clip.info.durationSeconds)}, ${clip.info.sampleRate} Hz, ${channelLabel(clip.info.channels)}`
    : "Reading…");

export default function ToolUi() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const nextId = useRef(1);

  const update = (next: Clip[]) => {
    setClips(next);
    setOutput(null);
    setError("");
  };

  const add = async (files: File[]) => {
    const problems: string[] = [];
    const added: Clip[] = [];
    for (const file of files) {
      const problem = checkFile(file);
      if (problem) problems.push(`${file.name}: ${problem}`);
      else if (clips.length + added.length >= LIMITS.maxFiles) {
        problems.push(`${file.name}: ${MESSAGES.tooMany}`);
      } else added.push({ id: nextId.current++, file, info: null, error: "" });
    }
    setRejected(problems);
    if (added.length === 0) return;
    update([...clips, ...added]);
    for (const clip of added) {
      let info: ClipInfo | null = null;
      let problem = "";
      try {
        const result = await client.run({ kind: "probe", file: clip.file });
        if (result.kind === "probe") info = result.clip;
      } catch (caught) {
        problem = failure(caught, MESSAGES.unreadable);
      }
      setClips((list) =>
        list.map((entry) => (entry.id === clip.id ? { ...entry, info, error: problem } : entry)),
      );
    }
  };

  const ready = clips.every((clip) => clip.info !== null);
  const infos = clips.flatMap((clip) => (clip.info ? [clip.info] : []));
  const target = targetFormat(infos);
  const long = tooLong(infos);

  const join = async () => {
    setOutput(null);
    setError("");
    if (clips.length < 2) {
      setError(MESSAGES.needTwo);
      return;
    }
    if (!ready || clips.some((clip) => clip.error)) {
      setError("Remove the recordings that could not be read, then join again.");
      return;
    }
    if (long) {
      setError(MESSAGES.tooLong);
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        {
          kind: "join",
          files: clips.map((clip) => clip.file),
          sampleRate: target.sampleRate,
          channels: target.channels,
        },
        {
          onProgress: ({ done, total }) =>
            setProgress(total ? Math.round((done / total) * 100) : 0),
        },
      );
      if (result.kind === "join") {
        setOutput({
          blob: result.blob,
          name: outputName(clips[0]?.file.name ?? "audio"),
          durationMs: result.durationMs,
          sampleRate: result.sampleRate,
          channels: result.channels,
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
        id="audio-joiner-files"
        accept="audio/*,.wav,.m4a,.mp3,.ogg,.oga,.opus,.flac"
        multiple
        title="Drop recordings here"
        hint={`or click to choose. Up to ${LIMITS.maxFiles} files of up to ${formatSize(LIMITS.maxInputBytes)} each`}
        onFiles={(files) => void add(files)}
      />
      {rejected.length > 0 && (
        <Alert tone="warning" title="Some files were not added">
          {rejected.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Alert>
      )}

      {clips.length > 0 && (
        <FileResultList label="Recordings to join">
          {clips.map((clip, index) => (
            <FileResult
              key={clip.id}
              name={`${index + 1}. ${clip.file.name}`}
              meta={clipMeta(clip)}
              state={clip.error ? "error" : undefined}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={index === 0 || busy}
                    aria-label={`Move ${clip.file.name} up`}
                    onClick={() => update(move(clips, index, -1))}
                  >
                    Up
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={index === clips.length - 1 || busy}
                    aria-label={`Move ${clip.file.name} down`}
                    onClick={() => update(move(clips, index, 1))}
                  >
                    Down
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${clip.file.name}`}
                    onClick={() => update(clips.filter((entry) => entry.id !== clip.id))}
                  >
                    Remove
                  </Button>
                </>
              }
            />
          ))}
        </FileResultList>
      )}

      {clips.length >= 2 && ready && infos.length > 0 && (
        <p className="text-sm text-fg-muted" id="audio-joiner-summary">
          {`${clips.length} recordings, ${formatDuration(infos.reduce((sum, clip) => sum + clip.durationSeconds, 0))} in all. The joined WAV will be ${target.sampleRate} Hz ${channelLabel(target.channels)}.`}
        </p>
      )}

      {clips.length > 0 && (
        <div className="ni-workspace__actions">
          <Button variant="primary" loading={busy} onClick={() => void join()}>
            {`Join ${clips.length} ${clips.length === 1 ? "recording" : "recordings"}`}
          </Button>
        </div>
      )}

      {busy && <Progress value={progress} label="Joining the recordings" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Joined recording">
          <FileResult
            name={output.name}
            meta={`${formatDuration(output.durationMs / 1000)}, ${output.sampleRate} Hz ${channelLabel(output.channels)}, ${formatSize(output.blob.size)}`}
            state="done"
            icon="video-audio"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "audio/wav" })}
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

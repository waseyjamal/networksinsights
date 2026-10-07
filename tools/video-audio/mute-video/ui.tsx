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
import { useState } from "react";
import {
  CONTAINERS,
  type Container,
  checkFile,
  formatDuration,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  type Probe,
} from "./logic";

// The workspace of Mute Video. Choosing a video starts worker.ts, which reads what the file holds;
// a video with no sound is reported as such and nothing more happens. Remove sound copies the video
// track into a new file without the audio. Mediabunny loads only with the worker (ADR 0061).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  probe: Probe;
}

interface Output {
  blob: Blob;
  name: string;
  durationMs: number;
  container: Container;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
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
    setBusy(true);
    try {
      const result = await client.run({ kind: "probe", file });
      if (result.kind === "probe") setSource({ file, probe: result.probe });
      setFileError("");
    } catch (caught) {
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setBusy(false);
    }
  };

  const mute = async () => {
    if (!source) return;
    setOutput(null);
    setError("");
    setProgress(0);
    setBusy(true);
    try {
      const result = await client.run(
        { kind: "mute", file: source.file },
        {
          onProgress: ({ done, total }) =>
            setProgress(total ? Math.round((done / total) * 100) : 0),
        },
      );
      if (result.kind === "mute") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name, result.container),
          durationMs: result.durationMs,
          container: result.container,
        });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const probe = source?.probe;

  return (
    <>
      <Alert tone="info" title="Copied, not re-encoded">
        The picture is copied into the new file exactly as it is stored, packet for packet, so its
        quality does not change. Only the sound is left out.
      </Alert>
      <Dropzone
        id="mute-video-file"
        accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv"
        multiple={false}
        title="Drop a video here"
        hint={`or click to choose. MP4, MOV, WebM or MKV, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && probe && (
        <>
          <p className="text-sm text-fg-muted" id="mute-video-original">
            {`${source.file.name}: ${CONTAINERS[probe.container].label}, ${formatDuration(probe.durationSeconds)}, ${probe.width} × ${probe.height}, ${
              probe.audioTracks === 0
                ? "no sound"
                : `${probe.audioTracks} audio ${probe.audioTracks === 1 ? "track" : "tracks"}`
            }`}
          </p>
          {probe.hasAudio ? (
            <div className="ni-workspace__actions">
              <Button variant="primary" loading={busy} onClick={() => void mute()}>
                Remove sound
              </Button>
            </div>
          ) : (
            <Alert tone="info" title="Nothing to remove" id="mute-video-silent">
              {MESSAGES.noAudio}
            </Alert>
          )}
        </>
      )}

      {busy && source && <Progress value={progress} label="Copying the video" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Muted video">
          <FileResult
            name={output.name}
            meta={`${formatDuration(output.durationMs / 1000)}, no sound, ${formatSize(output.blob.size)}`}
            state="done"
            icon="video-audio"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() =>
                  saveFile(output.blob, output.name, { type: CONTAINERS[output.container].mime })
                }
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

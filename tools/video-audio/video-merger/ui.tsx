import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useRef, useState } from "react";
import {
  AUDIO_BITRATE,
  AUDIO_CHANNELS,
  AUDIO_RATE,
  CONTAINERS,
  type Container,
  checkFile,
  checkList,
  type DecoderConfigLike,
  durationMs,
  type Encoders,
  formatSize,
  formatTime,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  move,
  outputName,
  outputSize,
  type Probe,
  room,
} from "./logic";

// The workspace of Video Merger. Each clip added is read by the worker, which looks only at its
// headers; this page asks the browser, with WebCodecs, whether it decodes each clip, and which
// containers it can encode at the joined size, and offers only those. Join sends the clips in the
// chosen order to the worker. Mediabunny loads in the worker on the first clip (ADR 0061).

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

const decodesVideo = (config: DecoderConfigLike | null) =>
  config !== null &&
  typeof VideoDecoder !== "undefined" &&
  ask(() => VideoDecoder.isConfigSupported(config as unknown as VideoDecoderConfig));

async function decodesAudio(probe: Probe): Promise<boolean> {
  if (probe.pcmAudio) return true;
  const config = probe.audioConfig;
  if (!config || typeof AudioDecoder === "undefined") return false;
  return ask(() => AudioDecoder.isConfigSupported(config as unknown as AudioDecoderConfig));
}

/** The containers this browser can write at this size, with the encoders it would use. */
async function encodersFor(width: number, height: number, withSound: boolean) {
  const found: Encoders[] = [];
  if (typeof VideoEncoder === "undefined") return found;
  for (const container of Object.keys(CONTAINERS) as Container[]) {
    const choice = CONTAINERS[container];
    let video: string | null = null;
    for (const option of choice.video) {
      const supported = await ask(() =>
        VideoEncoder.isConfigSupported({
          codec: option.webcodecs,
          width,
          height,
          bitrate: 2_000_000,
        }),
      );
      if (supported) {
        video = option.codec;
        break;
      }
    }
    if (!video) continue;
    if (withSound) {
      const audio =
        typeof AudioEncoder !== "undefined" &&
        (await ask(() =>
          AudioEncoder.isConfigSupported({
            codec: choice.audio.webcodecs,
            sampleRate: AUDIO_RATE,
            numberOfChannels: AUDIO_CHANNELS,
            bitrate: AUDIO_BITRATE,
          }),
        ));
      if (!audio) continue;
      found.push({ container, video, audio: choice.audio.codec });
    } else {
      found.push({ container, video, audio: null });
    }
  }
  return found;
}

interface Clip {
  id: number;
  file: File;
  state: "reading" | "ready" | "error";
  problem?: string;
  probe?: Probe;
  ms: number;
  /** Whether the browser decodes its pictures, and its sound (false when it has none). */
  video: boolean;
  sound: boolean;
}

interface Joined {
  blob: Blob;
  name: string;
  durationMs: number;
  width: number;
  height: number;
  container: Container;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

function clipMeta(clip: Clip): string {
  if (clip.state === "reading") return "Reading…";
  if (clip.state === "error" || !clip.probe) return clip.problem ?? MESSAGES.unreadable;
  if (!clip.video) return MESSAGES.cannotDecode;
  const sound = !clip.probe.audioConfig
    ? "no sound"
    : clip.sound
      ? "with sound"
      : "sound cannot be decoded here, so it will be silent";
  return `${formatTime(clip.ms)}, ${clip.probe.width} × ${clip.probe.height}, ${sound}, ${formatSize(clip.file.size)}`;
}

export default function ToolUi() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [encoders, setEncoders] = useState<Encoders[] | null>(null);
  const [container, setContainer] = useState<Container>("mp4");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<Joined | null>(null);
  const nextId = useRef(1);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  const first = clips[0]?.probe;
  const size = first ? outputSize(first.width, first.height) : null;

  /** Asks again which containers can be written, for the first clip's size and the sound. */
  const refreshEncoders = async (list: Clip[]) => {
    const head = list[0]?.probe;
    if (!head) {
      setEncoders(null);
      return;
    }
    const target = outputSize(head.width, head.height);
    const found = await encodersFor(
      target.width,
      target.height,
      list.some((clip) => clip.sound),
    );
    setEncoders(found);
    setContainer((current) =>
      found.some((entry) => entry.container === current) ? current : (found[0]?.container ?? "mp4"),
    );
  };

  const update = (next: Clip[]) => {
    setClips(next);
    setJoined(null);
    void refreshEncoders(next);
  };

  const add = async (files: File[]) => {
    setError("");
    setJoined(null);
    const refused: string[] = [];
    const accepted: Clip[] = [];
    let space = room(clipsRef.current.length);
    for (const file of files) {
      const problem = checkFile(file);
      if (problem) refused.push(`${file.name}: ${problem}`);
      else if (space <= 0) refused.push(`${file.name}: ${MESSAGES.tooMany}`);
      else {
        space--;
        accepted.push({
          id: nextId.current++,
          file,
          state: "reading",
          ms: 0,
          video: false,
          sound: false,
        });
      }
    }
    setRejected(refused);
    if (accepted.length === 0) return;
    setClips((list) => [...list, ...accepted]);
    for (const clip of accepted) {
      let done: Clip;
      try {
        const result = await client.run({ kind: "probe", file: clip.file });
        if (result.kind !== "probe") continue;
        const probe = result.probe;
        done = {
          ...clip,
          state: "ready",
          probe,
          ms: durationMs(probe.durationSeconds),
          video: await decodesVideo(probe.videoConfig),
          sound: probe.audioConfig ? await decodesAudio(probe) : false,
        };
      } catch (caught) {
        done = { ...clip, state: "error", problem: failure(caught, MESSAGES.unreadable) };
      }
      const next = clipsRef.current.map((entry) => (entry.id === clip.id ? done : entry));
      clipsRef.current = next;
      setClips(next);
      void refreshEncoders(next);
    }
  };

  const join = async () => {
    setJoined(null);
    const problem = checkList(clips.map((clip) => clip.ms));
    if (problem) {
      setError(problem);
      return;
    }
    const stuck = clips.findIndex((clip) => clip.state !== "ready" || !clip.video);
    if (stuck >= 0) {
      const clip = clips[stuck];
      setError(
        clip?.state === "reading"
          ? MESSAGES.stillReading
          : MESSAGES.clipProblem(stuck + 1, clip?.file.name ?? ""),
      );
      return;
    }
    const encoder = encoders?.find((entry) => entry.container === container);
    if (!encoder || !size) {
      setError(MESSAGES.cannotEncode);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        {
          kind: "merge",
          files: clips.map((clip) => clip.file),
          container,
          video: encoder.video,
          audio: encoder.audio,
          sound: clips.map((clip) => clip.sound),
          width: size.width,
          height: size.height,
        },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (result.kind === "merge") {
        setJoined({
          blob: result.blob,
          name: outputName(clips[0]?.file.name, container),
          durationMs: result.durationMs,
          width: result.width,
          height: result.height,
          container,
        });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const totalMs = clips.reduce((sum, clip) => sum + clip.ms, 0);
  const noEncoder = encoders !== null && encoders.length === 0;

  return (
    <>
      <Dropzone
        id="video-merger-files"
        accept="video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov"
        title="Drop video clips here"
        hint={`or click to choose. MP4, MOV or WebM, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} at a time`}
        onFiles={(files) => void add(files)}
      />

      {rejected.length > 0 && (
        <Alert
          tone="warning"
          title={
            rejected.length === 1
              ? "One file was not added"
              : `${rejected.length} files were not added`
          }
        >
          <ul>
            {rejected.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}

      {clips.length > 0 && (
        <section aria-labelledby="video-merger-list" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="video-merger-list" className="text-lg">
              Join in this order
            </h3>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => update([])}>
              Clear all
            </Button>
          </div>
          <FileResultList label="Clips to join">
            {clips.map((clip, index) => (
              <FileResult
                key={clip.id}
                name={`${index + 1}. ${clip.file.name}`}
                meta={clipMeta(clip)}
                state={
                  clip.state === "error" || (clip.state === "ready" && !clip.video)
                    ? "error"
                    : undefined
                }
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
          <p className="text-sm text-fg-muted" id="video-merger-summary">
            {clips.length} {clips.length === 1 ? "clip" : "clips"}, {formatTime(totalMs)} in all.
            {size &&
              ` The joined video will be ${size.width} × ${size.height}, the size of the first clip${
                first && (first.width !== size.width || first.height !== size.height)
                  ? " made to fit 1920 × 1080 with even sides"
                  : ""
              }; other sizes get black bars.`}
          </p>
          {noEncoder && (
            <Alert tone="warning" id="video-merger-support">
              {MESSAGES.cannotEncode}
            </Alert>
          )}
          {encoders && encoders.length > 0 && (
            <Select
              id="video-merger-container"
              label="Joined file"
              hint="Only the formats your browser can write are listed"
              value={container}
              onChange={(event) => setContainer(event.target.value as Container)}
            >
              {encoders.map((entry) => (
                <option key={entry.container} value={entry.container}>
                  {CONTAINERS[entry.container].label}
                </option>
              ))}
            </Select>
          )}
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} disabled={busy} onClick={() => void join()}>
              Join {clips.length} {clips.length === 1 ? "clip" : "clips"}
            </Button>
          </div>
        </section>
      )}

      {busy && <Progress value={progress} label="Joining the clips" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {joined && (
        <FileResultList label="Joined video">
          <FileResult
            name={joined.name}
            meta={`${formatTime(joined.durationMs)}, ${joined.width} × ${joined.height}, ${formatSize(joined.blob.size)}`}
            state="done"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${joined.name}`}
                onClick={() =>
                  saveFile(joined.blob, joined.name, { type: CONTAINERS[joined.container].mime })
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

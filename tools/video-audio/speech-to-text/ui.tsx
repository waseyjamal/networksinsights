import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  Progress,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  ENGINE,
  formatSeconds,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  modelBytes,
  outputName,
} from "./logic";

// The workspace of Speech to Text. A recording is first probed by worker.ts (its length and whether
// the browser can decode it); the model is downloaded only when the visitor presses the button that
// states its size (ADR 0068). Then the worker transcribes the recording in 30-second windows, with
// progress and Cancel, and the page shows the text with a download.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type State =
  | { status: "idle" }
  | { status: "probing"; file: File }
  | { status: "ready"; file: File; seconds: number; loaded: boolean }
  | { status: "working"; file: File; seconds: number; progress: number; stage: string }
  | { status: "done"; file: File; seconds: number; text: string; windows: number }
  | { status: "stopped"; file: File; seconds: number }
  | { status: "error"; file: File; message: string; seconds?: number };

const ACCEPT =
  "audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,.wav,.mp3,.m4a,.ogg,.oga,.opus,.webm,.weba";

const errorMessage = (caught: unknown) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed;

export default function ToolUi() {
  const [state, setState] = useState<State>({ status: "idle" });
  const job = useRef<AbortController | null>(null);

  useEffect(() => () => job.current?.abort(), []);

  const stopJob = () => {
    job.current?.abort();
    job.current = null;
  };

  const choose = async (file: File) => {
    stopJob();
    const refused = checkFile(file);
    if (refused) {
      setState({ status: "error", file, message: refused });
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    setState({ status: "probing", file });
    try {
      const answer = await client.run({ kind: "probe", file }, { signal: controller.signal });
      const status = await client.run({ kind: "status" }, { signal: controller.signal });
      if (answer.kind !== "probe" || status.kind !== "status") return;
      setState({
        status: "ready",
        file,
        seconds: answer.probe.durationSeconds,
        loaded: status.loaded,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setState({ status: "error", file, message: errorMessage(caught) });
    } finally {
      if (job.current === controller) job.current = null;
    }
  };

  const transcribe = async (file: File, seconds: number) => {
    stopJob();
    const controller = new AbortController();
    job.current = controller;
    setState({ status: "working", file, seconds, progress: 0, stage: "Starting" });
    try {
      const output = await client.run(
        { kind: "transcribe", file },
        {
          signal: controller.signal,
          onProgress: ({ done, total, stage }) =>
            setState({
              status: "working",
              file,
              seconds,
              progress: total > 0 ? Math.round((done / total) * 100) : 0,
              stage: stage ?? "Working",
            }),
        },
      );
      if (output.kind !== "transcribe") return;
      setState({ status: "done", file, seconds, text: output.text, windows: output.windows });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setState({ status: "error", file, seconds, message: errorMessage(caught) });
    } finally {
      if (job.current === controller) job.current = null;
    }
  };

  const cancel = () => {
    if (state.status !== "working") return;
    stopJob();
    setState({ status: "stopped", file: state.file, seconds: state.seconds });
  };

  const busy = state.status === "probing" || state.status === "working";
  const size = formatSize(modelBytes());

  return (
    <div id="speech-to-text-workspace" data-state={state.status} className="flex flex-col gap-4">
      <Alert tone="info" title="English only, up to 3 minutes">
        <span id="speech-to-text-notes">
          Whisper tiny may be slow, and may fail on phones with little memory. A long recording is
          heard in 30-second parts, so a word at a join may be cut or repeated.
        </span>
      </Alert>
      <p id="speech-to-text-download" className="text-sm text-fg-muted">
        The model is {size} and downloads only when you press the button. The engine that runs it
        adds {formatSize(ENGINE.bytes)} unless your browser already has it. After that, your
        recording stays on this device.
      </p>
      <Dropzone
        id="speech-to-text-file"
        accept={ACCEPT}
        multiple={false}
        disabled={busy}
        title="Drop an English recording here"
        hint={`or click to choose. WAV, MP3, M4A, OGG or WebM, up to ${formatSeconds(LIMITS.maxSeconds)} long`}
        onFiles={(files) => {
          const [file] = files;
          if (file) void choose(file);
        }}
      />

      {state.status === "probing" && (
        <p className="text-sm text-fg-muted">Reading {state.file.name}…</p>
      )}

      {(state.status === "ready" || state.status === "stopped") && (
        <div className="flex flex-col gap-2">
          <p id="speech-to-text-file-info" className="text-sm">
            {state.file.name}: {formatSeconds(state.seconds)}
          </p>
          {state.status === "stopped" && (
            <Alert tone="warning" title="Stopped">
              <span id="speech-to-text-stopped">Nothing was kept. Press Retry to start again.</span>
            </Alert>
          )}
          <div>
            <Button
              id="speech-to-text-start"
              variant="primary"
              onClick={() => void transcribe(state.file, state.seconds)}
            >
              {state.status === "stopped"
                ? "Retry"
                : state.loaded
                  ? "Transcribe"
                  : `Download the model (${size}) and transcribe`}
            </Button>
          </div>
        </div>
      )}

      {state.status === "working" && (
        <div className="flex flex-col gap-2">
          <Progress value={state.progress} label={`Transcribing ${state.file.name}`} />
          <span id="speech-to-text-stage" className="text-sm text-fg-muted">
            {state.stage}
          </span>
          <div>
            <Button id="speech-to-text-cancel" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <Alert tone="warning" title="No text this time">
          <span id="speech-to-text-error">{state.message}</span>
          {state.seconds !== undefined && (
            <div className="mt-2">
              <Button
                id="speech-to-text-retry"
                size="sm"
                variant="secondary"
                onClick={() => void transcribe(state.file, state.seconds ?? 0)}
              >
                Retry
              </Button>
            </div>
          )}
        </Alert>
      )}

      {state.status === "done" && (
        <div className="flex flex-col gap-2">
          <p id="speech-to-text-summary" className="text-sm text-fg-muted">
            {state.file.name}: {formatSeconds(state.seconds)}, heard in {state.windows}{" "}
            {state.windows === 1 ? "part" : "parts"} of up to 30 seconds
          </p>
          <Textarea
            id="speech-to-text-output"
            label={`Text of ${state.file.name}`}
            readOnly
            rows={10}
            value={state.text}
          />
          <div>
            <Button
              variant="primary"
              onClick={() =>
                saveFile(state.text, outputName(state.file.name), {
                  type: "text/plain;charset=utf-8",
                })
              }
            >
              Download TXT
            </Button>
          </div>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {state.status === "done" ? "Done: the text is ready." : ""}
      </p>
    </div>
  );
}

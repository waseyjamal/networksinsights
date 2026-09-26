// createWorkerClient(): the page side of the worker runtime (ADR 0051, docs/tool-contract.md
// "The worker runtime"). Import it from "@ui". The worker side is defineWorker() in
// "@networksinsights/tool-sdk/worker"; both speak the protocol described there.
//
// The worker is started on the first run, not when the page loads, so its code is on-demand
// JavaScript (ADR 0037). One worker serves every job of the tool. When it fails to start or
// crashes, every waiting job is rejected and the next run starts a fresh one.
//
// Cancel is two-step. The job's promise rejects at once with an AbortError, and the worker is asked
// to stop. A handler that notices the abort ends the job and keeps the worker alive; one that does
// not answer within `cancelGraceMs`, such as an encoder in the middle of a large image, has its
// worker terminated, because nothing else can stop it.

import {
  isProtocolMessage,
  type MessageFromWorker,
  type MessageToWorker,
  WORKER_PROTOCOL,
  type WorkerErrorInfo,
  type WorkerProgress,
} from "@networksinsights/tool-sdk/worker";

/** The part of a Worker the client uses. Tests pass a fake. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
}

/** A job that failed. `expected` is true when `message` was written for the visitor. */
export class WorkerJobError extends Error {
  override name = "WorkerJobError";
  readonly expected: boolean;
  readonly causeName: string;

  constructor(info: WorkerErrorInfo) {
    super(info.message);
    this.expected = info.expected;
    this.causeName = info.name;
  }
}

export interface RunOptions {
  onProgress?: (progress: WorkerProgress) => void;
  /** Aborting it cancels the job: the promise rejects with an AbortError at once. */
  signal?: AbortSignal;
}

export interface WorkerClientOptions {
  /** How long a cancelled job may take to stop before its worker is terminated. */
  cancelGraceMs?: number;
  /** Timers, for tests. */
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface WorkerClient<Input, Output> {
  run(input: Input, options?: RunOptions): Promise<Output>;
  /** Terminates the worker and rejects every waiting job. The next run starts a new worker. */
  dispose(): void;
}

/** The message a job gets when its worker could not start or stopped working. */
export const WORKER_FAILED_MESSAGE =
  "The tool stopped working in this tab. Reload the page and try again.";

export const DEFAULT_CANCEL_GRACE_MS = 400;

/** The error of a job whose worker was terminated to stop another, cancelled job. */
export const STOPPED_INFO: WorkerErrorInfo = {
  name: "WorkerStopped",
  message: "This job stopped because another one was cancelled. Run it again.",
  expected: true,
};

interface Job<Output> {
  resolve: (output: Output) => void;
  reject: (error: unknown) => void;
  onProgress: ((progress: WorkerProgress) => void) | undefined;
  settled: boolean;
  cleanup: () => void;
}

const abortError = () => new DOMException("The job was cancelled.", "AbortError");

/**
 * The page side of a worker tool:
 *
 * ```ts
 * const client = createWorkerClient<Input, Output>(
 *   () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
 * );
 * const output = await client.run(input, { onProgress, signal });
 * ```
 */
export function createWorkerClient<Input, Output>(
  create: () => WorkerLike,
  options: WorkerClientOptions = {},
): WorkerClient<Input, Output> {
  const graceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const later = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const cancelLater =
    options.clearTimeout ??
    ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let worker: WorkerLike | undefined;
  let nextId = 1;
  const jobs = new Map<number, Job<Output>>();
  /** Cancelled jobs the worker has not yet confirmed, with the timer that will terminate it. */
  const stopping = new Map<number, unknown>();

  const settle = (id: number, finish: (job: Job<Output>) => void) => {
    const job = jobs.get(id);
    if (!job) return;
    jobs.delete(id);
    if (job.settled) return;
    job.settled = true;
    job.cleanup();
    finish(job);
  };

  const failAll = (error: unknown) => {
    for (const id of [...jobs.keys()]) settle(id, (job) => job.reject(error));
    for (const timer of stopping.values()) cancelLater(timer);
    stopping.clear();
  };

  const stop = (error: unknown) => {
    const current = worker;
    worker = undefined;
    current?.terminate();
    failAll(error);
  };

  const onMessage = (event: { data: unknown }) => {
    const message = event.data;
    if (!isProtocolMessage(message)) return;
    const typed = message as MessageFromWorker<Output>;
    const { id } = typed;
    if (typed.type !== "progress") {
      // Any final message means a cancelled job did stop: its worker need not be terminated.
      const timer = stopping.get(id);
      if (timer !== undefined) cancelLater(timer);
      stopping.delete(id);
    }
    switch (typed.type) {
      case "progress":
        jobs.get(id)?.onProgress?.(typed.progress);
        return;
      case "result":
        settle(id, (job) => job.resolve(typed.output));
        return;
      case "error":
        settle(id, (job) => job.reject(new WorkerJobError(typed.error)));
        return;
      case "cancelled":
        settle(id, (job) => job.reject(abortError()));
        return;
    }
  };

  const ensure = (): WorkerLike => {
    if (worker) return worker;
    const started = create();
    const failed = () => {
      if (worker === started) {
        stop(
          new WorkerJobError({
            name: "WorkerError",
            message: WORKER_FAILED_MESSAGE,
            expected: true,
          }),
        );
      }
    };
    started.addEventListener("message", onMessage);
    started.addEventListener("error", failed);
    started.addEventListener("messageerror", failed);
    worker = started;
    return started;
  };

  const post = (message: MessageToWorker<Input>) => ensure().postMessage(message);

  return {
    run(input, { onProgress, signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      const id = nextId++;
      return new Promise<Output>((resolve, reject) => {
        const onAbort = () => {
          const current = worker;
          settle(id, (job) => job.reject(abortError()));
          if (!current) return;
          current.postMessage({ protocol: WORKER_PROTOCOL, type: "cancel", id });
          stopping.set(
            id,
            later(() => {
              stopping.delete(id);
              // Still busy after the grace period: only terminating the worker stops it. Any other
              // job it was running is lost with it, and says so.
              if (worker === current) stop(new WorkerJobError(STOPPED_INFO));
            }, graceMs),
          );
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        jobs.set(id, {
          resolve,
          reject,
          onProgress,
          settled: false,
          cleanup: () => signal?.removeEventListener("abort", onAbort),
        });
        try {
          post({ protocol: WORKER_PROTOCOL, type: "run", id, input });
        } catch (error) {
          settle(id, (job) => job.reject(error));
        }
      });
    },
    dispose() {
      stop(abortError());
    },
  };
}

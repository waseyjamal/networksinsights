// The worker runtime (ADR 0051, docs/tool-contract.md "The worker runtime").
//
// A `worker` tool does its heavy work in a Web Worker, so the page never freezes. Both sides speak
// one small, typed protocol:
//
//   page → worker   run { id, input }         start a job
//                   cancel { id }             ask the job to stop
//   worker → page   progress { id, progress } how far the job is
//                   result { id, output }     the job finished
//                   error { id, error }       the job failed
//                   cancelled { id }          the job stopped because it was asked to
//
// The worker side is `defineWorker(handler)` below, called once at the top of a tool's worker.ts.
// The page side is `createWorkerClient()` from "@ui". Every message carries the protocol version,
// and a message that is not one of these is ignored, so a stray postMessage cannot confuse a job.
//
// This module imports nothing: it is loaded into the worker bundle, and Zod or the manifest schema
// would only make that bundle bigger.

// The SDK is compiled against the ES library only, and the tools against the DOM library, so the
// few web APIs used here are described in this module rather than taken from either global set.
// Each one exists in browsers, Web Workers and Cloudflare Workers.

/** The part of an AbortSignal a handler uses. A real AbortSignal satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void): void;
}

interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(): void;
}

declare const AbortController: new () => AbortControllerLike;

/** A value postMessage may transfer instead of copying, such as an ArrayBuffer. */
export type TransferableLike = object;

/** Bumped when a message changes shape. Both sides are built together, so it guards mistakes only. */
export const WORKER_PROTOCOL = 1;

/** How far a job is: `done` of `total` steps, and optionally what it is doing, for the page. */
export interface WorkerProgress {
  done: number;
  total: number;
  /** A short label such as "Decoding" or "Encoding". Shown to the visitor, so plain words only. */
  stage?: string;
}

/** An error as it crosses the boundary: an Error object does not survive postMessage intact. */
export interface WorkerErrorInfo {
  name: string;
  message: string;
  /** True when `message` was written for the visitor (a ToolError); false for anything else. */
  expected: boolean;
}

export type MessageToWorker<Input> =
  | { protocol: typeof WORKER_PROTOCOL; type: "run"; id: number; input: Input }
  | { protocol: typeof WORKER_PROTOCOL; type: "cancel"; id: number };

export type MessageFromWorker<Output> =
  | { protocol: typeof WORKER_PROTOCOL; type: "progress"; id: number; progress: WorkerProgress }
  | { protocol: typeof WORKER_PROTOCOL; type: "result"; id: number; output: Output }
  | { protocol: typeof WORKER_PROTOCOL; type: "error"; id: number; error: WorkerErrorInfo }
  | { protocol: typeof WORKER_PROTOCOL; type: "cancelled"; id: number };

/**
 * An error whose message is meant for the visitor: "This file is not an image the browser can
 * read." Throw it from a handler for a problem the visitor can fix. Any other error reaches the
 * page as `expected: false`, and the page shows a general message instead of its text.
 */
export class ToolError extends Error {
  override name = "ToolError";
}

/** What a handler gets besides its input. */
export interface WorkerContext {
  /** Aborted when the page cancels the job. Check it between steps; `throwIfAborted()` stops. */
  signal: AbortSignalLike;
  /** Tells the page how far the job is. Cheap: call it as often as a step finishes. */
  progress(progress: WorkerProgress): void;
}

export type WorkerHandler<Input, Output> = (
  input: Input,
  context: WorkerContext,
) => Output | Promise<Output>;

/** The part of a worker's global scope the runtime uses. Tests pass their own. */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: TransferableLike[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface DefineWorkerOptions<Output> {
  /** The objects of a result to transfer rather than copy, such as ArrayBuffers. */
  transfer?: (output: Output) => TransferableLike[];
  /** Defaults to the worker's own global scope. */
  scope?: WorkerScope;
}

/** True when `value` is a message of this protocol with a numeric id. */
export function isProtocolMessage(
  value: unknown,
): value is { protocol: number; type: string; id: number } {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { protocol?: unknown; type?: unknown; id?: unknown };
  return (
    message.protocol === WORKER_PROTOCOL &&
    typeof message.type === "string" &&
    typeof message.id === "number"
  );
}

/** Any thrown value as the error info that crosses to the page. */
export function toErrorInfo(error: unknown): WorkerErrorInfo {
  if (error instanceof ToolError)
    return { name: error.name, message: error.message, expected: true };
  if (error instanceof Error) return { name: error.name, message: error.message, expected: false };
  return { name: "Error", message: String(error), expected: false };
}

function isAbort(error: unknown, signal: AbortSignalLike): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

/**
 * Runs `handler` for every job the page sends. Call it once, at the top of worker.ts:
 *
 * ```ts
 * defineWorker<Input, Output>(async (input, { progress, signal }) => { ... });
 * ```
 *
 * Jobs run as they arrive; a handler that awaits lets another job start. A job the page cancels
 * gets its signal aborted and ends with `cancelled`, even if the handler still returns a result.
 */
export function defineWorker<Input, Output>(
  handler: WorkerHandler<Input, Output>,
  options: DefineWorkerOptions<Output> = {},
): void {
  const scope = options.scope ?? (globalThis as unknown as WorkerScope);
  const jobs = new Map<number, AbortControllerLike>();
  const send = (message: MessageFromWorker<Output>, transfer?: TransferableLike[]) =>
    scope.postMessage(message, transfer ?? []);

  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (!isProtocolMessage(message)) return;
    const { id } = message;

    if (message.type === "cancel") {
      jobs.get(id)?.abort();
      return;
    }
    if (message.type !== "run" || jobs.has(id)) return;

    const controller = new AbortController();
    const { signal } = controller;
    jobs.set(id, controller);
    const context: WorkerContext = {
      signal,
      progress: (progress) => {
        if (!signal.aborted) send({ protocol: WORKER_PROTOCOL, type: "progress", id, progress });
      },
    };

    void (async () => {
      try {
        const output = await handler((message as unknown as { input: Input }).input, context);
        if (signal.aborted) send({ protocol: WORKER_PROTOCOL, type: "cancelled", id });
        else
          send(
            { protocol: WORKER_PROTOCOL, type: "result", id, output },
            options.transfer?.(output),
          );
      } catch (error) {
        if (isAbort(error, signal)) send({ protocol: WORKER_PROTOCOL, type: "cancelled", id });
        else send({ protocol: WORKER_PROTOCOL, type: "error", id, error: toErrorInfo(error) });
      } finally {
        jobs.delete(id);
      }
    })();
  });
}

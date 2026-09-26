# 0051. The worker runtime

Status: Accepted
Date: 2026-09-26

## Context

A `worker` tool (ADR 0012) does work that would freeze the page on the main thread: decoding and
encoding images, parsing large files. Until Mission 14 the runtime existed only as a manifest value
and a stub `worker.ts`. Compress Image is the first worker tool, and every worker tool after it will
need the same things: send a job, report progress, cancel it, and turn a failure into a message the
visitor can act on. Written once per tool, those would drift apart; written once here, a tool author
writes only the work.

## Decision

### 1. One typed protocol

`@networksinsights/tool-sdk/worker` defines the messages. Each carries `protocol: 1` and a numeric
job `id`; anything else is ignored.

| Direction | Message | Meaning |
|---|---|---|
| page → worker | `run { id, input }` | Start a job. |
| page → worker | `cancel { id }` | Ask the job to stop. |
| worker → page | `progress { id, progress: { done, total, stage? } }` | How far the job is. |
| worker → page | `result { id, output }` | The job finished. |
| worker → page | `error { id, error: { name, message, expected } }` | The job failed. |
| worker → page | `cancelled { id }` | The job stopped because it was asked to. |

Inputs and outputs cross by structured clone. `File` and `Blob` clone without copying their bytes, so
a tool sends the visitor's file as it is. A tool may name objects of its result to transfer.

The module imports nothing, so the worker bundle carries no Zod and no manifest schema.

### 2. The worker side: `defineWorker(handler)`

`worker.ts` calls it once. The handler gets the input and a context with `progress()` and an abort
`signal`. Throwing a `ToolError` sends its message to the visitor (`expected: true`); any other error
reaches the page with `expected: false`, and the page shows a general message instead of its text,
so an internal detail never becomes page copy. A job whose signal was aborted answers `cancelled`,
even if the handler still returns a result.

### 3. The page side: `createWorkerClient(create)` from `@ui`

- The worker is created on the first run, with
  `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`. The bundler emits it
  as its own file, loaded only then, so it counts as on-demand JavaScript (ADR 0037).
- `run(input, { onProgress, signal })` returns a promise. One worker serves every job.
- **Cancel** rejects the job's promise at once with an `AbortError` and sends `cancel`. A handler
  that stops keeps the worker alive. A worker that has not answered within the grace period (400 ms)
  is terminated, because an encoder in the middle of a large image cannot be interrupted any other
  way; any other job it was running is rejected with a message that says so, and the next run starts
  a fresh worker.
- A worker that fails to start or crashes (`error`, `messageerror`) rejects every waiting job with a
  message for the visitor, and the next run starts a fresh worker.

### 4. What is not decided here

- Module workers are the floor: Chrome 80, Firefox 114, Safari 15, all below the site's floor
  (ADR 0028). No classic-worker fallback.
- A worker pool, and sharing one worker between tools, wait until a tool needs them.
- The CSP already allows `worker-src 'self' blob:` (ADR 0047). No tool changes it.

## Consequences

- `pnpm new:tool --runtime worker` writes a `worker.ts` that calls `defineWorker` and a `ui.tsx` that
  sends it jobs, with Cancel and error handling already wired.
- The client is tested against the real `defineWorker` in a fake worker (results, progress, errors,
  graceful and forced cancel, a crashed worker), and the protocol on its own. The E2E test of
  Compress Image runs it in Chromium, Firefox and WebKit under the site's CSP.
- A tool that needs something the protocol lacks (streaming results, a shared worker) extends this
  ADR with a new one rather than messaging the worker by hand.

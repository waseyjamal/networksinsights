# 0057. On-device AI models

Status: Accepted
Date: 2026-10-02

## Context

Background Remover is the first tool that runs a machine-learning model. The visitor's photo must
stay on the device, the site has no server for it and the cost must be zero. A model brings
questions no earlier tool raised: whose licence covers the weights, where the file is served from,
how big it may be, which runtime runs it, what the CSP must allow, and what the service worker does
with files of several megabytes.

## Decision

### 1. Licences: the weights and the runtime, each checked

A model is used only when the licence of its **weights** allows commercial use (MIT, Apache-2.0,
BSD or similar) and so does the runtime. A repository's licence is not enough: the weights are
checked where their authors publish them. AGPL, GPL, SSPL, non-commercial and "other" licences are
refused (AGENTS.md). Each model folder holds the licence text and a `VENDOR.md` with its source,
size and SHA-256; `scripts/vendored-models.test.ts` checks the file against it.

The first model is U²-Netp (Apache-2.0, weights by the U-2-Net authors), 4,574,861 bytes, from the
ONNX export rembg (MIT) ships. Rejected: BRIA RMBG (excluded by the owner), ISNet as published on
Hugging Face (tagged AGPL-3.0), `@imgly/background-removal` (AGPL), BiRefNet-lite (MIT, but 109 MB
at fp16) and MODNet (Apache-2.0, portraits only).

### 2. Runtime: ONNX Runtime Web, WebAssembly, one thread

`onnxruntime-web` 1.30.0, MIT, imported only in the tool's `worker.ts` from `onnxruntime-web/wasm`.
Its WebAssembly (`ort-wasm-simd-threaded.wasm`, 14,239,897 bytes) is imported with `?url`, fetched
by the worker and handed to the runtime as bytes, so the runtime fetches nothing by itself and never
reaches for a CDN. It runs on one thread: more threads need `SharedArrayBuffer`, which needs
cross-origin isolation headers (COOP and COEP) the site does not send and that would change every
page. WebGPU is not used. Its transitive dependencies are permissive (`pnpm check:licenses`), and
`protobufjs`'s build script stays denied in `allowBuilds`.

`logic.ts` stays pure: the runtime is not added to its allowlist. The arithmetic around the model
(normalising the input, turning the output into alpha) is in `logic.ts` and tested there.

### 3. The CSP does not change

`script-src` already has `'wasm-unsafe-eval'` and `worker-src 'self' blob:` (ADR 0047), and every
file comes from `'self'`. The tool's E2E test runs under the real headers in `wrangler dev` and
fails on any CSP violation.

### 4. Served from our own domain, on demand only

The model and the WebAssembly are hashed files under `/_astro/`, emitted by the build. Cloudflare
Workers static assets allow at most 25 MiB per file; a test fails when either file passes that.
Nothing loads with the page: the worker, the runtime and the model load after the visitor adds a
photo, and the page shows the download with a progress bar and a Cancel button. A model over 25 MiB
needs a new ADR (splitting a file is not allowed by this one).

`pnpm check:budgets` counts the `.wasm` file as on-demand JavaScript (3.6 MB gzip), so the tool's
manifest raises `maxOnDemandJsKb` with a reason (ADR 0037). The `.onnx` file is data, not code, and
is not counted; its size is stated on the page instead.

### 5. The service worker never keeps a model or a .wasm file

ADR 0052's worker keeps every file a page needs, following its graph. For a model that would
download it with the page and push the other files out of the cache. `service-worker.ts` now never
answers for, fetches ahead or keeps any `.onnx` or `.wasm` file (`NEVER_KEPT`); the browser fetches
them as usual. Tool pages still work offline as before; a model tool's page says that its first use
needs a connection and does not promise offline use.

### 6. The page is honest

The page states the real download size, computed from the bytes above, the limits and where the
model does badly (hair, shadows, low contrast). It never states an accuracy figure, and its
examples are what the E2E test checks.

## Consequences

- A tool with a model is a non-tool change only the first time it adds a dependency; later model
  tools reuse the runtime and this ADR.
- Every model update repeats the licence check and updates `VENDOR.md` and the stated size.
- ADR 0052's "a tool's worker and .wasm are kept for offline" no longer holds for `.wasm`.

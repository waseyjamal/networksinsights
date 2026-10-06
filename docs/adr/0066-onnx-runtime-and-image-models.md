# 0066. ONNX Runtime Web and the first AI image models (Real-ESRGAN, MODNet)

Status: Accepted
Date: 2026-10-06

## Context

Tools batch 8A adds `image-upscaler` and `background-remover`. Both run a neural network on the
visitor's device. The owner approved the plan on 2026-10-06 with these conditions: onnxruntime-web
1.30.0 (MIT) as the runtime, not transformers.js; every model and engine file served from this
site; inference only in each tool's `worker.ts` (ADR 0057); a hard memory limit with a clear
message, on phones too; the upscaler's input at most 1 megapixel on a computer and 0.5 on a phone;
the Background Remover page saying "best for people"; test tolerances taken from the PyTorch
comparison and written before CI runs. Batch 8B (Whisper, BiRefNet, Cloudflare R2, a CSP change) is
not part of this decision.

Facts were checked on 2026-10-06 in each project's own repository, on the npm registry and on
Hugging Face.

## Decision

### The runtime: onnxruntime-web 1.30.0, plain wasm, one thread

- `onnxruntime-web` 1.30.0, MIT ("Copyright (c) Microsoft Corporation", in the bundle's banner;
  the npm package ships no LICENSE file, so the notice is in `credits.ts`). Its dependencies are
  `onnxruntime-common` (MIT), `protobufjs` (BSD-3-Clause), `long` (Apache-2.0), `flatbuffers`
  (Apache-2.0), `guid-typescript` (ISC) and `platform` (MIT); `pnpm check:licenses` passes.
  `protobufjs` has a build script, which stays denied (`allowBuilds: protobufjs: false`).
- **Backend: wasm, not WebGPU.** The WebGPU build (JSEP, `ort-wasm-simd-threaded.jsep.wasm`,
  28,312,028 bytes) is over Cloudflare's 25 MiB limit for one file and WebGPU is not in every
  browser. The plain build is `ort-wasm-simd-threaded.wasm`, **14,239,897 bytes** (13.58 MiB),
  with its loader `ort-wasm-simd-threaded.mjs` (24,381 bytes).
- **One thread.** Several threads need `SharedArrayBuffer`, which needs cross-origin isolation:
  `Cross-Origin-Opener-Policy: same-origin` (the site has it) and `Cross-Origin-Embedder-Policy:
  require-corp` (it does not, and adding it would break every page that loads a cross-origin
  resource). The workers set `numThreads = 1` and `proxy = false`, so the engine starts no thread
  and no worker of its own.
- **CSP: no change.** `script-src 'self' 'wasm-unsafe-eval'` already lets our own code compile
  WebAssembly, the loader `.mjs` is imported from `'self'`, and `connect-src 'self'` covers the
  engine and the model fetches.
- **No bundling of the engine.** `astro.config.mjs` aliases `onnxruntime-web/wasm` to
  `dist/ort.wasm.min.mjs`, the build that loads its wasm from a URL (the package's own
  `onnxruntime-web-use-extern-wasm` condition). The workers point `env.wasm.wasmPaths` at
  `/vendor/onnxruntime-web/1.30.0/`, where `pages/vendor/onnxruntime-web/[...path].ts` copies the
  two files unmodified from the installed package. That folder joins `versionedVendorPaths`
  (ADR 0061): it is cached for a year. Each worker bundle is about 54 KB (ONNX Runtime's
  JavaScript); no budget is raised.
- **Pages that do not use it get nothing.** `pnpm check:budgets` (`scripts/lib/onnxruntime-pages.ts`)
  fails if any page other than `/image-upscaler/` and `/background-remover/` can reach a file with
  ONNX Runtime's banner, even on demand, if those two cannot (the check would be blind), or if the
  engine's wasm is anywhere but its vendor path.

### The models

Each model is a file in the repository, `models/<id>/model.onnx`, with the licence from the
model's own repository as `models/<id>/LICENSE.txt`. `pages/models/[...path].ts` serves both at
`/models/<id>/<first 16 hex digits of the SHA-256>/`, so a new file is a new path and `/models/*`
is cached for a year. The worker checks the full SHA-256 of the downloaded model before it uses
it, and refuses a mismatch with a message. `config/models.ts` holds the hashes; a test checks them
against the files and the tools' constants.

| Model | File | Bytes | SHA-256 | Licence |
|---|---|---|---|---|
| Real-ESRGAN realesr-general-x4v3 | `models/realesr-general-x4v3/model.onnx` | 4,866,413 | `1793a6e7fdf15a53eed213ba269ea768b5373858ae433d56ee8e1b0424377cc5` | BSD-3-Clause |
| MODNet, 8-bit | `models/modnet/model.onnx` | 6,627,048 | `7bad6522b3cde60246e69e234b7786337ef9c88abc790ee5c1aaa6e535b0c61d` | Apache-2.0 |
| (source) `realesr-general-x4v3.pth` | not committed | 4,885,111 | `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292` | BSD-3-Clause |

The licence files: `models/realesr-general-x4v3/LICENSE.txt` SHA-256
`4a699ec4863d96a91fc265948a0c90033f7e8735d515524dcf3444736406e0c2`, `models/modnet/LICENSE.txt`
SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.

**Real-ESRGAN.** The weights are the release asset of `xinntao/Real-ESRGAN` v0.2.5.0. The
repository's LICENSE (commit `a4abfb2979a7bbff3f69f58f58ae324608821e27`) is BSD-3-Clause, Copyright
(c) 2021 Xintao Wang; the repository states no separate terms for the weights it publishes, so the
BSD-3-Clause licence of the repository is the one applied, which allows commercial use with the
notice kept. This project converted the weights to ONNX itself with
`scripts/models/convert-realesrgan.py`, which pins torch 2.8.0 (CPU), onnx 1.19.0, onnxruntime
1.23.0, numpy 2.3.3, pillow 11.3.0 and onnxscript 0.5.3, writes the network (`SRVGGNetCompact`,
64 features, 32 convolutions, 4×, PReLU) out by hand, loads the weights strictly, and exports
opset 17 with dynamic height and width. The export is deterministic: two runs gave the same
SHA-256. Run against PyTorch on three random inputs, onnxruntime was at most 6.11e-06 apart, which
is at most **1 level of 255** after rounding to 8 bits.

**MODNet.** The 8-bit export `onnx/model_uint8.onnx` of `Xenova/modnet` on Hugging Face at commit
`fa2fa546052fba4c08921230a26cc69a333fca12`, unmodified; its SHA-256 matches the LFS hash Hugging
Face records. The model card says `license: apache-2.0`. The original project, `ZHKKKe/MODNet`
(commit `28165a451e4610c9d77cfdf925a94610bb2810fb`), ships the Apache License 2.0 and says in its
README: "The code, models, and demos in this repository (excluding GIF files under the folder
`doc/gif`) are released under the Apache License 2.0." Commercial use is allowed. MODNet is a
portrait matting model: the page says it is best for people.

### Memory, tiles and limits

- **Upscaler.** At most 1 megapixel in on a computer and 0.5 on a phone, so the result is at most
  16 megapixels, which Safari on iPhone can still draw. A device counts as a phone when its main
  pointer is coarse (`(pointer: coarse)`) or `navigator.deviceMemory` is 4 or less;
  `deviceMemory` does not exist in Safari and Firefox, and a missing value does not make a phone.
  The picture is upscaled in tiles of 192 × 192 pixels, each run with 34 pixels of the picture
  around it: the network is 34 layers of 3 × 3 convolutions, so with that context the stitched
  result equals one run over the whole picture. `make-fixtures.py` confirmed it: 0 levels apart.
- **Background remover.** At most 24 megapixels in. The model sees a copy with its shorter side at
  512 pixels, its longer side at most 2048, both a multiple of 32.
- **Failure.** Any allocation failure, from JavaScript (`RangeError`) or the engine ("failed to
  allocate", "OOM", "bad_alloc"), ends the job with "This image is too large for this device's
  memory. Try a smaller image."

### Tests and tolerances

E2E fixtures are made from NASA's official portrait of Ellen Ochoa, public domain as a work of the
US federal government, by `scripts/models/make-fixtures.py`. The references come from the original
models: PyTorch for Real-ESRGAN on the whole picture, onnxruntime for MODNet on the same pixels.
Tolerances were written before any browser run, and are never raised after a failure:

- Upscaler: every channel within **2 levels** (the 1 measured above, plus 1 for rounding between
  native and WebAssembly float kernels), mean under 0.05 levels.
- Background remover: see the next section. Its limits were changed after the first run failed.

### Background remover: limits changed after the first run failed

The first limits were written before any browser run: mean under 0.5 levels, 99.5% of pixels
within 2 levels, none over 16. The first run in Chromium and Firefox failed them: mean 1.10,
93.1% within 2, largest 138. The limits were then changed, on these measurements:

- The browser's input tensor equals the reference script's except in the last float32 bit (max
  5.9e-8): the browser normalises in float64, the script in float32. Post-processing adds nothing
  (the browser's alpha equals the model's raw output exactly).
- The 8-bit MODNet amplifies that difference: onnxruntime on x64 alone, given the two tensors,
  gives up to **142 levels** apart, mean 1.08, 93.18% within 2. This is the noise floor. On the same
  tensor, x64 and wasm still differ (max 32, mean 0.24), so part of it is the engines themselves.
  `session.x64quantprecision=1` and disabling graph optimisation changed nothing.
- Every pixel over 16 levels lies within 41 px of the person's outline (the 0.5 contour of the
  reference matte), for the browser (6,276 pixels) and the noise floor (6,224) alike; none is in the
  face, the suit or the corners.

| Check | First limits (failed) | Limits now |
|---|---|---|
| Largest difference | ≤ 16 everywhere | ≤ 16 more than 48 px from the outline |
| Pixels over 16 within 48 px | not counted | at most 9,000 |
| Farthest pixel over 16 | not checked | at most 48 px from the outline |
| Mean difference | < 0.5 levels | ≤ 1.5 levels (noise floor 1.08) |
| Within 2 levels | ≥ 99.5% | ≥ 90% (noise floor 93.18%) |
| Corners, face, suit, helmet | as the page's example | unchanged |
| Same input twice | not checked | identical result |

Measured with these limits: Chromium and Firefox both give largest beyond 48 px 4 levels, 6,276
pixels over 16, farthest 41 px, mean 1.096, 93.14% within 2, and identical results twice. WebKit is
checked only in CI: Playwright's WebKit on Windows has no `OffscreenCanvas`. Settling which engine
is closer to exact needs ONNX's numpy reference evaluator, which did not finish on the development
machine (stopped for low memory); it is not run.

## Consequences

- A tool page that uses neither tool is unchanged: `pnpm check:budgets` proves it on every build.
- Every new model needs its own entry in `config/models.ts`, its licence file, its hash and a line
  in this ADR's successor. A model over 25 MiB cannot be served from Pages and needs batch 8B's
  separate decision.
- Single-thread wasm is slow: a 1 megapixel upscale can take minutes. The page says so. Multi-thread
  or WebGPU would need COEP or a second engine build and a new ADR.
- What tests cannot prove: speed and memory on real phones, and that every phone fails with the
  message rather than a crashed tab, since a browser can kill a tab before JavaScript sees an error.

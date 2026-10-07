# 0068. Whisper tiny for Speech to Text, with its decoder served in two parts

Status: Accepted
Date: 2026-10-07

## Context

Tools batch 8B was planned as three things: Speech to Text with Whisper, an "any object" mode for
Background Remover with BiRefNet_lite, and Cloudflare R2 for model files over 25 MiB. ADR 0066
says a model over 25 MiB, R2 or a CSP change needs its own ADR. A feasibility run on 2026-10-07
(scratch folder outside the repository, onnxruntime-web 1.30.0 under Node 24, plain wasm, one
thread) decided what is built. The owner then asked for Speech to Text only, English only, with no
R2, no CSP change and no change to Background Remover.

## Decision

### The model: Whisper tiny, 8-bit, from Xenova/whisper-tiny at 5332fcc3

- Weights: `openai/whisper-tiny` on Hugging Face, Apache-2.0. ONNX export: `Xenova/whisper-tiny`
  (by Xenova, for Transformers.js), revision `5332fcc35e32a33b86612b9a57a89be7906102b1`, whose
  model card says `license: apache-2.0` at that revision (rechecked 2026-10-07). The copy at
  `onnx-community/whisper-tiny` carries no licence tag and is not used. The Apache-2.0 text is in
  `models/whisper-tiny-en/LICENSE.txt` (from apache.org) and the notice is in `credits.ts`.
- Files, unmodified (SHA-256, bytes):

  | File | SHA-256 | Bytes |
  |---|---|---|
  | `encoder_model_quantized.onnx` | `fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e` | 10,124,910 |
  | `decoder_model_merged_quantized.onnx` (not in the repository) | `6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0` | 30,727,765 |
  | `decoder_model_merged_quantized.onnx.part1` (bytes 0 to 15,363,882) | `e09cb762fffb6116917f4e9997596670aac8e0f6e15ae4afa3fd0bd37969ca63` | 15,363,883 |
  | `decoder_model_merged_quantized.onnx.part2` (the rest) | `9ad7f59107d1822b42ac67e07f1c3fc0a366d5738b44caa191a1a8f7f18ed7ea` | 15,363,882 |
  | `vocab.json` | `50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a` | 1,036,584 |
  | `LICENSE.txt` (Apache-2.0, apache.org) | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` | 11,358 |

  Hashes of the other files read at that revision, not shipped: `tokenizer.json`
  `27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566`, `config.json`
  `2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94`, `generation_config.json`
  `68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c`, `preprocessor_config.json`
  `a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d`. The vocabulary alone is
  enough to turn tokens back into text, so the 2.4 MB `tokenizer.json` is not served.
- The 8-bit pair is the smallest that runs: every decoder variant at that revision is over 25 MiB
  (the smallest is 27.9 MiB), and the full-precision pair is 31.4 + 113 MiB. The model download is
  41,889,259 bytes (39.9 MB); the engine adds 14,264,278 bytes unless the browser already has it.

### Why the decoder is split

Cloudflare serves no static file over 25 MiB. The decoder is 30,727,765 bytes. It is cut at the
half into two byte-exact parts, each under 15 MiB. Every part, and every other file, is served under
`/models/whisper-tiny-en/<first 16 hex digits of its own SHA-256>/<name>` and cached for good, as
ADR 0066's model paths are. The worker downloads each file only after the visitor presses a button
that states the size, checks each file's size and SHA-256, joins the two parts, checks the joined
decoder's SHA-256 against the published file's, and keeps nothing unless every check passes. A
failed or cancelled download stops the request and the page offers Retry. `pnpm check:budgets` now
fails if any file in the build is over 25 MiB (`scripts/lib/file-sizes.ts`).

### Why R2 was dropped

R2 would put model files on a second origin: a new `connect-src` entry in the CSP, a bucket and its
access rules, and a second place to keep in step with the repository. Splitting the one file that is
too big keeps every file on this site under the existing policy, cached by the existing rule, with
the same hash checks. No CSP change, no new account resource.

### Limits

- English only: the prompt is `<|startoftranscript|><|en|><|transcribe|><|notimestamps|>`.
- At most 3 minutes (six windows); a longer recording is refused before anything is downloaded.
- The recording is made 16 kHz mono and cut into 30-second windows with no overlap; each window is
  encoded and then decoded greedily, at most 224 tokens. A word at a join may be cut or repeated, and
  the page says so. A silent window is skipped.
- Memory: the feasibility run peaked at about 740 MiB of process memory under Node. An allocation
  failure becomes a clear message. Nothing was measured on a phone.

### Why Hindi was dropped

Whisper tiny on a 12.2-second Hindi clip from Google's FLEURS (CC-BY-4.0) returned romanised,
garbled text ("Major khin khanam poh Madhya Sahagar mein…"), not Devanagari. It is not good enough to
offer, even as experimental.

### Why BiRefNet_lite ("any object" mode) was dropped

- Licence: the weights (`ZhengPeng7/BiRefNet_lite`) and the ONNX export
  (`onnx-community/BiRefNet_lite-ONNX`) are MIT, but BiRefNet's "general use" models are trained on
  sets that include DIS5K-TR, and the DIS5K Terms of Use (github.com/xuebinqin/DIS) say: "Without
  permission from the original authors, commercial use of this dataset is prohibited even after
  copying, editing, processing or any operations of this database." Whether that binds the weights is
  unclear, and the project does not ship unclear licences.
- Memory: `model_fp16.onnx` (114,538,221 bytes) loaded, but one 1024 × 1024 run failed in
  onnxruntime-web 1.30.0 wasm with `failed to call OrtRun(). ERROR_CODE: 6, ERROR_MESSAGE:
  std::bad_alloc`. A phone tab would fail the same way or worse.

## Consequences

- `models/whisper-tiny-en/` holds about 40 MB of model files in the repository, as `binary` in
  `.gitattributes`.
- ONNX Runtime may now reach three pages; the check in `pnpm check:budgets` names them.
- A future model over 25 MiB can follow the same pattern: parts under the limit, each hashed, and the
  joined file's hash checked before use.
- Tests: `logic.test.ts` checks the split and join on the real parts, the hash check, the windows,
  the mel features against librosa 0.11.0, the resampler and the tokenizer; `speech-to-text.spec.ts`
  runs real transcriptions in Chromium, Firefox and WebKit.

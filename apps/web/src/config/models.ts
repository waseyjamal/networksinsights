// The AI models the image tools run in the visitor's browser (ADR 0066). Each file is in the
// repository under `models/<id>/`, with its licence, and the route `pages/models/[...path].ts`
// serves it at a path that holds the start of its SHA-256: a new file is a new path, so every
// model path can be cached for good. The worker checks the full SHA-256 before it uses a file;
// a test checks every value here against the files.

export interface Model {
  /** The folder under `models/` and in the URL. */
  id: string;
  /** SHA-256 of model.onnx, lowercase hex. */
  sha256: string;
  /** Size of model.onnx in bytes. */
  bytes: number;
  /** SPDX licence of the weights. */
  license: string;
  /** Where the weights come from. */
  source: string;
}

export const MODELS = {
  "realesr-general-x4v3": {
    id: "realesr-general-x4v3",
    sha256: "1793a6e7fdf15a53eed213ba269ea768b5373858ae433d56ee8e1b0424377cc5",
    bytes: 4_866_413,
    license: "BSD-3-Clause",
    source:
      "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth",
  },
  modnet: {
    id: "modnet",
    sha256: "7bad6522b3cde60246e69e234b7786337ef9c88abc790ee5c1aaa6e535b0c61d",
    bytes: 6_627_048,
    license: "Apache-2.0",
    source:
      "https://huggingface.co/Xenova/modnet/blob/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model_uint8.onnx",
  },
} as const satisfies Record<string, Model>;

/** The folder a model's files are served from: its id, then the first 16 hex digits of its hash. */
export const modelBase = (model: Model) => `/models/${model.id}/${model.sha256.slice(0, 16)}/`;

/** One file of a model served as several files, each at a path that holds the start of its own hash. */
export interface ModelFile {
  name: string;
  /** SHA-256, lowercase hex. */
  sha256: string;
  bytes: number;
}

/**
 * Whisper tiny for Speech to Text (ADR 0068): Xenova's 8-bit ONNX export of openai/whisper-tiny,
 * unmodified, at a pinned revision. The decoder is 30,727,765 bytes, over Cloudflare's 25 MiB limit
 * for one file, so it is served as two byte-exact parts that the worker joins and checks against
 * `decoder`. The parts are in the repository; the joined decoder is not.
 */
export const WHISPER = {
  id: "whisper-tiny-en",
  license: "Apache-2.0",
  source:
    "https://huggingface.co/Xenova/whisper-tiny/tree/5332fcc35e32a33b86612b9a57a89be7906102b1",
  files: [
    {
      name: "encoder_model_quantized.onnx",
      sha256: "fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e",
      bytes: 10_124_910,
    },
    {
      name: "decoder_model_merged_quantized.onnx.part1",
      sha256: "e09cb762fffb6116917f4e9997596670aac8e0f6e15ae4afa3fd0bd37969ca63",
      bytes: 15_363_883,
    },
    {
      name: "decoder_model_merged_quantized.onnx.part2",
      sha256: "9ad7f59107d1822b42ac67e07f1c3fc0a366d5738b44caa191a1a8f7f18ed7ea",
      bytes: 15_363_882,
    },
    {
      name: "vocab.json",
      sha256: "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a",
      bytes: 1_036_584,
    },
    {
      name: "LICENSE.txt",
      sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
      bytes: 11_358,
    },
  ],
  /** The decoder the two parts make, as published. */
  decoder: {
    name: "decoder_model_merged_quantized.onnx",
    sha256: "6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0",
    bytes: 30_727_765,
  },
} as const satisfies { id: string; files: readonly ModelFile[]; decoder: ModelFile } & Record<
  string,
  unknown
>;

/** Where one file of a split model is served: the model's id, then the start of the file's hash. */
export const modelFilePath = (id: string, file: ModelFile) =>
  `/models/${id}/${file.sha256.slice(0, 16)}/${file.name}`;

/** Every model path is content-addressed, so it is cached for a year (ADR 0066). */
export const MODEL_PATHS = "/models/*";

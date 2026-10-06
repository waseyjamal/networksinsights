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

/** Every model path is content-addressed, so it is cached for a year (ADR 0066). */
export const MODEL_PATHS = "/models/*";

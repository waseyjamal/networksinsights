// The AI models of the image tools (ADR 0066), copied from `models/<id>/` in the repository at
// build time and served from our own origin with their licences. The path holds the start of the
// model's SHA-256, so a changed file is a new path and an old one is never read by mistake.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { APIRoute, GetStaticPaths } from "astro";
import { MODELS, modelBase, modelFilePath, WHISPER } from "../../config/models";

type Props = { file: string };

/** The repository's `models/` folder; the build runs from `apps/web`. */
const folder = (id: string) => resolve(process.cwd(), "../../models", id);

export const getStaticPaths = (() => [
  ...Object.values(MODELS).flatMap((model) =>
    ["model.onnx", "LICENSE.txt"].map((name) => ({
      params: { path: `${modelBase(model).slice("/models/".length)}${name}` },
      props: { file: resolve(folder(model.id), name) },
    })),
  ),
  // A model served as several files, each under the start of its own hash (ADR 0068).
  ...WHISPER.files.map((file) => ({
    params: { path: modelFilePath(WHISPER.id, file).slice("/models/".length) },
    props: { file: resolve(folder(WHISPER.id), file.name) },
  })),
]) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(readFileSync(props.file), {
    headers: {
      "Content-Type": /\.onnx(\.part\d)?$/.test(props.file)
        ? "application/octet-stream"
        : props.file.endsWith(".json")
          ? "application/json"
          : "text/plain; charset=utf-8",
    },
  });

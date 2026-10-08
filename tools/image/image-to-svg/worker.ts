import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import {
  isSafeSvg,
  type Job,
  type JobResult,
  MESSAGES,
  type TraceData,
  toSvg,
  tracerOptions,
} from "./logic";

// The Web Worker of "Image to SVG" (ADR 0051, ADR 0069). The page decodes and scales the picture
// and sends its pixels; imagetracerjs, imported on the first job so no other page loads it, cuts
// them into colour layers and traces each layer's outlines. toSvg writes the SVG text from those
// outlines, and isSafeSvg checks it before it leaves the worker.

type Tracer = {
  imagedataToTracedata(
    image: { width: number; height: number; data: Uint8ClampedArray },
    options: object,
  ): TraceData;
};

let loading: Promise<Tracer> | undefined;
const loadTracer = () =>
  // @ts-expect-error: imagetracerjs ships no type declarations.
  (loading ??= import("imagetracerjs").then((module) => module.default as Tracer));

defineWorker<Job, JobResult>(async (job, { progress, signal }) => {
  progress({ done: 0, total: 2, stage: "Loading" });
  const tracer = await loadTracer();
  signal.throwIfAborted();
  progress({ done: 1, total: 2, stage: "Tracing" });
  let data: TraceData;
  try {
    data = tracer.imagedataToTracedata(
      { width: job.width, height: job.height, data: job.pixels },
      tracerOptions(job.preset),
    );
  } catch {
    throw new ToolError(MESSAGES.failed);
  }
  signal.throwIfAborted();
  const { svg, paths } = toSvg(data);
  if (!isSafeSvg(svg)) throw new ToolError(MESSAGES.unsafe);
  progress({ done: 2, total: 2, stage: "Done" });
  return { svg, paths };
});

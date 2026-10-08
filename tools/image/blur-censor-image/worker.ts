import { defineWorker, ToolError } from "@networksinsights/tool-sdk/worker";
import { censor, checkRegions, type Job, type JobResult, MESSAGES } from "./logic";

// The Web Worker of "Blur & Censor Image" (ADR 0051). The page decodes the picture with a canvas
// and sends its RGBA pixels here; the worker fills, pixelates or blurs each region and sends the
// pixels back, so a large blur does not freeze the page. It draws nothing itself, so it needs no
// OffscreenCanvas.

defineWorker<Job, JobResult>(
  (job, { progress, signal }) => {
    const problem = checkRegions(job.regions);
    if (problem) throw new ToolError(problem);
    if (job.pixels.length !== job.width * job.height * 4) throw new ToolError(MESSAGES.failed);
    const total = job.regions.length;
    job.regions.forEach((region, index) => {
      signal.throwIfAborted();
      progress({ done: index, total });
      censor(job.pixels, job.width, job.height, [region]);
    });
    progress({ done: total, total });
    return { pixels: job.pixels };
  },
  { transfer: (result) => [result.pixels.buffer] },
);

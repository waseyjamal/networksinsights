import { defineWorker } from "@networksinsights/tool-sdk/worker";
import * as yaml from "yaml";
import { formatYaml, type Input, type WorkerResult } from "./logic";

// The Web Worker of "YAML Formatter" (ADR 0062). The `yaml` library (ISC) loads with this worker,
// so its code is fetched only once the visitor types or pastes YAML. formatYaml() in logic.ts
// does the work with it; a long text can take seconds, and a newer text cancels this job.

defineWorker<Input, WorkerResult>(async (input, { signal }) => {
  signal.throwIfAborted();
  return formatYaml(yaml, input);
});

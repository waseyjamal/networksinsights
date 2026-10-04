import { defineWorker } from "@networksinsights/tool-sdk/worker";
import * as sqlFormatter from "sql-formatter";
import { formatSql, type Input, type WorkerResult } from "./logic";

// The Web Worker of "SQL Formatter" (ADR 0062). The `sql-formatter` library (MIT) loads with this
// worker, with every dialect it supports, so its code is fetched only once the visitor types or
// pastes SQL. formatSql() in logic.ts does the work with it.

defineWorker<Input, WorkerResult>(async (input, { signal }) => {
  signal.throwIfAborted();
  return formatSql(sqlFormatter, input);
});

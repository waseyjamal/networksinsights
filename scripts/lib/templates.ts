// The files `pnpm new:tool` writes (ADR 0035). Each is a function of the manifest values, so a
// generated tool is complete and consistent, and a test can check the output against the
// contract without a tool ever being hand-written.
//
// Every stub that a person must finish carries UNFINISHED_MARKER. The build refuses a tool that
// still has one (ADR 0036), so a stub cannot ship by accident.

import { ISLAND_SOURCE, UNFINISHED_MARKER } from "@networksinsights/tool-sdk";

export interface ToolValues {
  id: string;
  name: string;
  category: string;
  summary: string;
  runtime: "client" | "worker" | "server";
  tags: readonly string[];
  /** Optional file formats, written into the manifest only when given. */
  accepts?: readonly string[] | undefined;
  produces?: readonly string[] | undefined;
  /** ISO date, YYYY-MM-DD. */
  today: string;
}

const LINE_WIDTH = 100;

/** `key: "value",` on one line, or with the value on the next when the line would be too long. */
function stringProperty(key: string, value: string, indent = "  "): string {
  const json = JSON.stringify(value);
  const line = `${indent}${key}: ${json},`;
  return line.length <= LINE_WIDTH ? line : `${indent}${key}:\n${indent}  ${json},`;
}

/** `key: ["a", "b"],` on one line, or one item per line when that would be too long. */
function arrayProperty(key: string, values: readonly string[], indent = "  "): string {
  const inline = `${indent}${key}: [${values.map((value) => JSON.stringify(value)).join(", ")}],`;
  if (inline.length <= LINE_WIDTH) return inline;
  const items = values.map((value) => `${indent}  ${JSON.stringify(value)},`);
  return `${indent}${key}: [\n${items.join("\n")}\n${indent}],`;
}

/** `arrayProperty` plus its line break, or nothing when the manifest has no such list. */
function optionalArray(key: string, values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? "" : `${arrayProperty(key, values)}\n`;
}

export function toolConfig(values: ToolValues): string {
  return `import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
${stringProperty("id", values.id)}
${stringProperty("name", values.name)}
${stringProperty("category", values.category)}
${stringProperty("summary", values.summary)}
${arrayProperty("tags", values.tags)}
${optionalArray("accepts", values.accepts)}${optionalArray("produces", values.produces)}${stringProperty("runtime", values.runtime)}
  status: "beta",
  input: z.object({ text: z.string() }),
  related: [],
${stringProperty("added", values.today)}
${stringProperty("updated", values.today)}
});
`;
}

export function toolLogic(values: ToolValues): string {
  return `// Pure logic of "${values.name}": no DOM, no network, no top-level statements, and imports only
// from zod, the SDK or this folder (docs/tool-contract.md, "logic.ts: what pure means").
// ${UNFINISHED_MARKER}: replace this stub with the real logic, then delete this comment.

/** What the tool accepts. Keep it in step with \`input\` in tool.config.ts. */
export interface Input {
  text: string;
}

/** What the tool gives back. */
export interface Result {
  output: string;
}

/**
 * ${UNFINISHED_MARKER}: implement the tool. The stub echoes its input so the page works while you
 * write the real thing.
 */
export function run(input: Input): Result {
  return { output: input.text };
}
`;
}

export function toolUi(values: ToolValues): string {
  return `import { Button, Textarea } from "@ui";
import { useState } from "react";
import { run } from "./logic";

// ${UNFINISHED_MARKER}: replace this skeleton with the real workspace of "${values.name}". Use the
// design-system components from "@ui" (docs/design-system.md); a new kind of component goes into the
// design system first. The page already provides the workspace card and the privacy statement.
export default function ToolUi() {
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");

  return (
    <>
      <Textarea
        id="input"
        label="Input"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" onClick={() => setOutput(run({ text }).output)}>
          Run
        </Button>
      </div>
      <Textarea id="output" label="Result" readOnly value={output} />
    </>
  );
}
`;
}

export function toolIsland(): string {
  return ISLAND_SOURCE;
}

export function toolContent(values: ToolValues): string {
  return `${UNFINISHED_MARKER}: write the intro of ${values.name}. Answer first: the first sentence says what the tool does, names ${values.name} and has at most 30 words. Then say who it is for and what makes it worth opening, in at least 40 words in all. Everything on this page must be true of this tool alone.

## How to use

${UNFINISHED_MARKER}: walk through the steps a visitor takes, in order, with the choices they meet. At least 50 words.

## Examples

${UNFINISHED_MARKER}: show a real input and the exact output it gives, and say what to notice in it. At least 40 words.

## Limits

${UNFINISHED_MARKER}: say honestly what the tool cannot do: size, formats, accuracy, browser support. At least 30 words.

## FAQ

### ${UNFINISHED_MARKER}: first question a visitor asks?

${UNFINISHED_MARKER}: answer it in full sentences.

### ${UNFINISHED_MARKER}: second question a visitor asks?

${UNFINISHED_MARKER}: answer it in full sentences. The FAQ needs at least two pairs and 60 words in all.
`;
}

export function toolTest(values: ToolValues): string {
  return `import { expect, it } from "vitest";
import { run } from "./logic";

// ${UNFINISHED_MARKER}: replace this failing test with real tests of run() for "${values.name}":
// a typical input, an empty input, the edge cases, and every limit the page describes.
it("has real tests", () => {
  expect(run({ text: "" })).toBeDefined();
  expect.fail("${UNFINISHED_MARKER}: write real tests for run(), then delete this one");
});
`;
}

export function toolWorker(values: ToolValues): string {
  return `import { defineWorker } from "@networksinsights/tool-sdk/worker";
import { type Input, type Result, run } from "./logic";

// The Web Worker of "${values.name}" (ADR 0051, docs/tool-contract.md "The worker runtime").
// ui.tsx starts it on the first run and sends it jobs; defineWorker() answers each one with its
// result, an error or "cancelled". ${UNFINISHED_MARKER}: do the heavy work here, report progress
// between steps and check the signal, then delete this comment.
defineWorker<Input, Result>(async (input, { progress, signal }) => {
  signal.throwIfAborted();
  const result = run(input);
  progress({ done: 1, total: 1 });
  return result;
});
`;
}

/** The workspace of a worker tool: the same skeleton, with the job sent to worker.ts. */
export function toolWorkerUi(values: ToolValues): string {
  return `import { Alert, Button, createWorkerClient, Textarea, WorkerJobError } from "@ui";
import { useRef, useState } from "react";
import type { Input, Result } from "./logic";

// The worker starts on the first run, so its code is loaded on demand (ADR 0051).
const client = createWorkerClient<Input, Result>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

// ${UNFINISHED_MARKER}: replace this skeleton with the real workspace of "${values.name}". Use the
// design-system components from "@ui" (docs/design-system.md); a new kind of component goes into the
// design system first. The page already provides the workspace card and the privacy statement.
export default function ToolUi() {
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const job = useRef<AbortController | null>(null);

  const start = async () => {
    const controller = new AbortController();
    job.current = controller;
    setBusy(true);
    setError("");
    try {
      setOutput((await client.run({ text }, { signal: controller.signal })).output);
    } catch (caught) {
      if (controller.signal.aborted) return;
      // A ToolError's message was written for the visitor; anything else is not shown as is.
      const expected = caught instanceof WorkerJobError && caught.expected;
      setError(expected ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Textarea
        id="input"
        label="Input"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" loading={busy} onClick={start}>
          Run
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => job.current?.abort()}>
            Cancel
          </Button>
        )}
      </div>
      {error && <Alert tone="danger" title="It did not work">{error}</Alert>}
      <Textarea id="output" label="Result" readOnly value={output} />
    </>
  );
}
`;
}

/** Every file of a new tool, keyed by its path inside the folder. `worker.ts` only for workers. */
export function toolFiles(values: ToolValues): Record<string, string> {
  return {
    "tool.config.ts": toolConfig(values),
    "logic.ts": toolLogic(values),
    "ui.tsx": values.runtime === "worker" ? toolWorkerUi(values) : toolUi(values),
    "island.astro": toolIsland(),
    "content/en.mdx": toolContent(values),
    "logic.test.ts": toolTest(values),
    ...(values.runtime === "worker" ? { "worker.ts": toolWorker(values) } : {}),
  };
}

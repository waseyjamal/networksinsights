import { Alert, Button, createWorkerClient, Select, StatGrid, Textarea, WorkerJobError } from "@ui";
import { useEffect, useState } from "react";
import {
  finish,
  INDENT_LABELS,
  INDENTS,
  type Indent,
  type Input,
  MESSAGES,
  MODE_LABELS,
  MODES,
  type Mode,
  precheck,
  type Result,
  type WorkerResult,
} from "./logic";

// The workspace of YAML Formatter: the YAML in, Format or Minify, the indentation, then the result
// with its counts, or the error with its line, column and a pointer. The `yaml` library runs in
// worker.ts, which starts at the first text, so its code is fetched only then (ADR 0062). A change
// waits a moment, then cancels any run still going and starts a new one. Nothing is sent anywhere:
// Copy writes only to the visitor's own clipboard.

const client = createWorkerClient<Input, WorkerResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

/** Wait this long after the last change before formatting again. */
const TYPING_DELAY_MS = 200;
/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("format");
  const [indent, setIndent] = useState<Indent>("2");
  const [result, setResult] = useState<Result | null>(null);
  const [working, setWorking] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    const early = precheck(text);
    if (early) {
      setResult(text === "" ? null : early);
      setWorking(false);
      return;
    }
    const controller = new AbortController();
    setWorking(true);
    const timer = setTimeout(() => {
      client
        .run({ text, mode, indent }, { signal: controller.signal })
        .then((answer) => setResult(finish(text, answer)))
        .catch((caught) => {
          if (controller.signal.aborted) return;
          const expected = caught instanceof WorkerJobError && caught.expected;
          setResult({
            ok: false,
            reason: "failed",
            error: expected ? caught.message : MESSAGES.failed,
          });
        })
        .finally(() => {
          if (!controller.signal.aborted) setWorking(false);
        });
    }, TYPING_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, mode, indent]);

  useEffect(() => {
    if (copyMessage === "") return;
    const timer = setTimeout(() => setCopyMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  const output = result?.ok ? result.output : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopyMessage("Copied to the clipboard.");
    } catch {
      setCopyMessage("Your browser did not allow copying. Select the result and copy it.");
    }
  };

  return (
    <>
      <Textarea
        id="yaml-formatter-text"
        label="Your YAML"
        hint="Paste or type YAML. It is checked and formatted as you go."
        rows={10}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Mode</legend>
          <div className="ni-workspace__actions">
            {MODES.map((item) => (
              <Button
                key={item}
                variant={item === mode ? "primary" : "secondary"}
                size="sm"
                aria-pressed={item === mode}
                onClick={() => setMode(item)}
              >
                {MODE_LABELS[item]}
              </Button>
            ))}
          </div>
        </fieldset>
        <Select
          id="yaml-formatter-indent"
          label="Indentation"
          hint={mode === "minify" ? "Minify puts each document on one line." : undefined}
          disabled={mode === "minify"}
          value={indent}
          onChange={(event) => setIndent(event.target.value as Indent)}
        >
          {INDENTS.map((value) => (
            <option key={value} value={value}>
              {INDENT_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
      {result && !result.ok && result.reason === "invalid" && (
        <Alert tone="warning" title="This YAML is not valid">
          <p id="yaml-formatter-error">{result.error}</p>
          <pre className="mt-2 overflow-x-auto font-mono text-sm">{result.at.pointer}</pre>
        </Alert>
      )}
      {result && !result.ok && result.reason !== "invalid" && (
        <p id="yaml-formatter-error" className="text-sm text-fg-muted">
          {result.error}
        </p>
      )}
      {result?.ok && (
        <p id="yaml-formatter-valid" className="text-sm text-success-text">
          Valid YAML: {result.documents === 1 ? "1 document" : `${result.documents} documents`}.
        </p>
      )}
      <Textarea
        id="yaml-formatter-result"
        label={mode === "format" ? "Formatted YAML" : "Minified YAML"}
        rows={12}
        readOnly
        spellCheck={false}
        className="font-mono"
        aria-busy={working}
        value={output}
      />
      <section aria-labelledby="yaml-formatter-counts" className="grid gap-3">
        <h3 id="yaml-formatter-counts" className="sr-only">
          Size of the result
        </h3>
        <StatGrid
          items={[
            { id: "lines", label: "Lines", value: number.format(result?.ok ? result.lines : 0) },
            {
              id: "characters",
              label: "Characters",
              value: number.format(result?.ok ? result.characters : 0),
            },
          ]}
        />
      </section>
      <div className="ni-workspace__actions">
        <Button variant="secondary" size="sm" disabled={output === "" || working} onClick={copy}>
          Copy result
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={text === ""}
          onClick={() => {
            setText("");
            setCopyMessage("");
          }}
        >
          Clear
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {working ? "Formatting…" : copyMessage}
      </p>
    </>
  );
}

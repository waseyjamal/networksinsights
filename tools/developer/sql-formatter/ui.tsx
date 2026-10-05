import { Alert, Button, createWorkerClient, Select, StatGrid, Textarea, WorkerJobError } from "@ui";
import { useEffect, useState } from "react";
import {
  CASE_LABELS,
  CASES,
  type Case,
  DIALECT_KEYS,
  DIALECTS,
  type Dialect,
  finish,
  INDENT_LABELS,
  INDENTS,
  type Indent,
  type Input,
  MESSAGES,
  precheck,
  type Result,
  type WorkerResult,
} from "./logic";

// The workspace of SQL Formatter: the SQL in, the dialect, the keyword case and the indentation,
// then the result with its counts, or the spot the dialect could not read. The `sql-formatter`
// library runs in worker.ts, which starts at the first text, so its code is fetched only then
// (ADR 0062). A change waits a moment, then cancels any run still going and starts a new one.
// Nothing is sent anywhere: Copy writes only to the visitor's own clipboard.

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
  const [dialect, setDialect] = useState<Dialect>("sql");
  const [keywordCase, setKeywordCase] = useState<Case>("upper");
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
        .run({ text, dialect, keywordCase, indent }, { signal: controller.signal })
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
  }, [text, dialect, keywordCase, indent]);

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
        id="sql-formatter-text"
        label="Your SQL"
        hint="Paste or type one or more statements. They are formatted as you go."
        rows={10}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Select
          id="sql-formatter-dialect"
          label="Dialect"
          value={dialect}
          onChange={(event) => setDialect(event.target.value as Dialect)}
        >
          {DIALECT_KEYS.map((key) => (
            <option key={key} value={key}>
              {DIALECTS[key]}
            </option>
          ))}
        </Select>
        <Select
          id="sql-formatter-case"
          label="Keyword case"
          value={keywordCase}
          onChange={(event) => setKeywordCase(event.target.value as Case)}
        >
          {CASES.map((value) => (
            <option key={value} value={value}>
              {CASE_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          id="sql-formatter-indent"
          label="Indentation"
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
        <Alert tone="warning" title="This SQL could not be read">
          <p id="sql-formatter-error">{result.error}</p>
          <pre className="mt-2 overflow-x-auto font-mono text-sm">{result.at.pointer}</pre>
        </Alert>
      )}
      {result && !result.ok && result.reason !== "invalid" && (
        <p id="sql-formatter-error" className="text-sm text-fg-muted">
          {result.error}
        </p>
      )}
      <Textarea
        id="sql-formatter-result"
        label="Formatted SQL"
        rows={12}
        readOnly
        spellCheck={false}
        className="font-mono"
        aria-busy={working}
        value={output}
      />
      <section aria-labelledby="sql-formatter-counts" className="grid gap-3">
        <h3 id="sql-formatter-counts" className="sr-only">
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

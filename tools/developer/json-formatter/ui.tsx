import { Alert, Button, Select, StatGrid, Textarea } from "@ui";
import { useEffect, useState } from "react";
import {
  formatInSteps,
  INDENT_LABELS,
  INDENTS,
  type Indent,
  MODE_LABELS,
  MODES,
  type Mode,
  type Result,
  run,
  STEP_SIZE,
} from "./logic";

// The workspace of JSON Formatter: the JSON in, Format or Minify, the indentation, then the result
// with its line and character counts, or the error with its line, column and a pointer. A short
// text is formatted at once on every change. A long one (a pasted 1 MB file) is formatted in steps,
// with a pause after each one, so typing and scrolling never wait for it; a new change drops the
// run in progress. Nothing is sent anywhere: Copy writes only to the visitor's own clipboard.

/** Wait this long after the last change before formatting a long text again. */
const LONG_TEXT_DELAY_MS = 120;
/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("format");
  const [indent, setIndent] = useState<Indent>("2");
  const [result, setResult] = useState<Result>(() => run({ text: "", mode, indent }));
  const [working, setWorking] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    const input = { text, mode, indent };
    if (text.length <= STEP_SIZE) {
      setResult(run(input));
      setWorking(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const steps = formatInSteps(input);
    const next = () => {
      if (cancelled) return;
      const step = steps.next();
      if (step.done) {
        setResult(step.value);
        setWorking(false);
      } else {
        timer = setTimeout(next, 0);
      }
    };
    setWorking(true);
    timer = setTimeout(next, LONG_TEXT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, mode, indent]);

  useEffect(() => {
    if (copyMessage === "") return;
    const timer = setTimeout(() => setCopyMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  const output = result.ok ? result.output : "";

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
        id="json-formatter-text"
        label="Your JSON"
        hint="Paste or type JSON. It is checked and formatted as you go."
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
          id="json-formatter-indent"
          label="Indentation"
          hint={mode === "minify" ? "Minify removes all indentation." : undefined}
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
      {!result.ok && result.reason === "invalid" && (
        <Alert tone="warning" title="This JSON is not valid">
          <p id="json-formatter-error">{result.error}</p>
          <pre className="mt-2 overflow-x-auto font-mono text-sm">{result.at.pointer}</pre>
        </Alert>
      )}
      <Textarea
        id="json-formatter-result"
        label={mode === "format" ? "Formatted JSON" : "Minified JSON"}
        rows={12}
        readOnly
        spellCheck={false}
        className="font-mono"
        aria-busy={working}
        value={output}
      />
      <section aria-labelledby="json-formatter-counts" className="grid gap-3">
        <h3 id="json-formatter-counts" className="sr-only">
          Size of the result
        </h3>
        <StatGrid
          items={[
            { id: "lines", label: "Lines", value: number.format(result.ok ? result.lines : 0) },
            {
              id: "characters",
              label: "Characters",
              value: number.format(result.ok ? result.characters : 0),
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
        {working ? "Formatting a long text…" : copyMessage}
      </p>
    </>
  );
}

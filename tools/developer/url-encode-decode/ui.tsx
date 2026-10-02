import { Button, Select, Textarea } from "@ui";
import { useEffect, useState } from "react";
import { MODE_LABELS, type Mode, run, SCOPE_LABELS, type Scope } from "./logic";

// The workspace of URL Encode Decode: Encode or Decode, Whole URL or Component, then the text and
// the result, updated on every change. Each mode keeps its own text, so switching back and forth
// loses nothing. A text that cannot be read shows why under the text box. Nothing is sent
// anywhere: Copy writes only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

export default function ToolUi() {
  const [mode, setMode] = useState<Mode>("encode");
  const [scope, setScope] = useState<Scope>("url");
  const [plain, setPlain] = useState("https://example.com/search?q=café & tea");
  const [encoded, setEncoded] = useState("");
  const [message, setMessage] = useState("");

  const text = mode === "encode" ? plain : encoded;
  const result = run({ mode, scope, text });

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copy = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(result.output);
      setMessage("Result copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the result and copy it.");
    }
  };

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="url-mode"
          label="Action"
          value={mode}
          onChange={(event) => setMode(event.target.value as Mode)}
        >
          {(Object.keys(MODE_LABELS) as Mode[]).map((value) => (
            <option key={value} value={value}>
              {MODE_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          id="url-scope"
          label="Treat the text as"
          value={scope}
          onChange={(event) => setScope(event.target.value as Scope)}
        >
          {(Object.keys(SCOPE_LABELS) as Scope[]).map((value) => (
            <option key={value} value={value}>
              {SCOPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
      <Textarea
        id="url-input"
        label={mode === "encode" ? "Text to encode" : "Text to decode"}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        error={result.ok ? undefined : result.error}
        onChange={(event) =>
          mode === "encode" ? setPlain(event.target.value) : setEncoded(event.target.value)
        }
      />
      <Textarea
        id="url-output"
        label="Result"
        readOnly
        spellCheck={false}
        className="font-mono"
        value={result.ok ? result.output : ""}
      />
      <div className="ni-workspace__actions">
        <Button variant="secondary" onClick={() => void copy()} disabled={!result.ok}>
          Copy result
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

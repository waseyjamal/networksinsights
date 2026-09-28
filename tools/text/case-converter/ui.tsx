import { Button, Textarea } from "@ui";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { convert, MODE_LABELS, MODES, type Mode } from "./logic";

// The workspace of Case Converter: a text box, one button per case, and the converted text,
// updated as the visitor types. The conversion renders at low priority (useDeferredValue), so
// typing into a long text never waits for it. Nothing is sent anywhere: the text stays in this
// component, and Copy writes it only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

export default function ToolUi() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("upper");
  const [copyMessage, setCopyMessage] = useState("");
  const deferredText = useDeferredValue(text);
  const output = useMemo(() => convert(deferredText, mode), [deferredText, mode]);
  const converting = deferredText !== text;

  useEffect(() => {
    if (copyMessage === "") return;
    const timer = setTimeout(() => setCopyMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopyMessage("Copied to the clipboard.");
    } catch {
      setCopyMessage("Your browser did not allow copying. Select the converted text and copy it.");
    }
  };

  return (
    <>
      <Textarea
        id="case-converter-text"
        label="Your text"
        hint="Type or paste, then pick a case. The result updates as you go."
        rows={8}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Convert to</legend>
        <div className="ni-workspace__actions">
          {MODES.map((item) => (
            <Button
              key={item}
              variant={item === mode ? "primary" : "secondary"}
              size="sm"
              aria-pressed={item === mode}
              data-mode={item}
              onClick={() => setMode(item)}
            >
              {MODE_LABELS[item]}
            </Button>
          ))}
        </div>
      </fieldset>
      <Textarea
        id="case-converter-result"
        label={`Converted text, ${MODE_LABELS[mode]}`}
        rows={8}
        readOnly
        spellCheck={false}
        aria-busy={converting}
        value={output}
      />
      <div className="ni-workspace__actions">
        <Button variant="secondary" size="sm" disabled={output === ""} onClick={copy}>
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
          Clear text
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {copyMessage}
      </p>
    </>
  );
}

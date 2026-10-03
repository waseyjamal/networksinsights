import { Alert, Button, Input, Select } from "@ui";
import { useEffect, useState } from "react";
import { run, type Style, type System } from "./logic";

// The workspace of Number to Words: the number, the system (Indian or international) and the
// style (plain words, rupees and paise, dollars and cents). The words follow on every change. The
// page opens on the example of its Examples section. Copy writes only to the visitor's clipboard.

const COPIED_MESSAGE_MS = 3000;

export default function ToolUi() {
  const [text, setText] = useState("1234567");
  const [system, setSystem] = useState<System>("indian");
  const [style, setStyle] = useState<Style>("words");
  const [message, setMessage] = useState("");

  const result = run({ text, system, style });

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copy = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(result.words);
      setMessage("Copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the words and copy them.");
    }
  };

  return (
    <>
      <Input
        id="ntw-number"
        label="Number"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text}
        error={result.ok ? undefined : result.error}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="ntw-system"
          label="Number system"
          value={system}
          onChange={(event) => setSystem(event.target.value as System)}
        >
          <option value="indian">Indian (lakh, crore)</option>
          <option value="international">International (million, billion)</option>
        </Select>
        <Select
          id="ntw-style"
          label="Style"
          value={style}
          onChange={(event) => setStyle(event.target.value as Style)}
        >
          <option value="words">Words</option>
          <option value="rupees">Cheque: rupees and paise</option>
          <option value="dollars">Cheque: dollars and cents</option>
        </Select>
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <p id="ntw-result" className="text-lg">
            {result.words}
          </p>
        ) : (
          <Alert tone="info">Fix the number above to see it in words.</Alert>
        )}
      </div>
      <div className="ni-workspace__actions">
        <Button variant="secondary" size="sm" disabled={!result.ok} onClick={copy}>
          Copy words
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

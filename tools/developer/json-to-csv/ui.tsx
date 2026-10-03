import { Alert, Button, Checkbox, Dropzone, Select, StatGrid, saveFile, Textarea } from "@ui";
import { useEffect, useState } from "react";
import { type Delimiter, MAX_CHARS, run } from "./logic";

// The workspace of JSON to CSV Converter: the JSON (typed, pasted or read from a chosen file), the
// delimiter and four options, then the CSV with its row and column counts, Copy and Download. The
// page opens on the example of its Examples section. The file is read on the device and nothing is
// sent anywhere.

const EXAMPLE = `[
  {"name": "Asha", "city": "Pune", "tags": ["a", "b"], "address": {"zip": "411001"}},
  {"name": "Ben, Jr.", "note": "=1+1"}
]`;
const COPIED_MESSAGE_MS = 3000;
const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [text, setText] = useState(EXAMPLE);
  const [delimiter, setDelimiter] = useState<Delimiter>("comma");
  const [header, setHeader] = useState(true);
  const [flatten, setFlatten] = useState(true);
  const [quoteAll, setQuoteAll] = useState(false);
  const [protect, setProtect] = useState(true);
  const [message, setMessage] = useState("");

  const result = run({ text, delimiter, header, flatten, quoteAll, protect });
  const csv = result.ok ? result.csv : "";

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const pick = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    // A file this many bytes cannot be within the character limit, so it is not read at all.
    if (file.size > MAX_CHARS * 4) {
      setMessage(`That file is too large; the limit is ${number.format(MAX_CHARS)} characters.`);
      return;
    }
    setText(await file.text());
    setMessage(`Read ${file.name}.`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv);
      setMessage("Copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the CSV and copy it.");
    }
  };

  return (
    <>
      <Textarea
        id="j2c-text"
        label="Your JSON"
        hint="An array of objects, or one object."
        rows={8}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Dropzone
        id="j2c-file"
        multiple={false}
        accept=".json,application/json"
        title="Or drop a JSON file here"
        hint={`or click to choose one, up to ${number.format(MAX_CHARS)} characters`}
        onFiles={(files) => void pick(files)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="j2c-delimiter"
          label="Delimiter"
          value={delimiter}
          onChange={(event) => setDelimiter(event.target.value as Delimiter)}
        >
          <option value="comma">Comma (,)</option>
          <option value="semicolon">Semicolon (;)</option>
          <option value="tab">Tab</option>
        </Select>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Options</legend>
          <Checkbox
            id="j2c-header"
            label="Header row"
            checked={header}
            onChange={(event) => setHeader(event.target.checked)}
          />
          <Checkbox
            id="j2c-flatten"
            label="Flatten nested objects (a.b)"
            checked={flatten}
            onChange={(event) => setFlatten(event.target.checked)}
          />
          <Checkbox
            id="j2c-quote"
            label="Quote every field"
            checked={quoteAll}
            onChange={(event) => setQuoteAll(event.target.checked)}
          />
          <Checkbox
            id="j2c-protect"
            label="Protect against spreadsheet formulas"
            checked={protect}
            onChange={(event) => setProtect(event.target.checked)}
          />
        </fieldset>
      </div>
      {!result.ok && (
        <Alert tone="warning" title="No CSV yet">
          <p id="j2c-error">{result.error}</p>
        </Alert>
      )}
      <Textarea
        id="j2c-result"
        label="CSV"
        rows={8}
        readOnly
        spellCheck={false}
        className="font-mono"
        value={csv}
      />
      <StatGrid
        items={[
          { id: "rows", label: "Rows", value: number.format(result.ok ? result.rows : 0) },
          { id: "columns", label: "Columns", value: number.format(result.ok ? result.columns : 0) },
        ]}
      />
      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          size="sm"
          disabled={csv === ""}
          onClick={() => saveFile(csv, "data.csv", { type: "text/csv" })}
        >
          Download CSV
        </Button>
        <Button variant="secondary" size="sm" disabled={csv === ""} onClick={copy}>
          Copy CSV
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

import { Alert, Button, Checkbox, Dropzone, Select, StatGrid, saveFile, Textarea } from "@ui";
import { useEffect, useState } from "react";
import { DELIMITER_NAMES, type Delimiter, MAX_CHARS, run } from "./logic";

// The workspace of CSV to JSON Parser: the CSV (typed, pasted or read from a chosen file), the
// delimiter and three options, then the JSON with its row and column counts, Copy and Download.
// The page opens on the example of its Examples section. The file is read on the device and
// nothing is sent anywhere.

const EXAMPLE = `name,age,note
Asha,31,"Likes ""tea"", and coffee"
Ben,,true
`;
const COPIED_MESSAGE_MS = 3000;
const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [text, setText] = useState(EXAMPLE);
  const [delimiter, setDelimiter] = useState<Delimiter>("auto");
  const [header, setHeader] = useState(true);
  const [convert, setConvert] = useState(false);
  const [pretty, setPretty] = useState(true);
  const [message, setMessage] = useState("");

  const result = run({ text, delimiter, header, convert, pretty });
  const json = result.ok ? result.json : "";

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
      await navigator.clipboard.writeText(json);
      setMessage("Copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the JSON and copy it.");
    }
  };

  return (
    <>
      <Textarea
        id="c2j-text"
        label="Your CSV"
        rows={8}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Dropzone
        id="c2j-file"
        multiple={false}
        accept=".csv,.tsv,.txt,text/csv,text/plain"
        title="Or drop a CSV file here"
        hint={`or click to choose one, up to ${number.format(MAX_CHARS)} characters`}
        onFiles={(files) => void pick(files)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="c2j-delimiter"
          label="Delimiter"
          hint={
            delimiter === "auto" && result.ok
              ? `Detected: ${DELIMITER_NAMES[result.delimiter]}`
              : undefined
          }
          value={delimiter}
          onChange={(event) => setDelimiter(event.target.value as Delimiter)}
        >
          <option value="auto">Detect</option>
          <option value="comma">Comma (,)</option>
          <option value="semicolon">Semicolon (;)</option>
          <option value="tab">Tab</option>
        </Select>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Options</legend>
          <Checkbox
            id="c2j-header"
            label="First row is the header"
            checked={header}
            onChange={(event) => setHeader(event.target.checked)}
          />
          <Checkbox
            id="c2j-convert"
            label="Convert numbers and true/false"
            checked={convert}
            onChange={(event) => setConvert(event.target.checked)}
          />
          <Checkbox
            id="c2j-pretty"
            label="Pretty print"
            checked={pretty}
            onChange={(event) => setPretty(event.target.checked)}
          />
        </fieldset>
      </div>
      {!result.ok && (
        <Alert tone="warning" title="No JSON yet">
          <p id="c2j-error">{result.error}</p>
        </Alert>
      )}
      <Textarea
        id="c2j-result"
        label="JSON"
        rows={10}
        readOnly
        spellCheck={false}
        className="font-mono"
        value={json}
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
          disabled={json === ""}
          onClick={() => saveFile(json, "data.json", { type: "application/json" })}
        >
          Download JSON
        </Button>
        <Button variant="secondary" size="sm" disabled={json === ""} onClick={copy}>
          Copy JSON
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

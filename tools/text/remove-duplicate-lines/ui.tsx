import { Alert, Button, Checkbox, Select, StatGrid, Textarea } from "@ui";
import { useDeferredValue, useEffect, useState } from "react";
import { type Keep, MAX_CHARS, run, type Sort } from "./logic";

// The workspace of Remove Duplicate Lines: the text, five options, then the result with the counts
// of lines before, after and removed. The result is worked out from a deferred copy of the text, so
// typing in a 1 MB text never waits for it. The page opens on the example of its Examples section.
// Copy writes only to the visitor's own clipboard.

const EXAMPLE = "apple\nBanana\napple\nbanana\n\ncherry";
const COPIED_MESSAGE_MS = 3000;
const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [text, setText] = useState(EXAMPLE);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [trim, setTrim] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(false);
  const [keep, setKeep] = useState<Keep>("first");
  const [sort, setSort] = useState<Sort>("none");
  const [message, setMessage] = useState("");

  const deferred = useDeferredValue(text);
  const result = run({ text: deferred, ignoreCase, trim, removeEmpty, keep, sort });
  const output = result.ok ? result.output : "";

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setMessage("Copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the result and copy it.");
    }
  };

  return (
    <>
      <Textarea
        id="rdl-text"
        label="Your lines"
        hint={`One item per line, up to ${number.format(MAX_CHARS)} characters.`}
        rows={10}
        spellCheck={false}
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Options</legend>
          <Checkbox
            id="rdl-case"
            label="Ignore case"
            checked={ignoreCase}
            onChange={(event) => setIgnoreCase(event.target.checked)}
          />
          <Checkbox
            id="rdl-trim"
            label="Trim spaces"
            checked={trim}
            onChange={(event) => setTrim(event.target.checked)}
          />
          <Checkbox
            id="rdl-empty"
            label="Remove empty lines"
            checked={removeEmpty}
            onChange={(event) => setRemoveEmpty(event.target.checked)}
          />
        </fieldset>
        <Select
          id="rdl-keep"
          label="Keep"
          value={keep}
          onChange={(event) => setKeep(event.target.value as Keep)}
        >
          <option value="first">The first copy</option>
          <option value="last">The last copy</option>
        </Select>
        <Select
          id="rdl-sort"
          label="Sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="none">Keep the order</option>
          <option value="asc">A to Z</option>
          <option value="desc">Z to A</option>
        </Select>
      </div>
      {!result.ok && (
        <Alert tone="warning" title="This text is too long">
          <p id="rdl-error">{result.error}</p>
        </Alert>
      )}
      <Textarea
        id="rdl-result"
        label="Lines without duplicates"
        rows={10}
        readOnly
        spellCheck={false}
        aria-busy={deferred !== text}
        value={output}
      />
      <StatGrid
        items={[
          {
            id: "before",
            label: "Lines before",
            value: number.format(result.ok ? result.before : 0),
          },
          { id: "after", label: "Lines after", value: number.format(result.ok ? result.after : 0) },
          {
            id: "removed",
            label: "Lines removed",
            value: number.format(result.ok ? result.removed : 0),
          },
        ]}
      />
      <div className="ni-workspace__actions">
        <Button variant="secondary" size="sm" disabled={output === ""} onClick={copy}>
          Copy result
        </Button>
        <Button variant="ghost" size="sm" disabled={text === ""} onClick={() => setText("")}>
          Clear
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

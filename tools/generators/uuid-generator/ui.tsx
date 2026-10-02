import { Alert, Button, Checkbox, Input, Select, Textarea } from "@ui";
import { useEffect, useMemo, useState } from "react";
import {
  BYTES_PER_UUID,
  buildUuids,
  formatUuid,
  MAX_COUNT,
  MIN_COUNT,
  parseCount,
  type Version,
} from "./logic";

// The workspace of UUID Generator: a version, a count and three options for how each UUID is
// written. UUIDs are drawn after hydration and again whenever the version or the count changes or
// Generate again is pressed, so the static HTML never holds one. The options only rewrite the UUIDs
// already drawn. Nothing is sent anywhere: Copy all writes only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

export default function ToolUi() {
  const [version, setVersion] = useState<Version>("4");
  const [countText, setCountText] = useState("5");
  const [uppercase, setUppercase] = useState(false);
  const [noHyphens, setNoHyphens] = useState(false);
  const [braces, setBraces] = useState(false);
  const [drawn, setDrawn] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  const [message, setMessage] = useState("");

  const count = parseCount(countText);
  const wanted = count.ok ? count.count : 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` only asks for a new draw
  useEffect(() => {
    if (wanted === 0) {
      setDrawn([]);
      return;
    }
    const random = new Uint8Array(wanted * BYTES_PER_UUID);
    crypto.getRandomValues(random);
    setDrawn(buildUuids(version, wanted, { random, timestampMs: Date.now() }));
  }, [version, wanted, round]);

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const text = useMemo(
    () => drawn.map((uuid) => formatUuid(uuid, { uppercase, noHyphens, braces })).join("\n"),
    [drawn, uppercase, noHyphens, braces],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(
        `${drawn.length} ${drawn.length === 1 ? "UUID" : "UUIDs"} copied to the clipboard.`,
      );
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it.");
    }
  };

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="uuid-version"
          label="Version"
          value={version}
          onChange={(event) => setVersion(event.target.value as Version)}
        >
          <option value="4">Version 4 (random)</option>
          <option value="7">Version 7 (time-ordered)</option>
        </Select>
        <Input
          id="uuid-count"
          label="How many"
          hint={`From ${MIN_COUNT} to ${MAX_COUNT.toLocaleString("en-US")}`}
          inputMode="numeric"
          autoComplete="off"
          value={countText}
          error={count.ok ? undefined : count.error}
          onChange={(event) => setCountText(event.target.value)}
        />
      </div>
      <fieldset className="flex flex-wrap gap-x-6 gap-y-2">
        <legend className="ni-field__label mb-2">Format</legend>
        <Checkbox
          label="Uppercase"
          checked={uppercase}
          onChange={(event) => setUppercase(event.target.checked)}
        />
        <Checkbox
          label="No hyphens"
          checked={noHyphens}
          onChange={(event) => setNoHyphens(event.target.checked)}
        />
        <Checkbox
          label="Braces"
          checked={braces}
          onChange={(event) => setBraces(event.target.checked)}
        />
      </fieldset>
      <Textarea
        id="uuid-output"
        label="UUIDs"
        readOnly
        rows={Math.min(Math.max(drawn.length, 3), 12)}
        spellCheck={false}
        className="font-mono"
        value={text}
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" onClick={() => setRound((n) => n + 1)} disabled={!count.ok}>
          Generate again
        </Button>
        <Button variant="secondary" onClick={() => void copy()} disabled={drawn.length === 0}>
          Copy all
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
      {!count.ok && <Alert tone="info">Fix the count to draw new UUIDs.</Alert>}
    </>
  );
}

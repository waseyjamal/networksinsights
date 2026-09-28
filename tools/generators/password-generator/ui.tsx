import { Alert, Badge, Button, Checkbox, Input } from "@ui";
import { useCallback, useEffect, useState } from "react";
import {
  CHARACTER_KINDS,
  type CharacterKind,
  DEFAULT_LENGTH,
  KIND_LABELS,
  MAX_LENGTH,
  MIN_LENGTH,
  type Result,
  run,
  STRENGTH_LABELS,
  type Strength,
} from "./logic";

// The workspace of Password Generator: the password with Copy and Generate again, its strength,
// then the length and the four kinds of character. Any change to an option draws a new password.
// The first one is drawn after hydration, never during server rendering, so the static HTML never
// holds a password. Nothing is sent anywhere: Copy writes only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

const STRENGTH_TONES: Readonly<Record<Strength, "danger" | "warning" | "success">> = {
  weak: "danger",
  fair: "warning",
  strong: "success",
  "very-strong": "success",
};

export default function ToolUi() {
  const [lengthText, setLengthText] = useState(String(DEFAULT_LENGTH));
  const [kinds, setKinds] = useState<Record<CharacterKind, boolean>>({
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  const length = Number(lengthText.trim() === "" ? Number.NaN : lengthText);
  const lengthError =
    Number.isInteger(length) && length >= MIN_LENGTH && length <= MAX_LENGTH
      ? undefined
      : `Enter a whole number from ${MIN_LENGTH} to ${MAX_LENGTH}.`;

  const generate = useCallback(() => {
    setResult(run({ length, ...kinds }));
    setCopyMessage("");
  }, [length, kinds]);

  // A new password whenever an option changes, and the first one after hydration.
  useEffect(() => {
    generate();
  }, [generate]);

  useEffect(() => {
    if (copyMessage === "") return;
    const timer = setTimeout(() => setCopyMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  const password = result?.ok ? result.password : "";
  const kindError = result && !result.ok && lengthError === undefined ? result.error : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopyMessage("Copied to the clipboard.");
    } catch {
      setCopyMessage("Your browser did not allow copying. Select the password and copy it.");
    }
  };

  return (
    <>
      <Input
        id="password-generator-result"
        label="Your password"
        className="font-mono"
        readOnly
        spellCheck={false}
        autoComplete="off"
        value={password}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" size="sm" disabled={password === ""} onClick={copy}>
          Copy password
        </Button>
        <Button variant="secondary" size="sm" disabled={!result?.ok} onClick={generate}>
          Generate again
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {copyMessage}
      </p>
      {result?.ok && (
        <p className="text-sm" id="password-generator-strength">
          Strength:{" "}
          <Badge tone={STRENGTH_TONES[result.strength]}>{STRENGTH_LABELS[result.strength]}</Badge>{" "}
          <span className="text-fg-muted">about {Math.floor(result.bits)} bits of entropy</span>
        </p>
      )}
      <Input
        id="password-generator-length"
        label="Length"
        hint={`${MIN_LENGTH} to ${MAX_LENGTH} characters.`}
        type="number"
        inputMode="numeric"
        min={MIN_LENGTH}
        max={MAX_LENGTH}
        step={1}
        value={lengthText}
        error={lengthError}
        onChange={(event) => setLengthText(event.target.value)}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Include</legend>
        {CHARACTER_KINDS.map((kind) => (
          <Checkbox
            key={kind}
            label={KIND_LABELS[kind]}
            checked={kinds[kind]}
            onChange={(event) => {
              const checked = event.target.checked;
              setKinds((current) => ({ ...current, [kind]: checked }));
            }}
          />
        ))}
      </fieldset>
      {kindError !== "" && <Alert tone="warning">{kindError}</Alert>}
    </>
  );
}

import { Alert, Button, Dropzone, Select, StatGrid, saveFile, Textarea } from "@ui";
import { useEffect, useMemo, useState } from "react";
import {
  checkFileSize,
  encodeBytes,
  formatSize,
  MAX_BYTES,
  MODE_LABELS,
  MODES,
  type Mode,
  type Result,
  run,
  VARIANT_LABELS,
  VARIANTS,
  type Variant,
} from "./logic";

// The workspace of Base64 Encoder / Decoder: Encode or Decode, the alphabet, then the input (text,
// or one file when encoding) and the result, updated on every change. A decode that gives text
// shows it; one that gives binary data offers it as a download. Each mode keeps its own input, so
// switching back and forth loses nothing. Nothing is sent anywhere: a file is read in the page,
// Copy writes only to the visitor's own clipboard, and Download saves from memory.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

const number = new Intl.NumberFormat("en-US");

interface Picked {
  name: string;
  bytes: Uint8Array;
}

export default function ToolUi() {
  const [mode, setMode] = useState<Mode>("encode");
  const [variant, setVariant] = useState<Variant>("standard");
  const [plain, setPlain] = useState("");
  const [encoded, setEncoded] = useState("");
  const [file, setFile] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState("");
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");

  const result: Result = useMemo(() => {
    if (mode === "encode" && file) return encodeBytes(file.bytes, variant);
    return run({ mode, variant, text: mode === "encode" ? plain : encoded });
  }, [mode, variant, plain, encoded, file]);

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const pick = async (files: File[]) => {
    const chosen = files[0];
    if (!chosen) return;
    const tooLarge = checkFileSize(chosen.size);
    setFileError(tooLarge ?? "");
    if (tooLarge) return;
    setReading(true);
    try {
      setFile({ name: chosen.name, bytes: new Uint8Array(await chosen.arrayBuffer()) });
    } catch {
      setFileError("Your browser could not read this file. Try choosing it again.");
    } finally {
      setReading(false);
    }
  };

  // What Copy copies: the Base64, or the decoded text.
  const output = !result.ok ? "" : result.mode === "encode" ? result.output : (result.text ?? "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setMessage("Copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the result and copy it.");
    }
  };

  const download = () => {
    if (!result.ok || result.mode !== "decode") return;
    const { filename } = saveFile(result.bytes, `decoded.${result.kind.extension}`);
    setMessage(`Saved ${filename}.`);
  };

  const clear = () => {
    if (mode === "encode") {
      setPlain("");
      setFile(null);
      setFileError("");
    } else {
      setEncoded("");
    }
    setMessage("");
  };

  const stats =
    result.ok && result.mode === "encode"
      ? [
          { id: "input", label: "Input", value: formatSize(result.inputBytes) },
          {
            id: "output",
            label: "Base64",
            value: `${number.format(result.output.length)} characters`,
          },
        ]
      : result.ok
        ? [
            {
              id: "input",
              label: "Base64",
              value: `${number.format(result.inputCharacters)} characters`,
            },
            { id: "output", label: "Decoded", value: formatSize(result.bytes.length) },
          ]
        : [
            { id: "input", label: "Input", value: "–" },
            { id: "output", label: "Output", value: "–" },
          ];
  const empty = mode === "encode" ? plain === "" && !file && fileError === "" : encoded === "";

  return (
    <>
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
                onClick={() => {
                  setMode(item);
                  setMessage("");
                }}
              >
                {MODE_LABELS[item]}
              </Button>
            ))}
          </div>
        </fieldset>
        <Select
          id="base64-variant"
          label="Alphabet"
          hint={
            mode === "decode" ? "Decode reads both alphabets, with or without padding." : undefined
          }
          disabled={mode === "decode"}
          value={variant}
          onChange={(event) => setVariant(event.target.value as Variant)}
        >
          {VARIANTS.map((value) => (
            <option key={value} value={value}>
              {VARIANT_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>

      {mode === "encode" ? (
        <>
          {file ? (
            <div className="grid gap-2">
              <p className="text-sm">
                Encoding the file <span className="font-medium">{file.name}</span> (
                {formatSize(file.bytes.length)}).
              </p>
              <div className="ni-workspace__actions">
                <Button variant="secondary" size="sm" onClick={() => setFile(null)}>
                  Remove file
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Textarea
                id="base64-text"
                label="Text to encode"
                hint="Type or paste text. It is encoded as UTF-8 as you go."
                rows={8}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                value={plain}
                onChange={(event) => setPlain(event.target.value)}
              />
              <Dropzone
                id="base64-file"
                multiple={false}
                title="Or drop a file here"
                hint={`or click to choose one file of any type, up to ${formatSize(MAX_BYTES)}`}
                disabled={reading}
                onFiles={(files) => void pick(files)}
              />
            </>
          )}
          {fileError !== "" && (
            <Alert tone="warning" title="This file cannot be encoded">
              <p id="base64-file-error">{fileError}</p>
            </Alert>
          )}
          {!result.ok && result.reason === "too-large" && (
            <Alert tone="warning" title="This text is too long">
              <p>{result.error}</p>
            </Alert>
          )}
          <Textarea
            id="base64-result"
            label={variant === "url" ? "Base64URL" : "Base64"}
            rows={8}
            readOnly
            spellCheck={false}
            className="font-mono"
            aria-busy={reading}
            value={output}
          />
        </>
      ) : (
        <>
          <Textarea
            id="base64-encoded"
            label="Base64 to decode"
            hint="Paste Base64, Base64URL or a data: URL. Spaces and line breaks are ignored."
            rows={8}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className="font-mono"
            value={encoded}
            onChange={(event) => setEncoded(event.target.value)}
          />
          {!result.ok && result.reason !== "empty" && (
            <Alert tone="warning" title="This cannot be decoded">
              <p id="base64-error">{result.error}</p>
            </Alert>
          )}
          {result.ok && result.mode === "decode" && result.text === null ? (
            <Alert tone="info" title="The result is a file, not text">
              <p id="base64-binary">
                {result.kind.label}, {formatSize(result.bytes.length)}. Download it to open it.
              </p>
            </Alert>
          ) : (
            <Textarea
              id="base64-decoded"
              label="Decoded text"
              rows={8}
              readOnly
              spellCheck={false}
              value={output}
            />
          )}
        </>
      )}

      <section aria-labelledby="base64-sizes" className="grid gap-3">
        <h3 id="base64-sizes" className="sr-only">
          Sizes
        </h3>
        <StatGrid items={stats} />
      </section>
      <div className="ni-workspace__actions">
        {result.ok && result.mode === "decode" && (
          <Button
            variant={result.text === null ? "primary" : "secondary"}
            size="sm"
            onClick={download}
          >
            {result.text === null ? `Download .${result.kind.extension} file` : "Download as .txt"}
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={output === ""} onClick={copy}>
          Copy result
        </Button>
        <Button variant="ghost" size="sm" disabled={empty} onClick={clear}>
          Clear
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {reading ? "Reading the file…" : message}
      </p>
    </>
  );
}

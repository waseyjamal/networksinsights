import { Alert, Button, Dropzone, Input, Progress, Tabs, Textarea } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  ALGORITHM_LABELS,
  ALGORITHMS,
  type Algorithm,
  checkFileSize,
  formatSize,
  type Hashes,
  hashFile,
  MAX_BYTES,
  type Result,
  run,
} from "./logic";

// The workspace of Hash Generator: a Text tab, hashed again on every change, and a File tab, which
// reads one file in chunks with a progress bar. Both show MD5, SHA-1, SHA-256 and SHA-512 at once,
// each with its own Copy button. Nothing is sent anywhere: the file is read in the page, and Copy
// writes only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

interface Picked {
  name: string;
  size: number;
}

export default function ToolUi() {
  const [text, setText] = useState("");
  const [textResult, setTextResult] = useState<Result | null>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [fileHashes, setFileHashes] = useState<Hashes | null>(null);
  const [fileError, setFileError] = useState("");
  const [done, setDone] = useState(0);
  const [hashing, setHashing] = useState(false);
  const [message, setMessage] = useState("");
  // Each file picked gets a number; a run whose number is no longer current stops.
  const fileRun = useRef(0);

  useEffect(() => {
    let current = true;
    void run({ text }).then((result) => {
      if (current) setTextResult(result);
    });
    return () => {
      current = false;
    };
  }, [text]);

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const pick = async (files: File[]) => {
    const chosen = files[0];
    if (!chosen) return;
    const id = ++fileRun.current;
    const tooLarge = checkFileSize(chosen.size);
    setFile(tooLarge ? null : { name: chosen.name, size: chosen.size });
    setFileHashes(null);
    setFileError(tooLarge ?? "");
    setDone(0);
    if (tooLarge) return;
    setHashing(true);
    try {
      const hashes = await hashFile(
        chosen.size,
        async (start, end) => new Uint8Array(await chosen.slice(start, end).arrayBuffer()),
        setDone,
        () => fileRun.current !== id,
      );
      if (hashes) setFileHashes(hashes);
    } catch {
      if (fileRun.current === id) {
        setFile(null);
        setFileError("Your browser could not read this file. Try choosing it again.");
      }
    } finally {
      if (fileRun.current === id) setHashing(false);
    }
  };

  const removeFile = () => {
    fileRun.current++;
    setFile(null);
    setFileHashes(null);
    setFileError("");
    setHashing(false);
    setDone(0);
  };

  const copy = async (algorithm: Algorithm, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${ALGORITHM_LABELS[algorithm]} copied to the clipboard.`);
    } catch {
      setMessage("Your browser did not allow copying. Select the hash and copy it.");
    }
  };

  const textHashes = textResult?.ok ? textResult.hashes : null;
  const percent = file && file.size > 0 ? Math.floor((done / file.size) * 100) : 0;

  const hashList = (prefix: string, hashes: Hashes | null) => (
    <section aria-labelledby={`${prefix}-hashes`} className="grid gap-3">
      <h3 id={`${prefix}-hashes`} className="sr-only">
        Hashes
      </h3>
      {ALGORITHMS.map((algorithm) => (
        <div key={algorithm} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              id={`${prefix}-${algorithm}`}
              label={ALGORITHM_LABELS[algorithm]}
              readOnly
              spellCheck={false}
              className="font-mono"
              value={hashes?.[algorithm] ?? ""}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hashes}
            aria-label={`Copy ${ALGORITHM_LABELS[algorithm]}`}
            onClick={() => hashes && void copy(algorithm, hashes[algorithm])}
          >
            Copy
          </Button>
        </div>
      ))}
    </section>
  );

  const textPanel = (
    <div className="grid gap-4">
      <Textarea
        id="hash-text-input"
        label="Text to hash"
        hint="Type or paste text. It is hashed as UTF-8 as you type."
        rows={6}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {textResult && !textResult.ok && textResult.reason === "too-large" && (
        <Alert tone="warning" title="This text is too long">
          <p>{textResult.error}</p>
        </Alert>
      )}
      {hashList("hash-text", textHashes)}
      <div className="ni-workspace__actions">
        <Button variant="ghost" size="sm" disabled={text === ""} onClick={() => setText("")}>
          Clear
        </Button>
      </div>
    </div>
  );

  const filePanel = (
    <div className="grid gap-4">
      <Dropzone
        id="hash-file-input"
        multiple={false}
        title="Drop a file here"
        hint={`or click to choose one file of any type, up to ${formatSize(MAX_BYTES)}`}
        onFiles={(files) => void pick(files)}
      />
      {fileError !== "" && (
        <Alert tone="warning" title="This file cannot be hashed">
          <p id="hash-file-error">{fileError}</p>
        </Alert>
      )}
      {file && (
        <div className="grid gap-2">
          <p className="text-sm" id="hash-file-name">
            {hashing ? "Hashing" : "Hashes of"} the file{" "}
            <span className="font-medium">{file.name}</span> ({formatSize(file.size)}).
          </p>
          {hashing && (
            <>
              <Progress label="Hashing the file" value={percent} />
              <p className="text-sm text-fg-muted">
                {formatSize(done)} of {formatSize(file.size)} read.
              </p>
            </>
          )}
        </div>
      )}
      {hashList("hash-file", fileHashes)}
      <div className="ni-workspace__actions">
        <Button variant="ghost" size="sm" disabled={!file && fileError === ""} onClick={removeFile}>
          Remove file
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Tabs
        id="hash-input"
        label="What to hash"
        tabs={[
          { id: "text", label: "Text", panel: textPanel },
          { id: "file", label: "File", panel: filePanel },
        ]}
      />
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

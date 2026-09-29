import { Alert, Badge, Button, StatGrid, Textarea } from "@ui";
import { useEffect, useMemo, useState } from "react";
import { type Decoded, run, type TimeState, timeStatus } from "./logic";

// The workspace of JWT Decoder: one box for the token and, as it is typed or pasted, the header,
// the payload and the signature, each in its own box with its own Copy button. The token's dates
// are checked against the device clock, once a second. The signature is never verified, and the
// page says so before anything else. Nothing is sent anywhere: Copy writes only to the visitor's
// own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

const TICK_MS = 1000;

const TONES: Record<TimeState, "success" | "danger" | "warning" | "info"> = {
  valid: "success",
  expired: "danger",
  "not-yet-valid": "warning",
  "no-expiry": "info",
  unreadable: "warning",
};

/** Rows for a result box: its lines, kept between a floor and a ceiling. */
function rowsFor(text: string, max: number): number {
  return Math.min(max, Math.max(3, text.split("\n").length));
}

export default function ToolUi() {
  const [text, setText] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");

  const result = useMemo(() => run({ text }), [text]);
  const decoded: Decoded | null = result.ok ? result : null;
  const watchesClock = decoded !== null && decoded.times.length > 0;

  useEffect(() => {
    if (!watchesClock) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [watchesClock]);

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copy = async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${what} copied to the clipboard.`);
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it.");
    }
  };

  const header = decoded?.header.json ?? "";
  const payload = decoded?.payload.json ?? "";
  const signature = decoded?.signature.base64url ?? "";
  const status = decoded ? timeStatus(decoded, now) : null;

  const signatureHint = !decoded
    ? undefined
    : decoded.signature.bytes === 0
      ? "This token has no signature: its third part is empty."
      : `${decoded.signature.bytes} bytes, in Base64URL as written. It is not verified.`;

  return (
    <>
      <Alert tone="warning" title="This tool does not verify the signature">
        <p>
          It only decodes. Anyone can write a token with any payload, so a token that decodes is not
          a token you can trust. Only a server that holds the secret or the public key can check the
          signature.
        </p>
      </Alert>
      <Textarea
        id="jwt-decoder-token"
        label="Your token"
        hint="Paste a JSON Web Token. It is decoded as you type. A Bearer prefix is ignored."
        rows={6}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {!result.ok && result.reason !== "empty" && (
        <Alert tone="warning" title="This cannot be decoded">
          <p id="jwt-decoder-error">{result.error}</p>
        </Alert>
      )}

      {decoded && status && (
        <section aria-labelledby="jwt-decoder-time" className="grid gap-3">
          <h3 id="jwt-decoder-time" className="text-sm font-medium">
            Dates, checked against this device's clock
          </h3>
          <p>
            <Badge tone={TONES[status.state]} id="jwt-decoder-state">
              {status.label}
            </Badge>{" "}
            <span id="jwt-decoder-detail">{status.detail}</span>
          </p>
          {decoded.times.length > 0 && (
            <StatGrid
              items={decoded.times.map((claim) => ({
                id: claim.name,
                label: `${claim.label} (${claim.name})`,
                value: claim.utc,
              }))}
            />
          )}
        </section>
      )}

      <Textarea
        id="jwt-decoder-header"
        label="Header"
        hint={decoded?.algorithm ? `Algorithm: ${decoded.algorithm}` : undefined}
        rows={rowsFor(header, 8)}
        readOnly
        spellCheck={false}
        className="font-mono"
        value={header}
      />
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={header === ""}
          onClick={() => void copy("Header", header)}
        >
          Copy header
        </Button>
      </div>

      <Textarea
        id="jwt-decoder-payload"
        label="Payload"
        rows={rowsFor(payload, 16)}
        readOnly
        spellCheck={false}
        className="font-mono"
        value={payload}
      />
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={payload === ""}
          onClick={() => void copy("Payload", payload)}
        >
          Copy payload
        </Button>
      </div>

      <Textarea
        id="jwt-decoder-signature"
        label="Signature"
        hint={signatureHint}
        rows={3}
        readOnly
        spellCheck={false}
        className="font-mono"
        value={signature}
      />
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={signature === ""}
          onClick={() => void copy("Signature", signature)}
        >
          Copy signature
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

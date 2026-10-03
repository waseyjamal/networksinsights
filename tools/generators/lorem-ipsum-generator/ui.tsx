import { Alert, Button, Checkbox, Input, Select, StatGrid } from "@ui";
import { useEffect, useState } from "react";
import { MAX_COUNT, run, type Unit } from "./logic";

// The workspace of Filler Text Generator: paragraphs, sentences or words, how many, and whether to
// start with the classic opening. The text follows on every change; Generate again picks new words.
// The page opens on seed 1, so the server and the browser show the same text. Copy writes only to
// the visitor's own clipboard.

const COPIED_MESSAGE_MS = 3000;
const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [unit, setUnit] = useState<Unit>("paragraphs");
  const [count, setCount] = useState("3");
  const [classic, setClassic] = useState(true);
  const [seed, setSeed] = useState(1);
  const [message, setMessage] = useState("");

  const result = run({ unit, count, classic, seed });
  const text = result.ok ? result.paragraphs.join("\n\n") : "";

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the text and copy it.");
    }
  };

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="lorem-unit"
          label="Make"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
        >
          <option value="paragraphs">Paragraphs</option>
          <option value="sentences">Sentences</option>
          <option value="words">Words</option>
        </Select>
        <Input
          id="lorem-count"
          label="How many"
          hint={`From 1 to ${number.format(MAX_COUNT[unit])}`}
          inputMode="numeric"
          autoComplete="off"
          value={count}
          error={result.ok ? undefined : result.error}
          onChange={(event) => setCount(event.target.value)}
        />
      </div>
      <Checkbox
        id="lorem-classic"
        label="Start with the classic opening"
        checked={classic}
        onChange={(event) => setClassic(event.target.checked)}
      />
      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0] ?? seed + 1)}
        >
          Generate again
        </Button>
        <Button variant="secondary" size="sm" disabled={text === ""} onClick={copy}>
          Copy text
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
      {result.ok ? (
        <>
          <StatGrid
            items={[
              {
                id: "paragraphs",
                label: "Paragraphs",
                value: number.format(result.paragraphs.length),
              },
              { id: "words", label: "Words", value: number.format(result.words) },
            ]}
          />
          <section id="lorem-result" aria-label="Generated text" className="grid gap-3">
            {result.paragraphs.map((paragraph, index) => (
              // The paragraphs are rebuilt together each time, so their position is their identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <p key={index}>{paragraph}</p>
            ))}
          </section>
        </>
      ) : (
        <Alert tone="info">Fix the number above to see the text.</Alert>
      )}
    </>
  );
}

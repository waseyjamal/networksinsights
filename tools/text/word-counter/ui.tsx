import { Button, StatGrid, Textarea } from "@ui";
import { useEffect, useState } from "react";
import {
  type Counts,
  countInSteps,
  formatDuration,
  run,
  STEP_SIZE,
  WORDS_PER_MINUTE,
} from "./logic";

// The workspace of Word Counter: a text box and the counts, updated as the visitor types.
// A short text is counted at once on every change. A long one (a pasted book) is counted in steps,
// with a pause after each one, so typing and scrolling never wait for it; a new change drops the
// run in progress. Nothing is sent anywhere: the text never leaves this component.

/** Wait this long after the last change before counting a long text again. */
const LONG_TEXT_DELAY_MS = 120;
/** Wait this long after the last change before the screen-reader summary speaks. */
const ANNOUNCE_DELAY_MS = 900;

const EMPTY = run({ text: "" });
const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [text, setText] = useState("");
  const [counts, setCounts] = useState<Counts>(EMPTY);
  const [counting, setCounting] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (text.length <= STEP_SIZE) {
      setCounts(run({ text }));
      setCounting(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const steps = countInSteps(text);
    const next = () => {
      if (cancelled) return;
      const step = steps.next();
      if (step.done) {
        setCounts(step.value);
        setCounting(false);
      } else {
        timer = setTimeout(next, 0);
      }
    };
    setCounting(true);
    timer = setTimeout(next, LONG_TEXT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    if (counting) return;
    const timer = setTimeout(() => {
      setAnnouncement(
        `${number.format(counts.words)} ${counts.words === 1 ? "word" : "words"}, ` +
          `${number.format(counts.characters)} ${counts.characters === 1 ? "character" : "characters"}.`,
      );
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [counts, counting]);

  return (
    <>
      <Textarea
        id="word-counter-text"
        label="Your text"
        hint="Type or paste. The counts update as you go."
        rows={10}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="ni-workspace__actions">
        <Button variant="ghost" size="sm" disabled={text === ""} onClick={() => setText("")}>
          Clear text
        </Button>
      </div>
      <section aria-labelledby="word-counter-results" aria-busy={counting} className="grid gap-3">
        <h3 id="word-counter-results" className="text-lg">
          Counts
        </h3>
        <StatGrid
          items={[
            { id: "words", label: "Words", value: number.format(counts.words) },
            { id: "characters", label: "Characters", value: number.format(counts.characters) },
            {
              id: "characters-no-spaces",
              label: "Characters without spaces",
              value: number.format(counts.charactersNoSpaces),
            },
            { id: "sentences", label: "Sentences", value: number.format(counts.sentences) },
            { id: "paragraphs", label: "Paragraphs", value: number.format(counts.paragraphs) },
            {
              id: "reading-time",
              label: "Reading time",
              value: formatDuration(counts.readingSeconds),
            },
          ]}
        />
        <p className="text-sm text-fg-muted">
          {counting
            ? "Counting a long text…"
            : `Reading time assumes ${WORDS_PER_MINUTE} words per minute.`}
        </p>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </section>
    </>
  );
}

import { Alert, Button, Checkbox, DiffView, StatGrid, Textarea } from "@ui";
import { useEffect, useMemo, useState } from "react";
import { type DiffResult, diffInSteps, formatDiff, run } from "./logic";

// The workspace of Text Diff Checker: two text boxes and the lines that differ, compared as the
// visitor types. Short texts are compared at once on every change. Long ones (a pasted file) are
// compared in steps, with a pause after each one, so typing and scrolling never wait for it; a new
// change drops the run in progress. Only the first lines of a long result are drawn, more on
// request. Nothing is sent anywhere: the texts never leave this component, and Copy writes the diff
// only to the visitor's own clipboard.

/** Two texts this long together, in UTF-16 units, are compared at once on every change. */
const SMALL_TEXT = 32_768;
/** Wait this long after the last change before comparing long texts again. */
const LONG_TEXT_DELAY_MS = 150;
/** Wait this long after the last change before the screen-reader summary speaks. */
const ANNOUNCE_DELAY_MS = 900;
/** How many lines of the result are drawn, and how many more each "Show more" adds. */
const ROWS_PER_PAGE = 1_000;
/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3_000;

const number = new Intl.NumberFormat("en-US");
const lines = (count: number) => `${number.format(count)} ${count === 1 ? "line" : "lines"}`;

export default function ToolUi() {
  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [result, setResult] = useState<DiffResult | undefined>(undefined);
  const [comparing, setComparing] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);
  const [limit, setLimit] = useState(ROWS_PER_PAGE);
  const [announcement, setAnnouncement] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    if (original === "" && modified === "") {
      setResult(undefined);
      setComparing(false);
      return;
    }
    if (original.length + modified.length <= SMALL_TEXT) {
      setResult(run({ original, modified }));
      setComparing(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const steps = diffInSteps({ original, modified });
    const next = () => {
      if (cancelled) return;
      const step = steps.next();
      if (step.done) {
        setResult(step.value);
        setComparing(false);
      } else {
        timer = setTimeout(next, 0);
      }
    };
    setComparing(true);
    timer = setTimeout(next, LONG_TEXT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [original, modified]);

  useEffect(() => {
    if (comparing || result === undefined) return;
    const timer = setTimeout(() => {
      setAnnouncement(
        `${lines(result.added)} added, ${lines(result.removed)} removed, ${lines(result.unchanged)} unchanged.`,
      );
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [result, comparing]);

  useEffect(() => {
    if (copyMessage === "") return;
    const timer = setTimeout(() => setCopyMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [copyMessage]);

  const listed = useMemo(
    () => (changesOnly ? result?.lines.filter((line) => line.kind !== "same") : result?.lines),
    [result, changesOnly],
  );

  const copy = async () => {
    if (result === undefined) return;
    try {
      await navigator.clipboard.writeText(formatDiff(result.lines));
      setCopyMessage("Copied to the clipboard.");
    } catch {
      setCopyMessage("Your browser did not allow copying. Select the differences and copy them.");
    }
  };

  const identical = result !== undefined && result.added === 0 && result.removed === 0;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Textarea
          id="diff-checker-original"
          label="Original"
          hint="Type or paste the first version."
          rows={12}
          spellCheck={false}
          wrap="off"
          value={original}
          onChange={(event) => setOriginal(event.target.value)}
        />
        <Textarea
          id="diff-checker-modified"
          label="Modified"
          hint="Type or paste the changed version."
          rows={12}
          spellCheck={false}
          wrap="off"
          value={modified}
          onChange={(event) => setModified(event.target.value)}
        />
      </div>
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={result === undefined || result.lines.length === 0}
          onClick={copy}
        >
          Copy diff
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={original === "" && modified === ""}
          onClick={() => {
            setOriginal("");
            setModified("");
            setCopyMessage("");
          }}
        >
          Clear both
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {copyMessage}
      </p>
      <section aria-labelledby="diff-checker-results" aria-busy={comparing} className="grid gap-3">
        <h3 id="diff-checker-results" className="text-lg">
          Differences
        </h3>
        <StatGrid
          items={[
            { id: "added", label: "Lines added", value: number.format(result?.added ?? 0) },
            { id: "removed", label: "Lines removed", value: number.format(result?.removed ?? 0) },
            {
              id: "unchanged",
              label: "Lines unchanged",
              value: number.format(result?.unchanged ?? 0),
            },
          ]}
        />
        <p className="text-sm text-fg-muted">
          {comparing
            ? "Comparing a long text…"
            : result === undefined
              ? "Type or paste text into both boxes. The differences appear here as you go."
              : identical
                ? "The two texts are identical."
                : "Added lines are green with a plus, removed lines are red with a minus, and unchanged lines are grey."}
        </p>
        {result?.approximate && !comparing ? (
          <Alert tone="warning" title="These texts are too different to compare exactly">
            The comparison stopped early. Some lines shown as removed and added may match a line in
            the other text.
          </Alert>
        ) : null}
        {result !== undefined && result.lines.length > 0 ? (
          <>
            <Checkbox
              label="Show only the changed lines"
              checked={changesOnly}
              onChange={(event) => setChangesOnly(event.target.checked)}
            />
            {listed !== undefined && listed.length > 0 ? (
              <>
                <DiffView
                  id="diff-checker-diff"
                  label="Lines of both texts, compared"
                  rows={listed.slice(0, limit)}
                />
                {listed.length > limit ? (
                  <div className="ni-workspace__actions">
                    <p className="text-sm text-fg-muted">
                      Showing the first {lines(limit)} of {lines(listed.length)}.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setLimit((current) => current + ROWS_PER_PAGE)}
                    >
                      Show more
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </section>
    </>
  );
}

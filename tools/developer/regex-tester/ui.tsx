import { Alert, Button, Input, MatchText, Textarea } from "@ui";
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { type Group, type Match, type Matched, run } from "./logic";

// The workspace of Regex Tester: a pattern, its flags and a test string. As any of them changes it
// runs the pattern with this browser's own RegExp, highlights every match inside the test string
// and lists each match with its index, its text and its capture groups. Nothing is sent anywhere:
// Copy writes only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

/** The flags the page starts with: g, so that every match is found and not only the first. */
const START_FLAGS = "g";

const count = (n: number) => n.toLocaleString("en-US");

/** Visitor text in a monospace run that keeps its spaces and line breaks and wraps anywhere. */
function Code({ children }: { children: string }) {
  return <code className="font-mono whitespace-pre-wrap break-all">{children}</code>;
}

function groupLabel(group: Group): string {
  return group.name === null ? `Group ${group.number}` : `Group ${group.number} (${group.name})`;
}

const MatchRow = memo(function MatchRow({ match, number }: { match: Match; number: number }) {
  return (
    <li className="grid gap-1 rounded-xl border border-border bg-surface-raised p-3">
      <p className="text-sm text-fg-muted">
        <span className="font-medium text-fg">Match {count(number)}</span> at index{" "}
        <span className="font-mono">{count(match.index)}</span>
        {match.text === "" ? "" : ` to ${count(match.end)}`}
      </p>
      <p>
        {match.text === "" ? <span className="text-sm text-fg-muted">(empty match)</span> : null}
        {match.text === "" ? null : <Code>{match.text}</Code>}
      </p>
      {match.groups.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {match.groups.map((group) => (
            <li key={group.number}>
              <span className="text-fg-muted">{groupLabel(group)}: </span>
              {group.value === null ? (
                <span className="text-fg-muted">did not take part</span>
              ) : group.value === "" ? (
                <span className="text-fg-muted">(empty)</span>
              ) : (
                <Code>{group.value}</Code>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});

/** What one run found, in a sentence. */
function summaryOf(result: Matched, text: string): string {
  const n = result.matches.length;
  if (n === 0) return "No matches.";
  const parts = [
    result.truncated
      ? `The first ${count(n)} matches are shown; there are more.`
      : `${count(n)} ${n === 1 ? "match" : "matches"}.`,
  ];
  if (!result.global) parts.push("Only the first match is found because the g flag is off.");
  if (result.empty > 0) {
    parts.push(
      `${count(result.empty)} of them ${result.empty === 1 ? "is an empty match and is" : "are empty matches and are"} not highlighted.`,
    );
  }
  if (text === "") parts.push("The test string is empty.");
  return parts.join(" ");
}

// Holds the highlighted string and the list of matches. It is memoised on the result, so typing
// in a box does not redraw up to a thousand rows until the deferred result has changed.
const Output = memo(function Output({ result, text }: { result: Matched; text: string }) {
  return (
    <>
      <p className="text-sm" id="regex-tester-summary" aria-live="polite">
        {summaryOf(result, text)}
      </p>
      {text !== "" && (
        <MatchText
          id="regex-tester-highlighted"
          label="Test string with matches highlighted"
          segments={result.segments}
        />
      )}
      {result.matches.length > 0 && (
        <section aria-labelledby="regex-tester-matches" className="grid gap-3">
          <h3 id="regex-tester-matches" className="text-sm font-medium">
            Matches
          </h3>
          <ol className="grid gap-2" id="regex-tester-list">
            {result.matches.map((match, index) => (
              <MatchRow key={`${match.index}-${match.end}`} match={match} number={index + 1} />
            ))}
          </ol>
        </section>
      )}
    </>
  );
});

export default function ToolUi() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState(START_FLAGS);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");

  // The boxes stay responsive while a big test string is matched: the run follows a moment later.
  const deferredPattern = useDeferredValue(pattern);
  const deferredFlags = useDeferredValue(flags);
  const deferredText = useDeferredValue(text);
  const result = useMemo(
    () => run({ pattern: deferredPattern, flags: deferredFlags, text: deferredText }),
    [deferredPattern, deferredFlags, deferredText],
  );

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copyPattern = async () => {
    try {
      await navigator.clipboard.writeText(pattern);
      setMessage("Pattern copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the pattern and copy it.");
    }
  };

  const patternError = !result.ok && result.reason === "pattern" ? result.error : undefined;
  const flagsError = !result.ok && result.reason === "flags" ? result.error : undefined;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="regex-tester-pattern"
          label="Regular expression"
          hint="Type the pattern without the slashes around it."
          error={patternError}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="font-mono"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
        />
        <Input
          id="regex-tester-flags"
          label="Flags"
          hint="Any of g (every match), i (ignore case), m (each line), s (dot matches a line break) and u (Unicode)."
          error={flagsError}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="font-mono"
          value={flags}
          onChange={(event) => setFlags(event.target.value)}
        />
      </div>
      <Textarea
        id="regex-tester-text"
        label="Test string"
        hint="The matches are found as you type."
        rows={8}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="font-mono"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={pattern === ""}
          onClick={() => void copyPattern()}
        >
          Copy pattern
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pattern === "" && text === "" && flags === START_FLAGS}
          onClick={() => {
            setPattern("");
            setFlags(START_FLAGS);
            setText("");
          }}
        >
          Clear
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>

      {!result.ok && result.reason === "too-large" && (
        <Alert tone="warning" title="This is too large to test">
          <p id="regex-tester-error">{result.error}</p>
        </Alert>
      )}
      {result.ok && <Output result={result} text={deferredText} />}
    </>
  );
}

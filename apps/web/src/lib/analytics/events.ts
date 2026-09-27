// What an error report may contain (ADR 0051). Pure functions, so the rules that keep a visitor's
// words out of the report are tested without a browser.
//
// An error message can carry what a visitor typed or dropped ("Invalid URL: <their text>"), so a
// report keeps only the error's shape: its name, its message with quoted text, URLs, email
// addresses and long numbers replaced, the file of ours it came from, and the line.

/** The two events the site sends besides page views and Web Vitals. */
export const EVENTS = {
  /** Once per page view, the first time a visitor works with a tool. Data: `{ tool }`. */
  toolUsed: "tool-used",
  /** An uncaught error, stripped of anything a visitor typed. */
  error: "js-error",
} as const;

/** The most error events one page view sends. The rest are dropped. */
export const MAX_ERRORS_PER_PAGE = 3;

/** The longest message a report keeps, after scrubbing. */
export const MAX_MESSAGE_LENGTH = 120;

export interface ErrorReport {
  /** "TypeError", "Error", or the type of what was thrown when it was not an Error. */
  name: string;
  message: string;
  /** Path of our own file (`/_astro/x.js`), "external" for another origin's, "" when unknown. */
  source: string;
  line: number;
  column: number;
  /** The tool whose page this is, or "" on other pages. */
  tool: string;
}

export function scrubMessage(message: string): string {
  const scrubbed = message
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”/g, "<text>")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s"'`”]+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "<email>")
    .replace(/\d{4,}/g, "<number>")
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed.length > MAX_MESSAGE_LENGTH
    ? `${scrubbed.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
    : scrubbed;
}

/** The path of a script of ours, without query or hash; never another site's address. */
export function sourceOf(filename: string | undefined, origin: string): string {
  if (!filename) return "";
  try {
    const url = new URL(filename);
    return url.origin === origin ? url.pathname : "external";
  } catch {
    return "";
  }
}

const whole = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

/** A report from what `error` or `unhandledrejection` delivers. */
export function errorReport(input: {
  error: unknown;
  message?: string | undefined;
  filename?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  origin: string;
  tool: string;
}): ErrorReport {
  const { error } = input;
  const name =
    error instanceof Error
      ? error.name
      : error === null || error === undefined
        ? "Error"
        : typeof error;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : input.message;
  return {
    name: scrubMessage(name).slice(0, 40) || "Error",
    message: scrubMessage(message ?? ""),
    source: sourceOf(input.filename, input.origin),
    line: whole(input.line),
    column: whole(input.column),
    tool: input.tool,
  };
}

/**
 * Lets through at most `max` distinct reports per page view: an error in an animation frame or a
 * loop would otherwise use up the month's events in minutes.
 */
export function reportLimiter(max: number): (report: ErrorReport) => boolean {
  const seen = new Set<string>();
  return (report) => {
    if (seen.size >= max) return false;
    const key = [report.name, report.message, report.source, report.line].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

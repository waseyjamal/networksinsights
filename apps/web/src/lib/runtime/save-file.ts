// saveFile(): the one way a tool gives the visitor a file (ADR 0050, docs/tool-contract.md
// "Downloads"). Import it from "@ui".
//
// It names the file safely, gives it the right media type, always downloads it (never opens it in
// a tab, where an HTML or SVG result would run as a page of this site), and revokes the object URL
// once the download has started, so the file's memory is given back.

// The download module only, not the SDK's index: that would bring Zod and the whole contract into
// every page that offers a download.
import { mimeTypeFor, safeFilename } from "@networksinsights/tool-sdk/download";

/**
 * How long the object URL stays alive after the click. The browser reads the file when the
 * download starts, not at the click, and Firefox and Safari fail a download whose URL was revoked
 * in the same task. Thirty seconds is long enough for the start and short enough not to matter.
 */
export const REVOKE_AFTER_MS = 30_000;

export interface SaveFileOptions {
  /** The media type. Defaults to the one the file name's extension implies (mimeTypeFor). */
  type?: string;
  /** The extension to force, whatever the name has: `"pdf"`. */
  extension?: string;
  /** The name to use when `name` has nothing usable left. Defaults to "download". */
  fallback?: string;
}

/** What the browser provides. Tests pass their own. */
export interface SaveFileEnvironment {
  document: Pick<Document, "createElement" | "body">;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  setTimeout: (callback: () => void, ms: number) => unknown;
}

const browser = (): SaveFileEnvironment => ({
  document,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
});

/**
 * Downloads `data` as a file called `name` (made safe first). Returns the name and type it used.
 *
 * ```tsx
 * <Button onClick={() => saveFile(result, `${input.name}.txt`)}>Download</Button>
 * ```
 */
export function saveFile(
  data: BlobPart,
  name: string,
  options: SaveFileOptions = {},
  env: SaveFileEnvironment = browser(),
): { filename: string; type: string } {
  const filename = safeFilename(name, {
    ...(options.extension !== undefined ? { extension: options.extension } : {}),
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
  });
  const type = options.type ?? mimeTypeFor(filename);
  // Always a new Blob with the chosen type: a Blob the tool got from elsewhere may claim any type.
  const url = env.createObjectURL(new Blob([data], { type }));
  try {
    const link = env.document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    link.hidden = true;
    env.document.body.append(link);
    link.click();
    link.remove();
  } finally {
    env.setTimeout(() => env.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
  return { filename, type };
}

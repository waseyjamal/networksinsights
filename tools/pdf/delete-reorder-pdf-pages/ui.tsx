import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  type Item,
  initialItems,
  isUnchanged,
  type Job,
  type JobResult,
  keptPages,
  LIMITS,
  MAX_PAGES,
  MESSAGES,
  moveItem,
  outputName,
  pagesLabel,
  summary,
  toggleDeleted,
} from "./logic";

// The workspace of Delete and Reorder PDF Pages. Choosing a PDF starts worker.ts, which counts the
// pages and draws a thumbnail of each. The visitor drags a page, or uses its buttons (keyboard
// friendly), to move it, and marks pages to delete; Save sends the new order to the worker, which
// writes the new PDF with pdf-lib. The PDF code loads only with the worker (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
  /** Object URLs of the thumbnails, by original page number; empty when none could be drawn. */
  urls: Map<number, string>;
}

interface Output {
  blob: Blob;
  name: string;
  summary: string;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

const revoke = (source: Source | null) => {
  if (source) for (const url of source.urls.values()) URL.revokeObjectURL(url);
};

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [fileError, setFileError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [announce, setAnnounce] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => () => revoke(sourceRef.current), []);

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setOutput(null);
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setBusy(true);
    setProgress(undefined);
    try {
      const result = await client.run(
        { kind: "open", file },
        {
          onProgress: ({ done, total }) =>
            setProgress(total > 0 ? Math.round((done / total) * 100) : undefined),
        },
      );
      if (result.kind === "open") {
        revoke(sourceRef.current);
        const urls = new Map<number, string>();
        for (const thumb of result.thumbs) {
          if (thumb.blob) urls.set(thumb.page, URL.createObjectURL(thumb.blob));
        }
        setSource({ file, pages: result.pages, urls });
        setItems(initialItems(result.pages));
        setAnnounce("");
      }
      setFileError("");
    } catch (caught) {
      revoke(sourceRef.current);
      setSource(null);
      setItems([]);
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Moves a page and keeps the keyboard focus on the button that moved it. */
  const move = (from: number, to: number, focus?: string) => {
    const item = items[from];
    if (!item) return;
    const next = moveItem(items, from, to);
    if (next === items) return;
    setItems(next);
    setOutput(null);
    setError("");
    const position = next.indexOf(item) + 1;
    setAnnounce(`Page ${item.page} moved to position ${position} of ${next.length}.`);
    if (focus) {
      requestAnimationFrame(() => {
        const target = list.current?.querySelector<HTMLButtonElement>(
          `[data-page="${item.page}"][data-action="${focus}"]`,
        );
        if (target && !target.disabled) target.focus();
        else list.current?.querySelector<HTMLButtonElement>(`[data-page="${item.page}"]`)?.focus();
      });
    }
  };

  const toggle = (index: number) => {
    const item = items[index];
    if (!item) return;
    setItems(toggleDeleted(items, index));
    setOutput(null);
    setError("");
    setAnnounce(
      item.deleted ? `Page ${item.page} will be kept.` : `Page ${item.page} will be deleted.`,
    );
  };

  const reset = () => {
    if (!source) return;
    setItems(initialItems(source.pages));
    setOutput(null);
    setError("");
    setAnnounce("Back to the original order, with every page kept.");
  };

  const save = async () => {
    if (!source) return;
    setOutput(null);
    const order = keptPages(items);
    if (order.length === 0) {
      setError(MESSAGES.allDeleted);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(undefined);
    try {
      const result = await client.run({ kind: "build", file: source.file, order });
      if (result.kind === "build") {
        setOutput({
          blob: result.blob,
          name: outputName(source.file.name),
          summary: summary(items),
        });
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  const kept = keptPages(items).length;

  return (
    <>
      <Dropzone
        id="delete-reorder-pdf-pages-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)} and ${MAX_PAGES} pages`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}
      {busy && !source && (
        <Progress
          {...(progress === undefined ? {} : { value: progress })}
          label="Drawing the page thumbnails"
        />
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="delete-reorder-pdf-pages-original">
            {source.file.name}: {pagesLabel(source.pages)}, {formatSize(source.file.size)}
          </p>
          <p className="text-sm text-fg-muted" id="delete-reorder-pdf-pages-help">
            Drag a page to a new place, or use its arrow buttons. Delete marks a page to leave out;
            press it again to keep the page.
          </p>
          <ol
            ref={list}
            aria-label="Pages"
            aria-describedby="delete-reorder-pdf-pages-help"
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))" }}
          >
            {items.map((item, index) => {
              const url = source.urls.get(item.page);
              return (
                <li
                  key={item.page}
                  draggable
                  onDragStart={(event) => {
                    setDragging(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(item.page));
                  }}
                  onDragOver={(event) => {
                    if (dragging !== null) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging !== null) move(dragging, index);
                    setDragging(null);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`grid gap-2 rounded-lg border p-2 cursor-move ${
                    item.deleted ? "border-danger bg-danger-soft" : "border-border bg-surface"
                  }`}
                  style={{ opacity: dragging === index ? 0.5 : 1 }}
                >
                  <div
                    className="grid place-items-center rounded-md border border-border bg-white"
                    style={{ height: "10rem" }}
                  >
                    {url ? (
                      <img
                        src={url}
                        alt={`Thumbnail of page ${item.page}`}
                        draggable={false}
                        className="max-w-full"
                        style={{ maxHeight: "9.5rem", opacity: item.deleted ? 0.35 : 1 }}
                      />
                    ) : (
                      <span className="text-sm text-black">Page {item.page}</span>
                    )}
                  </div>
                  <span className="text-sm font-medium text-fg">
                    {index + 1}. Page {item.page}
                    {item.deleted && <span className="text-danger-text"> (deleted)</span>}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      data-page={item.page}
                      data-action="earlier"
                      aria-label={`Move page ${item.page} earlier`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1, "earlier")}
                    >
                      ←
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-page={item.page}
                      data-action="later"
                      aria-label={`Move page ${item.page} later`}
                      disabled={index === items.length - 1}
                      onClick={() => move(index, index + 1, "later")}
                    >
                      →
                    </Button>
                    <Button
                      size="sm"
                      variant={item.deleted ? "secondary" : "ghost"}
                      data-page={item.page}
                      data-action="delete"
                      aria-label={`Delete page ${item.page}`}
                      aria-pressed={item.deleted}
                      onClick={() => toggle(index)}
                    >
                      {item.deleted ? "Keep" : "Delete"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="sr-only" role="status" aria-live="polite">
            {announce}
          </p>
          <p className="text-sm text-fg-muted" id="delete-reorder-pdf-pages-summary">
            The new PDF will have {pagesLabel(kept)}.
          </p>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save new PDF
            </Button>
            <Button variant="ghost" disabled={isUnchanged(items)} onClick={reset}>
              Start over
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="New PDF">
          <FileResult
            name={output.name}
            meta={`${output.summary}, ${formatSize(output.blob.size)}`}
            state="done"
            icon="pdf"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "application/pdf" })}
              >
                Download
              </Button>
            }
          />
        </FileResultList>
      )}
    </>
  );
}

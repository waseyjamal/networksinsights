import {
  Alert,
  Badge,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  Select,
  StatGrid,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkFiles,
  defaultFormat,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  OUTPUT_FORMATS,
  type OutputFormat,
  outputName,
  QUALITY_LEVELS,
  type QualityLevel,
  type Rejected,
  saving,
  sizeLine,
  writableFormats,
} from "./logic";

// The workspace of Compress Image. The visitor's files go to worker.ts one at a time; the page
// only keeps the list, the previews and the downloads, so it stays responsive while an image is
// being encoded. The worker starts with the first file, so its code loads only then (ADR 0051).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type Status = "waiting" | "working" | "done" | "error";

interface Item {
  id: number;
  file: File;
  status: Status;
  /** 0 to 100 while working. */
  progress?: number | undefined;
  result?: { blob: Blob; url: string; format: OutputFormat } | undefined;
  error?: string | undefined;
  /** "Cancelled" after the visitor pressed Cancel: the file waits until Continue. */
  note?: string | undefined;
}

/**
 * Why a run was stopped: the visitor's Cancel, or new settings, Remove and Clear, which stop the
 * run to start again or to drop a file.
 */
type StopReason = "cancel" | "restart";

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** The formats this browser's canvas encoder writes, from a 1 by 1 image. */
function detectFormats(): OutputFormat[] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const typeOf = (mime: string) => /^data:([^;,]+)/.exec(canvas.toDataURL(mime))?.[1] ?? "";
  return writableFormats({
    jpg: typeOf(OUTPUT_FORMATS.jpg.mime),
    webp: typeOf(OUTPUT_FORMATS.webp.mime),
  });
}

let nextId = 1;

export default function ToolUi() {
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<Array<Rejected & { key: number }>>([]);
  const [formats, setFormats] = useState<OutputFormat[]>(["jpg", "webp"]);
  const [format, setFormat] = useState<OutputFormat>("webp");
  const [quality, setQuality] = useState<QualityLevel>("balanced");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const job = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // WebP is offered only where the browser can write it.
  useEffect(() => {
    const available = detectFormats();
    setFormats(available);
    setFormat(defaultFormat(available));
  }, []);

  // Previews are object URLs of the results: give their memory back when the page goes.
  useEffect(
    () => () => {
      for (const item of itemsRef.current) if (item.result) URL.revokeObjectURL(item.result.url);
    },
    [],
  );

  const update = useCallback((id: number, change: Partial<Item>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const compress = useCallback(
    async (targetFormat: OutputFormat, targetQuality: QualityLevel) => {
      const controller = new AbortController();
      job.current = controller;
      setBusy(true);
      let done = 0;
      try {
        for (;;) {
          const next = itemsRef.current.find((item) => item.status === "waiting");
          if (!next || controller.signal.aborted) break;
          update(next.id, { status: "working", progress: 0, note: undefined, error: undefined });
          try {
            const output = await client.run(
              { file: next.file, format: targetFormat, quality: targetQuality },
              {
                signal: controller.signal,
                onProgress: ({ done: step, total }) =>
                  update(next.id, { progress: Math.round((step / total) * 100) }),
              },
            );
            const url = URL.createObjectURL(output.blob);
            update(next.id, {
              status: "done",
              result: { blob: output.blob, url, format: targetFormat },
            });
            done++;
          } catch (caught) {
            // Stopped on purpose: cancel() or a restart already set the list as it should be.
            if (controller.signal.aborted) break;
            const message =
              caught instanceof WorkerJobError && caught.expected
                ? caught.message
                : MESSAGES.failed;
            update(next.id, { status: "error", error: message });
          }
        }
      } finally {
        if (job.current === controller) job.current = null;
        setBusy(false);
        setAnnouncement(
          controller.signal.reason === "cancel"
            ? "Compression cancelled."
            : `${done} ${done === 1 ? "image" : "images"} compressed.`,
        );
      }
    },
    [update],
  );

  // Runs whenever there is work and nothing is running: new files, or new settings.
  useEffect(() => {
    if (!busy && items.some((item) => item.status === "waiting" && !item.note)) {
      void compress(format, quality);
    }
  }, [busy, items, format, quality, compress]);

  const add = (files: File[]) => {
    const { accepted, rejected: refused } = checkFiles(files, itemsRef.current.length);
    setRejected(refused.map((entry) => ({ ...entry, key: nextId++ })));
    if (accepted.length === 0) return;
    setItems((list) => [
      ...list,
      ...accepted.map((file) => ({ id: nextId++, file, status: "waiting" as const })),
    ]);
  };

  /** New settings: every result is made again with them. */
  const stop = (reason: StopReason) => job.current?.abort(reason);

  /** The visitor's Cancel: every file not yet done waits, marked, until Continue. */
  const cancel = () => {
    stop("cancel");
    setItems((list) =>
      list.map((item) =>
        item.status === "waiting" || item.status === "working"
          ? { ...item, status: "waiting", progress: undefined, note: "Cancelled" }
          : item,
      ),
    );
  };

  const restart = (nextFormat: OutputFormat, nextQuality: QualityLevel) => {
    stop("restart");
    setFormat(nextFormat);
    setQuality(nextQuality);
    setItems((list) =>
      list.map((item) => {
        if (item.result) URL.revokeObjectURL(item.result.url);
        return { id: item.id, file: item.file, status: "waiting" };
      }),
    );
  };

  const remove = (id: number) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item?.status === "working") stop("restart");
    if (item?.result) URL.revokeObjectURL(item.result.url);
    setItems((list) => list.filter((entry) => entry.id !== id));
  };

  const clear = () => {
    stop("restart");
    for (const item of itemsRef.current) if (item.result) URL.revokeObjectURL(item.result.url);
    setItems([]);
    setRejected([]);
  };

  const resume = () =>
    setItems((list) =>
      list.map((item) => (item.note === "Cancelled" ? { ...item, note: undefined } : item)),
    );

  const finished = items.filter((item) => item.status === "done" && item.result);
  const before = finished.reduce((sum, item) => sum + item.file.size, 0);
  const after = finished.reduce((sum, item) => sum + (item.result?.blob.size ?? 0), 0);
  const total = saving(before, after);
  const cancelled = items.some((item) => item.note === "Cancelled");
  const webpMissing = !formats.includes("webp");

  return (
    <>
      <Dropzone
        id="compress-image-files"
        accept={ACCEPT}
        title="Drop images here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} at a time`}
        onFiles={add}
      />

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="compress-image-format"
          label="Save as"
          hint={webpMissing ? MESSAGES.formatUnavailable("WebP") : undefined}
          value={format}
          onChange={(event) => restart(event.target.value as OutputFormat, quality)}
        >
          {(Object.keys(OUTPUT_FORMATS) as OutputFormat[]).map((key) => (
            <option key={key} value={key} disabled={!formats.includes(key)}>
              {OUTPUT_FORMATS[key].label}
            </option>
          ))}
        </Select>
        <Select
          id="compress-image-quality"
          label="Quality"
          hint="Lower quality gives a smaller file."
          value={quality}
          onChange={(event) => restart(format, event.target.value as QualityLevel)}
        >
          {(Object.keys(QUALITY_LEVELS) as QualityLevel[]).map((key) => (
            <option key={key} value={key}>
              {QUALITY_LEVELS[key].label}
            </option>
          ))}
        </Select>
      </div>

      {rejected.length > 0 && (
        <Alert
          tone="warning"
          title={
            rejected.length === 1
              ? "One file was not added"
              : `${rejected.length} files were not added`
          }
        >
          <ul>
            {rejected.map((entry) => (
              <li key={entry.key}>
                {entry.name}: {entry.reason}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {items.length > 0 && (
        <section aria-labelledby="compress-image-results" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="compress-image-results" className="text-lg">
              Your images
            </h3>
            <div className="flex flex-wrap gap-2">
              {busy && (
                <Button size="sm" variant="secondary" onClick={cancel}>
                  Cancel
                </Button>
              )}
              {!busy && cancelled && (
                <Button size="sm" variant="secondary" onClick={resume}>
                  Continue
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={clear}>
                Clear all
              </Button>
            </div>
          </div>

          {finished.length > 0 && (
            <StatGrid
              items={[
                {
                  id: "images",
                  label: "Images done",
                  value: `${finished.length} of ${items.length}`,
                },
                { id: "before", label: "Before", value: formatSize(before) },
                { id: "after", label: "After", value: formatSize(after) },
                {
                  id: "saved",
                  label: total.larger ? "Larger by" : `Saved (${total.percent}%)`,
                  value: formatSize(Math.abs(total.saved)),
                },
              ]}
            />
          )}

          <FileResultList label="Compressed images">
            {items.map((item) => (
              <ResultRow key={item.id} item={item} onRemove={() => remove(item.id)} />
            ))}
          </FileResultList>
        </section>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function ResultRow({ item, onRemove }: { item: Item; onRemove: () => void }) {
  const { file, result } = item;
  const change = result ? saving(file.size, result.blob.size) : undefined;
  const name = result ? outputName(file.name, result.format) : "";
  const meta = result ? sizeLine(file.size, result.blob.size) : formatSize(file.size);

  return (
    <FileResult
      name={file.name}
      meta={meta}
      state={item.status}
      previewSrc={result?.url}
      previewAlt={result ? `Compressed preview of ${file.name}` : undefined}
      actions={
        <>
          {result && (
            <Button
              size="sm"
              variant={change?.larger ? "secondary" : "primary"}
              aria-label={`Download ${name}`}
              onClick={() =>
                saveFile(result.blob, name, { type: OUTPUT_FORMATS[result.format].mime })
              }
            >
              {change?.larger ? "Download anyway" : "Download"}
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label={`Remove ${file.name}`} onClick={onRemove}>
            Remove
          </Button>
        </>
      }
    >
      {item.status === "working" && (
        <Progress value={item.progress ?? 0} label={`Compressing ${file.name}`} />
      )}
      {item.status === "waiting" && (
        <span className="text-sm text-fg-muted">{item.note ?? "Waiting"}</span>
      )}
      {item.status === "error" && (
        <span className="text-sm text-danger-text" role="alert">
          {item.error}
        </span>
      )}
      {change &&
        (change.larger ? (
          <Badge tone="warning">Larger than the original: keep the original</Badge>
        ) : (
          <Badge tone="success">{change.percent}% smaller</Badge>
        ))}
    </FileResult>
  );
}

import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Progress,
  Select,
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
  type Rejected,
  writableFormats,
} from "./logic";

// The workspace of Image Converter. Files go to worker.ts one at a time, so the page stays
// responsive; the worker's code loads with the first file (ADR 0051). A new format converts
// every file again.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type Status = "waiting" | "working" | "done" | "error";

interface Item {
  id: number;
  file: File;
  status: Status;
  progress?: number | undefined;
  result?: { blob: Blob; url: string; format: OutputFormat; width: number; height: number };
  error?: string | undefined;
}

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** The formats this browser's canvas encoder writes, asked of a 1 by 1 canvas. */
function detectFormats(): OutputFormat[] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const typeOf = (mime: string) => /^data:([^;,]+)/.exec(canvas.toDataURL(mime))?.[1] ?? "";
  return writableFormats({
    jpg: typeOf(OUTPUT_FORMATS.jpg.mime),
    png: typeOf(OUTPUT_FORMATS.png.mime),
    webp: typeOf(OUTPUT_FORMATS.webp.mime),
  });
}

let nextId = 1;

export default function ToolUi() {
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<Array<Rejected & { key: number }>>([]);
  const [formats, setFormats] = useState<OutputFormat[]>(["jpg", "png", "webp"]);
  const [format, setFormat] = useState<OutputFormat>("jpg");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const job = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const available = detectFormats();
    setFormats(available);
    setFormat(defaultFormat(available));
  }, []);

  useEffect(
    () => () => {
      for (const item of itemsRef.current) if (item.result) URL.revokeObjectURL(item.result.url);
    },
    [],
  );

  const update = useCallback((id: number, change: Partial<Item>) => {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  const convert = useCallback(
    async (target: OutputFormat) => {
      const controller = new AbortController();
      job.current = controller;
      setBusy(true);
      let done = 0;
      try {
        for (;;) {
          const next = itemsRef.current.find((item) => item.status === "waiting");
          if (!next || controller.signal.aborted) break;
          update(next.id, { status: "working", progress: 0, error: undefined });
          try {
            const output = await client.run(
              { file: next.file, format: target },
              {
                signal: controller.signal,
                onProgress: ({ done: step, total }) =>
                  update(next.id, { progress: Math.round((step / total) * 100) }),
              },
            );
            update(next.id, {
              status: "done",
              result: {
                blob: output.blob,
                url: URL.createObjectURL(output.blob),
                format: target,
                width: output.width,
                height: output.height,
              },
            });
            done++;
          } catch (caught) {
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
        if (!controller.signal.aborted) {
          setAnnouncement(`${done} ${done === 1 ? "image" : "images"} converted.`);
        }
      }
    },
    [update],
  );

  useEffect(() => {
    if (!busy && items.some((item) => item.status === "waiting")) void convert(format);
  }, [busy, items, format, convert]);

  const add = (files: File[]) => {
    const { accepted, rejected: refused } = checkFiles(files, itemsRef.current.length);
    setRejected(refused.map((entry) => ({ ...entry, key: nextId++ })));
    if (accepted.length === 0) return;
    setItems((list) => [
      ...list,
      ...accepted.map((file) => ({ id: nextId++, file, status: "waiting" as const })),
    ]);
  };

  const restart = (next: OutputFormat) => {
    job.current?.abort();
    setFormat(next);
    setItems((list) =>
      list.map((item) => {
        if (item.result) URL.revokeObjectURL(item.result.url);
        return { id: item.id, file: item.file, status: "waiting" };
      }),
    );
  };

  const remove = (id: number) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item?.status === "working") job.current?.abort();
    if (item?.result) URL.revokeObjectURL(item.result.url);
    setItems((list) => list.filter((entry) => entry.id !== id));
  };

  const clear = () => {
    job.current?.abort();
    for (const item of itemsRef.current) if (item.result) URL.revokeObjectURL(item.result.url);
    setItems([]);
    setRejected([]);
  };

  const webpMissing = !formats.includes("webp");

  return (
    <>
      <Dropzone
        id="image-converter-files"
        accept={ACCEPT}
        title="Drop images here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} at a time`}
        onFiles={add}
      />

      <Select
        id="image-converter-format"
        label="Convert to"
        hint={webpMissing ? MESSAGES.formatUnavailable("WebP") : undefined}
        value={format}
        onChange={(event) => restart(event.target.value as OutputFormat)}
      >
        {(Object.keys(OUTPUT_FORMATS) as OutputFormat[]).map((key) => (
          <option key={key} value={key} disabled={!formats.includes(key)}>
            {OUTPUT_FORMATS[key].label}
          </option>
        ))}
      </Select>

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
        <section aria-labelledby="image-converter-results" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="image-converter-results" className="text-lg">
              Your images
            </h3>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear all
            </Button>
          </div>
          <FileResultList label="Converted images">
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
  const name = result ? outputName(file.name, result.format) : "";
  const meta = result
    ? `${formatSize(file.size)} → ${formatSize(result.blob.size)}, ${result.width} × ${result.height} pixels`
    : formatSize(file.size);
  return (
    <FileResult
      name={file.name}
      meta={meta}
      state={item.status}
      previewSrc={result?.url}
      previewAlt={result ? `Converted preview of ${file.name}` : undefined}
      actions={
        <>
          {result && (
            <Button
              size="sm"
              aria-label={`Download ${name}`}
              onClick={() =>
                saveFile(result.blob, name, { type: OUTPUT_FORMATS[result.format].mime })
              }
            >
              Download
            </Button>
          )}
          <Button size="sm" variant="ghost" aria-label={`Remove ${file.name}`} onClick={onRemove}>
            Remove
          </Button>
        </>
      }
    >
      {item.status === "working" && (
        <Progress value={item.progress ?? 0} label={`Converting ${file.name}`} />
      )}
      {item.status === "waiting" && <span className="text-sm text-fg-muted">Waiting</span>}
      {item.status === "error" && (
        <span className="text-sm text-danger-text" role="alert">
          {item.error}
        </span>
      )}
    </FileResult>
  );
}

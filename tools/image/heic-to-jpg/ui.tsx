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
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  OUTPUT_FORMATS,
  type OutputFormat,
  outputName,
  QUALITIES,
  type Quality,
  type Rejected,
} from "./logic";

// The workspace of HEIC to JPG. The visitor's photos go to worker.ts one at a time; the page keeps
// the list, the previews and the downloads. The worker, and libheif with it, loads only when the
// first photo is added (ADR 0051, ADR 0060).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type Status = "waiting" | "working" | "done" | "error";

interface Item {
  id: number;
  file: File;
  status: Status;
  progress?: number | undefined;
  result?:
    | { blob: Blob; url: string; format: OutputFormat; width: number; height: number }
    | undefined;
  error?: string | undefined;
}

const ACCEPT = "image/heic,image/heif,.heic,.heif,.hif";

let nextId = 1;

export default function ToolUi() {
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<Array<Rejected & { key: number }>>([]);
  const [format, setFormat] = useState<OutputFormat>("jpg");
  const [quality, setQuality] = useState<Quality>("high");
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const job = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
    async (targetFormat: OutputFormat, targetQuality: Quality) => {
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
              { file: next.file, format: targetFormat, quality: targetQuality },
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
                format: targetFormat,
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
                : MESSAGES.unreadable;
            update(next.id, { status: "error", error: message });
          }
        }
      } finally {
        if (job.current === controller) job.current = null;
        setBusy(false);
        setAnnouncement(`${done} ${done === 1 ? "photo" : "photos"} converted.`);
      }
    },
    [update],
  );

  // Runs whenever there is work and nothing is running: new photos, or new settings.
  useEffect(() => {
    if (!busy && items.some((item) => item.status === "waiting")) void convert(format, quality);
  }, [busy, items, format, quality, convert]);

  const add = (files: File[]) => {
    const { accepted, rejected: refused } = checkFiles(files, itemsRef.current.length);
    setRejected(refused.map((entry) => ({ ...entry, key: nextId++ })));
    if (accepted.length === 0) return;
    setItems((list) => [
      ...list,
      ...accepted.map((file) => ({ id: nextId++, file, status: "waiting" as const })),
    ]);
  };

  /** New settings: every picture is made again with them. */
  const restart = (nextFormat: OutputFormat, nextQuality: Quality) => {
    job.current?.abort();
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
    if (item?.status === "working") job.current?.abort();
    if (item?.result) URL.revokeObjectURL(item.result.url);
    setItems((list) =>
      list
        .filter((entry) => entry.id !== id)
        .map((entry) => (entry.status === "working" ? { ...entry, status: "waiting" } : entry)),
    );
  };

  const clear = () => {
    job.current?.abort();
    for (const item of itemsRef.current) if (item.result) URL.revokeObjectURL(item.result.url);
    setItems([]);
    setRejected([]);
  };

  return (
    <>
      <Dropzone
        id="heic-to-jpg-files"
        accept={ACCEPT}
        title="Drop HEIC photos here"
        hint={`or click to choose. HEIC or HEIF, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} at a time`}
        onFiles={add}
      />

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="heic-to-jpg-format"
          label="Save as"
          value={format}
          onChange={(event) => restart(event.target.value as OutputFormat, quality)}
        >
          {(Object.keys(OUTPUT_FORMATS) as OutputFormat[]).map((key) => (
            <option key={key} value={key}>
              {OUTPUT_FORMATS[key].label}
            </option>
          ))}
        </Select>
        <Select
          id="heic-to-jpg-quality"
          label="JPG quality"
          hint={
            format === "png" ? "PNG keeps every pixel, so it has no quality setting." : undefined
          }
          disabled={format === "png"}
          value={quality}
          onChange={(event) => restart(format, event.target.value as Quality)}
        >
          {(Object.keys(QUALITIES) as Quality[]).map((key) => (
            <option key={key} value={key}>
              {QUALITIES[key].label}
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
        <section aria-labelledby="heic-to-jpg-results" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="heic-to-jpg-results" className="text-lg">
              Your photos
            </h3>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear all
            </Button>
          </div>
          <FileResultList label="Converted photos">
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
    ? `${result.width} × ${result.height} pixels, ${formatSize(file.size)} → ${formatSize(result.blob.size)}`
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
              variant="primary"
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

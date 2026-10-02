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
import { useRef, useState } from "react";
import {
  checkFiles,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  move,
  outputName,
  pagesLabel,
  type Rejected,
} from "./logic";

// The workspace of Merge PDF. The visitor builds the list and its order here; worker.ts, with
// pdf-lib, joins the files when Merge is pressed, so the PDF code loads only then (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Item {
  id: number;
  file: File;
}

interface Output {
  blob: Blob;
  name: string;
  pages: number;
}

let nextId = 1;

export default function ToolUi() {
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<Array<Rejected & { key: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const job = useRef<AbortController | null>(null);

  const changed = () => {
    setOutput(null);
    setError("");
  };

  const add = (files: File[]) => {
    const { accepted, rejected: refused } = checkFiles(files, items.length);
    setRejected(refused.map((entry) => ({ ...entry, key: nextId++ })));
    if (accepted.length === 0) return;
    changed();
    setItems((list) => [...list, ...accepted.map((file) => ({ id: nextId++, file }))]);
  };

  const reorder = (index: number, by: -1 | 1) => {
    changed();
    setItems((list) => move(list, index, by));
  };

  const remove = (id: number) => {
    changed();
    setItems((list) => list.filter((item) => item.id !== id));
  };

  const clear = () => {
    job.current?.abort();
    changed();
    setItems([]);
    setRejected([]);
  };

  const merge = async () => {
    if (items.length < 2) {
      setError(MESSAGES.needTwo);
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    changed();
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { files: items.map((item) => ({ name: item.file.name, data: item.file })) },
        {
          signal: controller.signal,
          onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)),
        },
      );
      setOutput({ blob: result.blob, name: outputName(items[0]?.file.name), pages: result.pages });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      if (job.current === controller) job.current = null;
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="merge-pdf-files"
        accept="application/pdf,.pdf"
        title="Drop PDF files here"
        hint={`or click to choose. Up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} at a time`}
        onFiles={add}
      />

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
        <section aria-labelledby="merge-pdf-list" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="merge-pdf-list" className="text-lg">
              Merge in this order
            </h3>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear all
            </Button>
          </div>
          <FileResultList label="PDFs to merge">
            {items.map((item, index) => (
              <FileResult
                key={item.id}
                name={`${index + 1}. ${item.file.name}`}
                meta={formatSize(item.file.size)}
                icon="pdf"
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={index === 0 || busy}
                      aria-label={`Move ${item.file.name} up`}
                      onClick={() => reorder(index, -1)}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={index === items.length - 1 || busy}
                      aria-label={`Move ${item.file.name} down`}
                      onClick={() => reorder(index, 1)}
                    >
                      Down
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Remove ${item.file.name}`}
                      onClick={() => remove(item.id)}
                    >
                      Remove
                    </Button>
                  </>
                }
              />
            ))}
          </FileResultList>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void merge()}>
              Merge {items.length} {items.length === 1 ? "PDF" : "PDFs"}
            </Button>
          </div>
        </section>
      )}

      {busy && <Progress value={progress} label="Merging the PDFs" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Merged PDF">
          <FileResult
            name={output.name}
            meta={`${pagesLabel(output.pages)}, ${formatSize(output.blob.size)}`}
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

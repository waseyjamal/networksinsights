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
import { useEffect, useRef, useState } from "react";
import {
  checkFiles,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MARGINS,
  type Margin,
  MESSAGES,
  move,
  ORIENTATIONS,
  type Orientation,
  outputName,
  PAGE_SIZES,
  type PageSize,
  type Rejected,
} from "./logic";

// The workspace of Image to PDF. The visitor builds the list of pictures and its order here, with
// a preview of each; worker.ts makes the PDF with pdf-lib when Make PDF is pressed (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Item {
  id: number;
  file: File;
  preview: string;
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
  const [size, setSize] = useState<PageSize>("a4");
  const [orientation, setOrientation] = useState<Orientation>("auto");
  const [margin, setMargin] = useState<Margin>("10");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.preview);
    },
    [],
  );

  const changed = () => {
    setOutput(null);
    setError("");
  };

  const add = (files: File[]) => {
    const { accepted, rejected: refused } = checkFiles(files, itemsRef.current.length);
    setRejected(refused.map((entry) => ({ ...entry, key: nextId++ })));
    if (accepted.length === 0) return;
    changed();
    setItems((list) => [
      ...list,
      ...accepted.map((file) => ({ id: nextId++, file, preview: URL.createObjectURL(file) })),
    ]);
  };

  const remove = (id: number) => {
    changed();
    setItems((list) =>
      list.filter((item) => {
        if (item.id === id) URL.revokeObjectURL(item.preview);
        return item.id !== id;
      }),
    );
  };

  const clear = () => {
    changed();
    for (const item of itemsRef.current) URL.revokeObjectURL(item.preview);
    setItems([]);
    setRejected([]);
  };

  const make = async () => {
    if (items.length === 0) {
      setError(MESSAGES.needOne);
      return;
    }
    changed();
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        {
          images: items.map((item) => ({ name: item.file.name, data: item.file })),
          size,
          orientation,
          margin,
        },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      setOutput({ blob: result.blob, name: outputName(items[0]?.file.name), pages: result.pages });
    } catch (caught) {
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="image-to-pdf-files"
        accept={ACCEPT}
        title="Drop pictures here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} in one PDF`}
        onFiles={add}
      />

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Select
          id="image-to-pdf-size"
          label="Page size"
          value={size}
          onChange={(event) => {
            setSize(event.target.value as PageSize);
            changed();
          }}
        >
          {(Object.keys(PAGE_SIZES) as PageSize[]).map((key) => (
            <option key={key} value={key}>
              {PAGE_SIZES[key].label}
            </option>
          ))}
        </Select>
        <Select
          id="image-to-pdf-orientation"
          label="Orientation"
          hint={size === "fit" ? "Each page takes the shape of its picture." : undefined}
          disabled={size === "fit"}
          value={orientation}
          onChange={(event) => {
            setOrientation(event.target.value as Orientation);
            changed();
          }}
        >
          {(Object.keys(ORIENTATIONS) as Orientation[]).map((key) => (
            <option key={key} value={key}>
              {ORIENTATIONS[key]}
            </option>
          ))}
        </Select>
        <Select
          id="image-to-pdf-margin"
          label="Margin"
          value={margin}
          onChange={(event) => {
            setMargin(event.target.value as Margin);
            changed();
          }}
        >
          {(Object.keys(MARGINS) as Margin[]).map((key) => (
            <option key={key} value={key}>
              {MARGINS[key]}
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
        <section aria-labelledby="image-to-pdf-list" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="image-to-pdf-list" className="text-lg">
              Pages in this order
            </h3>
            <Button size="sm" variant="ghost" onClick={clear}>
              Clear all
            </Button>
          </div>
          <FileResultList label="Pictures for the PDF">
            {items.map((item, index) => (
              <FileResult
                key={item.id}
                name={`${index + 1}. ${item.file.name}`}
                meta={formatSize(item.file.size)}
                previewSrc={item.preview}
                previewAlt={`Preview of ${item.file.name}`}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={index === 0 || busy}
                      aria-label={`Move ${item.file.name} up`}
                      onClick={() => {
                        changed();
                        setItems((list) => move(list, index, -1));
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={index === items.length - 1 || busy}
                      aria-label={`Move ${item.file.name} down`}
                      onClick={() => {
                        changed();
                        setItems((list) => move(list, index, 1));
                      }}
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
            <Button variant="primary" loading={busy} onClick={() => void make()}>
              Make PDF
            </Button>
          </div>
        </section>
      )}

      {busy && <Progress value={progress} label="Making the PDF" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Your PDF">
          <FileResult
            name={output.name}
            meta={`${output.pages} ${output.pages === 1 ? "page" : "pages"}, ${formatSize(output.blob.size)}`}
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

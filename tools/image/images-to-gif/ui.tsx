import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  checkSettings,
  DEFAULTS,
  formatSize,
  gifSize,
  type Job,
  type JobResult,
  LIMITS,
  LOOPS,
  type Loop,
  MESSAGES,
  move,
  outputName,
  playSeconds,
  RANGES,
  room,
} from "./logic";

// The workspace of Images to GIF: the pictures in a list that can be put in order, the delay, the
// width and the loop, then the GIF to preview and download. worker.ts draws the frames and gifenc
// writes the GIF there, so it loads only when the visitor presses Make GIF.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Item {
  id: number;
  file: File;
  url: string;
}

interface Output {
  blob: Blob;
  url: string;
  name: string;
  frames: number;
  width: number;
  height: number;
  seconds: number;
}

/** The first picture's size, upright as the browser shows it, or null if it cannot be read. */
async function sizeOf(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export default function ToolUi() {
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [width, setWidth] = useState(String(DEFAULTS.width));
  const [delay, setDelay] = useState(String(DEFAULTS.delay));
  const [loop, setLoop] = useState<Loop>("forever");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const nextId = useRef(1);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const outputRef = useRef(output);
  outputRef.current = output;

  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.url);
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    },
    [],
  );

  const dropOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    setOutput(null);
  };

  const add = (files: File[]) => {
    dropOutput();
    setError("");
    const refused: string[] = [];
    const accepted: Item[] = [];
    let space = room(itemsRef.current.length);
    for (const file of files) {
      const problem = checkFile(file);
      if (problem) refused.push(`${file.name}: ${problem}`);
      else if (space <= 0) refused.push(`${file.name}: ${MESSAGES.tooMany}`);
      else {
        space--;
        accepted.push({ id: nextId.current++, file, url: URL.createObjectURL(file) });
      }
    }
    setRejected(refused);
    setItems((list) => [...list, ...accepted]);
  };

  const reorder = (index: number, by: -1 | 1) => {
    dropOutput();
    setItems((list) => move(list, index, by));
  };

  const remove = (id: number) => {
    dropOutput();
    setItems((list) => {
      const gone = list.find((item) => item.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return list.filter((item) => item.id !== id);
    });
  };

  const clear = () => {
    dropOutput();
    for (const item of items) URL.revokeObjectURL(item.url);
    setItems([]);
    setRejected([]);
  };

  const problems = checkSettings(items.length, number(width), number(delay));

  const make = async () => {
    dropOutput();
    const problem = problems.count ?? problems.width ?? problems.delay;
    if (problem) {
      setError(problem);
      return;
    }
    const first = items[0];
    const size = first ? await sizeOf(first.file) : null;
    if (!first || !size) {
      setError(MESSAGES.unreadable(first?.file.name ?? "Picture 1"));
      return;
    }
    const frame = gifSize(number(width), size.width, size.height);
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        {
          images: items.map((item) => item.file),
          width: frame.width,
          height: frame.height,
          delay: number(delay),
          loop,
        },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      setOutput({
        blob: result.blob,
        url: URL.createObjectURL(result.blob),
        name: outputName(first.file.name),
        frames: result.frames,
        width: frame.width,
        height: frame.height,
        seconds: playSeconds(result.frames, number(delay)),
      });
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
        id="images-to-gif-files"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        title="Drop pictures here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} in all`}
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
            {rejected.slice(0, 5).map((line) => (
              <li key={line}>{line}</li>
            ))}
            {rejected.length > 5 && <li>and {rejected.length - 5} more</li>}
          </ul>
        </Alert>
      )}

      {items.length > 0 && (
        <section aria-labelledby="images-to-gif-list" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="images-to-gif-list" className="text-lg">
              Frames in this order
            </h3>
            <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
              Clear all
            </Button>
          </div>
          <FileResultList label="Pictures for the GIF">
            {items.map((item, index) => (
              <FileResult
                key={item.id}
                name={`${index + 1}. ${item.file.name}`}
                meta={formatSize(item.file.size)}
                previewSrc={item.url}
                previewAlt={`Frame ${index + 1}`}
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
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Input
              id="images-to-gif-delay"
              label="Frame delay (milliseconds)"
              hint="1000 is one second; GIF keeps hundredths"
              type="number"
              min={RANGES.delay.min}
              max={RANGES.delay.max}
              step={10}
              value={delay}
              error={problems.delay}
              onChange={(event) => {
                dropOutput();
                setDelay(event.target.value);
              }}
            />
            <Input
              id="images-to-gif-width"
              label="Width (pixels)"
              hint="The height follows the first picture, at most 800"
              type="number"
              min={RANGES.width.min}
              max={RANGES.width.max}
              value={width}
              error={problems.width}
              onChange={(event) => {
                dropOutput();
                setWidth(event.target.value);
              }}
            />
            <Select
              id="images-to-gif-loop"
              label="Loop"
              value={loop}
              onChange={(event) => {
                dropOutput();
                setLoop(event.target.value as Loop);
              }}
            >
              {(Object.keys(LOOPS) as Loop[]).map((key) => (
                <option key={key} value={key}>
                  {LOOPS[key]}
                </option>
              ))}
            </Select>
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void make()}>
              Make GIF
            </Button>
          </div>
        </section>
      )}

      {busy && <Progress value={progress} label="Making the GIF" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Your GIF">
          <FileResult
            name={output.name}
            meta={`${output.frames} frames, ${output.width} × ${output.height} pixels, ${output.seconds} seconds a loop, ${formatSize(output.blob.size)}`}
            state="done"
            previewSrc={output.url}
            previewAlt="The animated GIF"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "image/gif" })}
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

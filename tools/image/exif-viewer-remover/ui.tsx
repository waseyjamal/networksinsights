import {
  Alert,
  Button,
  createWorkerClient,
  DataTable,
  Dropzone,
  FileResult,
  FileResultList,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  ORIENTATIONS,
  outputName,
} from "./logic";

// The workspace of EXIF Viewer & Remover. worker.ts reads the photo and, for a JPEG, writes the
// copy without metadata. A PNG or WebP is redrawn here, through a canvas, because some browsers
// have no canvas inside a worker.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

type State =
  | { status: "idle" }
  | { status: "working"; file: File }
  | { status: "done"; file: File; result: JobResult; cleaned: Blob }
  | { status: "error"; file: File; message: string };

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** Draws the picture on a canvas and saves the canvas as a PNG: only the pixels remain. */
async function redraw(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/png"),
    );
  } finally {
    bitmap.close();
  }
}

export default function ToolUi() {
  const [state, setState] = useState<State>({ status: "idle" });
  const job = useRef<AbortController | null>(null);

  useEffect(() => () => job.current?.abort(), []);

  const start = async (file: File) => {
    job.current?.abort();
    const refused = checkFile(file);
    if (refused) {
      setState({ status: "error", file, message: refused });
      return;
    }
    const controller = new AbortController();
    job.current = controller;
    setState({ status: "working", file });
    try {
      const result = await client.run({ file }, { signal: controller.signal });
      const cleaned = result.cleaned ?? (await redraw(file));
      if (controller.signal.aborted) return;
      setState({ status: "done", file, result, cleaned });
    } catch (caught) {
      if (controller.signal.aborted) return;
      const message =
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.unreadable;
      setState({ status: "error", file, message });
    } finally {
      if (job.current === controller) job.current = null;
    }
  };

  const done = state.status === "done" ? state : null;
  const jpeg = done?.result.format === "jpeg";
  const orientation = done?.result.orientation ?? null;

  return (
    <>
      <Dropzone
        id="exif-viewer-remover-file"
        accept={ACCEPT}
        multiple={false}
        disabled={state.status === "working"}
        title="Drop a photo here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => {
          const [file] = files;
          if (file) void start(file);
        }}
      />

      {state.status === "error" && (
        <Alert tone="warning" title="The photo was not read">
          <span id="exif-viewer-remover-error">{state.message}</span>
        </Alert>
      )}

      {done?.result.location && (
        <Alert tone="danger" title="This photo reveals a location">
          <span id="exif-viewer-remover-gps">
            Its GPS tags give the place where it was taken. Anyone you send the original file to can
            read them. The copy below has no location.
          </span>
        </Alert>
      )}

      {done &&
        !jpeg &&
        (done.result.blocks.includes("EXIF") || done.result.blocks.includes("XMP")) && (
          <Alert tone="warning" title="This file may reveal a location">
            <span id="exif-viewer-remover-blocks-warning">
              It holds an EXIF or XMP block, which can include GPS tags. This page reads tags from
              JPG files only, so it cannot show them here. The copy below has none of those blocks.
            </span>
          </Alert>
        )}

      {done && (
        <section aria-labelledby="exif-viewer-remover-found" className="grid gap-3">
          <h3 id="exif-viewer-remover-found" className="text-lg">
            What the photo holds
          </h3>
          {done.result.rows.length > 0 ? (
            <DataTable
              id="exif-viewer-remover-tags"
              label="Metadata of the photo"
              columns={["Tag", "Value"]}
              rows={done.result.rows.map((row) => [row.label, row.value])}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              {jpeg
                ? "No camera, date, software, orientation or GPS tags were found."
                : "Tags are shown for JPG files only. For a PNG or WebP the blocks below are listed by name."}
            </p>
          )}
          <p id="exif-viewer-remover-blocks" className="text-sm">
            Metadata blocks found:{" "}
            {done.result.blocks.length > 0 ? done.result.blocks.join(", ") : "none"}.
          </p>
        </section>
      )}

      {(state.status === "working" || done) && (
        <FileResultList label="Photo without metadata">
          <FileResult
            name={state.status === "working" ? state.file.name : (done?.file.name ?? "")}
            state={done ? "done" : "working"}
            meta={done ? `${formatSize(done.file.size)} → ${formatSize(done.cleaned.size)}` : ""}
            actions={
              done ? (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    saveFile(done.cleaned, outputName(done.file.name, done.result.format), {
                      type: done.cleaned.type,
                    })
                  }
                >
                  {jpeg ? "Download JPG" : "Download PNG"}
                </Button>
              ) : undefined
            }
          >
            {done && (
              <span id="exif-viewer-remover-method" className="text-sm text-fg-muted">
                {jpeg
                  ? "The metadata blocks were cut out of the file. The picture data was not re-encoded, so the pixels are the same."
                  : "The picture was redrawn through the browser canvas and saved as a new PNG. All metadata is gone and the file was re-encoded. Some browsers add their own colour profile."}
              </span>
            )}
          </FileResult>
        </FileResultList>
      )}

      {jpeg && orientation !== null && orientation !== 1 && (
        <Alert tone="info" title="Orientation kept">
          <span id="exif-viewer-remover-orientation">
            The photo is stored sideways or mirrored and its tag says to show it{" "}
            {(ORIENTATIONS[orientation] ?? "").toLowerCase()}. That one tag is kept, alone, so the
            copy shows the right way up.
          </span>
        </Alert>
      )}

      <p className="sr-only" aria-live="polite">
        {done ? `Read. ${done.result.rows.length} tags found.` : ""}
      </p>
    </>
  );
}

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
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MAX_PAGES_PER_RUN,
  MAX_SIDE,
  MESSAGES,
  pagesForRun,
  pictureName,
  QUALITIES,
  type Quality,
  RESOLUTIONS,
  type Resolution,
  type Which,
} from "./logic";

// The workspace of PDF to JPG. Choosing a PDF starts worker.ts, which counts its pages with PDF.js;
// Convert draws the chosen pages there and sends back one JPG each. PDF.js loads only with the
// worker, after the visitor chooses a PDF (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

interface Source {
  file: File;
  pages: number;
}

interface Shown {
  page: number;
  blob: Blob;
  url: string;
  name: string;
  width: number;
  height: number;
}

const failure = (caught: unknown, fallback: string) =>
  caught instanceof WorkerJobError && caught.expected ? caught.message : fallback;

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [opening, setOpening] = useState(false);
  const [which, setWhich] = useState<Which>("all");
  const [chosen, setChosen] = useState("");
  const [resolution, setResolution] = useState<Resolution>("150");
  const [quality, setQuality] = useState<Quality>("high");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pictures, setPictures] = useState<Shown[]>([]);
  const [error, setError] = useState("");
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;

  const dropPictures = () => {
    for (const picture of picturesRef.current) URL.revokeObjectURL(picture.url);
    setPictures([]);
  };

  useEffect(
    () => () => {
      for (const picture of picturesRef.current) URL.revokeObjectURL(picture.url);
    },
    [],
  );

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    dropPictures();
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    setFileError("");
    setOpening(true);
    try {
      const result = await client.run({ kind: "count", file });
      if (result.kind === "count") setSource({ file, pages: result.pages });
    } catch (caught) {
      setSource(null);
      setFileError(`${file.name}: ${failure(caught, MESSAGES.unreadable)}`);
    } finally {
      setOpening(false);
    }
  };

  const convert = async () => {
    if (!source) return;
    dropPictures();
    const run = pagesForRun(which, chosen, source.pages);
    if (!run.ok) {
      setError(run.error);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const result = await client.run(
        { kind: "render", file: source.file, pages: run.pages, resolution, quality },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      if (result.kind === "render") {
        setPictures(
          result.pictures.map((picture) => ({
            ...picture,
            url: URL.createObjectURL(picture.blob),
            name: pictureName(source.file.name, picture.page),
          })),
        );
      }
    } catch (caught) {
      setError(failure(caught, MESSAGES.failed));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="pdf-to-jpg-file"
        accept="application/pdf,.pdf"
        multiple={false}
        title="Drop a PDF here"
        hint={`or click to choose. One PDF, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {opening && <p className="text-sm text-fg-muted">Opening the PDF…</p>}
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="pdf-to-jpg-original">
            {source.file.name}: {source.pages} {source.pages === 1 ? "page" : "pages"},{" "}
            {formatSize(source.file.size)}
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Select
              id="pdf-to-jpg-which"
              label="Pages"
              hint={`Up to ${MAX_PAGES_PER_RUN} at a time`}
              value={which}
              onChange={(event) => {
                setWhich(event.target.value as Which);
                setError("");
              }}
            >
              <option value="all">All pages</option>
              <option value="chosen">Only the pages I choose</option>
            </Select>
            <Select
              id="pdf-to-jpg-resolution"
              label="Resolution"
              hint={`At most ${MAX_SIDE.toLocaleString("en-US")} pixels on the longer side`}
              value={resolution}
              onChange={(event) => setResolution(event.target.value as Resolution)}
            >
              {(Object.keys(RESOLUTIONS) as Resolution[]).map((key) => (
                <option key={key} value={key}>
                  {RESOLUTIONS[key]}
                </option>
              ))}
            </Select>
            <Select
              id="pdf-to-jpg-quality"
              label="JPG quality"
              value={quality}
              onChange={(event) => setQuality(event.target.value as Quality)}
            >
              {(Object.keys(QUALITIES) as Quality[]).map((key) => (
                <option key={key} value={key}>
                  {QUALITIES[key].label}
                </option>
              ))}
            </Select>
          </div>
          {which === "chosen" && (
            <Input
              id="pdf-to-jpg-pages"
              label="Pages to convert"
              hint="For example 1, 3-4, or 7- for page 7 to the end"
              value={chosen}
              onChange={(event) => setChosen(event.target.value)}
            />
          )}
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void convert()}>
              Convert
            </Button>
          </div>
        </>
      )}

      {busy && <Progress value={progress} label="Drawing the pages" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {pictures.length > 0 && (
        <FileResultList label="Page pictures">
          {pictures.map((picture) => (
            <FileResult
              key={picture.page}
              name={picture.name}
              meta={`${picture.width} × ${picture.height} pixels, ${formatSize(picture.blob.size)}`}
              state="done"
              previewSrc={picture.url}
              previewAlt={`Page ${picture.page} as a picture`}
              actions={
                <Button
                  size="sm"
                  aria-label={`Download ${picture.name}`}
                  onClick={() => saveFile(picture.blob, picture.name, { type: "image/jpeg" })}
                >
                  Download
                </Button>
              }
            />
          ))}
        </FileResultList>
      )}
    </>
  );
}

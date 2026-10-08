import {
  Alert,
  Button,
  createWorkerClient,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  PageCanvas,
  type PageCanvasItem,
  Progress,
  Select,
  saveFile,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  boxFrom,
  checkFile,
  checkRegion,
  checkRegions,
  formatDimensions,
  formatSize,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  MODES,
  type Mode,
  moveRegion,
  OUTPUT_TYPES,
  type OutputType,
  outputName,
  previewSize,
  QUALITY,
  RANGES,
  type Region,
  withinPixelLimit,
  workSize,
} from "./logic";

// The workspace of Blur & Censor Image. The page decodes the picture upright with
// createImageBitmap, scales it down if it is over 16 megapixels, and shows a preview; the visitor
// draws regions on it with PageCanvas, or adds them with a button and types their place. On
// Censor, the page sends the pixels to worker.ts, which hides each region, and a canvas on this
// page encodes the result as PNG or JPG. No library and no upload.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Source {
  file: File;
  /** The picture upright, at the size it is worked on. */
  canvas: HTMLCanvasElement;
  previewUrl: string;
  /** Its own size, when it was scaled down. */
  scaledFrom: { width: number; height: number } | null;
}

interface Output {
  blob: Blob;
  url: string;
  name: string;
  type: OutputType;
  width: number;
  height: number;
}

const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
const percent = (value: number) =>
  Number.isFinite(value) ? String(Math.round(value * 10000) / 100) : "";

function toBlob(canvas: HTMLCanvasElement, type: OutputType): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

function fresh(id: string, place: { x: number; y: number; width: number; height: number }) {
  const region: Region = {
    id,
    ...place,
    mode: "fill",
    color: "#000000",
    block: 16,
    radius: 20,
  };
  return region;
}

function Overlay({ region }: { region: Region }) {
  if (region.mode === "fill") {
    return <span className="block h-full w-full" style={{ background: region.color }} />;
  }
  return (
    <span className="flex h-full w-full items-center justify-center border-2 border-dashed border-fg bg-bg/60 text-xs font-semibold text-fg">
      {MODES[region.mode]}
    </span>
  );
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"draw" | "select">("draw");
  const [format, setFormat] = useState<OutputType>("image/png");
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const nextId = useRef(1);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const outputRef = useRef(output);
  outputRef.current = output;

  useEffect(
    () => () => {
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.previewUrl);
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    },
    [],
  );

  const dropOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    setOutput(null);
  };

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    dropOutput();
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    let bitmap: ImageBitmap;
    try {
      // "from-image" turns a photo upright by its EXIF orientation, as a viewer shows it.
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      setFileError(`${file.name}: ${MESSAGES.unreadable}`);
      return;
    }
    try {
      if (!withinPixelLimit(bitmap.width, bitmap.height)) {
        setFileError(`${file.name}: ${MESSAGES.tooManyPixels}`);
        return;
      }
      const size = workSize(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no context");
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const shown = previewSize(size.width, size.height);
      const preview = document.createElement("canvas");
      preview.width = shown.width;
      preview.height = shown.height;
      preview.getContext("2d")?.drawImage(canvas, 0, 0, shown.width, shown.height);
      const previewBlob = await toBlob(preview, "image/png");
      if (!previewBlob) throw new Error("no preview");
      if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.previewUrl);
      const scaled = size.width !== bitmap.width || size.height !== bitmap.height;
      setFileError("");
      setRegions([]);
      setSelected(null);
      setMode("draw");
      setSource({
        file,
        canvas,
        previewUrl: URL.createObjectURL(previewBlob),
        scaledFrom: scaled ? { width: bitmap.width, height: bitmap.height } : null,
      });
    } catch {
      setFileError(`${file.name}: ${MESSAGES.failed}`);
    } finally {
      bitmap.close();
    }
  };

  const change = (next: Region[]) => {
    dropOutput();
    setError("");
    setRegions(next);
  };
  const update = (id: string, patch: Partial<Region>) =>
    change(regions.map((region) => (region.id === id ? { ...region, ...patch } : region)));
  const remove = (id: string) => {
    change(regions.filter((region) => region.id !== id));
    setSelected(null);
  };

  const add = () => {
    const id = `region-${nextId.current++}`;
    change([...regions, fresh(id, { x: 0.35, y: 0.35, width: 0.3, height: 0.3 })]);
    setSelected(id);
    setMode("select");
  };

  const apply = async () => {
    if (!source) return;
    dropOutput();
    const problem = checkRegions(regions);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const { width, height } = source.canvas;
      const context = source.canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no context");
      const pixels = context.getImageData(0, 0, width, height).data;
      const result = await client.run(
        { width, height, pixels, regions },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const target = canvas.getContext("2d");
      if (!target) throw new Error("no context");
      const image = new ImageData(width, height);
      image.data.set(result.pixels);
      if (format === "image/jpeg") {
        // JPG has no transparency: transparent pixels go on white.
        const layer = document.createElement("canvas");
        layer.width = width;
        layer.height = height;
        layer.getContext("2d")?.putImageData(image, 0, 0);
        target.fillStyle = "#ffffff";
        target.fillRect(0, 0, width, height);
        target.drawImage(layer, 0, 0);
      } else {
        target.putImageData(image, 0, 0);
      }
      const blob = await toBlob(canvas, format);
      if (!blob) throw new Error("no blob");
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        name: outputName(source.file.name, format),
        type: format,
        width,
        height,
      });
    } catch (caught) {
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const items: PageCanvasItem[] = regions.map((region, index) => ({
    id: region.id,
    label: `Region ${index + 1}: ${MODES[region.mode]}`,
    x: Number.isFinite(region.x) ? region.x : 0,
    y: Number.isFinite(region.y) ? region.y : 0,
    width: Number.isFinite(region.width) ? region.width : 0,
    height: Number.isFinite(region.height) ? region.height : 0,
    content: <Overlay region={region} />,
  }));
  const currentIndex = regions.findIndex((region) => region.id === selected);
  const current = regions[currentIndex];
  const currentProblem = current ? checkRegion(current) : null;

  const place = (key: "x" | "y" | "width" | "height", label: string) =>
    current && (
      <Input
        id={`blur-censor-image-${key}`}
        label={label}
        type="number"
        min={0}
        max={100}
        step={0.1}
        value={percent(current[key])}
        onChange={(event) => update(current.id, { [key]: number(event.target.value) / 100 })}
      />
    );

  return (
    <>
      <Dropzone
        id="blur-censor-image-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop a picture here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      {source && (
        <>
          <p className="text-sm text-fg-muted" id="blur-censor-image-original">
            {source.file.name}: {formatDimensions(source.canvas.width, source.canvas.height)}{" "}
            pixels, {formatSize(source.file.size)}
          </p>
          {source.scaledFrom && (
            <Alert tone="info" title="Scaled down">
              {MESSAGES.scaled(
                formatDimensions(source.scaledFrom.width, source.scaledFrom.height),
                formatDimensions(source.canvas.width, source.canvas.height),
              )}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Regions">
            <Button
              size="sm"
              variant={mode === "draw" ? "primary" : "secondary"}
              aria-pressed={mode === "draw"}
              onClick={() => setMode("draw")}
            >
              Draw regions
            </Button>
            <Button
              size="sm"
              variant={mode === "select" ? "primary" : "secondary"}
              aria-pressed={mode === "select"}
              onClick={() => setMode("select")}
            >
              Move regions
            </Button>
            <Button size="sm" variant="secondary" onClick={add}>
              Add a region
            </Button>
          </div>
          <PageCanvas
            id="blur-censor-image-canvas"
            label="Your picture"
            hint="In Draw regions, drag from one corner to the other. In Move regions, drag a region or use the arrow keys; Delete removes it."
            src={source.previewUrl}
            aspectRatio={source.canvas.width / source.canvas.height}
            items={items}
            selectedId={selected}
            mode={mode}
            onSelect={setSelected}
            onMove={(id, x, y) =>
              change(
                regions.map((region) => (region.id === id ? moveRegion(region, x, y) : region)),
              )
            }
            onDelete={remove}
            onStroke={(points) => {
              const box = boxFrom(points);
              if (!box) return;
              const id = `region-${nextId.current++}`;
              change([...regions, fresh(id, box)]);
              setSelected(id);
            }}
          />
          <p className="text-sm text-fg-muted" id="blur-censor-image-summary">
            {regions.length === 0
              ? "No regions yet."
              : `${regions.length} ${regions.length === 1 ? "region" : "regions"}. Where regions overlap, the later one is drawn on top.`}
          </p>

          {current && (
            <section aria-label={`Region ${currentIndex + 1}`} className="grid gap-4">
              <p className="text-sm font-semibold">Region {currentIndex + 1}</p>
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Select
                  id="blur-censor-image-mode"
                  label="Hide with"
                  value={current.mode}
                  onChange={(event) => update(current.id, { mode: event.target.value as Mode })}
                >
                  {(Object.keys(MODES) as Mode[]).map((key) => (
                    <option key={key} value={key}>
                      {MODES[key]}
                    </option>
                  ))}
                </Select>
                {current.mode === "fill" && (
                  <Input
                    id="blur-censor-image-color"
                    label="Fill colour"
                    type="color"
                    className="h-11 w-full cursor-pointer"
                    value={current.color}
                    error={currentProblem ?? undefined}
                    onChange={(event) => update(current.id, { color: event.target.value })}
                  />
                )}
                {current.mode === "pixelate" && (
                  <Input
                    id="blur-censor-image-block"
                    label="Block size (pixels)"
                    type="number"
                    inputMode="numeric"
                    min={RANGES.block.min}
                    max={RANGES.block.max}
                    value={Number.isFinite(current.block) ? String(current.block) : ""}
                    error={currentProblem ?? undefined}
                    onChange={(event) => update(current.id, { block: number(event.target.value) })}
                  />
                )}
                {current.mode === "blur" && (
                  <Input
                    id="blur-censor-image-radius"
                    label="Blur radius (pixels)"
                    type="number"
                    inputMode="numeric"
                    min={RANGES.radius.min}
                    max={RANGES.radius.max}
                    value={Number.isFinite(current.radius) ? String(current.radius) : ""}
                    error={currentProblem ?? undefined}
                    onChange={(event) => update(current.id, { radius: number(event.target.value) })}
                  />
                )}
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-4">
                {place("x", "Left (%)")}
                {place("y", "Top (%)")}
                {place("width", "Width (%)")}
                {place("height", "Height (%)")}
              </div>
              <div>
                <Button size="sm" variant="ghost" onClick={() => remove(current.id)}>
                  Remove this region
                </Button>
              </div>
            </section>
          )}

          <Select
            id="blur-censor-image-format"
            label="Save as"
            value={format}
            onChange={(event) => {
              dropOutput();
              setFormat(event.target.value as OutputType);
            }}
          >
            {(Object.keys(OUTPUT_TYPES) as OutputType[]).map((key) => (
              <option key={key} value={key}>
                {OUTPUT_TYPES[key].label}
              </option>
            ))}
          </Select>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void apply()}>
              Censor picture
            </Button>
          </div>
        </>
      )}

      {busy && <Progress value={progress} label="Hiding the regions" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Censored picture">
          <FileResult
            name={output.name}
            meta={`${formatDimensions(output.width, output.height)} pixels, ${formatSize(output.blob.size)}`}
            state="done"
            previewSrc={output.url}
            previewAlt={`Preview of ${output.name}`}
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: output.type })}
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

import { Alert, Button, Dropzone, FileResult, FileResultList, Input, Select, saveFile } from "@ui";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import {
  CHECKED,
  checkFile,
  clampFrame,
  DPI,
  type Frame,
  formatMm,
  formatSize,
  initialFrame,
  LIMITS,
  MESSAGES,
  outputName,
  PAPERS,
  type Paper,
  type PhotoSize,
  PRESETS,
  photoSize,
  type SizeChoice,
  scaleFrame,
  sheetLayout,
  type Unit,
  withinPixelLimit,
  withJpegDpi,
} from "./logic";

// The workspace of Passport Photo Maker. One picture at a time: the visitor picks a size and a DPI,
// moves and resizes the crop frame (by dragging, with the buttons or with the keyboard), then makes
// the photo and, if they like, a print sheet. A canvas on this page does all of it: no library and
// no upload.

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Source {
  file: File;
  bitmap: ImageBitmap;
  url: string;
}

interface Output {
  blob: Blob;
  url: string;
  name: string;
  meta: string;
}

async function toJpeg(canvas: HTMLCanvasElement, dpi: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("no blob");
  const bytes = withJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
}

function drawPhoto(source: Source, frame: Frame, size: PhotoSize): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no context");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    source.bitmap,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    0,
    0,
    size.width,
    size.height,
  );
  return canvas;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [choice, setChoice] = useState<SizeChoice>("uk");
  const [unit, setUnit] = useState<Unit>("mm");
  const [width, setWidth] = useState("35");
  const [height, setHeight] = useState("45");
  const [dpi, setDpi] = useState(String(DPI.initial));
  const [paper, setPaper] = useState<Paper>("4x6");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [photo, setPhoto] = useState<Output | null>(null);
  const [sheet, setSheet] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; frame: Frame } | null>(null);
  const kept = useRef({ source, photo, sheet });
  kept.current = { source, photo, sheet };

  useEffect(
    () => () => {
      const { source: s, photo: p, sheet: h } = kept.current;
      if (s) URL.revokeObjectURL(s.url);
      if (p) URL.revokeObjectURL(p.url);
      if (h) URL.revokeObjectURL(h.url);
    },
    [],
  );

  const form = { size: choice, width, height, unit, dpi };
  const sized = photoSize(form);
  // The frame's shape: from the photo size when it is valid, else the last good one.
  const aspect = sized.ok ? sized.size.widthMm / sized.size.heightMm : null;
  const image = source ? { width: source.bitmap.width, height: source.bitmap.height } : null;

  const dropOutputs = () => {
    if (kept.current.photo) URL.revokeObjectURL(kept.current.photo.url);
    if (kept.current.sheet) URL.revokeObjectURL(kept.current.sheet.url);
    setPhoto(null);
    setSheet(null);
  };

  // A new shape starts with the largest centred frame of that shape.
  useEffect(() => {
    if (source && aspect) {
      setFrame(initialFrame({ width: source.bitmap.width, height: source.bitmap.height }, aspect));
    }
  }, [aspect, source]);

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    dropOutputs();
    setError("");
    const problem = checkFile(file);
    if (problem) {
      setFileError(`${file.name}: ${problem}`);
      return;
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      setFileError(`${file.name}: ${MESSAGES.unreadable}`);
      return;
    }
    if (!withinPixelLimit(bitmap.width, bitmap.height)) {
      bitmap.close();
      setFileError(`${file.name}: ${MESSAGES.tooManyPixels}`);
      return;
    }
    if (source) {
      source.bitmap.close();
      URL.revokeObjectURL(source.url);
    }
    setFileError("");
    setSource({ file, bitmap, url: URL.createObjectURL(file) });
  };

  const update = (next: Frame | null) => {
    if (!next) return;
    setFrame(next);
    dropOutputs();
  };

  /** Source pixels per CSS pixel of the preview. */
  const scale = () => (image && area.current ? image.width / area.current.clientWidth : 1);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!frame) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, frame };
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || !image || !aspect) return;
    const factor = scale();
    update(
      clampFrame(
        {
          x: start.frame.x + (event.clientX - start.x) * factor,
          y: start.frame.y + (event.clientY - start.y) * factor,
          width: start.frame.width,
        },
        image,
        aspect,
      ),
    );
  };

  const resize = (factor: number) => {
    if (frame && image && aspect) update(scaleFrame(frame, factor, image, aspect));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!frame || !image || !aspect) return;
    const step = image.width * (event.shiftKey ? 0.05 : 0.01);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      update(
        clampFrame(
          { x: frame.x + move[0], y: frame.y + move[1], width: frame.width },
          image,
          aspect,
        ),
      );
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      resize(1.05);
    } else if (event.key === "-") {
      event.preventDefault();
      resize(1 / 1.05);
    }
  };

  const make = async (kind: "photo" | "sheet") => {
    if (!source || !frame) return;
    if (!sized.ok) {
      setError(sized.error);
      return;
    }
    const size = sized.size;
    let layout: ReturnType<typeof sheetLayout> | null = null;
    if (kind === "sheet") {
      layout = sheetLayout(paper, size);
      if (!layout.ok) {
        setError(layout.error);
        return;
      }
    }
    setError("");
    setBusy(true);
    try {
      const canvas = drawPhoto(source, frame, size);
      if (kind === "photo") {
        const blob = await toJpeg(canvas, size.dpi);
        if (photo) URL.revokeObjectURL(photo.url);
        setPhoto({
          blob,
          url: URL.createObjectURL(blob),
          name: outputName(source.file.name, "photo", `${size.width}x${size.height}`),
          meta: `${size.width} × ${size.height} pixels, ${formatMm(size.widthMm)} × ${formatMm(size.heightMm)} at ${size.dpi} DPI, ${formatSize(blob.size)}`,
        });
      } else if (layout?.ok) {
        const { sheet: plan } = layout;
        const page = document.createElement("canvas");
        page.width = plan.width;
        page.height = plan.height;
        const context = page.getContext("2d");
        if (!context) throw new Error("no context");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, plan.width, plan.height);
        // A thin light grey outline around each copy shows where to cut.
        context.strokeStyle = "#c8c8c8";
        context.lineWidth = 1;
        for (const [x, y] of plan.positions) {
          context.drawImage(canvas, x, y);
          context.strokeRect(x - 0.5, y - 0.5, size.width + 1, size.height + 1);
        }
        const blob = await toJpeg(page, size.dpi);
        if (sheet) URL.revokeObjectURL(sheet.url);
        const count = plan.positions.length;
        setSheet({
          blob,
          url: URL.createObjectURL(blob),
          name: outputName(source.file.name, "sheet", paper),
          meta: `${count} ${count === 1 ? "copy" : "copies"} (${plan.columns} × ${plan.rows}), ${plan.landscape ? "landscape" : "portrait"}, ${plan.width} × ${plan.height} pixels at ${size.dpi} DPI, ${formatSize(blob.size)}`,
        });
      }
    } catch {
      setError(MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  const preset = choice === "custom" ? null : PRESETS[choice];

  return (
    <>
      <Dropzone
        id="passport-photo-maker-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop a photo here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {fileError && (
        <Alert tone="warning" title="This file was not opened">
          {fileError}
        </Alert>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="passport-photo-maker-size"
          label="Photo size"
          value={choice}
          onChange={(event) => {
            setChoice(event.target.value as SizeChoice);
            setError("");
            dropOutputs();
          }}
        >
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => (
            <option key={key} value={key}>
              {PRESETS[key].label}
            </option>
          ))}
          <option value="custom">Type my own size</option>
        </Select>
        <Input
          id="passport-photo-maker-dpi"
          label="DPI (dots per inch)"
          hint={`${DPI.min} to ${DPI.max}; 300 is usual for photo printing`}
          inputMode="numeric"
          value={dpi}
          onChange={(event) => {
            setDpi(event.target.value);
            setError("");
            dropOutputs();
          }}
        />
      </div>
      {preset && (
        <p className="text-sm text-fg-muted" id="passport-photo-maker-source">
          Size checked on {CHECKED} at{" "}
          <a href={preset.source} rel="noopener noreferrer" target="_blank">
            {preset.sourceName}
          </a>
          . Rules change and include much more than size: read the official page yourself.
        </p>
      )}
      {choice === "custom" && (
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Input
            id="passport-photo-maker-width"
            label="Width"
            inputMode="decimal"
            value={width}
            onChange={(event) => {
              setWidth(event.target.value);
              setError("");
            }}
          />
          <Input
            id="passport-photo-maker-height"
            label="Height"
            inputMode="decimal"
            value={height}
            onChange={(event) => {
              setHeight(event.target.value);
              setError("");
            }}
          />
          <Select
            id="passport-photo-maker-unit"
            label="Unit"
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value as Unit);
              setError("");
            }}
          >
            <option value="mm">Millimetres</option>
            <option value="in">Inches</option>
          </Select>
        </div>
      )}
      {sized.ok ? (
        <p className="text-sm text-fg-muted" id="passport-photo-maker-pixels">
          The photo will be {sized.size.width} × {sized.size.height} pixels.
        </p>
      ) : (
        <p className="text-sm text-danger-text" id="passport-photo-maker-pixels">
          {sized.error}
        </p>
      )}

      {source && image && frame && (
        <>
          <p className="text-sm text-fg-muted" id="passport-photo-maker-original">
            {source.file.name}: {image.width} × {image.height} pixels,{" "}
            {formatSize(source.file.size)}
          </p>
          <div
            ref={area}
            className="relative overflow-hidden rounded-md border border-border"
            style={{ maxWidth: "32rem", touchAction: "none" }}
          >
            <img
              src={source.url}
              alt={`Your upload, ${source.file.name}`}
              className="block w-full"
              draggable={false}
            />
            <button
              type="button"
              id="passport-photo-maker-frame"
              aria-label="Crop frame. Drag it, or use the arrow keys to move it and + or - to resize it."
              className="absolute cursor-move border-2 border-brand"
              style={{
                left: `${(frame.x / image.width) * 100}%`,
                top: `${(frame.y / image.height) * 100}%`,
                width: `${(frame.width / image.width) * 100}%`,
                height: `${(frame.height / image.height) * 100}%`,
                boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.45)",
                background: "transparent",
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => {
                drag.current = null;
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => resize(1 / 1.1)}>
              Smaller frame
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resize(1.1)}>
              Larger frame
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => aspect && update(initialFrame(image, aspect))}
            >
              Reset frame
            </Button>
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void make("photo")}>
              Make photo
            </Button>
          </div>
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
            <Select
              id="passport-photo-maker-paper"
              label="Print sheet paper"
              value={paper}
              onChange={(event) => {
                setPaper(event.target.value as Paper);
                setError("");
              }}
            >
              {(Object.keys(PAPERS) as Paper[]).map((key) => (
                <option key={key} value={key}>
                  {PAPERS[key].label}
                </option>
              ))}
            </Select>
            <Button variant="secondary" loading={busy} onClick={() => void make("sheet")}>
              Make print sheet
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {(photo || sheet) && source && (
        <FileResultList label="Passport photo files">
          {[photo, sheet].map(
            (output) =>
              output && (
                <FileResult
                  key={output.name}
                  name={output.name}
                  meta={output.meta}
                  state="done"
                  previewSrc={output.url}
                  previewAlt={`Preview of ${output.name}`}
                  actions={
                    <Button
                      size="sm"
                      aria-label={`Download ${output.name}`}
                      onClick={() => saveFile(output.blob, output.name, { type: "image/jpeg" })}
                    >
                      Download
                    </Button>
                  }
                />
              ),
          )}
        </FileResultList>
      )}
    </>
  );
}

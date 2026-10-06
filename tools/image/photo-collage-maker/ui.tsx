import { Alert, Button, Dropzone, FileResult, FileResultList, Input, Select, saveFile } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  borderRect,
  cells,
  checkFile,
  checkSettings,
  cover,
  FORMATS,
  type FormatId,
  formatSize,
  LAYOUTS,
  type LayoutId,
  LIMITS,
  MESSAGES,
  outputName,
  QUALITY,
  RANGES,
  type Rect,
  room,
  type Settings,
  SIZES,
  type SizeId,
  slotsOf,
} from "./logic";

// The workspace of Photo Collage Maker. Each photo is decoded once, upright, when it is added. The
// preview is the collage drawn small on a canvas; Save draws it again at full size from the same
// numbers (logic.ts) and writes PNG or JPG. Nothing leaves the page.

interface Photo {
  id: number;
  file: File;
  url: string;
  bitmap: ImageBitmap;
}

interface Output {
  blob: Blob;
  url: string;
  name: string;
  width: number;
  height: number;
  format: FormatId;
}

/** The preview is drawn at this fraction of the full size. */
const PREVIEW_SCALE = 0.4;

function draw(
  context: CanvasRenderingContext2D,
  scale: number,
  photos: readonly Photo[],
  settings: Settings,
) {
  const { width, height } = SIZES[settings.size];
  context.save();
  context.scale(scale, scale);
  context.fillStyle = settings.background;
  context.fillRect(0, 0, width, height);
  const rects: Rect[] = cells(settings.layout, width, height, settings.spacing);
  for (const [index, cell] of rects.entries()) {
    const photo = photos[index];
    if (photo) {
      const part = cover(photo.bitmap.width, photo.bitmap.height, cell);
      context.drawImage(
        photo.bitmap,
        part.x,
        part.y,
        part.width,
        part.height,
        cell.x,
        cell.y,
        cell.width,
        cell.height,
      );
    }
    if (settings.border > 0) {
      const line = borderRect(cell, settings.border);
      context.lineWidth = settings.border;
      context.strokeStyle = settings.borderColor;
      context.strokeRect(line.x, line.y, line.width, line.height);
    }
  }
  context.restore();
}

const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export default function ToolUi() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [layout, setLayout] = useState<LayoutId>("2-side");
  const [size, setSize] = useState<SizeId>("square");
  const [spacing, setSpacing] = useState("20");
  const [border, setBorder] = useState("0");
  const [borderColor, setBorderColor] = useState("#000000");
  const [background, setBackground] = useState("#ffffff");
  const [format, setFormat] = useState<FormatId>("png");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const nextId = useRef(1);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const outputRef = useRef(output);
  outputRef.current = output;

  const settings: Settings = {
    layout,
    size,
    spacing: number(spacing),
    border: number(border),
    borderColor,
    background,
    format,
  };
  const problems = checkSettings(settings);
  const slots = slotsOf(layout);
  const { width, height } = SIZES[size];

  useEffect(
    () => () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.url);
        photo.bitmap.close();
      }
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    },
    [],
  );

  // Every change redraws the preview and drops a collage saved before it.
  useEffect(() => {
    if (outputRef.current) {
      URL.revokeObjectURL(outputRef.current.url);
      setOutput(null);
    }
    const current: Settings = {
      layout,
      size,
      spacing: number(spacing),
      border: number(border),
      borderColor,
      background,
      format,
    };
    const canvas = preview.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || Object.keys(checkSettings(current)).length > 0) return;
    draw(context, PREVIEW_SCALE, photos, current);
  }, [photos, layout, size, spacing, border, borderColor, background, format]);

  const add = async (files: File[]) => {
    setError("");
    const refused: string[] = [];
    const accepted: Photo[] = [];
    let space = room(photosRef.current.length);
    for (const file of files) {
      const problem = checkFile(file);
      if (problem) {
        refused.push(`${file.name}: ${problem}`);
        continue;
      }
      if (space <= 0) {
        refused.push(`${file.name}: ${MESSAGES.tooMany}`);
        continue;
      }
      try {
        const bitmap = await createImageBitmap(file);
        space--;
        accepted.push({ id: nextId.current++, file, url: URL.createObjectURL(file), bitmap });
      } catch {
        refused.push(`${file.name}: ${MESSAGES.unreadable}`);
      }
    }
    setRejected(refused);
    setPhotos((list) => [...list, ...accepted]);
  };

  const move = (index: number, by: -1 | 1) => {
    setPhotos((list) => {
      const target = index + by;
      if (target < 0 || target >= list.length) return list;
      const next = [...list];
      [next[index], next[target]] = [next[target] as Photo, next[index] as Photo];
      return next;
    });
  };

  const remove = (id: number) => {
    setPhotos((list) => {
      const gone = list.find((photo) => photo.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.url);
        gone.bitmap.close();
      }
      return list.filter((photo) => photo.id !== id);
    });
  };

  const save = async () => {
    if (photos.length < slots) {
      setError(MESSAGES.needMore(slots));
      return;
    }
    const problem = Object.values(problems)[0];
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(MESSAGES.failed);
      draw(context, 1, photos, settings);
      const mime = FORMATS[format].mime;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, format === "jpg" ? QUALITY : undefined),
      );
      if (!blob) throw new Error(MESSAGES.failed);
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        name: outputName(photos[0]?.file.name, format),
        width,
        height,
        format,
      });
    } catch {
      setError(MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dropzone
        id="photo-collage-maker-files"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        title="Drop photos here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)} each, ${LIMITS.maxFiles} in all`}
        onFiles={(files) => void add(files)}
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
            {rejected.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Alert>
      )}

      {photos.length > 0 && (
        <section aria-labelledby="photo-collage-maker-list" className="grid gap-4">
          <h3 id="photo-collage-maker-list" className="text-lg">
            Photos, in the order of the cells
          </h3>
          <FileResultList label="Photos for the collage">
            {photos.map((photo, index) => (
              <FileResult
                key={photo.id}
                name={`${index + 1}. ${photo.file.name}`}
                meta={`${photo.bitmap.width} × ${photo.bitmap.height} pixels${
                  index >= slots ? ", not used in this layout" : ""
                }`}
                previewSrc={photo.url}
                previewAlt={`Photo ${index + 1}`}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={index === 0}
                      aria-label={`Swap ${photo.file.name} with the photo before it`}
                      onClick={() => move(index, -1)}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={index === photos.length - 1}
                      aria-label={`Swap ${photo.file.name} with the photo after it`}
                      onClick={() => move(index, 1)}
                    >
                      Down
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${photo.file.name}`}
                      onClick={() => remove(photo.id)}
                    >
                      Remove
                    </Button>
                  </>
                }
              />
            ))}
          </FileResultList>

          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Select
              id="photo-collage-maker-layout"
              label="Layout"
              value={layout}
              onChange={(event) => setLayout(event.target.value as LayoutId)}
            >
              {(Object.keys(LAYOUTS) as LayoutId[]).map((key) => (
                <option key={key} value={key}>
                  {LAYOUTS[key].label}
                </option>
              ))}
            </Select>
            <Select
              id="photo-collage-maker-size"
              label="Size in pixels"
              value={size}
              onChange={(event) => setSize(event.target.value as SizeId)}
            >
              {(Object.keys(SIZES) as SizeId[]).map((key) => (
                <option key={key} value={key}>
                  {SIZES[key].label}
                </option>
              ))}
            </Select>
            <Select
              id="photo-collage-maker-format"
              label="Save as"
              value={format}
              onChange={(event) => setFormat(event.target.value as FormatId)}
            >
              {(Object.keys(FORMATS) as FormatId[]).map((key) => (
                <option key={key} value={key}>
                  {FORMATS[key].label}
                </option>
              ))}
            </Select>
            <Input
              id="photo-collage-maker-spacing"
              label="Spacing (pixels)"
              type="number"
              min={RANGES.spacing.min}
              max={RANGES.spacing.max}
              value={spacing}
              error={problems.spacing}
              onChange={(event) => setSpacing(event.target.value)}
            />
            <Input
              id="photo-collage-maker-background"
              label="Background colour"
              type="color"
              value={background}
              error={problems.background}
              onChange={(event) => setBackground(event.target.value)}
            />
            <Input
              id="photo-collage-maker-border"
              label="Border around each photo (pixels)"
              type="number"
              min={RANGES.border.min}
              max={RANGES.border.max}
              value={border}
              error={problems.border}
              onChange={(event) => setBorder(event.target.value)}
            />
            <Input
              id="photo-collage-maker-border-color"
              label="Border colour"
              type="color"
              value={borderColor}
              error={problems.borderColor}
              onChange={(event) => setBorderColor(event.target.value)}
            />
          </div>
          <p className="text-sm text-fg-muted" id="photo-collage-maker-summary">
            {`${LAYOUTS[layout].label}: ${Math.min(photos.length, slots)} of ${slots} cells filled. `}
            {photos.length > slots
              ? `Only the first ${slots} photos are used. `
              : photos.length < slots
                ? `Add ${slots - photos.length} more, or choose another layout. `
                : ""}
            Each photo fills its cell, and what does not fit is cut off at the edges.
          </p>
          <canvas
            ref={preview}
            id="photo-collage-maker-preview"
            className="h-auto w-full"
            width={Math.round(width * PREVIEW_SCALE)}
            height={Math.round(height * PREVIEW_SCALE)}
            role="img"
            aria-label="Preview of the collage"
          />
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save collage
            </Button>
          </div>
        </section>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <FileResultList label="Your collage">
          <FileResult
            name={output.name}
            meta={`${output.width} × ${output.height} pixels, ${FORMATS[output.format].label}, ${formatSize(output.blob.size)}`}
            state="done"
            previewSrc={output.url}
            previewAlt="The collage"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() =>
                  saveFile(output.blob, output.name, { type: FORMATS[output.format].mime })
                }
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

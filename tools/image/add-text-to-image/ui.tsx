import {
  Alert,
  Button,
  Checkbox,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  PageCanvas,
  type PageCanvasItem,
  Select,
  saveFile,
  Textarea,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  checkLayer,
  checkLayers,
  cssFont,
  FONTS,
  type Font,
  formatSize,
  type ImageType,
  INPUT_TYPES,
  imageTypeOf,
  type Layer,
  LIMITS,
  LINE_HEIGHT,
  layout,
  MESSAGES,
  newLayer,
  outputName,
  QUALITY,
  RANGES,
  withinPixelLimit,
} from "./logic";

// The workspace of Add Text to Image. The photo is shown with PageCanvas and each text layer is an
// item over it, sized in cqw (a hundredth of the shown width), so it can be dragged or moved with
// the arrow keys. Save draws the photo and every layer on a canvas at full size, from the same
// numbers (logic.ts), and writes it in the photo's own format. Nothing leaves the page.

interface Photo {
  file: File;
  url: string;
  bitmap: ImageBitmap;
  type: ImageType;
}

interface Output {
  blob: Blob;
  url: string;
  name: string;
  type: ImageType;
  asked: ImageType;
  width: number;
  height: number;
}

const blobOf = (canvas: HTMLCanvasElement, type: ImageType) =>
  new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, type === "image/png" ? undefined : QUALITY),
  );

/** The photo with every layer, at full size. */
function draw(photo: Photo, layers: readonly Layer[]): HTMLCanvasElement {
  const { width, height } = photo.bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(MESSAGES.failed);
  if (photo.type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(photo.bitmap, 0, 0);
  context.textAlign = "left";
  context.textBaseline = "top";
  context.lineJoin = "round";
  for (const layer of layers) {
    const shape = layout(layer, width, height);
    context.font = cssFont(layer, shape.pixels);
    for (const line of shape.lines) {
      context.save();
      if (layer.shadow) {
        context.shadowColor = "rgba(0, 0, 0, 0.6)";
        context.shadowBlur = shape.shadowBlur;
        context.shadowOffsetX = shape.shadowOffset;
        context.shadowOffsetY = shape.shadowOffset;
      }
      if (shape.outlineWidth > 0) {
        context.lineWidth = shape.outlineWidth;
        context.strokeStyle = layer.outlineColor;
        context.strokeText(line.text, line.x, line.y);
        // The shadow is cast once, by the outline, so the letters do not darken their own edge.
        context.shadowColor = "transparent";
      }
      context.fillStyle = layer.color;
      context.fillText(line.text, line.x, line.y);
      context.restore();
    }
  }
  return canvas;
}

const number = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));
const shown = (value: number) => (Number.isNaN(value) ? "" : String(value));
const round1 = (value: number) => Math.round(value * 10) / 10;

export default function ToolUi() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [fileError, setFileError] = useState("");
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<Output | null>(null);
  const nextId = useRef(1);
  const photoRef = useRef(photo);
  photoRef.current = photo;
  const outputRef = useRef(output);
  outputRef.current = output;

  const dropOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    setOutput(null);
  };

  useEffect(
    () => () => {
      if (photoRef.current) {
        URL.revokeObjectURL(photoRef.current.url);
        photoRef.current.bitmap.close();
      }
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    },
    [],
  );

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    dropOutput();
    setError("");
    const problem = checkFile(file);
    const type = imageTypeOf(file);
    if (problem || !type) {
      setFileError(`${file.name}: ${problem ?? MESSAGES.notAnImage}`);
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
    setFileError("");
    if (photoRef.current) {
      URL.revokeObjectURL(photoRef.current.url);
      photoRef.current.bitmap.close();
    }
    setPhoto({ file, url: URL.createObjectURL(file), bitmap, type });
    if (layers.length === 0) {
      const first = newLayer(`layer-${nextId.current++}`, 0);
      setLayers([first]);
      setSelected(first.id);
    }
  };

  const change = (id: string, patch: Partial<Layer>) => {
    dropOutput();
    setLayers((list) => list.map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)));
  };

  const add = () => {
    if (layers.length >= LIMITS.maxLayers) {
      setError(MESSAGES.tooManyLayers);
      return;
    }
    setError("");
    dropOutput();
    const layer = newLayer(`layer-${nextId.current++}`, layers.length);
    setLayers((list) => [...list, layer]);
    setSelected(layer.id);
  };

  const remove = (id: string) => {
    dropOutput();
    setError("");
    setLayers((list) => list.filter((layer) => layer.id !== id));
    setSelected(null);
  };

  const save = async () => {
    if (!photo) return;
    dropOutput();
    const problem = checkLayers(layers);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const canvas = draw(photo, layers);
      const asked = photo.type;
      let blob = await blobOf(canvas, asked);
      let type = asked;
      // A browser that cannot write the format gives PNG, or nothing: then PNG is written.
      if (!blob || blob.type !== asked) {
        blob = blob?.type === "image/png" ? blob : await blobOf(canvas, "image/png");
        type = "image/png";
      }
      if (!blob) throw new Error(MESSAGES.failed);
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        name: outputName(photo.file.name, type),
        type,
        asked,
        width: canvas.width,
        height: canvas.height,
      });
    } catch {
      setError(MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  const current = layers.find((layer) => layer.id === selected) ?? null;
  const problems = current ? checkLayer(current) : {};

  const items: PageCanvasItem[] = layers.map((layer, index) => {
    const size = Number.isFinite(layer.size) ? layer.size : 1;
    const outline = Number.isFinite(layer.outline) ? layer.outline : 0;
    return {
      id: layer.id,
      label: `Text layer ${index + 1}: ${layer.text || "empty"}`,
      x: (Number.isFinite(layer.x) ? layer.x : 0) / 100,
      y: (Number.isFinite(layer.y) ? layer.y : 0) / 100,
      content: (
        <span
          style={{
            display: "block",
            whiteSpace: "pre",
            fontFamily: FONTS[layer.font].css,
            fontWeight: layer.bold ? 700 : 400,
            fontSize: `${size}cqw`,
            lineHeight: LINE_HEIGHT,
            color: layer.color,
            WebkitTextStroke:
              outline > 0 ? `${(outline / 100) * size * 2}cqw ${layer.outlineColor}` : undefined,
            paintOrder: "stroke fill",
            textShadow: layer.shadow
              ? `${size * 0.06}cqw ${size * 0.06}cqw ${size * 0.15}cqw rgba(0, 0, 0, 0.6)`
              : undefined,
          }}
        >
          {layer.text || " "}
        </span>
      ),
    };
  });

  return (
    <>
      <Dropzone
        id="add-text-to-image-file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
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

      {photo && (
        <>
          <p className="text-sm text-fg-muted" id="add-text-to-image-original">
            {photo.file.name}: {photo.bitmap.width} × {photo.bitmap.height} pixels,{" "}
            {INPUT_TYPES[photo.type].label}, {formatSize(photo.file.size)}
          </p>
          <PageCanvas
            id="add-text-to-image-canvas"
            label="Your photo"
            hint="Drag a text to move it, or select it and use the arrow keys (Shift moves further). Delete removes it."
            src={photo.url}
            aspectRatio={photo.bitmap.width / photo.bitmap.height}
            items={items}
            selectedId={selected}
            onSelect={setSelected}
            onMove={(id, x, y) => change(id, { x: round1(x * 100), y: round1(y * 100) })}
            onDelete={remove}
          />
          <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Text layers">
            {layers.map((layer, index) => (
              <Button
                key={layer.id}
                size="sm"
                variant={layer.id === selected ? "primary" : "secondary"}
                aria-pressed={layer.id === selected}
                onClick={() => setSelected(layer.id)}
              >
                Layer {index + 1}
              </Button>
            ))}
            <Button size="sm" variant="secondary" onClick={add}>
              Add text layer
            </Button>
          </div>

          {current && (
            <section aria-label="Selected layer" className="grid gap-4">
              <Textarea
                id="add-text-to-image-text"
                label="Text"
                hint={`Up to ${LIMITS.maxTextLength} characters; press Enter for a new line`}
                rows={2}
                value={current.text}
                error={problems.text}
                onChange={(event) => change(current.id, { text: event.target.value })}
              />
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Select
                  id="add-text-to-image-font"
                  label="Font"
                  value={current.font}
                  onChange={(event) => change(current.id, { font: event.target.value as Font })}
                >
                  {(Object.keys(FONTS) as Font[]).map((key) => (
                    <option key={key} value={key}>
                      {FONTS[key].label}
                    </option>
                  ))}
                </Select>
                <Input
                  id="add-text-to-image-size"
                  label="Text size (% of width)"
                  type="number"
                  min={RANGES.size.min}
                  max={RANGES.size.max}
                  step={0.5}
                  value={shown(current.size)}
                  error={problems.size}
                  onChange={(event) => change(current.id, { size: number(event.target.value) })}
                />
                <Input
                  id="add-text-to-image-color"
                  label="Colour"
                  type="color"
                  value={current.color}
                  error={problems.color}
                  onChange={(event) => change(current.id, { color: event.target.value })}
                />
                <Input
                  id="add-text-to-image-outline"
                  label="Outline (% of text size)"
                  type="number"
                  min={RANGES.outline.min}
                  max={RANGES.outline.max}
                  value={shown(current.outline)}
                  error={problems.outline}
                  onChange={(event) => change(current.id, { outline: number(event.target.value) })}
                />
                <Input
                  id="add-text-to-image-outline-color"
                  label="Outline colour"
                  type="color"
                  value={current.outlineColor}
                  error={problems.outlineColor}
                  onChange={(event) => change(current.id, { outlineColor: event.target.value })}
                />
                <div className="grid gap-2">
                  <Checkbox
                    id="add-text-to-image-bold"
                    label="Bold"
                    checked={current.bold}
                    onChange={(event) => change(current.id, { bold: event.target.checked })}
                  />
                  <Checkbox
                    id="add-text-to-image-shadow"
                    label="Shadow"
                    checked={current.shadow}
                    onChange={(event) => change(current.id, { shadow: event.target.checked })}
                  />
                </div>
                <Input
                  id="add-text-to-image-x"
                  label="Left (% of width)"
                  type="number"
                  min={RANGES.x.min}
                  max={RANGES.x.max}
                  step={0.1}
                  value={shown(current.x)}
                  error={problems.x}
                  onChange={(event) => change(current.id, { x: number(event.target.value) })}
                />
                <Input
                  id="add-text-to-image-y"
                  label="Top (% of height)"
                  type="number"
                  min={RANGES.y.min}
                  max={RANGES.y.max}
                  step={0.1}
                  value={shown(current.y)}
                  error={problems.y}
                  onChange={(event) => change(current.id, { y: number(event.target.value) })}
                />
              </div>
              <div>
                <Button size="sm" variant="ghost" onClick={() => remove(current.id)}>
                  Remove this layer
                </Button>
              </div>
            </section>
          )}

          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              Save picture
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      {output && (
        <>
          {output.type !== output.asked && (
            <Alert tone="info" id="add-text-to-image-webp">
              {MESSAGES.noWebp}
            </Alert>
          )}
          <FileResultList label="Picture with text">
            <FileResult
              name={output.name}
              meta={`${output.width} × ${output.height} pixels, ${INPUT_TYPES[output.type].label}, ${formatSize(output.blob.size)}`}
              state="done"
              previewSrc={output.url}
              previewAlt="The photo with its text"
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
        </>
      )}
    </>
  );
}

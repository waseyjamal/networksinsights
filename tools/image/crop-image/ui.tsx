import { Alert, Button, Dropzone, FileResult, FileResultList, Input, Select, saveFile } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkCrop,
  checkFile,
  formatSize,
  heightFor,
  type ImageType,
  INPUT_TYPES,
  imageTypeOf,
  LIMITS,
  largestCrop,
  MESSAGES,
  outputName,
  outputType,
  parseNumber,
  qualityFor,
  RATIOS,
  type Ratio,
  type Rect,
  widthFor,
  withinPixelLimit,
} from "./logic";

// The workspace of Crop Image. One picture at a time: the visitor sets the rectangle in pixels,
// or picks a ratio, which starts with the largest centred crop of that shape. A canvas on this
// page cuts it out and encodes it in the same format. No library and no upload.

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Source {
  file: File;
  type: ImageType;
  bitmap: ImageBitmap;
}

interface Output {
  blob: Blob;
  url: string;
  name: string;
  rect: Rect;
  type: ImageType;
}

type Fields = Record<keyof Rect, string>;

const toFields = (rect: Rect): Fields => ({
  x: String(rect.x),
  y: String(rect.y),
  width: String(rect.width),
  height: String(rect.height),
});

function writableTypes(): ImageType[] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return (Object.keys(INPUT_TYPES) as ImageType[]).filter((type) =>
    canvas.toDataURL(type).startsWith(`data:${type}`),
  );
}

async function cut(source: Source, rect: Rect, type: ImageType): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no context");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
  }
  context.drawImage(
    source.bitmap,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, qualityFor(type)),
  );
  if (!blob) throw new Error("no blob");
  return blob;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [ratio, setRatio] = useState<Ratio>("free");
  const [fields, setFields] = useState<Fields>({ x: "0", y: "0", width: "", height: "" });
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const outputRef = useRef(output);
  outputRef.current = output;

  useEffect(
    () => () => {
      if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    },
    [],
  );

  const dropOutput = () => {
    if (outputRef.current) URL.revokeObjectURL(outputRef.current.url);
    setOutput(null);
  };

  const imageSize = source ? { width: source.bitmap.width, height: source.bitmap.height } : null;

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
    source?.bitmap.close();
    setFileError("");
    setSource({ file, type: imageTypeOf(file) ?? "image/png", bitmap });
    setFields(toFields(largestCrop({ width: bitmap.width, height: bitmap.height }, ratio)));
  };

  const chooseRatio = (next: Ratio) => {
    setRatio(next);
    setError("");
    if (imageSize) setFields(toFields(largestCrop(imageSize, next)));
  };

  // With a fixed ratio, the width and the height follow each other.
  const change = (key: keyof Rect, text: string) => {
    const next = { ...fields, [key]: text };
    const value = parseNumber(text);
    if (value !== undefined && value >= 1) {
      if (key === "width") {
        const height = heightFor(value, ratio);
        if (height !== undefined) next.height = String(height);
      } else if (key === "height") {
        const width = widthFor(value, ratio);
        if (width !== undefined) next.width = String(width);
      }
    }
    setFields(next);
  };

  const crop = async () => {
    if (!source || !imageSize) return;
    dropOutput();
    const checked = checkCrop(
      {
        x: parseNumber(fields.x),
        y: parseNumber(fields.y),
        width: parseNumber(fields.width),
        height: parseNumber(fields.height),
      },
      imageSize,
    );
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const type = outputType(source.type, writableTypes());
      const blob = await cut(source, checked.rect, type);
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        name: outputName(source.file.name, checked.rect, type),
        rect: checked.rect,
        type,
      });
    } catch {
      setError(MESSAGES.failed);
    } finally {
      setBusy(false);
    }
  };

  const box = (key: keyof Rect, label: string) => (
    <Input
      id={`crop-image-${key}`}
      label={label}
      inputMode="numeric"
      value={fields[key]}
      onChange={(event) => change(key, event.target.value)}
    />
  );

  return (
    <>
      <Dropzone
        id="crop-image-file"
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

      {source && imageSize && (
        <>
          <p className="text-sm text-fg-muted" id="crop-image-original">
            {source.file.name}: {imageSize.width} × {imageSize.height} pixels,{" "}
            {formatSize(source.file.size)}
          </p>
          <Select
            id="crop-image-ratio"
            label="Shape"
            hint="A shape starts with the largest centred crop of that shape."
            value={ratio}
            onChange={(event) => chooseRatio(event.target.value as Ratio)}
          >
            {(Object.keys(RATIOS) as Ratio[]).map((key) => (
              <option key={key} value={key}>
                {RATIOS[key].label}
              </option>
            ))}
          </Select>
          <div className="grid items-start gap-4 sm:grid-cols-4">
            {box("x", "Left (pixels)")}
            {box("y", "Top (pixels)")}
            {box("width", "Width (pixels)")}
            {box("height", "Height (pixels)")}
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void crop()}>
              Crop
            </Button>
          </div>
          {error && (
            <p className="text-sm text-danger-text" role="alert">
              {error}
            </p>
          )}
        </>
      )}

      {output && source && (
        <FileResultList label="Cropped picture">
          <FileResult
            name={output.name}
            meta={`${output.rect.width} × ${output.rect.height} pixels, ${formatSize(output.blob.size)}`}
            state="done"
            previewSrc={output.url}
            previewAlt={`Cropped preview of ${source.file.name}`}
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: output.type })}
              >
                Download
              </Button>
            }
          >
            {output.type !== source.type && (
              <span className="text-sm text-fg-muted">
                This browser cannot write {INPUT_TYPES[source.type].label}, so the result is a PNG.
              </span>
            )}
          </FileResult>
        </FileResultList>
      )}
    </>
  );
}

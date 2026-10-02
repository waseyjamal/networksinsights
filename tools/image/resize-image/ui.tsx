import {
  Alert,
  Button,
  Dropzone,
  FileResult,
  FileResultList,
  Input,
  Select,
  Switch,
  saveFile,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  type ImageType,
  INPUT_TYPES,
  imageTypeOf,
  LIMITS,
  MESSAGES,
  type Mode,
  outputName,
  outputType,
  parseNumber,
  qualityFor,
  type Size,
  targetSize,
  withinPixelLimit,
} from "./logic";

// The workspace of Resize Image. One picture at a time: the browser decodes it, a canvas on this
// page draws it at the new size with high-quality smoothing, and the canvas encodes it again in
// the same format. No library and no upload.

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
  size: Size;
  type: ImageType;
}

/** The types this browser's canvas writes, asked of a 1 by 1 canvas. */
function writableTypes(): ImageType[] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  return (Object.keys(INPUT_TYPES) as ImageType[]).filter((type) =>
    canvas.toDataURL(type).startsWith(`data:${type}`),
  );
}

async function draw(source: Source, size: Size, type: ImageType): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no context");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source.bitmap, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, qualityFor(type)),
  );
  if (!blob) throw new Error("no blob");
  return blob;
}

export default function ToolUi() {
  const [source, setSource] = useState<Source | null>(null);
  const [fileError, setFileError] = useState("");
  const [mode, setMode] = useState<Mode>("pixels");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [keepRatio, setKeepRatio] = useState(true);
  const [percent, setPercent] = useState("50");
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
    setWidth(String(bitmap.width));
    setHeight(String(bitmap.height));
  };

  // With Keep proportions on, typing one side fills in the other.
  const changeWidth = (text: string) => {
    setWidth(text);
    const value = parseNumber(text);
    if (keepRatio && source && value !== undefined && value > 0) {
      setHeight(
        String(Math.max(1, Math.round((value * source.bitmap.height) / source.bitmap.width))),
      );
    }
  };
  const changeHeight = (text: string) => {
    setHeight(text);
    const value = parseNumber(text);
    if (keepRatio && source && value !== undefined && value > 0) {
      setWidth(
        String(Math.max(1, Math.round((value * source.bitmap.width) / source.bitmap.height))),
      );
    }
  };

  const resize = async () => {
    if (!source) return;
    dropOutput();
    const result = targetSize(
      {
        mode,
        width: parseNumber(width),
        // With proportions kept, the width decides when it is filled in.
        height: keepRatio && parseNumber(width) !== undefined ? undefined : parseNumber(height),
        keepRatio,
        percent: parseNumber(percent),
      },
      { width: source.bitmap.width, height: source.bitmap.height },
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const type = outputType(source.type, writableTypes());
      const blob = await draw(source, result.size, type);
      setOutput({
        blob,
        url: URL.createObjectURL(blob),
        name: outputName(source.file.name, result.size, type),
        size: result.size,
        type,
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
        id="resize-image-file"
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
          <p className="text-sm text-fg-muted" id="resize-image-original">
            {source.file.name}: {source.bitmap.width} × {source.bitmap.height} pixels,{" "}
            {formatSize(source.file.size)}
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Select
              id="resize-image-mode"
              label="Resize by"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as Mode);
                setError("");
              }}
            >
              <option value="pixels">Width and height in pixels</option>
              <option value="percent">Percentage</option>
            </Select>
            {mode === "percent" ? (
              <Input
                id="resize-image-percent"
                label="Percentage of the original"
                inputMode="numeric"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
              />
            ) : (
              <Switch
                label="Keep proportions"
                checked={keepRatio}
                onChange={(event) => setKeepRatio(event.target.checked)}
              />
            )}
          </div>
          {mode === "pixels" && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Input
                id="resize-image-width"
                label="Width (pixels)"
                inputMode="numeric"
                value={width}
                onChange={(event) => changeWidth(event.target.value)}
              />
              <Input
                id="resize-image-height"
                label="Height (pixels)"
                inputMode="numeric"
                value={height}
                onChange={(event) => changeHeight(event.target.value)}
              />
            </div>
          )}
          <div className="ni-workspace__actions">
            <Button variant="primary" loading={busy} onClick={() => void resize()}>
              Resize
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
        <FileResultList label="Resized picture">
          <FileResult
            name={output.name}
            meta={`${output.size.width} × ${output.size.height} pixels, ${formatSize(output.blob.size)}`}
            state="done"
            previewSrc={output.url}
            previewAlt={`Resized preview of ${source.file.name}`}
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

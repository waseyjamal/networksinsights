import { Button, Dropzone, Select } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  LIMITS,
  MESSAGES,
  run,
  type Swatch,
  sampleSize,
  withinPixelLimit,
} from "./logic";

// The workspace of Color Palette from Image. The browser decodes the picture, a canvas on this page
// draws it small, and logic.ts runs median cut on those pixels. Nothing is uploaded.

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const COPIED_MESSAGE_MS = 3000;
const COUNTS = [2, 3, 4, 5, 6, 7, 8] as const;

/** The pixels of a picture drawn at its sampling size, or a message saying why it cannot be. */
async function samplePixels(file: File): Promise<Uint8ClampedArray | string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return MESSAGES.unreadable;
  }
  try {
    if (!withinPixelLimit(bitmap.width, bitmap.height)) return MESSAGES.tooManyPixels;
    const size = sampleSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return MESSAGES.unreadable;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return context.getImageData(0, 0, size.width, size.height).data;
  } finally {
    bitmap.close();
  }
}

export default function ToolUi() {
  const [count, setCount] = useState(6);
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);
  const [preview, setPreview] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const previewRef = useRef("");

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreview("");
    setPixels(null);
    const refused = checkFile(file);
    if (refused) {
      setError(`${file.name}: ${refused}`);
      return;
    }
    const sampled = await samplePixels(file);
    if (typeof sampled === "string") {
      setError(`${file.name}: ${sampled}`);
      return;
    }
    setError("");
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreview(url);
    setName(file.name);
    setPixels(sampled);
  };

  const result = pixels ? run({ pixels, count }) : null;
  const colors: Swatch[] = result?.ok ? result.colors : [];

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${what} copied to the clipboard.`);
    } catch {
      setMessage("Your browser did not allow copying. Select the value and copy it.");
    }
  };

  return (
    <>
      <Dropzone
        id="palette-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop one picture here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      <Select
        id="palette-count"
        label="Number of colours"
        value={String(count)}
        onChange={(event) => setCount(Number(event.target.value))}
      >
        {COUNTS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {result && !result.ok && (
        <p className="text-sm text-danger-text" role="alert">
          {result.error}
        </p>
      )}
      {preview && (
        <img
          src={preview}
          alt={`Your file ${name}`}
          className="max-h-64 w-auto max-w-full rounded-xl border border-border"
        />
      )}
      {colors.length > 0 && (
        <section aria-labelledby="palette-colors" className="grid gap-3">
          <h3 id="palette-colors" className="text-lg">
            Palette
          </h3>
          <ul aria-label="Colours" className="grid gap-2 sm:grid-cols-2">
            {colors.map((color) => (
              <li
                key={color.hex}
                className="flex items-center gap-3 rounded-xl border border-border p-2"
              >
                <span
                  aria-hidden="true"
                  className="h-10 w-10 shrink-0 rounded-lg border border-border"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="flex-1 font-mono">{color.hex}</span>
                <span className="text-sm text-fg-muted">{color.share}%</span>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Copy ${color.hex}`}
                  onClick={() => void copy(color.hex, color.hex)}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
          <div className="ni-workspace__actions">
            <Button
              variant="primary"
              onClick={() => void copy(colors.map((color) => color.hex).join("\n"), "All colours")}
            >
              Copy all
            </Button>
          </div>
        </section>
      )}
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

import { Alert, Button, Select, saveFile, Textarea } from "@ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LEVEL,
  DEFAULT_SIZE,
  LEVEL_LABELS,
  LEVELS,
  type Level,
  type Result,
  run,
  SIZES,
} from "./logic";

// The workspace of QR Code Generator: the text, the error correction level and the image size, then
// the code itself, drawn on a canvas at its real size, and a PNG download. The code is drawn again
// on every keystroke and every change of option. Nothing leaves the page: the PNG is made from the
// canvas in the browser and handed to saveFile.

// A QR code is black on white whatever the page theme: readers expect dark modules on a light
// background, and many cannot read a code drawn the other way round. These are the code's colours,
// not the interface's, so they are not design tokens.
const DARK = "#000000";
const LIGHT = "#ffffff";

/** Draws the code on the canvas, the quiet zone included, at the image size. */
function draw(canvas: HTMLCanvasElement, result: Extract<Result, { ok: true }>): void {
  const { code, placement, size } = result;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = LIGHT;
  context.fillRect(0, 0, size, size);
  context.fillStyle = DARK;
  const { scale, offset } = placement;
  for (let y = 0; y < code.modules; y++)
    for (let x = 0; x < code.modules; x++)
      if (code.dark[y * code.modules + x] === 1)
        context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
}

export default function ToolUi() {
  const [text, setText] = useState("");
  const [level, setLevel] = useState<Level>(DEFAULT_LEVEL);
  const [size, setSize] = useState<number>(DEFAULT_SIZE);
  const [downloadMessage, setDownloadMessage] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);

  const result = useMemo(() => run({ text, level, size }), [text, level, size]);

  useEffect(() => {
    if (result.ok && canvas.current) draw(canvas.current, result);
  }, [result]);

  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) {
        setDownloadMessage(
          "Your browser could not make the PNG. Try again, or try another browser.",
        );
        return;
      }
      saveFile(blob, `qr-code-${size}px.png`, { type: "image/png" });
      setDownloadMessage("");
    }, "image/png");
  };

  return (
    <>
      <Textarea
        id="qr-code-generator-text"
        label="Text or link"
        hint="The code updates as you type."
        rows={3}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id="qr-code-generator-level"
          label="Error correction"
          value={level}
          onChange={(event) => setLevel(event.target.value as Level)}
        >
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {LEVEL_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select
          id="qr-code-generator-size"
          label="Size"
          value={String(size)}
          onChange={(event) => setSize(Number(event.target.value))}
        >
          {SIZES.map((value) => (
            <option key={value} value={value}>
              {value} × {value} pixels
            </option>
          ))}
        </Select>
      </div>
      {result.ok ? (
        <>
          <div className="grid justify-items-start gap-2">
            <canvas
              ref={canvas}
              id="qr-code-generator-code"
              width={size}
              height={size}
              role="img"
              aria-label={`QR code of the text above, ${size} by ${size} pixels`}
              className="h-auto max-w-full rounded-sm border border-border"
            />
            <p className="text-sm text-fg-muted" id="qr-code-generator-details">
              Version {result.code.version}, {result.code.modules} × {result.code.modules} modules,
              level {result.code.level}.
            </p>
          </div>
          <div className="ni-workspace__actions">
            <Button variant="primary" size="sm" onClick={download}>
              Download PNG
            </Button>
          </div>
          {downloadMessage !== "" && <Alert tone="warning">{downloadMessage}</Alert>}
        </>
      ) : result.reason === "empty" ? (
        <p className="text-sm text-fg-muted">{result.error}</p>
      ) : (
        <Alert tone="warning">{result.error}</Alert>
      )}
    </>
  );
}

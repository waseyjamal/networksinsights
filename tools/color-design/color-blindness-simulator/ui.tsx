import { Alert, Dropzone } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  checkFile,
  formatSize,
  LIMITS,
  MESSAGES,
  simulatePixels,
  VIEW_MAX_SIDE,
  VISIONS,
  type Vision,
  viewSize,
} from "./logic";

// The workspace of Color Blindness Simulator. The picture is decoded once, upright, and drawn on
// one canvas per view; each simulated view changes its pixels with the matrices in logic.ts.
// Nothing leaves the page.

interface Picture {
  name: string;
  size: number;
  bitmap: ImageBitmap;
}

const ORDER: Array<Vision | "original"> = [
  "original",
  "protanopia",
  "deuteranopia",
  "tritanopia",
  "achromatopsia",
];

function View({ picture, vision }: { picture: Picture; vision: Vision | "original" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = viewSize(picture.bitmap.width, picture.bitmap.height);
  useEffect(() => {
    const context = canvas.current?.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(picture.bitmap, 0, 0, width, height);
    if (vision === "original") return;
    const image = context.getImageData(0, 0, width, height);
    simulatePixels(vision, image.data);
    context.putImageData(image, 0, 0);
  }, [picture, vision, width, height]);
  const title =
    vision === "original" ? "Original" : `${VISIONS[vision].label} (${VISIONS[vision].about})`;
  return (
    <figure className="grid gap-2">
      <canvas
        ref={canvas}
        id={`color-blindness-simulator-${vision}`}
        className="h-auto w-full"
        width={width}
        height={height}
        role="img"
        aria-label={`The picture as seen with ${vision === "original" ? "typical colour vision" : VISIONS[vision].label}`}
      />
      <figcaption className="text-sm">{title}</figcaption>
    </figure>
  );
}

export default function ToolUi() {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [error, setError] = useState("");
  const pictureRef = useRef(picture);
  pictureRef.current = picture;

  useEffect(() => () => pictureRef.current?.bitmap.close(), []);

  const open = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const problem = checkFile(file);
    if (problem) {
      setError(`${file.name}: ${problem}`);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      pictureRef.current?.bitmap.close();
      setPicture({ name: file.name, size: file.size, bitmap });
      setError("");
    } catch {
      setError(`${file.name}: ${MESSAGES.unreadable}`);
    }
  };

  return (
    <>
      <Alert tone="info" title="An approximation, not a medical test">
        These views come from a published model of colour vision. Real colour vision differs from
        person to person, and screens differ too. This tool cannot tell you whether you or anyone
        else is colour blind.
      </Alert>
      <Dropzone
        id="color-blindness-simulator-file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple={false}
        title="Drop a picture here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={(files) => void open(files)}
      />
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {picture && (
        <>
          <p className="text-sm text-fg-muted" id="color-blindness-simulator-summary">
            {picture.name}: {picture.bitmap.width} × {picture.bitmap.height} pixels,{" "}
            {formatSize(picture.size)}. Each view is drawn at most {VIEW_MAX_SIDE} pixels on its
            longer side.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {ORDER.map((vision) => (
              <View key={vision} picture={picture} vision={vision} />
            ))}
          </div>
          <p className="text-sm text-fg-muted">
            Source: Machado, Oliveira and Fernandes (2009), A Physiologically-based Model for
            Simulation of Color Vision Deficiency, IEEE Transactions on Visualization and Computer
            Graphics 15(6), severity 1.0, applied in linear RGB. Achromatopsia uses the luminance
            weights of ITU-R BT.709.
          </p>
        </>
      )}
    </>
  );
}

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
  checkSettings,
  formatSize,
  type ImageType,
  INPUT_TYPES,
  imageTypeOf,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
  POSITIONS,
  type Position,
  RANGES,
} from "./logic";

// The workspace of Add Watermark to Image: one picture, the text and its look, then the result to
// preview and download. worker.ts draws and saves the picture, so the page stays light.

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

interface Output extends JobResult {
  name: string;
  url: string;
  asked: ImageType;
}

const num = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

export default function ToolUi() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("© Example Studio");
  const [size, setSize] = useState("5");
  const [color, setColor] = useState("#ffffff");
  const [opacity, setOpacity] = useState("50");
  const [position, setPosition] = useState<Position>("bottom-right");
  const [rotation, setRotation] = useState("0");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  const urlRef = useRef("");

  const settings = {
    text,
    size: num(size),
    color,
    opacity: num(opacity),
    position,
    rotation: num(rotation),
  };
  const problems = checkSettings(settings);

  const clearOutput = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = "";
    setOutput(null);
  };
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const choose = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    clearOutput();
    const refused = checkFile(picked);
    if (refused) {
      setFile(null);
      setError(`${picked.name}: ${refused}`);
      return;
    }
    setError("");
    setFile(picked);
  };

  const apply = async () => {
    if (!file) return;
    const type = imageTypeOf(file);
    if (!type || Object.keys(problems).length > 0) return;
    clearOutput();
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      const made = await client.run(
        { ...settings, image: file, type },
        { onProgress: ({ done, total }) => setProgress(Math.round((done / total) * 100)) },
      );
      const url = URL.createObjectURL(made.blob);
      urlRef.current = url;
      setOutput({ ...made, name: outputName(file.name, made.type), url, asked: type });
    } catch (caught) {
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    clearOutput();
  };

  return (
    <>
      <Dropzone
        id="watermark-file"
        accept={ACCEPT}
        multiple={false}
        title="Drop one picture here"
        hint={`or click to choose. JPG, PNG or WebP, up to ${formatSize(LIMITS.maxInputBytes)}`}
        onFiles={choose}
      />
      {file && (
        <p className="text-sm">
          Picture: {file.name}, {formatSize(file.size)}
        </p>
      )}
      <Input
        id="watermark-text"
        label="Watermark text"
        maxLength={LIMITS.maxTextLength + 20}
        value={text}
        error={problems.text}
        onChange={(event) => edit(setText)(event.target.value)}
      />
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Input
          id="watermark-size"
          label="Text size (% of the shorter side)"
          type="number"
          inputMode="decimal"
          min={RANGES.size.min}
          max={RANGES.size.max}
          value={size}
          error={problems.size}
          onChange={(event) => edit(setSize)(event.target.value)}
        />
        <Input
          id="watermark-opacity"
          label="Opacity (%)"
          type="number"
          inputMode="numeric"
          min={RANGES.opacity.min}
          max={RANGES.opacity.max}
          value={opacity}
          error={problems.opacity}
          onChange={(event) => edit(setOpacity)(event.target.value)}
        />
        <Input
          id="watermark-rotation"
          label="Rotation (degrees)"
          type="number"
          inputMode="numeric"
          min={RANGES.rotation.min}
          max={RANGES.rotation.max}
          value={rotation}
          error={problems.rotation}
          onChange={(event) => edit(setRotation)(event.target.value)}
        />
        <Select
          id="watermark-position"
          label="Position"
          value={position}
          onChange={(event) => edit((v) => setPosition(v as Position))(event.target.value)}
        >
          {(Object.keys(POSITIONS) as Position[]).map((key) => (
            <option key={key} value={key}>
              {POSITIONS[key]}
            </option>
          ))}
        </Select>
        <Input
          id="watermark-color"
          label="Colour"
          type="color"
          className="h-11 w-full cursor-pointer"
          value={color}
          onChange={(event) => edit(setColor)(event.target.value)}
        />
      </div>
      <div className="ni-workspace__actions">
        <Button
          variant="primary"
          loading={busy}
          disabled={!file || Object.keys(problems).length > 0}
          onClick={() => void apply()}
        >
          Add watermark
        </Button>
      </div>
      {busy && <Progress value={progress} label="Adding the watermark" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {output && (
        <>
          {output.type !== output.asked && (
            <Alert tone="info" title="Saved as PNG">
              This browser cannot write {INPUT_TYPES[output.asked].label}, so the picture was saved
              as PNG instead.
            </Alert>
          )}
          <FileResultList label="Your picture">
            <FileResult
              name={output.name}
              meta={`${output.width} × ${output.height} pixels, ${formatSize(output.blob.size)}`}
              previewSrc={output.url}
              previewAlt={`Preview of ${output.name}`}
              state="done"
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
          <img
            src={output.url}
            alt={`${output.name} with the watermark`}
            className="max-h-96 w-auto max-w-full rounded-xl border border-border"
          />
        </>
      )}
    </>
  );
}

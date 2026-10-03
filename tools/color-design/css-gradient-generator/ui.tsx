import { Button, Input, Select, Textarea } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  KIND_LABELS,
  KINDS,
  type Kind,
  LIMITS,
  normalizeHex,
  run,
  SHAPES,
  type Shape,
  type Stop,
} from "./logic";

// The workspace of CSS Gradient Generator: the type, the angle or shape, then one row per colour
// stop (a picker, a HEX field and a position). The preview and the CSS follow every change; an
// invalid field shows why and the preview keeps the last valid gradient.

const COPIED_MESSAGE_MS = 3000;
const START: Stop[] = [
  { color: "#3b82f6", position: 0 },
  { color: "#ff8800", position: 100 },
];
const START_CSS = "background-image: linear-gradient(90deg, #3b82f6 0%, #ff8800 100%);";
const START_VALUE = "linear-gradient(90deg, #3b82f6 0%, #ff8800 100%)";

export default function ToolUi() {
  const [kind, setKind] = useState<Kind>("linear");
  const [angle, setAngle] = useState("90");
  const [shape, setShape] = useState<Shape>("circle");
  const [stops, setStops] = useState<Array<{ color: string; position: string }>>(() =>
    START.map((stop) => ({ color: stop.color, position: String(stop.position) })),
  );
  const lastGood = useRef({ css: START_CSS, value: START_VALUE });
  const [message, setMessage] = useState("");

  const result = run({
    kind,
    angle: angle.trim() === "" ? Number.NaN : Number(angle),
    shape,
    stops: stops.map((stop) => ({
      color: stop.color,
      position: stop.position.trim() === "" ? Number.NaN : Number(stop.position),
    })),
  });

  if (result.ok) lastGood.current = { css: result.css, value: result.value };
  const shown = lastGood.current;

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const edit = (index: number, change: Partial<{ color: string; position: string }>) =>
    setStops((list) => list.map((stop, i) => (i === index ? { ...stop, ...change } : stop)));

  const add = () =>
    setStops((list) => {
      if (list.length >= LIMITS.maxStops) return list;
      const last = list[list.length - 1];
      return [...list, { color: last?.color ?? "#000000", position: "100" }];
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.css);
      setMessage("CSS copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the CSS and copy it.");
    }
  };

  return (
    <>
      <div
        id="gradient-preview"
        role="img"
        aria-label={`Preview of ${shown.value}`}
        className="h-40 rounded-xl border border-border"
        style={{ backgroundImage: shown.value }}
      />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="gradient-kind"
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
        >
          {KINDS.map((key) => (
            <option key={key} value={key}>
              {KIND_LABELS[key]}
            </option>
          ))}
        </Select>
        {kind === "radial" ? (
          <Select
            id="gradient-shape"
            label="Shape"
            value={shape}
            onChange={(event) => setShape(event.target.value as Shape)}
          >
            {SHAPES.map((key) => (
              <option key={key} value={key}>
                {key === "circle" ? "Circle" : "Ellipse"}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            id="gradient-angle"
            label={kind === "linear" ? "Angle (degrees)" : "Start angle (degrees)"}
            type="number"
            inputMode="decimal"
            min={0}
            max={360}
            hint="0 to 360"
            value={angle}
            onChange={(event) => setAngle(event.target.value)}
          />
        )}
      </div>
      <section aria-labelledby="gradient-stops" className="grid gap-3">
        <h3 id="gradient-stops" className="text-lg">
          Colour stops
        </h3>
        {stops.map((stop, index) => {
          const hex = normalizeHex(stop.color);
          const number = index + 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: stops have no identity but their place
            <div key={index} className="flex flex-wrap items-end gap-3">
              <Input
                id={`gradient-pick-${number}`}
                type="color"
                label={`Stop ${number} picker`}
                className="h-11 w-12 cursor-pointer"
                value={hex ?? "#000000"}
                onChange={(event) => edit(index, { color: event.target.value })}
              />
              <div className="min-w-0 flex-1">
                <Input
                  id={`gradient-color-${number}`}
                  label={`Stop ${number} colour`}
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                  value={stop.color}
                  onChange={(event) => edit(index, { color: event.target.value })}
                />
              </div>
              <div className="w-28">
                <Input
                  id={`gradient-position-${number}`}
                  label={`Stop ${number} position (%)`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  value={stop.position}
                  onChange={(event) => edit(index, { position: event.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={stops.length <= LIMITS.minStops}
                aria-label={`Remove stop ${number}`}
                onClick={() => setStops((list) => list.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={stops.length >= LIMITS.maxStops}
            onClick={add}
          >
            Add stop
          </Button>
        </div>
      </section>
      {!result.ok && (
        <p id="gradient-error" className="text-sm text-danger-text" role="alert">
          {result.error}
        </p>
      )}
      <Textarea
        id="gradient-css"
        label="CSS"
        className="font-mono"
        readOnly
        rows={3}
        value={shown.css}
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" onClick={() => void copy()}>
          Copy CSS
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

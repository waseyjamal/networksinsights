import { Button, Input, Switch, Textarea } from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_LAYER,
  GLASS_BLUR,
  GLASS_LAYERS,
  type Layer,
  MAX_LAYERS,
  RANGES,
  run,
} from "./logic";

// The workspace of Box Shadow Generator: one group of fields per layer, the glass card switch and
// preset, a live preview on a patterned backdrop (so the glass blur shows) and the CSS to copy. An
// invalid field shows why and the preview keeps the last valid shadow.

const COPIED_MESSAGE_MS = 3000;
const START_CSS = "box-shadow: 0px 4px 12px 0px rgba(0, 0, 0, 0.25);";

type Draft = Record<"x" | "y" | "blur" | "spread" | "opacity", string> & {
  color: string;
  inset: boolean;
};

const toDraft = (layer: Layer): Draft => ({
  x: String(layer.x),
  y: String(layer.y),
  blur: String(layer.blur),
  spread: String(layer.spread),
  opacity: String(layer.opacity),
  color: layer.color,
  inset: layer.inset,
});

const GLASS_STYLE = {
  backgroundColor: "rgba(255, 255, 255, 0.15)",
  backdropFilter: `blur(${GLASS_BLUR}px)`,
  WebkitBackdropFilter: `blur(${GLASS_BLUR}px)`,
  border: "1px solid rgba(255, 255, 255, 0.3)",
} as const;

const num = (text: string) => (text.trim() === "" ? Number.NaN : Number(text));

const NUMBER_FIELDS = [
  ["x", "Horizontal offset (px)", RANGES.offset],
  ["y", "Vertical offset (px)", RANGES.offset],
  ["blur", "Blur (px)", RANGES.blur],
  ["spread", "Spread (px)", RANGES.spread],
  ["opacity", "Opacity (%)", RANGES.opacity],
] as const;

export default function ToolUi() {
  const [layers, setLayers] = useState<Draft[]>(() => [toDraft(DEFAULT_LAYER)]);
  const [glass, setGlass] = useState(false);
  const [message, setMessage] = useState("");

  const result = run({
    glass,
    layers: layers.map((layer) => ({
      x: num(layer.x),
      y: num(layer.y),
      blur: num(layer.blur),
      spread: num(layer.spread),
      opacity: num(layer.opacity),
      color: layer.color,
      inset: layer.inset,
    })),
  });
  const lastGood = useRef({ css: START_CSS, shadow: "0px 4px 12px 0px rgba(0, 0, 0, 0.25)" });
  if (result.ok) lastGood.current = { css: result.css, shadow: result.shadow };
  const shown = lastGood.current;

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const edit = (index: number, change: Partial<Draft>) =>
    setLayers((list) => list.map((layer, i) => (i === index ? { ...layer, ...change } : layer)));

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
      <div className="grid place-items-center rounded-xl border border-border bg-[repeating-linear-gradient(45deg,var(--color-brand-soft)_0_16px,var(--color-surface-sunken)_16px_32px)] p-10">
        <div
          id="shadow-preview"
          role="img"
          aria-label={`Preview of the shadow ${shown.shadow}${glass ? " on a glass card" : ""}`}
          className={glass ? "h-32 w-48 rounded-xl" : "h-32 w-48 rounded-xl bg-surface"}
          // The glass card is drawn with the same values the CSS box gives the visitor.
          style={glass ? { boxShadow: shown.shadow, ...GLASS_STYLE } : { boxShadow: shown.shadow }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          id="shadow-glass"
          label="Glass card (backdrop blur)"
          checked={glass}
          onChange={(event) => setGlass(event.target.checked)}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setLayers(GLASS_LAYERS.map(toDraft));
            setGlass(true);
          }}
        >
          Glass card preset
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLayers([toDraft(DEFAULT_LAYER)]);
            setGlass(false);
          }}
        >
          Reset
        </Button>
      </div>
      {layers.map((layer, index) => {
        const number = index + 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: layers have no identity but their place
          <fieldset key={index} className="grid gap-3 rounded-xl border border-border p-4">
            <legend className="px-1 font-semibold">Layer {number}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {NUMBER_FIELDS.map(([key, label, range]) => (
                <Input
                  key={key}
                  id={`shadow-${key}-${number}`}
                  label={label}
                  type="number"
                  inputMode="numeric"
                  min={range.min}
                  max={range.max}
                  value={layer[key]}
                  onChange={(event) => edit(index, { [key]: event.target.value })}
                />
              ))}
              <Input
                id={`shadow-color-${number}`}
                label="Colour"
                type="color"
                className="h-11 w-full cursor-pointer"
                value={layer.color}
                onChange={(event) => edit(index, { color: event.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Switch
                id={`shadow-inset-${number}`}
                label="Inset"
                checked={layer.inset}
                onChange={(event) => edit(index, { inset: event.target.checked })}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={layers.length <= 1}
                aria-label={`Remove layer ${number}`}
                onClick={() => setLayers((list) => list.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          </fieldset>
        );
      })}
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={layers.length >= MAX_LAYERS}
          onClick={() => setLayers((list) => [...list, toDraft(DEFAULT_LAYER)])}
        >
          Add layer
        </Button>
      </div>
      {!result.ok && (
        <p id="shadow-error" className="text-sm text-danger-text" role="alert">
          {result.error}
        </p>
      )}
      <Textarea
        id="shadow-css"
        label="CSS"
        className="font-mono"
        readOnly
        rows={glass ? 6 : 3}
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

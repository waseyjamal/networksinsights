import { Button, Input } from "@ui";
import { useEffect, useState } from "react";
import { FORMAT_LABELS, FORMATS, type Format, formatAll, type Rgb, run, type Texts } from "./logic";

// The workspace of Color Converter: a preview swatch and a color picker, then one field each for
// HEX, RGB and HSL. Editing any field converts it on every keystroke and rewrites the other two;
// a field that cannot be read shows why and leaves the others at the last valid color. Nothing is
// sent anywhere: Copy writes only to the visitor's own clipboard.

/** How long the "Copied" message stays before it clears. */
const COPIED_MESSAGE_MS = 3000;

/** The color the page opens with, the one its Examples section converts. */
const START: Rgb = { r: 59, g: 130, b: 246 };

const HINTS: Readonly<Record<Format, string>> = {
  hex: "3 or 6 digits, such as #3b82f6 or #f80",
  rgb: "Red, green and blue from 0 to 255, such as rgb(59, 130, 246)",
  hsl: "Hue 0 to 360, saturation and lightness 0 to 100%, such as hsl(217, 91%, 60%)",
};

export default function ToolUi() {
  const [texts, setTexts] = useState<Texts>(() => formatAll(START));
  const [color, setColor] = useState<Texts>(() => formatAll(START));
  const [errors, setErrors] = useState<Partial<Record<Format, string>>>({});
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const edit = (format: Format, text: string) => {
    const result = run({ format, text });
    if (result.ok) {
      setTexts({ ...result.texts, [format]: text });
      setColor(result.texts);
      setErrors({});
    } else {
      setTexts((current) => ({ ...current, [format]: text }));
      setErrors({ [format]: result.error });
    }
  };

  const pick = (hex: string) => {
    const result = run({ format: "hex", text: hex });
    if (!result.ok) return;
    setTexts(result.texts);
    setColor(result.texts);
    setErrors({});
  };

  const copy = async (format: Format) => {
    try {
      await navigator.clipboard.writeText(color[format]);
      setMessage(`${FORMAT_LABELS[format]} copied to the clipboard.`);
    } catch {
      setMessage("Your browser did not allow copying. Select the value and copy it.");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <div
          id="color-swatch"
          role="img"
          aria-label={`Preview of the color ${color.hex}`}
          className="h-16 min-w-0 flex-1 rounded-xl border border-border"
          style={{ backgroundColor: color.hex }}
        />
        <div>
          <Input
            id="color-picker"
            type="color"
            label="Picker"
            className="h-12 w-12 cursor-pointer"
            value={color.hex}
            onChange={(event) => pick(event.target.value)}
          />
        </div>
      </div>
      <section aria-labelledby="color-formats" className="grid gap-4">
        <h3 id="color-formats" className="sr-only">
          Formats
        </h3>
        {FORMATS.map((format) => (
          <div key={format} className="grid gap-1">
            {/* The label shares its line with Copy, so the button sits level whatever the
                message under the field. */}
            <div className="flex items-center gap-2">
              <label className="ni-field__label flex-1" htmlFor={`color-${format}`}>
                {FORMAT_LABELS[format]}
              </label>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Copy ${FORMAT_LABELS[format]}`}
                onClick={() => void copy(format)}
              >
                Copy
              </Button>
            </div>
            <Input
              id={`color-${format}`}
              hint={errors[format] ? undefined : HINTS[format]}
              error={errors[format]}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono"
              value={texts[format]}
              onChange={(event) => edit(format, event.target.value)}
            />
          </div>
        ))}
      </section>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

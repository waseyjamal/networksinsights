import { Alert, Button, DataTable, Input, StatGrid } from "@ui";
import { useState } from "react";
import { formatHex, parseHex, run } from "./logic";

// The workspace of Contrast Checker: a text color and a background color, each a HEX code with a
// color picker, a preview of text on that background, the contrast ratio and a pass or fail for
// each WCAG 2.2 criterion. The page opens on the example of its Examples section. A code that
// cannot be read says why under its box. Nothing is sent anywhere.

const COLUMNS = ["Criterion", "Needs", "Result"] as const;

/** The code a picker shows: the color in the box, or black while the box cannot be read. */
function pickerValue(text: string, field: "foreground" | "background"): string {
  const parsed = parseHex(text, field);
  return typeof parsed === "string" ? "#000000" : formatHex(parsed);
}

export default function ToolUi() {
  const [foreground, setForeground] = useState("#767676");
  const [background, setBackground] = useState("#ffffff");

  const result = run({ foreground, background });
  const error = (field: "foreground" | "background") =>
    !result.ok && result.field === field ? result.error : undefined;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Input
              id="cc-foreground"
              label="Text color"
              hint="3 or 6 digits, such as #767676"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono"
              value={foreground}
              error={error("foreground")}
              onChange={(event) => setForeground(event.target.value)}
            />
          </div>
          <Input
            id="cc-foreground-picker"
            type="color"
            label="Pick"
            className="h-12 w-12 cursor-pointer"
            value={pickerValue(foreground, "foreground")}
            onChange={(event) => setForeground(event.target.value)}
          />
        </div>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Input
              id="cc-background"
              label="Background color"
              hint="3 or 6 digits, such as #ffffff"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="font-mono"
              value={background}
              error={error("background")}
              onChange={(event) => setBackground(event.target.value)}
            />
          </div>
          <Input
            id="cc-background-picker"
            type="color"
            label="Pick"
            className="h-12 w-12 cursor-pointer"
            value={pickerValue(background, "background")}
            onChange={(event) => setBackground(event.target.value)}
          />
        </div>
      </div>
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          onClick={() => {
            setForeground(background);
            setBackground(foreground);
          }}
        >
          Swap colors
        </Button>
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <div
              id="cc-preview"
              className="grid gap-1 rounded-xl border border-border p-4"
              style={{ backgroundColor: result.background, color: result.foreground }}
            >
              <p className="text-base">Normal text sample: the quick brown fox.</p>
              <p className="text-2xl font-bold">Large text sample</p>
            </div>
            <StatGrid items={[{ id: "ratio", label: "Contrast ratio", value: result.shown }]} />
            <DataTable
              id="cc-results"
              label="Result for each criterion"
              columns={COLUMNS}
              rows={result.checks.map((check) => [
                check.label,
                `${check.required}:1`,
                check.passes ? "Pass" : "Fail",
              ])}
            />
          </>
        ) : (
          <Alert tone="info">Fix the color marked above to see the contrast.</Alert>
        )}
      </div>
    </>
  );
}

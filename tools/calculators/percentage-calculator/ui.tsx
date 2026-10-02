import { Alert, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { FIELD_LABELS, MODE_LABELS, MODES, type Mode, type Operation, run } from "./logic";

// The workspace of Percentage Calculator: pick one of four questions, type two numbers, and the
// answer follows on every keystroke. The page opens on the first example of its Examples section.
// A box that cannot be read says why under that box. Nothing is sent anywhere.

export default function ToolUi() {
  const [mode, setMode] = useState<Mode>("of");
  const [operation, setOperation] = useState<Operation>("add");
  const [a, setA] = useState("15");
  const [b, setB] = useState("80");

  const result = run({ mode, a, b, operation });
  const labels = FIELD_LABELS[mode];

  return (
    <>
      <Select
        id="pc-mode"
        label="What do you want to know?"
        value={mode}
        onChange={(event) => setMode(event.target.value as Mode)}
      >
        {MODES.map((value) => (
          <option key={value} value={value}>
            {MODE_LABELS[value]}
          </option>
        ))}
      </Select>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="pc-a"
          label={labels.a}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={a}
          error={!result.ok && result.field === "a" ? result.error : undefined}
          onChange={(event) => setA(event.target.value)}
        />
        <Input
          id="pc-b"
          label={labels.b}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={b}
          error={!result.ok && result.field === "b" ? result.error : undefined}
          onChange={(event) => setB(event.target.value)}
        />
      </div>
      {mode === "addSub" && (
        <Select
          id="pc-operation"
          label="Add or subtract?"
          value={operation}
          onChange={(event) => setOperation(event.target.value as Operation)}
        >
          <option value="add">Add the percent</option>
          <option value="subtract">Subtract the percent</option>
        </Select>
      )}
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                { id: "result", label: "Result", value: result.text },
                ...result.extras.map((extra, index) => ({
                  id: `extra-${index}`,
                  label: extra.label,
                  value: extra.value,
                })),
              ]}
            />
            <p id="pc-sentence" className="text-fg">
              {result.sentence}
            </p>
            <p className="text-sm text-fg-muted">
              Worked as: <span className="font-mono">{result.working}</span>
            </p>
          </>
        ) : (
          <Alert tone="info">Fix the box marked above to see the result.</Alert>
        )}
      </div>
    </>
  );
}

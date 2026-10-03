import { Alert, Button, Input, Select } from "@ui";
import { useState } from "react";
import { GROUP_LABELS, GROUPS, type Group, run, SIGNIFICANT, UNITS } from "./logic";

// The workspace of Unit Converter: the kind of unit, the value, the unit to convert from and to,
// and a swap button. The result follows on every change, worked out exactly and rounded only to
// show. The page opens on the example of its Examples section. Nothing is sent anywhere.

/** The pair of units each kind opens on. */
const DEFAULTS: Readonly<Record<Group, [string, string]>> = {
  length: ["km", "mi"],
  weight: ["kg", "lb"],
  temperature: ["c", "f"],
  area: ["m2", "ft2"],
  volume: ["l", "usgal"],
  speed: ["kmh", "mph"],
  data: ["GB", "GiB"],
  time: ["h", "min"],
};

export default function ToolUi() {
  const [group, setGroup] = useState<Group>("length");
  const [value, setValue] = useState("1");
  const [from, setFrom] = useState("km");
  const [to, setTo] = useState("mi");

  const result = run({ group, value, from, to });
  const label = (id: string) => UNITS[group].find((unit) => unit.id === id)?.label ?? "";

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Select
          id="unit-group"
          label="Kind of unit"
          value={group}
          onChange={(event) => {
            const next = event.target.value as Group;
            setGroup(next);
            setFrom(DEFAULTS[next][0]);
            setTo(DEFAULTS[next][1]);
          }}
        >
          {GROUPS.map((item) => (
            <option key={item} value={item}>
              {GROUP_LABELS[item]}
            </option>
          ))}
        </Select>
        <Input
          id="unit-value"
          label="Value"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          error={result.ok ? undefined : result.error}
          onChange={(event) => setValue(event.target.value)}
        />
        <Select id="unit-from" label="From" value={from} onChange={(e) => setFrom(e.target.value)}>
          {UNITS[group].map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.label}
            </option>
          ))}
        </Select>
        <Select id="unit-to" label="To" value={to} onChange={(e) => setTo(e.target.value)}>
          {UNITS[group].map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="ni-workspace__actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          Swap units
        </Button>
      </div>
      <div aria-live="polite" className="grid gap-2">
        {result.ok ? (
          <>
            <p className="text-lg">
              <span id="unit-result" className="font-mono font-semibold">
                {result.value}
              </span>{" "}
              <span>{label(to)}</span>
            </p>
            <p id="unit-note" className="text-sm text-fg-muted">
              {result.exact ? "Exact." : `Rounded to ${SIGNIFICANT} significant digits.`}
            </p>
          </>
        ) : (
          <Alert tone="info">Fix the value above to see the result.</Alert>
        )}
      </div>
    </>
  );
}

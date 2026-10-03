import { Alert, Button, Input, StatGrid } from "@ui";
import { useState } from "react";
import { formatMoney, type Mode, run, SLABS, SLABS_CHECKED } from "./logic";

// The workspace of GST Calculator: the amount, the rate (typed, or one of the slab buttons) and
// whether to add GST or remove it. The base, the GST, its CGST and SGST halves and the total follow
// on every change. The page opens on the example of its Examples section. Nothing is sent anywhere.

const MODE_LABELS: Readonly<Record<Mode, string>> = {
  add: "Add GST",
  remove: "Remove GST",
};

export default function ToolUi() {
  const [amount, setAmount] = useState("10000");
  const [rate, setRate] = useState("18");
  const [mode, setMode] = useState<Mode>("add");

  const result = run({ amount, rate, mode });
  const error = (field: "amount" | "rate") =>
    !result.ok && result.field === field ? result.error : undefined;

  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">The amount</legend>
        <div className="ni-workspace__actions">
          {(["add", "remove"] as const).map((item) => (
            <Button
              key={item}
              variant={item === mode ? "primary" : "secondary"}
              size="sm"
              aria-pressed={item === mode}
              onClick={() => setMode(item)}
            >
              {MODE_LABELS[item]}
            </Button>
          ))}
        </div>
      </fieldset>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="gst-amount"
          label={mode === "add" ? "Amount before GST" : "Amount including GST"}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={amount}
          error={error("amount")}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          id="gst-rate"
          label="GST rate (%)"
          hint={`Slabs checked on ${SLABS_CHECKED}. Confirm the rate for your item.`}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={rate}
          error={error("rate")}
          onChange={(event) => setRate(event.target.value)}
        />
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Quick rates</legend>
        <div className="ni-workspace__actions">
          {SLABS.map((slab) => (
            <Button
              key={slab}
              variant={slab === rate.trim() ? "primary" : "secondary"}
              size="sm"
              aria-pressed={slab === rate.trim()}
              onClick={() => setRate(slab)}
            >
              {`${slab}%`}
            </Button>
          ))}
        </div>
      </fieldset>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <StatGrid
            items={[
              { id: "base", label: "Base amount", value: formatMoney(result.base) },
              { id: "gst", label: "GST", value: formatMoney(result.gst) },
              { id: "cgst", label: "CGST (half)", value: formatMoney(result.cgst) },
              { id: "sgst", label: "SGST (half)", value: formatMoney(result.sgst) },
              { id: "total", label: "Total", value: formatMoney(result.total) },
            ]}
          />
        ) : (
          <Alert tone="info">Fix the box marked above to see the GST.</Alert>
        )}
      </div>
    </>
  );
}

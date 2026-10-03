import { Alert, DataTable, Input, StatGrid } from "@ui";
import { useState } from "react";
import { type Field, formatMoney, run } from "./logic";

// The workspace of SIP Calculator: the monthly investment, the expected yearly return and the
// number of years. The invested amount, the estimated returns, the total value and the
// year-by-year table follow on every keystroke. The page opens on the example of its Examples
// section. Nothing is sent anywhere.

const COLUMNS = ["Year", "Invested", "Returns", "Value"] as const;

export default function ToolUi() {
  const [amount, setAmount] = useState("5000");
  const [rate, setRate] = useState("12");
  const [years, setYears] = useState("10");

  const result = run({ amount, rate, years });
  const error = (field: Field) => (!result.ok && result.field === field ? result.error : undefined);

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Input
          id="sip-amount"
          label="Monthly investment"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={amount}
          error={error("amount")}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          id="sip-rate"
          label="Expected yearly return (%)"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={rate}
          error={error("rate")}
          onChange={(event) => setRate(event.target.value)}
        />
        <Input
          id="sip-years"
          label="Years"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={years}
          error={error("years")}
          onChange={(event) => setYears(event.target.value)}
        />
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                { id: "invested", label: "Invested amount", value: formatMoney(result.invested) },
                { id: "returns", label: "Estimated returns", value: formatMoney(result.returns) },
                { id: "total", label: "Total value", value: formatMoney(result.total) },
              ]}
            />
            <DataTable
              id="sip-table"
              label="Year-by-year value"
              columns={COLUMNS}
              rows={result.table.map((row) => [
                String(row.year),
                formatMoney(row.invested),
                formatMoney(row.returns),
                formatMoney(row.value),
              ])}
            />
          </>
        ) : (
          <Alert tone="info">Fix the box marked above to see the estimate.</Alert>
        )}
      </div>
    </>
  );
}

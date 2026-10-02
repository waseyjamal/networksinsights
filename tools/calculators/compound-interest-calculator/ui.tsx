import { Alert, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { FREQUENCIES, FREQUENCY_LABELS, type Frequency, formatMoney, run } from "./logic";

// The workspace of Compound Interest Calculator: a starting amount, a yearly rate, a number of
// years, how often interest is added and an optional regular deposit. The end balance, the interest
// and the year-by-year table follow on every keystroke. The page opens on the example of its
// Examples section. Nothing is sent anywhere.

const COLUMNS = ["Year", "Start balance", "Deposits", "Interest", "End balance"] as const;

export default function ToolUi() {
  const [principal, setPrincipal] = useState("10000");
  const [rate, setRate] = useState("5");
  const [years, setYears] = useState("10");
  const [frequency, setFrequency] = useState<Frequency>("12");
  const [deposit, setDeposit] = useState("");

  const result = run({ principal, rate, years, frequency, deposit });
  const error = (field: "principal" | "rate" | "years" | "deposit") =>
    !result.ok && result.field === field ? result.error : undefined;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="ci-principal"
          label="Starting amount"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={principal}
          error={error("principal")}
          onChange={(event) => setPrincipal(event.target.value)}
        />
        <Input
          id="ci-rate"
          label="Yearly interest rate (%)"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={rate}
          error={error("rate")}
          onChange={(event) => setRate(event.target.value)}
        />
        <Input
          id="ci-years"
          label="Years"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={years}
          error={error("years")}
          onChange={(event) => setYears(event.target.value)}
        />
        <Select
          id="ci-frequency"
          label="Interest is added"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as Frequency)}
        >
          {FREQUENCIES.map((value) => (
            <option key={value} value={value}>
              {FREQUENCY_LABELS[value]}
            </option>
          ))}
        </Select>
        <Input
          id="ci-deposit"
          label="Regular deposit (optional)"
          hint="Added at the end of every period above"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={deposit}
          error={error("deposit")}
          onChange={(event) => setDeposit(event.target.value)}
        />
      </div>
      <Alert tone="info">
        This is a calculation from the numbers you enter, with a rate that never changes. It is not
        a forecast and not financial advice.
      </Alert>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                { id: "end", label: "End balance", value: formatMoney(result.endBalance) },
                { id: "interest", label: "Interest earned", value: formatMoney(result.interest) },
                {
                  id: "contributed",
                  label: "Total put in",
                  value: formatMoney(result.contributed),
                },
              ]}
            />
            <DataTable
              id="ci-years-table"
              label="Year-by-year balance"
              columns={COLUMNS}
              rows={result.years.map((row) => [
                String(row.year),
                formatMoney(row.start),
                formatMoney(row.deposits),
                formatMoney(row.interest),
                formatMoney(row.end),
              ])}
            />
          </>
        ) : (
          <Alert tone="info">Fix the box marked above to see the balance.</Alert>
        )}
      </div>
    </>
  );
}

import { Alert, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { type Compounding, type Field, formatMoney, run, type Unit } from "./logic";

// The workspace of FD Calculator: the deposit, the yearly rate, the tenure in years, months or days
// and the compounding. The maturity amount, the interest and the year-by-year table follow on every
// change. The page opens on the example of its Examples section. Nothing is sent anywhere.

const COLUMNS = ["Year", "Interest so far", "Value"] as const;

export default function ToolUi() {
  const [amount, setAmount] = useState("100000");
  const [rate, setRate] = useState("7");
  const [tenure, setTenure] = useState("5");
  const [unit, setUnit] = useState<Unit>("years");
  const [compounding, setCompounding] = useState<Compounding>("quarterly");

  const result = run({ amount, rate, tenure, unit, compounding });
  const error = (field: Field) => (!result.ok && result.field === field ? result.error : undefined);

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="fd-amount"
          label="Deposit amount"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={amount}
          error={error("amount")}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          id="fd-rate"
          label="Yearly interest rate (%)"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={rate}
          error={error("rate")}
          onChange={(event) => setRate(event.target.value)}
        />
        <Input
          id="fd-tenure"
          label="Tenure"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={tenure}
          error={error("tenure")}
          onChange={(event) => setTenure(event.target.value)}
        />
        <Select
          id="fd-unit"
          label="Tenure in"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
        >
          <option value="years">Years</option>
          <option value="months">Months</option>
          <option value="days">Days</option>
        </Select>
        <Select
          id="fd-compounding"
          label="Interest"
          value={compounding}
          onChange={(event) => setCompounding(event.target.value as Compounding)}
        >
          <option value="monthly">Compounded monthly</option>
          <option value="quarterly">Compounded quarterly</option>
          <option value="half-yearly">Compounded half-yearly</option>
          <option value="yearly">Compounded yearly</option>
          <option value="simple">Simple interest at maturity</option>
        </Select>
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                { id: "maturity", label: "Maturity amount", value: formatMoney(result.maturity) },
                { id: "interest", label: "Interest earned", value: formatMoney(result.interest) },
              ]}
            />
            <DataTable
              id="fd-table"
              label="Year-by-year value"
              columns={COLUMNS}
              rows={result.table.map((row) => [
                row.label,
                formatMoney(row.interest),
                formatMoney(row.value),
              ])}
            />
          </>
        ) : (
          <Alert tone="info">Fix the box marked above to see the maturity amount.</Alert>
        )}
      </div>
    </>
  );
}

import { Alert, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { formatMoney, run, type Unit } from "./logic";

// The workspace of EMI Calculator: the loan amount, the yearly rate and the tenure in years or
// months. The monthly instalment, the totals and the month-by-month schedule follow on every
// keystroke. The page opens on the example of its Examples section. Nothing is sent anywhere.

const COLUMNS = ["Month", "EMI", "Principal", "Interest", "Balance"] as const;

export default function ToolUi() {
  const [amount, setAmount] = useState("500000");
  const [rate, setRate] = useState("8.5");
  const [tenure, setTenure] = useState("5");
  const [unit, setUnit] = useState<Unit>("years");

  const result = run({ amount, rate, tenure, unit });
  const error = (field: "amount" | "rate" | "tenure") =>
    !result.ok && result.field === field ? result.error : undefined;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="emi-amount"
          label="Loan amount"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={amount}
          error={error("amount")}
          onChange={(event) => setAmount(event.target.value)}
        />
        <Input
          id="emi-rate"
          label="Yearly interest rate (%)"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={rate}
          error={error("rate")}
          onChange={(event) => setRate(event.target.value)}
        />
        <Input
          id="emi-tenure"
          label="Tenure"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={tenure}
          error={error("tenure")}
          onChange={(event) => setTenure(event.target.value)}
        />
        <Select
          id="emi-unit"
          label="Tenure in"
          value={unit}
          onChange={(event) => setUnit(event.target.value as Unit)}
        >
          <option value="years">Years</option>
          <option value="months">Months</option>
        </Select>
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                { id: "emi", label: "Monthly EMI", value: formatMoney(result.emi) },
                {
                  id: "interest",
                  label: "Total interest",
                  value: formatMoney(result.totalInterest),
                },
                { id: "payment", label: "Total payment", value: formatMoney(result.totalPayment) },
                { id: "months", label: "Number of payments", value: String(result.months) },
              ]}
            />
            <DataTable
              id="emi-schedule"
              label="Month-by-month schedule"
              columns={COLUMNS}
              rows={result.schedule.map((row) => [
                String(row.month),
                formatMoney(row.payment),
                formatMoney(row.principal),
                formatMoney(row.interest),
                formatMoney(row.balance),
              ])}
            />
          </>
        ) : (
          <Alert tone="info">Fix the box marked above to see the EMI.</Alert>
        )}
      </div>
    </>
  );
}

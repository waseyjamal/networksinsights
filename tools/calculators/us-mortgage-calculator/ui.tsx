import { Alert, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { byYear, type Input as Fields, formatCents, formatMonths, run } from "./logic";

// The workspace of US Mortgage Calculator: price, down payment, rate and term, then the yearly
// property tax and insurance, the monthly PMI the lender quotes and any extra monthly payment.
// The monthly payment, the totals and the amortization table, by year or by month, follow on
// every change. The page opens on the example of its Examples section. Nothing is sent anywhere.

type Key = keyof Fields;

const FIELDS: ReadonlyArray<[Key, string, string | undefined]> = [
  ["price", "Home price ($)", undefined],
  ["down", "Down payment ($)", undefined],
  ["rate", "Interest rate (% a year)", "Fixed for the whole term"],
  ["years", "Term (years)", undefined],
  ["tax", "Property tax ($ a year)", "Optional"],
  ["insurance", "Homeowners insurance ($ a year)", "Optional"],
  ["pmi", "PMI ($ a month)", "Optional: the amount your lender quotes"],
  ["extra", "Extra payment toward principal ($ a month)", "Optional"],
];

export default function ToolUi() {
  const [values, setValues] = useState<Fields>({
    price: "250,000",
    down: "50,000",
    rate: "6",
    years: "30",
    tax: "3,000",
    insurance: "1,200",
    pmi: "",
    extra: "",
  });

  const [view, setView] = useState<"year" | "month">("year");

  const result = run(values);
  const error = (key: Key) => (!result.ok && result.field === key ? result.error : undefined);

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {FIELDS.map(([key, label, hint]) => (
          <Input
            key={key}
            id={`us-mortgage-${key}`}
            label={label}
            hint={hint}
            inputMode="decimal"
            autoComplete="off"
            value={values[key]}
            error={error(key)}
            onChange={(event) => setValues({ ...values, [key]: event.target.value })}
          />
        ))}
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                {
                  id: "monthly",
                  label: "Monthly payment",
                  value: formatCents(result.monthlyTotal),
                },
                {
                  id: "pi",
                  label: "Principal and interest",
                  value: formatCents(result.principalAndInterest),
                },
                { id: "tax", label: "Property tax", value: formatCents(result.monthlyTax) },
                {
                  id: "insurance",
                  label: "Insurance",
                  value: formatCents(result.monthlyInsurance),
                },
                { id: "pmi", label: "PMI", value: formatCents(result.pmi) },
                { id: "loan", label: "Loan amount", value: formatCents(result.loan) },
                {
                  id: "interest",
                  label: "Total interest",
                  value: formatCents(result.totalInterest),
                },
                {
                  id: "paid",
                  label: "Total of principal and interest payments",
                  value: formatCents(result.totalPaid),
                },
                { id: "payoff", label: "Paid off in", value: formatMonths(result.payments) },
              ]}
            />
            <Select
              id="us-mortgage-view"
              label="Amortization table"
              value={view}
              onChange={(event) => setView(event.target.value as "year" | "month")}
            >
              <option value="year">By year</option>
              <option value="month">By month</option>
            </Select>
            <DataTable
              id="us-mortgage-schedule"
              label={
                view === "year"
                  ? "Amortization table, year by year"
                  : "Amortization table, month by month"
              }
              columns={[
                view === "year" ? "Year" : "Month",
                "Paid",
                "Principal",
                "Interest",
                "Balance",
              ]}
              rows={(view === "year" ? byYear(result.schedule) : result.schedule).map((row) => [
                String(row.month),
                formatCents(row.paid),
                formatCents(row.principal),
                formatCents(row.interest),
                formatCents(row.balance),
              ])}
            />
          </>
        ) : (
          <Alert tone="info">Fix the box marked above to see the payment.</Alert>
        )}
      </div>
      <Alert tone="info" title="An estimate, not financial advice">
        PMI is not worked out here: enter the amount your lender quotes, and it is added to every
        month. Your lender's figures, fees and rounding can differ.
      </Alert>
    </>
  );
}

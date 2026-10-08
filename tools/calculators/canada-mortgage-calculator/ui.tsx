import { Alert, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { REVIEWED, SOURCES } from "./data";
import {
  FREQUENCIES,
  type Frequency,
  formatBasisPoints,
  formatCents,
  type PremiumPaid,
  run,
} from "./logic";

// The workspace of Canada Mortgage Payment Calculator: price, down payment, a fixed rate
// compounded half-yearly, amortization, payment frequency and how the CMHC premium is paid. The
// payment, the premium and a year-by-year summary follow on every change, with the official
// sources and the date we last reviewed them. The page opens on the example of its Examples
// section. Nothing is sent anywhere.

type Text = "price" | "down" | "rate" | "years";

export default function ToolUi() {
  const [values, setValues] = useState<Record<Text, string>>({
    price: "500,000",
    down: "25,000",
    rate: "5",
    years: "25",
  });
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [premiumPaid, setPremiumPaid] = useState<PremiumPaid>("added");

  const result = run({ ...values, frequency, premiumPaid });
  const error = (key: Text) => (!result.ok && result.field === key ? result.error : undefined);
  const field = (key: Text, label: string, hint?: string) => (
    <Input
      id={`canada-mortgage-${key}`}
      label={label}
      hint={hint}
      inputMode="decimal"
      autoComplete="off"
      value={values[key]}
      error={error(key)}
      onChange={(event) => setValues({ ...values, [key]: event.target.value })}
    />
  );

  return (
    <>
      <p className="text-sm text-fg-muted" id="canada-mortgage-rules">
        Fixed rate, compounded half-yearly. CMHC figures last reviewed on {REVIEWED}.
      </p>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {field("price", "Home price ($)")}
        {field("down", "Down payment ($)", "At least 5% of the first $500,000 and 10% of the rest")}
        {field("rate", "Interest rate (% a year)", "Fixed, compounded half-yearly")}
        {field("years", "Amortization (years)")}
        <Select
          id="canada-mortgage-frequency"
          label="Payment frequency"
          value={frequency}
          onChange={(event) => setFrequency(event.target.value as Frequency)}
        >
          {(Object.keys(FREQUENCIES) as Frequency[]).map((key) => (
            <option key={key} value={key}>
              {FREQUENCIES[key].label}
            </option>
          ))}
        </Select>
        <Select
          id="canada-mortgage-premium-paid"
          label="CMHC premium"
          hint="Only when the down payment is under 20%"
          value={premiumPaid}
          onChange={(event) => setPremiumPaid(event.target.value as PremiumPaid)}
        >
          <option value="added">Added to the mortgage</option>
          <option value="separate">Paid separately, as a lump sum</option>
        </Select>
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                {
                  id: "payment",
                  label: `Payment (${FREQUENCIES[frequency].label.split(" (")[0]?.toLowerCase()})`,
                  value: formatCents(result.payment),
                },
                { id: "mortgage", label: "Mortgage amount", value: formatCents(result.mortgage) },
                {
                  id: "ltv",
                  label: "Loan to value",
                  value: formatBasisPoints(result.ltvBasisPoints),
                },
                {
                  id: "premium",
                  label: "CMHC premium",
                  value: result.insured
                    ? `${formatCents(result.premium)} (${formatBasisPoints(result.premiumRate)})`
                    : "None: 20% or more down",
                },
                {
                  id: "minimum",
                  label: "Minimum down payment",
                  value: formatCents(result.minimumDown),
                },
                {
                  id: "interest",
                  label: "Total interest",
                  value: formatCents(result.totalInterest),
                },
                { id: "paid", label: "Total of payments", value: formatCents(result.totalPaid) },
                { id: "count", label: "Number of payments", value: String(result.payments) },
              ]}
            />
            <DataTable
              id="canada-mortgage-schedule"
              label="Year-by-year summary"
              columns={["Year", "Paid", "Principal", "Interest", "Balance"]}
              rows={result.years.map((row) => [
                String(row.year),
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
        This covers fixed-rate mortgages only, not variable rates. The premium uses CMHC's table for
        a traditional down payment; provincial sales tax on the premium in Quebec, Ontario and
        Saskatchewan is not included. Your lender gives the exact figures.
      </Alert>
      <div className="grid gap-1 text-sm" id="canada-mortgage-sources">
        <span className="font-medium">Official sources, last reviewed on {REVIEWED}:</span>
        <ul className="grid gap-1">
          {SOURCES.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noopener noreferrer" target="_blank">
                {source.name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

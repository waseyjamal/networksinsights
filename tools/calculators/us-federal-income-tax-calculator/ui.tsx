import { Alert, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { REVIEWED, SOURCES, STATUSES, type Status, TAX_YEAR } from "./data";
import {
  type BracketRow,
  DEDUCTIONS,
  type Deduction,
  formatBasisPoints,
  formatCents,
  formatDollars,
  run,
} from "./logic";

// The workspace of US Federal Income Tax Calculator: income, filing status and the deduction.
// The tax is worked out bracket by bracket on every change, with the IRS sources, the tax year
// and the date we last reviewed them. The page opens on the example of its Examples section.
// Nothing is sent anywhere.

function bracketLabel(row: BracketRow): string {
  if (row.to === null) return `Over ${formatDollars(row.from)}`;
  if (row.from === 0) return `Up to ${formatDollars(row.to)}`;
  return `${formatDollars(row.from)} to ${formatDollars(row.to)}`;
}

export default function ToolUi() {
  const [income, setIncome] = useState("100,000");
  const [status, setStatus] = useState<Status>("single");
  const [deduction, setDeduction] = useState<Deduction>("standard");
  const [itemized, setItemized] = useState("");

  const result = run({ income, status, deduction, itemized });
  const error = (field: "income" | "itemized") =>
    !result.ok && result.field === field ? result.error : undefined;

  return (
    <>
      <p className="text-sm text-fg-muted" id="us-tax-year">
        Tax year {TAX_YEAR} (returns filed in {TAX_YEAR + 1}), federal income tax only. Last
        reviewed on {REVIEWED}.
      </p>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="us-tax-income"
          label="Income for the year ($)"
          hint="Whole dollars, after any adjustments to income"
          inputMode="numeric"
          autoComplete="off"
          value={income}
          error={error("income")}
          onChange={(event) => setIncome(event.target.value)}
        />
        <Select
          id="us-tax-status"
          label="Filing status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status)}
        >
          {(Object.keys(STATUSES) as Status[]).map((key) => (
            <option key={key} value={key}>
              {STATUSES[key]}
            </option>
          ))}
        </Select>
        <Select
          id="us-tax-deduction"
          label="Deduction"
          value={deduction}
          onChange={(event) => setDeduction(event.target.value as Deduction)}
        >
          {(Object.keys(DEDUCTIONS) as Deduction[]).map((key) => (
            <option key={key} value={key}>
              {DEDUCTIONS[key]}
            </option>
          ))}
        </Select>
        {deduction === "itemized" && (
          <Input
            id="us-tax-itemized"
            label="Itemized deductions ($)"
            inputMode="numeric"
            autoComplete="off"
            value={itemized}
            error={error("itemized")}
            onChange={(event) => setItemized(event.target.value)}
          />
        )}
      </div>

      {result.ok && (
        <div aria-live="polite" className="grid gap-3">
          <StatGrid
            items={[
              {
                id: "tax",
                label: "Estimated federal income tax",
                value: formatCents(result.taxCents),
              },
              { id: "taxable", label: "Taxable income", value: formatDollars(result.taxable) },
              { id: "deduction", label: "Deduction taken", value: formatDollars(result.deduction) },
              { id: "marginal", label: "Marginal rate", value: `${result.marginalRate}%` },
              {
                id: "effective",
                label: "Share of the income",
                value: formatBasisPoints(result.effectiveBasisPoints),
              },
            ]}
          />
          <DataTable
            id="us-tax-brackets"
            label={`Tax bracket by bracket, tax year ${TAX_YEAR}`}
            columns={["Taxable income", "Rate", "Income in the bracket", "Tax"]}
            rows={result.brackets.map((row) => [
              bracketLabel(row),
              `${row.rate}%`,
              formatDollars(row.portion),
              formatCents(row.taxCents),
            ])}
          />
        </div>
      )}

      <Alert tone="info" title="An estimate, not tax advice">
        This is regular federal income tax on ordinary income only. It leaves out state and local
        income tax, Social Security and Medicare tax, tax credits, the additional standard deduction
        for age or blindness, capital gains and qualified dividend rates, the alternative minimum
        tax and every other deduction or surtax.
      </Alert>
      <div className="grid gap-1 text-sm" id="us-tax-sources">
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

import { Alert, DataTable, Input, Select } from "@ui";
import { useState } from "react";
import {
  AGES,
  type Age,
  CHECKED,
  formatRupees,
  type RegimeResult,
  run,
  SOURCES,
  TAX_YEAR,
} from "./logic";

// The workspace of Income Tax Calculator India: salary, other income, old-regime deductions and age.
// Both regimes are worked out on every change and shown side by side, with the official sources
// and the date they were checked. The page opens on the example of its Examples section. Nothing
// is sent anywhere.

const ROWS: ReadonlyArray<[string, (result: RegimeResult) => number]> = [
  ["Gross income", (r) => r.gross],
  ["Standard deduction on salary", (r) => r.standardDeduction],
  ["Other deductions (old regime only)", (r) => r.deductions],
  ["Taxable income", (r) => r.taxable],
  ["Tax on the slabs", (r) => r.slabTax],
  ["Rebate (section 156)", (r) => r.rebate],
  ["Surcharge", (r) => r.surcharge],
  ["Health and Education Cess (4%)", (r) => r.cess],
  ["Estimated tax", (r) => r.total],
];

export default function ToolUi() {
  const [salary, setSalary] = useState("15,00,000");
  const [other, setOther] = useState("0");
  const [deductions, setDeductions] = useState("2,00,000");
  const [age, setAge] = useState<Age>("below60");

  const result = run({ salary, other, deductions, age });
  const error = (field: "salary" | "other" | "deductions") =>
    !result.ok && result.field === field ? result.error : undefined;

  const money = (
    key: "salary" | "other" | "deductions",
    label: string,
    hint: string,
    value: string,
    set: (text: string) => void,
  ) => (
    <Input
      id={`income-tax-${key}`}
      label={label}
      hint={hint}
      inputMode="numeric"
      autoComplete="off"
      value={value}
      error={error(key)}
      onChange={(event) => set(event.target.value)}
    />
  );

  return (
    <>
      <p className="text-sm text-fg-muted" id="income-tax-year">
        Tax year {TAX_YEAR} (1 April 2026 to 31 March 2027), for a resident individual. Rules
        checked on {CHECKED}.
      </p>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {money(
          "salary",
          "Salary for the year (₹)",
          "Before the standard deduction",
          salary,
          setSalary,
        )}
        {money(
          "other",
          "Other income (₹)",
          "Interest, rent and the like, taxed at slab rates",
          other,
          setOther,
        )}
        {money(
          "deductions",
          "Deductions you claim in the old regime (₹)",
          "Such as section 80C; not checked against their limits",
          deductions,
          setDeductions,
        )}
        <Select
          id="income-tax-age"
          label="Age during the year"
          hint="Changes the old regime only"
          value={age}
          onChange={(event) => setAge(event.target.value as Age)}
        >
          {(Object.keys(AGES) as Age[]).map((key) => (
            <option key={key} value={key}>
              {AGES[key]}
            </option>
          ))}
        </Select>
      </div>

      {result.ok && (
        <>
          <p className="text-lg font-semibold" id="income-tax-summary" aria-live="polite">
            {result.lower === "same"
              ? `Both regimes give the same estimate: ${formatRupees(result.new.total)}.`
              : `The ${result.lower} regime gives less tax: ${formatRupees(result[result.lower].total)}, which is ${formatRupees(Math.abs(result.new.total - result.old.total))} less.`}
          </p>
          <DataTable
            id="income-tax-table"
            label={`Estimated income tax for tax year ${TAX_YEAR}`}
            columns={["", "New regime", "Old regime"]}
            rows={ROWS.map(([label, pick]) => [
              label,
              formatRupees(pick(result.new)),
              formatRupees(pick(result.old)),
            ])}
          />
        </>
      )}

      <Alert tone="info" title="An estimate, not tax advice">
        This follows only the rules listed below, for income taxed at slab rates. Your own case can
        differ, so check it with the official sources or a tax professional before you file or pay.
      </Alert>
      <div className="grid gap-1 text-sm" id="income-tax-sources">
        <span className="font-medium">Official sources, checked on {CHECKED}:</span>
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

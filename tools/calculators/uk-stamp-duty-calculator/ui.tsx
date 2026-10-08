import { Alert, Checkbox, DataTable, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { EFFECTIVE, REVIEWED, SOURCES } from "./data";
import {
  type BandRow,
  BUYERS,
  type Buyer,
  formatBasisPoints,
  formatPence,
  formatPounds,
  run,
} from "./logic";

// The workspace of UK Stamp Duty Calculator: the price, the kind of buyer and whether the buyer
// is a UK resident. The tax is worked out band by band on every change, with the gov.uk sources,
// the date the rates take effect and the date we read them. The page opens on gov.uk's own
// example of a £295,000 house. Nothing is sent anywhere.

const NOTES = {
  "first-time-over-limit":
    "First-time buyer relief does not apply above £500,000, so the standard rates are used.",
  "exempt-under-40k":
    "No SDLT is due, and no return is needed, on a freehold bought for less than £40,000.",
} as const;

function bandLabel(row: BandRow): string {
  if (row.to === null) return `Above ${formatPounds(row.from)}`;
  if (row.from === 0) return `Up to ${formatPounds(row.to)}`;
  return `${formatPounds(row.from + 1)} to ${formatPounds(row.to)}`;
}

export default function ToolUi() {
  const [price, setPrice] = useState("295,000");
  const [buyer, setBuyer] = useState<Buyer>("home");
  const [nonResident, setNonResident] = useState(false);

  const result = run({ price, buyer, nonResident });

  return (
    <>
      <p className="text-sm text-fg-muted" id="sdlt-year">
        Residential rates in England and Northern Ireland from {EFFECTIVE}. Last reviewed on{" "}
        {REVIEWED}.
      </p>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="sdlt-price"
          label="Purchase price (£)"
          hint="Whole pounds, for a freehold home"
          inputMode="numeric"
          autoComplete="off"
          value={price}
          error={result.ok ? undefined : result.error}
          onChange={(event) => setPrice(event.target.value)}
        />
        <Select
          id="sdlt-buyer"
          label="Who is buying"
          value={buyer}
          onChange={(event) => setBuyer(event.target.value as Buyer)}
        >
          {(Object.keys(BUYERS) as Buyer[]).map((key) => (
            <option key={key} value={key}>
              {BUYERS[key]}
            </option>
          ))}
        </Select>
        <Checkbox
          id="sdlt-non-resident"
          label="Not a UK resident (2% surcharge)"
          checked={nonResident}
          onChange={(event) => setNonResident(event.target.checked)}
        />
      </div>

      {result.ok && (
        <div aria-live="polite" className="grid gap-3">
          <StatGrid
            items={[
              { id: "total", label: "Estimated SDLT", value: formatPence(result.totalPence) },
              {
                id: "effective",
                label: "Share of the price",
                value: formatBasisPoints(result.effectiveBasisPoints),
              },
            ]}
          />
          {result.notes.map((note) => (
            <Alert key={note} tone="info">
              {NOTES[note]}
            </Alert>
          ))}
          <DataTable
            id="sdlt-bands"
            label="SDLT band by band"
            columns={["Band", "Rate", "Part of the price", "Tax"]}
            rows={result.bands.map((row) => [
              bandLabel(row),
              `${row.rate}%`,
              formatPounds(row.portion),
              formatPence(row.taxPence),
            ])}
          />
        </div>
      )}

      <Alert tone="info" title="An estimate, not tax advice">
        This covers residential freehold purchases in England and Northern Ireland only. It does not
        cover Scotland or Wales, leases and their rent, companies, trusts, shared ownership,
        mixed-use or non-residential property, or reliefs other than first-time buyer relief.
      </Alert>
      <div className="grid gap-1 text-sm" id="sdlt-sources">
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

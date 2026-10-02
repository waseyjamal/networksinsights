import { Alert, Checkbox, Input, StatGrid } from "@ui";
import { useState } from "react";
import { run } from "./logic";

// The workspace of Date Difference Calculator: a start date, an end date and the option to count
// the end date too. The page opens on the example of its Examples section. A date that is missing
// or not real says so under its box. Nothing is sent anywhere.

const number = new Intl.NumberFormat("en-US");
const plural = (n: number, word: string) => `${number.format(n)} ${word}${n === 1 ? "" : "s"}`;

export default function ToolUi() {
  const [start, setStart] = useState("2026-01-05");
  const [end, setEnd] = useState("2026-03-20");
  const [includeEnd, setIncludeEnd] = useState(false);

  const result = run({ start, end, includeEnd });
  const error = (field: "start" | "end") =>
    !result.ok && result.field === field ? result.error : undefined;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="dd-start"
          type="date"
          label="Start date"
          value={start}
          error={error("start")}
          onChange={(event) => setStart(event.target.value)}
        />
        <Input
          id="dd-end"
          type="date"
          label="End date"
          value={end}
          error={error("end")}
          onChange={(event) => setEnd(event.target.value)}
        />
      </div>
      <Checkbox
        id="dd-include"
        label="Include the end date in the count"
        checked={includeEnd}
        onChange={(event) => setIncludeEnd(event.target.checked)}
      />
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            {result.swapped && (
              <Alert id="dd-swapped" tone="info">
                The end date is before the start date, so the two dates were put in order.
              </Alert>
            )}
            <StatGrid
              items={[
                { id: "years", label: "Years", value: number.format(result.years) },
                { id: "months", label: "Months", value: String(result.months) },
                { id: "days", label: "Days", value: String(result.days) },
                { id: "total-days", label: "Total days", value: number.format(result.totalDays) },
                {
                  id: "weeks",
                  label: "Weeks",
                  value: `${plural(result.weeks, "week")} and ${plural(result.extraDays, "day")}`,
                },
                {
                  id: "weekdays",
                  label: "Weekdays (Mon to Fri)",
                  value: number.format(result.weekdays),
                },
              ]}
            />
          </>
        ) : (
          <Alert tone="info">Choose two real dates to see the difference.</Alert>
        )}
      </div>
    </>
  );
}

import { Alert, Button, DataTable, Input, Select, StatGrid } from "@ui";
import { useEffect, useState } from "react";
import { FALLBACK_ZONES, MAX_TARGETS, run, zoneList } from "./logic";

// The workspace of Time Zone Converter: a date and a time on the clock of a source zone, and up to
// ten zones to show it in. The zone list is the browser's own (Intl.supportedValuesOf); the static
// HTML and the first render use the fixed list, so server and browser agree, and the browser's list
// replaces it once the page has loaded. Daylight saving comes from the browser's time zone data.
// The page opens on the example of its Examples section. Nothing is sent anywhere.

const COLUMNS = ["Zone", "Date", "Time", "UTC offset"] as const;

const dayNote = (shift: number) => {
  if (shift === 0) return "";
  const days = Math.abs(shift);
  return ` (${shift > 0 ? "+" : "-"}${days} day${days === 1 ? "" : "s"})`;
};

export default function ToolUi() {
  const [date, setDate] = useState("2026-07-15");
  const [time, setTime] = useState("09:00");
  const [source, setSource] = useState("America/New_York");
  const [targets, setTargets] = useState<string[]>(["Europe/London", "Asia/Kolkata", "Asia/Tokyo"]);
  const [toAdd, setToAdd] = useState("");
  const [zones, setZones] = useState<string[]>(() => zoneList(null));
  const [fixedList, setFixedList] = useState(false);

  useEffect(() => {
    try {
      const supported =
        typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : null;
      setZones(zoneList(supported));
      setFixedList(supported === null);
    } catch {
      setZones(zoneList(null));
      setFixedList(true);
    }
  }, []);

  const result = run({ date, time, source, targets });
  const error = (field: "date" | "time" | "source" | "targets") =>
    !result.ok && result.field === field ? result.error : undefined;
  const sourceOptions = zones.includes(source) ? zones : [source, ...zones];
  const addable = zones.filter((zone) => !targets.includes(zone));

  const add = () => {
    if (toAdd === "" || targets.length >= MAX_TARGETS || targets.includes(toAdd)) return;
    setTargets([...targets, toAdd]);
    setToAdd("");
  };

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="tz-date"
          type="date"
          label="Date"
          value={date}
          error={error("date")}
          onChange={(event) => setDate(event.target.value)}
        />
        <Input
          id="tz-time"
          type="time"
          label="Time (24-hour)"
          value={time}
          error={error("time")}
          onChange={(event) => setTime(event.target.value)}
        />
      </div>
      <Select
        id="tz-source"
        label="From this time zone"
        value={source}
        error={error("source")}
        onChange={(event) => setSource(event.target.value)}
      >
        {sourceOptions.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </Select>
      {fixedList && (
        <Alert tone="info">
          This browser cannot list every time zone, so a fixed list of {FALLBACK_ZONES.length} zones
          is offered.
        </Alert>
      )}
      <fieldset className="grid gap-3">
        <legend className="ni-field__label mb-1">To these time zones</legend>
        <ul id="tz-targets" className="grid gap-2">
          {targets.map((zone) => (
            <li key={zone} className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm">{zone}</span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Remove ${zone}`}
                onClick={() => setTargets(targets.filter((item) => item !== zone))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        {error("targets") && (
          <p id="tz-targets-error" className="ni-field__error">
            {error("targets")}
          </p>
        )}
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <Select
            id="tz-add"
            label="Add a time zone"
            hint={`Up to ${MAX_TARGETS} zones`}
            value={toAdd}
            disabled={targets.length >= MAX_TARGETS}
            onChange={(event) => setToAdd(event.target.value)}
          >
            <option value="">Choose a zone</option>
            {addable.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            onClick={add}
            disabled={toAdd === "" || targets.length >= MAX_TARGETS}
          >
            Add zone
          </Button>
        </div>
      </fieldset>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            {result.notice && (
              <Alert id="tz-notice" tone="warning" data-kind={result.notice.kind}>
                {result.notice.text}
              </Alert>
            )}
            <StatGrid items={[{ id: "utc", label: "The same moment in UTC", value: result.utc }]} />
            <DataTable
              id="tz-results"
              label="The time in each zone"
              columns={COLUMNS}
              rows={[
                [
                  `${result.source.zone} (from)`,
                  result.source.date,
                  result.source.time,
                  result.source.offset,
                ],
                ...result.targets.map((row) => [
                  row.zone,
                  `${row.date}${dayNote(row.dayShift)}`,
                  row.time,
                  row.offset,
                ]),
              ]}
            />
          </>
        ) : (
          <Alert tone="info">Fix the field marked above to see the converted times.</Alert>
        )}
      </div>
    </>
  );
}

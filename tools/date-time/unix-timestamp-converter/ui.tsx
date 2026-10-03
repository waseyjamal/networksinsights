import { Alert, Button, Input, Select, StatGrid } from "@ui";
import { useEffect, useState } from "react";
import { toDate, toStamp, type Unit, type Zone, zoneText } from "./logic";

// The workspace of Unix Timestamp Converter, in two parts: a timestamp to a date (UTC, the device
// time zone and ISO 8601), and a date and time to a timestamp. The device time zone is read only in
// the browser, after the page has loaded, so the page built on the server never guesses it. The
// page opens on the example of its Examples section. Nothing is sent anywhere.

export default function ToolUi() {
  const [stamp, setStamp] = useState("1700000000");
  const [unit, setUnit] = useState<Unit>("auto");
  const [date, setDate] = useState("2023-11-14 22:13:20");
  const [zone, setZone] = useState<Zone>("utc");
  const [timeZone, setTimeZone] = useState<string | null>(null);

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const asDate = toDate(stamp, unit);
  const asStamp =
    zone === "local" && timeZone === null
      ? ({ ok: false, error: "Your time zone is read when the page has loaded." } as const)
      : toStamp(date, zone, timeZone ?? "UTC");

  return (
    <>
      <section aria-labelledby="ts-to-date" className="grid gap-4">
        <h3 id="ts-to-date" className="text-base font-semibold">
          Timestamp to date
        </h3>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Input
            id="ts-value"
            label="Unix timestamp"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={stamp}
            error={asDate.ok ? undefined : asDate.error}
            onChange={(event) => setStamp(event.target.value)}
          />
          <Select
            id="ts-unit"
            label="Read it as"
            value={unit}
            onChange={(event) => setUnit(event.target.value as Unit)}
          >
            <option value="auto">Detect seconds or milliseconds</option>
            <option value="seconds">Seconds</option>
            <option value="milliseconds">Milliseconds</option>
          </Select>
        </div>
        <div className="ni-workspace__actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStamp(String(Math.floor(Date.now() / 1000)));
              setUnit("auto");
            }}
          >
            Use the current time
          </Button>
        </div>
        <div aria-live="polite">
          {asDate.ok ? (
            <StatGrid
              items={[
                { id: "unit", label: "Read as", value: asDate.unit },
                { id: "utc", label: "UTC", value: asDate.utc },
                {
                  id: "local",
                  label: timeZone ? `Your time zone (${timeZone})` : "Your time zone",
                  value: timeZone
                    ? zoneText(asDate.ms, timeZone)
                    : "Shown once the page has loaded",
                },
                { id: "iso", label: "ISO 8601", value: asDate.iso },
              ]}
            />
          ) : (
            <Alert tone="info">Fix the timestamp above to see the date.</Alert>
          )}
        </div>
      </section>
      <section aria-labelledby="ts-to-stamp" className="grid gap-4">
        <h3 id="ts-to-stamp" className="text-base font-semibold">
          Date to timestamp
        </h3>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Input
            id="ts-date"
            label="Date and time"
            hint="YYYY-MM-DD HH:MM:SS, time optional"
            autoComplete="off"
            spellCheck={false}
            value={date}
            error={asStamp.ok ? undefined : asStamp.error}
            onChange={(event) => setDate(event.target.value)}
          />
          <Select
            id="ts-zone"
            label="The date is in"
            value={zone}
            onChange={(event) => setZone(event.target.value as Zone)}
          >
            <option value="utc">UTC</option>
            <option value="local">
              {timeZone ? `Your time zone (${timeZone})` : "Your time zone"}
            </option>
          </Select>
        </div>
        <div aria-live="polite">
          {asStamp.ok ? (
            <StatGrid
              items={[
                { id: "seconds", label: "Seconds", value: asStamp.seconds },
                { id: "milliseconds", label: "Milliseconds", value: asStamp.milliseconds },
                { id: "stamp-iso", label: "ISO 8601", value: asStamp.iso },
              ]}
            />
          ) : (
            <Alert tone="info">Fix the date above to see the timestamp.</Alert>
          )}
        </div>
      </section>
    </>
  );
}

import { Alert, Input, StatGrid } from "@ui";
import { useEffect, useState } from "react";
import { run } from "./logic";

// The workspace of Age Calculator: a birth date and the date to measure on. The second date is
// today's date on the visitor's device, filled in once the page has loaded (the HTML of the page
// is built ahead of time and cannot know today). Nothing is sent anywhere.

/** Today's date on this device, as YYYY-MM-DD, from the local calendar and not from UTC. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const number = new Intl.NumberFormat("en-US");

export default function ToolUi() {
  const [birth, setBirth] = useState("");
  const [on, setOn] = useState("");
  const [birthTouched, setBirthTouched] = useState(false);
  const [onTouched, setOnTouched] = useState(false);

  useEffect(() => {
    setOn(localToday());
  }, []);

  const result = run({ birth, on });
  const birthError =
    !result.ok && result.field === "birth" && birthTouched ? result.error : undefined;
  const onError = !result.ok && result.field === "on" && onTouched ? result.error : undefined;

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Input
          id="age-birth"
          type="date"
          label="Date of birth"
          value={birth}
          error={birthError}
          onChange={(event) => {
            setBirth(event.target.value);
            setBirthTouched(true);
          }}
        />
        <Input
          id="age-on"
          type="date"
          label="Age on"
          hint="Today's date on your device, unless you change it"
          value={on}
          error={onError}
          onChange={(event) => {
            setOn(event.target.value);
            setOnTouched(true);
          }}
        />
      </div>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <>
            <StatGrid
              items={[
                { id: "years", label: "Years", value: String(result.years) },
                { id: "months", label: "Months", value: String(result.months) },
                { id: "days", label: "Days", value: String(result.days) },
                { id: "total-days", label: "Total days", value: number.format(result.totalDays) },
              ]}
            />
            <p id="age-next" className="text-fg">
              {result.next.daysUntil === 0
                ? `The birthday is on this very date: ${result.next.text}, turning ${result.next.turns}.`
                : `Next birthday: ${result.next.text}, in ${plural(result.next.daysUntil, "day")}, turning ${result.next.turns}.`}
            </p>
          </>
        ) : (
          <Alert id="age-message" tone={birthError || onError ? "danger" : "info"}>
            {birthError || onError
              ? "Fix the date marked above."
              : "Choose a date of birth to see an age."}
          </Alert>
        )}
      </div>
    </>
  );
}

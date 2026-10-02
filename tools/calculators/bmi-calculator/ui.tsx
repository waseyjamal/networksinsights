import { Alert, Input, Select, StatGrid } from "@ui";
import { useState } from "react";
import { CATEGORY_LABELS, run, type System } from "./logic";

// The workspace of BMI Calculator: metric (centimetres and kilograms) or imperial (feet, inches and
// pounds). The index, its WHO adult category and the weight range of the normal band follow on
// every keystroke. The page opens on the example of its Examples section. Nothing is sent anywhere.

const oneDecimal = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function ToolUi() {
  const [system, setSystem] = useState<System>("metric");
  const [cm, setCm] = useState("175");
  const [feet, setFeet] = useState("5");
  const [inches, setInches] = useState("9");
  const [kg, setKg] = useState("70");
  const [lb, setLb] = useState("154");

  const metric = system === "metric";
  const result = run({ system, cm, feet, inches, weight: metric ? kg : lb });
  const error = (field: "cm" | "feet" | "inches" | "weight") =>
    !result.ok && result.field === field ? result.error : undefined;
  const unit = metric ? "kg" : "lb";

  return (
    <>
      <Select
        id="bmi-system"
        label="Units"
        value={system}
        onChange={(event) => setSystem(event.target.value as System)}
      >
        <option value="metric">Metric (cm, kg)</option>
        <option value="imperial">Imperial (ft, in, lb)</option>
      </Select>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {metric ? (
          <Input
            id="bmi-cm"
            label="Height (cm)"
            inputMode="decimal"
            autoComplete="off"
            value={cm}
            error={error("cm")}
            onChange={(event) => setCm(event.target.value)}
          />
        ) : (
          <div className="grid items-start gap-4 grid-cols-2">
            <Input
              id="bmi-feet"
              label="Height (ft)"
              inputMode="decimal"
              autoComplete="off"
              value={feet}
              error={error("feet")}
              onChange={(event) => setFeet(event.target.value)}
            />
            <Input
              id="bmi-inches"
              label="and (in)"
              inputMode="decimal"
              autoComplete="off"
              value={inches}
              error={error("inches")}
              onChange={(event) => setInches(event.target.value)}
            />
          </div>
        )}
        <Input
          id="bmi-weight"
          label={metric ? "Weight (kg)" : "Weight (lb)"}
          inputMode="decimal"
          autoComplete="off"
          value={metric ? kg : lb}
          error={error("weight")}
          onChange={(event) => (metric ? setKg : setLb)(event.target.value)}
        />
      </div>
      <Alert tone="warning" title="Adults only. Not medical advice.">
        BMI ignores muscle and body build, so it can mislead for athletes, older people and anyone
        who is very muscular or very slight. Ask a health professional about your own health.
      </Alert>
      <div aria-live="polite" className="grid gap-3">
        {result.ok ? (
          <StatGrid
            items={[
              { id: "bmi", label: "BMI (kg/m²)", value: oneDecimal.format(result.bmi) },
              {
                id: "category",
                label: "WHO adult category",
                value: CATEGORY_LABELS[result.category],
              },
              {
                id: "range",
                label: `Normal range at this height (${unit})`,
                value: `${oneDecimal.format(result.normalFrom)} to ${oneDecimal.format(result.normalTo)}`,
              },
            ]}
          />
        ) : (
          <Alert tone="info">Fix the box marked above to see the BMI.</Alert>
        )}
      </div>
    </>
  );
}

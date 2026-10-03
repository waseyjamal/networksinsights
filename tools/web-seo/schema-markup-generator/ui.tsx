import { Badge, Button, Input, Select, Textarea } from "@ui";
import { useEffect, useState } from "react";
import {
  AVAILABILITY,
  FIELDS,
  type FieldSpec,
  LIMITS,
  type Question,
  run,
  type SchemaType,
  TYPES,
} from "./logic";

// The workspace of Schema Markup Generator: a type, the fields of that type marked required or
// recommended, and the JSON-LD script to copy, rewritten on every keystroke.

const COPIED_MESSAGE_MS = 3000;

const START: Record<string, string> = {
  name: "Sourdough Loaf",
  price: "6.50",
  priceCurrency: "GBP",
  availability: "InStock",
  brand: "Example Bakery",
};

function Field({
  spec,
  value,
  error,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = `schema-${spec.key}`;
  const label = `${spec.label} (${spec.required ? "required" : "recommended"})`;
  if (spec.kind === "availability") {
    return (
      <Select
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Not given</option>
        {AVAILABILITY.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </Select>
    );
  }
  if (spec.kind === "urls") {
    return (
      <Textarea
        id={id}
        label={label}
        rows={2}
        spellCheck={false}
        hint={error ? undefined : spec.hint}
        error={error}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      id={id}
      label={label}
      type={spec.kind === "date" ? "date" : "text"}
      inputMode={spec.kind === "price" ? "decimal" : undefined}
      spellCheck={spec.kind === "text"}
      hint={error ? undefined : spec.hint}
      error={error}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function ToolUi() {
  const [type, setType] = useState<SchemaType>("Product");
  const [values, setValues] = useState<Record<string, string>>(START);
  const [questions, setQuestions] = useState<Question[]>([{ question: "", answer: "" }]);
  const [message, setMessage] = useState("");
  const result = run({ type, values, questions });
  const errors = result.ok ? {} : result.errors;

  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), COPIED_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const copy = async () => {
    if (!result.ok) return;
    try {
      await navigator.clipboard.writeText(result.script);
      setMessage("JSON-LD copied to the clipboard.");
    } catch {
      setMessage("Your browser did not allow copying. Select the code and copy it.");
    }
  };

  const editQuestion = (index: number, change: Partial<Question>) =>
    setQuestions((list) => list.map((pair, i) => (i === index ? { ...pair, ...change } : pair)));

  return (
    <>
      <Select
        id="schema-type"
        label="Type"
        value={type}
        onChange={(event) => {
          setType(event.target.value as SchemaType);
          setValues({});
        }}
      >
        {TYPES.map((key) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </Select>

      {type === "FAQPage" ? (
        <section aria-labelledby="schema-questions" className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="schema-questions" className="text-lg">
              Questions
            </h3>
            <Badge>Google no longer shows FAQ rich results</Badge>
          </div>
          {questions.map((pair, index) => {
            const number = index + 1;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: questions have no identity but their place
              <div key={index} className="grid gap-2 rounded-xl border border-border p-4">
                <Input
                  id={`schema-question-${number}`}
                  label={`Question ${number} (required)`}
                  value={pair.question}
                  error={errors[`question-${index}`]}
                  onChange={(event) => editQuestion(index, { question: event.target.value })}
                />
                <Textarea
                  id={`schema-answer-${number}`}
                  label={`Answer ${number} (required)`}
                  rows={2}
                  value={pair.answer}
                  error={errors[`answer-${index}`]}
                  onChange={(event) => editQuestion(index, { answer: event.target.value })}
                />
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={questions.length <= 1}
                    aria-label={`Remove question ${number}`}
                    onClick={() => setQuestions((list) => list.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
          <div>
            <Button
              variant="secondary"
              size="sm"
              disabled={questions.length >= LIMITS.maxQuestions}
              onClick={() => setQuestions((list) => [...list, { question: "", answer: "" }])}
            >
              Add question
            </Button>
          </div>
        </section>
      ) : (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {FIELDS[type].map((spec) => (
            <Field
              key={`${type}-${spec.key}`}
              spec={spec}
              value={values[spec.key] ?? ""}
              error={errors[spec.key]}
              onChange={(value) => setValues((current) => ({ ...current, [spec.key]: value }))}
            />
          ))}
        </div>
      )}

      <Textarea
        id="schema-output"
        label="JSON-LD for your page"
        className="font-mono"
        readOnly
        rows={12}
        value={result.ok ? result.script : ""}
        placeholder="Fill in the required fields to see the JSON-LD."
      />
      <div className="ni-workspace__actions">
        <Button variant="primary" disabled={!result.ok} onClick={() => void copy()}>
          Copy JSON-LD
        </Button>
      </div>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {message}
      </p>
    </>
  );
}

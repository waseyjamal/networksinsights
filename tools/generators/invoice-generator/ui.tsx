import {
  Button,
  createWorkerClient,
  FileResult,
  FileResultList,
  Input,
  Progress,
  Select,
  saveFile,
  Textarea,
  WorkerJobError,
} from "@ui";
import { useEffect, useRef, useState } from "react";
import {
  CURRENCIES,
  type Currency,
  check,
  formatMoney,
  type Invoice,
  type Item,
  type Job,
  type JobResult,
  LIMITS,
  MESSAGES,
  outputName,
} from "./logic";

// The workspace of Invoice Generator: the parties, the line items and the totals, worked out on
// every keystroke in whole cents by logic.ts, and the PDF, which worker.ts makes with pdf-lib when
// the visitor asks for it (ADR 0057).

const client = createWorkerClient<Job, JobResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);

const START: Invoice = {
  number: "INV-001",
  issued: "2026-10-03",
  due: "2026-11-02",
  seller: "Example Studio\n1 High Street\nLeeds",
  buyer: "Sample Shop Ltd\n2 Low Road\nYork",
  items: [
    { description: "Logo design", quantity: "1", price: "450.00" },
    { description: "Business cards (box of 100)", quantity: "3", price: "19.99" },
    { description: "Hourly support", quantity: "2.5", price: "40" },
  ],
  currency: "gbp",
  tax: "20",
  discountType: "percent",
  discount: "10",
  notes: "Payment by bank transfer within 30 days.",
};

const EMPTY_ITEM: Item = { description: "", quantity: "1", price: "" };

interface Output extends JobResult {
  name: string;
}

export default function ToolUi() {
  const [invoice, setInvoice] = useState<Invoice>(START);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState<Output | null>(null);
  // Set by Add item: once the new line is drawn, its description takes the focus and the page
  // scrolls just enough to show it with the button under it. Browsers without scroll anchoring (Safari) would otherwise push the button off the
  // screen with every line added.
  const focusItem = useRef(0);
  useEffect(() => {
    if (focusItem.current === 0 || focusItem.current !== invoice.items.length) return;
    focusItem.current = 0;
    document
      .getElementById(`invoice-item-${invoice.items.length}-description`)
      ?.focus({ preventScroll: true });
    document.getElementById("invoice-add-item")?.scrollIntoView({ block: "nearest" });
  }, [invoice.items.length]);
  const checked = check(invoice);
  const errors = checked.ok ? {} : checked.errors;

  const update = (change: Partial<Invoice>) => {
    setInvoice((current) => ({ ...current, ...change }));
    setOutput(null);
    setError("");
  };
  const editItem = (index: number, change: Partial<Item>) =>
    update({
      items: invoice.items.map((item, i) => (i === index ? { ...item, ...change } : item)),
    });

  const make = async () => {
    if (!checked.ok) return;
    setBusy(true);
    setError("");
    setOutput(null);
    try {
      const result = await client.run(invoice);
      setOutput({ ...result, name: outputName(invoice.number) });
    } catch (caught) {
      setError(
        caught instanceof WorkerJobError && caught.expected ? caught.message : MESSAGES.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const money = (value: bigint) => formatMoney(value, invoice.currency);

  return (
    <>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Input
          id="invoice-number"
          label="Invoice number"
          value={invoice.number}
          error={errors.number}
          onChange={(event) => update({ number: event.target.value })}
        />
        <Input
          id="invoice-issued"
          label="Invoice date"
          value={invoice.issued}
          error={errors.issued}
          onChange={(event) => update({ issued: event.target.value })}
        />
        <Input
          id="invoice-due"
          label="Due date (optional)"
          value={invoice.due}
          error={errors.due}
          onChange={(event) => update({ due: event.target.value })}
        />
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Textarea
          id="invoice-seller"
          label="From (your name and address)"
          rows={4}
          value={invoice.seller}
          error={errors.seller}
          onChange={(event) => update({ seller: event.target.value })}
        />
        <Textarea
          id="invoice-buyer"
          label="Bill to (customer name and address)"
          rows={4}
          value={invoice.buyer}
          error={errors.buyer}
          onChange={(event) => update({ buyer: event.target.value })}
        />
      </div>

      <section aria-labelledby="invoice-items" className="grid gap-3">
        <h3 id="invoice-items" className="text-lg">
          Line items
        </h3>
        {invoice.items.map((item, index) => {
          const n = index + 1;
          return (
            <div
              key={`item-${n}`}
              className="grid items-start gap-3 rounded-xl border border-border p-4 sm:grid-cols-[1fr_7rem_9rem_auto]"
            >
              <Input
                id={`invoice-item-${n}-description`}
                label={`Item ${n} description`}
                value={item.description}
                error={errors[`item-${n}-description`]}
                onChange={(event) => editItem(index, { description: event.target.value })}
              />
              <Input
                id={`invoice-item-${n}-quantity`}
                label="Quantity"
                inputMode="decimal"
                value={item.quantity}
                error={errors[`item-${n}-quantity`]}
                onChange={(event) => editItem(index, { quantity: event.target.value })}
              />
              <Input
                id={`invoice-item-${n}-price`}
                label="Unit price"
                inputMode="decimal"
                value={item.price}
                error={errors[`item-${n}-price`]}
                onChange={(event) => editItem(index, { price: event.target.value })}
              />
              <div className="grid gap-1 sm:pt-7">
                <span className="text-sm" id={`invoice-item-${n}-amount`}>
                  {checked.ok ? money(checked.totals.lines[index] ?? 0n) : "–"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={invoice.items.length <= 1}
                  aria-label={`Remove item ${n}`}
                  onClick={() => update({ items: invoice.items.filter((_, i) => i !== index) })}
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
        <div>
          <Button
            id="invoice-add-item"
            size="sm"
            variant="secondary"
            disabled={invoice.items.length >= LIMITS.maxItems}
            onClick={() => {
              focusItem.current = invoice.items.length + 1;
              update({ items: [...invoice.items, EMPTY_ITEM] });
            }}
          >
            Add item
          </Button>
        </div>
      </section>

      <div className="grid items-start gap-4 sm:grid-cols-4">
        <Select
          id="invoice-currency"
          label="Currency sign"
          value={invoice.currency}
          onChange={(event) => update({ currency: event.target.value as Currency })}
        >
          {(Object.keys(CURRENCIES) as Currency[]).map((key) => (
            <option key={key} value={key}>
              {CURRENCIES[key].label}
            </option>
          ))}
        </Select>
        <Select
          id="invoice-discount-type"
          label="Discount type"
          value={invoice.discountType}
          onChange={(event) =>
            update({ discountType: event.target.value as Invoice["discountType"] })
          }
        >
          <option value="percent">Percent</option>
          <option value="amount">Amount</option>
        </Select>
        <Input
          id="invoice-discount"
          label={invoice.discountType === "percent" ? "Discount (%)" : "Discount amount"}
          inputMode="decimal"
          value={invoice.discount}
          error={errors.discount}
          onChange={(event) => update({ discount: event.target.value })}
        />
        <Input
          id="invoice-tax"
          label="Tax (%)"
          inputMode="decimal"
          value={invoice.tax}
          error={errors.tax}
          onChange={(event) => update({ tax: event.target.value })}
        />
      </div>
      <Textarea
        id="invoice-notes"
        label="Notes (optional)"
        hint="Such as how to pay. Payment links are not added."
        rows={2}
        value={invoice.notes}
        error={errors.notes}
        onChange={(event) => update({ notes: event.target.value })}
      />

      {checked.ok ? (
        <dl
          id="invoice-totals"
          className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm sm:ml-auto sm:w-80"
        >
          <dt>Subtotal</dt>
          <dd className="text-right">{money(checked.totals.subtotal)}</dd>
          <dt>Discount</dt>
          <dd className="text-right">{money(-checked.totals.discount)}</dd>
          <dt>Tax</dt>
          <dd className="text-right">{money(checked.totals.tax)}</dd>
          <dt className="font-bold">Total</dt>
          <dd className="text-right font-bold">{money(checked.totals.total)}</dd>
        </dl>
      ) : (
        checked.problems.length > 0 && (
          <div id="invoice-problems" role="alert">
            <ul className="grid gap-1 text-sm text-danger-text">
              {checked.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )
      )}

      <div className="ni-workspace__actions">
        <Button variant="primary" loading={busy} disabled={!checked.ok} onClick={() => void make()}>
          Make PDF
        </Button>
      </div>
      {busy && <Progress label="Making the PDF" />}
      {error && (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
      {output && (
        <FileResultList label="Your invoice">
          <FileResult
            name={output.name}
            meta={`${output.pages} ${output.pages === 1 ? "page" : "pages"}`}
            state="done"
            icon="pdf"
            actions={
              <Button
                size="sm"
                aria-label={`Download ${output.name}`}
                onClick={() => saveFile(output.blob, output.name, { type: "application/pdf" })}
              >
                Download
              </Button>
            }
          />
        </FileResultList>
      )}
    </>
  );
}

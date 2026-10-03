import { describe, expect, it } from "vitest";
import {
  check,
  formatMoney,
  formatScaled,
  type Invoice,
  LIMITS,
  layout,
  MESSAGES,
  type Measure,
  mulDivRound,
  outputName,
  parseScaled,
  totals,
} from "./logic";

const measure: Measure = (text, size) => text.length * size * 0.5;

const invoice: Invoice = {
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

describe("money in whole cents", () => {
  it("reads amounts without floating point", () => {
    expect(parseScaled("0.1", 2)).toBe(10n);
    expect(parseScaled("19.99", 2)).toBe(1999n);
    expect(parseScaled("1,234.5", 2)).toBe(123450n);
    expect(parseScaled("2.5", 3)).toBe(2500n);
    expect(parseScaled("1.234", 2)).toBeNull();
    expect(parseScaled("-1", 2)).toBeNull();
    expect(parseScaled("1e3", 2)).toBeNull();
    expect(parseScaled("", 2)).toBeNull();
  });

  it("adds 0.1 and 0.2 to exactly 0.30, where floats give 0.30000000000000004", () => {
    const sums = totals(
      [
        { quantity: 1000n, price: 10n },
        { quantity: 1000n, price: 20n },
      ],
      "amount",
      0n,
      0n,
    );
    expect(formatScaled(sums.total)).toBe("0.30");
  });

  it("rounds half up", () => {
    expect(mulDivRound(1n, 5n, 10n)).toBe(1n);
    expect(mulDivRound(1n, 4n, 10n)).toBe(0n);
  });

  it("works out the example of the page", () => {
    const checked = check(invoice);
    if (!checked.ok) throw new Error(JSON.stringify(checked));
    const t = checked.totals;
    expect(t.lines.map((line) => formatScaled(line))).toEqual(["450.00", "59.97", "100.00"]);
    expect(formatScaled(t.subtotal)).toBe("609.97");
    expect(formatScaled(t.discount)).toBe("61.00");
    expect(formatScaled(t.taxable)).toBe("548.97");
    expect(formatScaled(t.tax)).toBe("109.79");
    expect(formatScaled(t.total)).toBe("658.76");
  });

  it("never lets an amount discount go below zero", () => {
    const sums = totals([{ quantity: 1000n, price: 500n }], "amount", 900n, 2000n);
    expect([sums.discount, sums.total]).toEqual([500n, 0n]);
  });

  it("stays exact for the largest quantity and price", () => {
    const sums = totals([{ quantity: 1_000_000_000n, price: 100_000_000_000n }], "amount", 0n, 0n);
    expect(formatScaled(sums.total)).toBe("1,000,000,000,000,000.00");
  });

  it("formats money with the chosen sign", () => {
    expect(formatMoney(123456n, "usd")).toBe("$1,234.56");
    expect(formatMoney(5n, "inr")).toBe("Rs 0.05");
    expect(formatMoney(-6100n, "eur")).toBe("-€61.00");
    expect(formatMoney(100n, "none")).toBe("1.00");
  });
});

describe("check", () => {
  it("needs the number, date, seller, buyer and a valid line", () => {
    const empty = check({ ...invoice, number: "", issued: "", seller: "", buyer: "" });
    expect(empty.ok === false && Object.keys(empty.errors)).toEqual([
      "number",
      "issued",
      "seller",
      "buyer",
    ]);
    const bad = check({ ...invoice, items: [{ description: "", quantity: "0", price: "1.234" }] });
    expect(bad.ok === false && bad.errors).toEqual({
      "item-1-description": "Describe the item.",
      "item-1-quantity": "A number above 0, with up to 3 decimals.",
      "item-1-price": "An amount with up to 2 decimals, such as 49.50.",
    });
    expect(check({ ...invoice, items: [] }).ok).toBe(false);
  });

  it("takes 50 items and the largest quantity and price, and refuses one more of each", () => {
    const item = { description: "x", quantity: "1", price: "1" };
    expect(
      check({ ...invoice, items: Array.from({ length: LIMITS.maxItems }, () => item) }).ok,
    ).toBe(true);
    expect(check({ ...invoice, items: Array.from({ length: 51 }, () => item) }).ok).toBe(false);
    const big = { description: "x", quantity: "1000000", price: "1000000000" };
    expect(check({ ...invoice, items: [big] }).ok).toBe(true);
    const more = check({
      ...invoice,
      items: [{ ...big, quantity: "1000000.001", price: "1000000000.01" }],
    });
    expect(more.ok === false && more.errors).toEqual({
      "item-1-quantity": "At most 1,000,000.",
      "item-1-price": "At most 1,000,000,000.",
    });
  });

  it("takes tax and percent discount up to 100, not over", () => {
    expect(check({ ...invoice, tax: "100", discount: "100" }).ok).toBe(true);
    const over = check({ ...invoice, tax: "100.01", discount: "100.01" });
    expect(over.ok === false && Object.keys(over.errors)).toEqual(["tax", "discount"]);
    expect(check({ ...invoice, tax: "", discount: "" }).ok).toBe(true);
  });

  it("names characters the fonts cannot draw", () => {
    const result = check({ ...invoice, buyer: "Łódź ₹" });
    expect(result.ok === false && result.problems).toEqual([MESSAGES.characters("Ł ź ₹")]);
  });

  it("takes fields of 500 characters and refuses 501", () => {
    expect(check({ ...invoice, notes: "a".repeat(500) }).ok).toBe(true);
    const over = check({ ...invoice, notes: "a".repeat(501) });
    expect(over.ok === false && over.errors.notes).toBe("Keep this under 500 characters.");
  });
});

describe("layout", () => {
  it("places the title, the items and the totals, and continues on a new page", () => {
    const checked = check(invoice);
    if (!checked.ok) throw new Error("expected totals");
    const [page] = layout(invoice, checked.totals, measure);
    const words = (page ?? []).flatMap((mark) => (mark.kind === "text" ? [mark.text] : []));
    expect(words[0]).toBe("INVOICE");
    expect(words).toContain("£658.76");
    expect(words).toContain("Discount (10%)");
    expect(words).toContain("-£61.00");
    expect(words).toContain("2.5");

    const many = {
      ...invoice,
      items: Array.from({ length: 50 }, () => ({
        description: "Logo design",
        quantity: "1",
        price: "450.00",
      })),
    };
    const checkedMany = check(many);
    if (!checkedMany.ok) throw new Error("expected totals");
    const pages = layout(many, checkedMany.totals, measure);
    expect(pages.length).toBeGreaterThan(1);
    for (const mark of pages.flat())
      if (mark.kind === "text") expect(mark.y).toBeGreaterThanOrEqual(50);
  });

  it("names the file after the number", () => {
    expect(outputName("INV-001")).toBe("invoice-INV-001.pdf");
    expect(outputName("2026 / 7")).toBe("invoice-2026-7.pdf");
    expect(outputName("")).toBe("invoice-draft.pdf");
  });
});

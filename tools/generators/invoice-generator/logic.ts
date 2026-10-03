// Pure logic of "Invoice Generator": reading amounts as whole numbers of the smallest currency unit,
// the totals in integer arithmetic (BigInt, so no float noise and no overflow), the characters the
// PDF fonts can draw, and the layout of the invoice as lines placed on pages. No DOM, no network
// and no top-level statements (docs/tool-contract.md). worker.ts draws it with pdf-lib.

export const LIMITS = {
  /** Our own caps. */
  maxItems: 50,
  maxField: 500,
  /** The largest quantity, and the largest unit price in whole currency units. */
  maxQuantity: 1_000_000,
  maxPrice: 1_000_000_000,
} as const;

/** Every amount has two decimal places; quantities up to three. */
export const MONEY_DECIMALS = 2;
export const QUANTITY_DECIMALS = 3;

/**
 * The currency signs offered. The rupee sign and others outside the Windows Western character set
 * cannot be drawn by the PDF's standard fonts, so letters stand in for them.
 */
export const CURRENCIES = {
  usd: { label: "$ (dollar)", prefix: "$" },
  eur: { label: "€ (euro)", prefix: "€" },
  gbp: { label: "£ (pound)", prefix: "£" },
  jpy: { label: "¥ (yen, yuan)", prefix: "¥" },
  inr: { label: "Rs (rupee)", prefix: "Rs " },
  chf: { label: "CHF (Swiss franc)", prefix: "CHF " },
  none: { label: "No sign", prefix: "" },
} as const;

export type Currency = keyof typeof CURRENCIES;

export interface Item {
  description: string;
  /** As typed: a number with up to 3 decimals. */
  quantity: string;
  /** As typed: an amount with up to 2 decimals. */
  price: string;
}

export interface Invoice {
  number: string;
  issued: string;
  due: string;
  seller: string;
  buyer: string;
  items: Item[];
  currency: Currency;
  /** Percent, as typed, up to 2 decimals. */
  tax: string;
  discountType: "percent" | "amount";
  /** Percent or amount, as typed. */
  discount: string;
  notes: string;
}

export type Input = Invoice;
export type Job = Invoice;

export interface JobResult {
  blob: Blob;
  pages: number;
}

export interface Totals {
  lines: bigint[];
  subtotal: bigint;
  discount: bigint;
  taxable: bigint;
  tax: bigint;
  total: bigint;
}

/** Messages by field id; line items use `item-1-quantity` and so on. */
export type Errors = Record<string, string> & {
  number?: string;
  issued?: string;
  due?: string;
  notes?: string;
  seller?: string;
  buyer?: string;
  tax?: string;
  discount?: string;
};

export type Checked =
  | { ok: true; totals: Totals }
  | { ok: false; errors: Errors; problems: string[] };

export const MESSAGES = {
  failed: "The PDF could not be made.",
  characters: (list: string) =>
    `The PDF fonts cannot draw these characters: ${list}. They cover English and most Western European letters only. Replace them.`,
} as const;

/**
 * Reads a non-negative decimal with at most `decimals` places as a whole number scaled by
 * 10^decimals: "12.5" with 2 places is 1250n. Commas between thousands are allowed. Anything else
 * is null; no floating point is involved.
 */
export function parseScaled(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(/,(?=\d{3}(\D|$))/g, "");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** a * b / divisor, rounded half up, for non-negative whole numbers. */
export function mulDivRound(a: bigint, b: bigint, divisor: bigint): bigint {
  return (a * b * 2n + divisor) / (divisor * 2n);
}

/** 123456n cents gives "1,234.56". */
export function formatScaled(value: bigint, decimals = MONEY_DECIMALS): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+$)/g, ",");
  const fraction = digits.slice(digits.length - decimals);
  return `${negative ? "-" : ""}${whole}${decimals > 0 ? `.${fraction}` : ""}`;
}

export function formatMoney(value: bigint, currency: Currency): string {
  const text = formatScaled(value < 0n ? -value : value);
  return `${value < 0n ? "-" : ""}${CURRENCIES[currency].prefix}${text}`;
}

/** The totals: each line rounded to the cent, then the discount, then tax on what is left. */
export function totals(
  items: ReadonlyArray<{ quantity: bigint; price: bigint }>,
  discountType: "percent" | "amount",
  discount: bigint,
  taxHundredths: bigint,
): Totals {
  const quantityScale = 10n ** BigInt(QUANTITY_DECIMALS);
  const lines = items.map((item) => mulDivRound(item.quantity, item.price, quantityScale));
  const subtotal = lines.reduce((sum, line) => sum + line, 0n);
  let off = discountType === "percent" ? mulDivRound(subtotal, discount, 10_000n) : discount;
  if (off > subtotal) off = subtotal;
  const taxable = subtotal - off;
  const tax = mulDivRound(taxable, taxHundredths, 10_000n);
  return { lines, subtotal, discount: off, taxable, tax, total: taxable + tax };
}

const WIN_ANSI_EXTRA = [
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
] as const;

/** Whether pdf-lib's standard fonts (WinAnsi, Windows-1252) can draw a character. */
export function isDrawable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x0a || code === 0x0d || code === 0x09) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return (WIN_ANSI_EXTRA as readonly number[]).includes(code);
}

function texts(invoice: Invoice): string[] {
  return [
    invoice.number,
    invoice.issued,
    invoice.due,
    invoice.seller,
    invoice.buyer,
    invoice.notes,
    ...invoice.items.map((item) => item.description),
  ];
}

/** Checks every field and, when all are valid, works out the totals. */
export function check(invoice: Invoice): Checked {
  const errors: Errors = {};
  const problems: string[] = [];
  if (invoice.number.trim() === "") errors.number = "Give the invoice a number.";
  if (invoice.issued.trim() === "") errors.issued = "Give the date of the invoice.";
  if (invoice.seller.trim() === "") errors.seller = "Give your name and address.";
  if (invoice.buyer.trim() === "") errors.buyer = "Give the customer's name and address.";
  for (const [key, value] of Object.entries({
    number: invoice.number,
    issued: invoice.issued,
    due: invoice.due,
    seller: invoice.seller,
    buyer: invoice.buyer,
    notes: invoice.notes,
  })) {
    if (value.length > LIMITS.maxField)
      errors[key] = `Keep this under ${LIMITS.maxField} characters.`;
  }
  if (invoice.items.length === 0) problems.push("Add at least one line item.");
  if (invoice.items.length > LIMITS.maxItems) {
    problems.push(`An invoice here has at most ${LIMITS.maxItems} line items.`);
  }
  const parsed: Array<{ quantity: bigint; price: bigint }> = [];
  for (const [index, item] of invoice.items.entries()) {
    const n = index + 1;
    if (item.description.trim() === "") errors[`item-${n}-description`] = "Describe the item.";
    else if (item.description.length > LIMITS.maxField) {
      errors[`item-${n}-description`] = `Keep this under ${LIMITS.maxField} characters.`;
    }
    const quantity = parseScaled(item.quantity, QUANTITY_DECIMALS);
    if (quantity === null || quantity === 0n) {
      errors[`item-${n}-quantity`] = "A number above 0, with up to 3 decimals.";
    } else if (quantity > BigInt(LIMITS.maxQuantity) * 1000n) {
      errors[`item-${n}-quantity`] = "At most 1,000,000.";
    }
    const price = parseScaled(item.price, MONEY_DECIMALS);
    if (price === null)
      errors[`item-${n}-price`] = "An amount with up to 2 decimals, such as 49.50.";
    else if (price > BigInt(LIMITS.maxPrice) * 100n) {
      errors[`item-${n}-price`] = "At most 1,000,000,000.";
    }
    parsed.push({ quantity: quantity ?? 0n, price: price ?? 0n });
  }
  const tax = invoice.tax.trim() === "" ? 0n : parseScaled(invoice.tax, 2);
  if (tax === null || tax > 10_000n) errors.tax = "A percent from 0 to 100, with up to 2 decimals.";
  const discount = invoice.discount.trim() === "" ? 0n : parseScaled(invoice.discount, 2);
  if (discount === null || (invoice.discountType === "percent" && discount > 10_000n)) {
    errors.discount =
      invoice.discountType === "percent"
        ? "A percent from 0 to 100, with up to 2 decimals."
        : "An amount with up to 2 decimals.";
  }
  const bad = new Set<string>();
  for (const text of texts(invoice)) for (const char of text) if (!isDrawable(char)) bad.add(char);
  if (bad.size > 0) problems.push(MESSAGES.characters([...bad].join(" ")));
  if (Object.keys(errors).length > 0 || problems.length > 0) return { ok: false, errors, problems };
  return {
    ok: true,
    totals: totals(parsed, invoice.discountType, discount ?? 0n, tax ?? 0n),
  };
}

export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "");
}

export type Measure = (text: string, size: number, bold: boolean) => number;

/** Breaks text into lines no wider than `width`; a word longer than a line is cut. */
export function wrap(text: string, width: number, size: number, bold: boolean, measure: Measure) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter((part) => part !== "")) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, size, bold) <= width) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    let rest = word;
    while (measure(rest, size, bold) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut), size, bold) > width) cut--;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) out.push(line);
  return out;
}

export type Mark =
  | { kind: "text"; text: string; x: number; y: number; size: number; bold: boolean }
  | { kind: "rule"; x1: number; x2: number; y: number };

/** A4 in points. */
export const PAGE = { width: 595.28, height: 841.89, margin: 50 } as const;

/**
 * Places the invoice on A4 pages: the title and number, the dates, the seller and the buyer side
 * by side, the table of items (continued on a new page when full), the totals and the notes.
 * Numbers are right-aligned in their columns.
 */
export function layout(invoice: Invoice, sums: Totals, measure: Measure): Mark[][] {
  const { width, height, margin } = PAGE;
  const right = width - margin;
  const pages: Mark[][] = [[]];
  let y = height - margin;
  const body = 10;
  const step = body * 1.4;
  const put = (mark: Mark) => pages[pages.length - 1]?.push(mark);
  const text = (value: string, x: number, size = body, bold = false) =>
    put({ kind: "text", text: value, x, y, size, bold });
  const textRight = (value: string, edge: number, size = body, bold = false) =>
    text(value, edge - measure(value, size, bold), size, bold);
  const room = (needed: number) => {
    if (y - needed >= margin) return;
    pages.push([]);
    y = height - margin;
  };

  y -= 22;
  text("INVOICE", margin, 22, true);
  textRight(invoice.number.trim(), right, 12, true);
  y -= step * 1.5;
  textRight(`Date: ${invoice.issued.trim()}`, right);
  if (invoice.due.trim()) {
    y -= step;
    textRight(`Due: ${invoice.due.trim()}`, right);
  }

  y -= step * 2;
  const half = (right - margin) / 2;
  const columns = [
    { title: "From", body: lines(invoice.seller), x: margin },
    { title: "Bill to", body: lines(invoice.buyer), x: margin + half + 10 },
  ];
  const top = y;
  let lowest = y;
  for (const column of columns) {
    y = top;
    text(column.title.toUpperCase(), column.x, 9, true);
    for (const row of column.body) {
      for (const piece of wrap(row, half - 10, body, false, measure)) {
        y -= step;
        text(piece, column.x, body);
      }
    }
    lowest = Math.min(lowest, y);
  }
  y = lowest - step * 2;

  const amountEdge = right;
  const priceEdge = right - 100;
  const quantityEdge = right - 190;
  const descriptionWidth = quantityEdge - 60 - margin;
  const header = () => {
    text("Description", margin, 9, true);
    textRight("Qty", quantityEdge, 9, true);
    textRight("Unit price", priceEdge, 9, true);
    textRight("Amount", amountEdge, 9, true);
    y -= 6;
    put({ kind: "rule", x1: margin, x2: right, y });
  };
  header();
  for (const [index, item] of invoice.items.entries()) {
    const pieces = wrap(item.description.trim(), descriptionWidth, body, false, measure);
    const needed = pieces.length * step + 4;
    if (y - needed < margin) {
      pages.push([]);
      y = height - margin - step;
      header();
    }
    y -= step;
    const quantity = parseScaled(item.quantity, QUANTITY_DECIMALS) ?? 0n;
    const price = parseScaled(item.price, MONEY_DECIMALS) ?? 0n;
    textRight(formatScaled(quantity, QUANTITY_DECIMALS).replace(/\.?0+$/, ""), quantityEdge);
    textRight(formatMoney(price, invoice.currency), priceEdge);
    textRight(formatMoney(sums.lines[index] ?? 0n, invoice.currency), amountEdge);
    for (const [i, piece] of pieces.entries()) {
      if (i > 0) y -= step;
      text(piece, margin);
    }
    y -= 4;
  }
  put({ kind: "rule", x1: margin, x2: right, y });

  const rows: Array<[string, bigint, boolean]> = [["Subtotal", sums.subtotal, false]];
  if (sums.discount > 0n) {
    const label =
      invoice.discountType === "percent" ? `Discount (${invoice.discount.trim()}%)` : "Discount";
    rows.push([label, -sums.discount, false]);
  }
  const taxText = invoice.tax.trim() || "0";
  rows.push([`Tax (${taxText}%)`, sums.tax, false], ["Total", sums.total, true]);
  room(rows.length * step + step);
  for (const [label, value, bold] of rows) {
    y -= step;
    textRight(label, priceEdge, body, bold);
    textRight(formatMoney(value, invoice.currency), amountEdge, body, bold);
  }

  const notes = lines(invoice.notes);
  if (notes.length > 0) {
    y -= step;
    room(step * 2);
    y -= step;
    text("NOTES", margin, 9, true);
    for (const row of notes) {
      for (const piece of wrap(row, right - margin, body, false, measure)) {
        room(step);
        y -= step;
        text(piece, margin);
      }
    }
  }
  return pages;
}

/** `INV-001` gives `invoice-INV-001.pdf`. */
export function outputName(number: string): string {
  const base = number
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `invoice-${base || "draft"}.pdf`;
}

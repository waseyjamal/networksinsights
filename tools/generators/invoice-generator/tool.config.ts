import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "invoice-generator",
  name: "Invoice Generator",
  category: "generators",
  summary:
    "Make a simple invoice with line items, tax and discount, totals worked out to the cent, and download it as a PDF.",
  tags: ["invoice", "billing", "pdf", "business"],
  produces: ["PDF"],
  runtime: "worker",
  status: "beta",
  input: z.object({
    number: z.string().min(1).max(500),
    issued: z.string().min(1).max(500),
    due: z.string().max(500),
    seller: z.string().min(1).max(500),
    buyer: z.string().min(1).max(500),
    items: z
      .array(
        z.object({ description: z.string().max(500), quantity: z.string(), price: z.string() }),
      )
      .min(1)
      .max(50),
    currency: z.enum(["usd", "eur", "gbp", "jpy", "inr", "chf", "none"]),
    tax: z.string(),
    discountType: z.enum(["percent", "amount"]),
    discount: z.string(),
    notes: z.string().max(500),
  }),
  related: ["resume-builder", "gst-calculator", "percentage-calculator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

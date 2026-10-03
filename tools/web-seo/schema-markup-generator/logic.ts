// Pure logic of "Schema Markup Generator": which fields each schema.org type has here, which are
// required, how they are checked, and the JSON-LD they make. No DOM, no network and no top-level
// statements (docs/tool-contract.md). The required and recommended fields follow Google Search
// Central's structured data pages for each type, read on 2026-10-03.

export const TYPES = ["Article", "FAQPage", "Product", "LocalBusiness", "Organization"] as const;
export type SchemaType = (typeof TYPES)[number];

export type FieldKind = "text" | "url" | "urls" | "date" | "price" | "currency" | "availability";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  hint?: string;
}

export const AVAILABILITY = ["InStock", "OutOfStock", "PreOrder", "BackOrder"] as const;

/** Our own caps, so a pasted page cannot freeze the form. */
export const LIMITS = { maxField: 2000, maxQuestions: 20 } as const;

export const FIELDS: Readonly<Record<Exclude<SchemaType, "FAQPage">, readonly FieldSpec[]>> = {
  Article: [
    { key: "headline", label: "Headline", kind: "text", required: false },
    {
      key: "image",
      label: "Image URLs",
      kind: "urls",
      required: false,
      hint: "One full URL per line.",
    },
    { key: "datePublished", label: "Date published", kind: "date", required: false },
    { key: "dateModified", label: "Date modified", kind: "date", required: false },
    { key: "authorName", label: "Author name", kind: "text", required: false },
    { key: "authorUrl", label: "Author page URL", kind: "url", required: false },
  ],
  Product: [
    { key: "name", label: "Product name", kind: "text", required: true },
    {
      key: "price",
      label: "Price",
      kind: "price",
      required: true,
      hint: "A number such as 19.99. The offer is what makes the product eligible here.",
    },
    {
      key: "priceCurrency",
      label: "Currency code",
      kind: "currency",
      required: false,
      hint: "Three letters, such as USD or EUR.",
    },
    { key: "availability", label: "Availability", kind: "availability", required: false },
    { key: "description", label: "Description", kind: "text", required: false },
    {
      key: "image",
      label: "Image URLs",
      kind: "urls",
      required: false,
      hint: "One full URL per line.",
    },
    { key: "brand", label: "Brand", kind: "text", required: false },
    { key: "sku", label: "SKU", kind: "text", required: false },
  ],
  LocalBusiness: [
    { key: "name", label: "Business name", kind: "text", required: true },
    { key: "streetAddress", label: "Street address", kind: "text", required: true },
    { key: "addressLocality", label: "Town or city", kind: "text", required: true },
    { key: "addressRegion", label: "Region or state", kind: "text", required: false },
    { key: "postalCode", label: "Postal code", kind: "text", required: false },
    {
      key: "addressCountry",
      label: "Country code",
      kind: "text",
      required: false,
      hint: "Two letters, such as GB or US.",
    },
    {
      key: "telephone",
      label: "Telephone",
      kind: "text",
      required: false,
      hint: "With the country code, such as +44 20 7946 0000.",
    },
    { key: "url", label: "Website URL", kind: "url", required: false },
    { key: "priceRange", label: "Price range", kind: "text", required: false, hint: "Such as $$." },
    {
      key: "image",
      label: "Image URLs",
      kind: "urls",
      required: false,
      hint: "One full URL per line.",
    },
  ],
  Organization: [
    {
      key: "name",
      label: "Organization name",
      kind: "text",
      required: true,
      hint: "Google lists no required field; this tool asks for a name, our own choice.",
    },
    { key: "url", label: "Website URL", kind: "url", required: false },
    { key: "logo", label: "Logo URL", kind: "url", required: false },
    { key: "description", label: "Description", kind: "text", required: false },
    { key: "email", label: "Email", kind: "text", required: false },
    { key: "telephone", label: "Telephone", kind: "text", required: false },
    {
      key: "sameAs",
      label: "Profile URLs (sameAs)",
      kind: "urls",
      required: false,
      hint: "One full URL per line, such as your social profiles.",
    },
  ],
};

export interface Question {
  question: string;
  answer: string;
}

/** The field values by key; the keys named here are the ones the code reads by name. */
export type Values = Record<string, string> & { image?: string; sameAs?: string };

/** Messages by field key; FAQ keys are `question-0`, `answer-0` and so on. */
export type Errors = Record<string, string> & {
  questions?: string;
  headline?: string;
  brand?: string;
};

export interface Input {
  type: SchemaType;
  values: Values;
  questions: Question[];
}

export type Result = { ok: true; json: string; script: string } | { ok: false; errors: Errors };

export function isUrl(text: string): boolean {
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]+\S*$/i.test(text);
}

/** A real calendar date written YYYY-MM-DD. */
export function isDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function check(spec: FieldSpec, raw: string): string | null {
  const value = raw.trim();
  if (raw.length > LIMITS.maxField) return `Keep this under ${LIMITS.maxField} characters.`;
  if (value === "") return spec.required ? `${spec.label} is required.` : null;
  switch (spec.kind) {
    case "url":
      return isUrl(value) ? null : "Use a full URL that starts with https:// or http://.";
    case "urls":
      return lines(value).every(isUrl)
        ? null
        : "Each line must be a full URL that starts with https:// or http://.";
    case "date":
      return isDate(value) ? null : "Use a real date written YYYY-MM-DD, such as 2026-10-03.";
    case "price":
      return /^\d+(\.\d+)?$/.test(value)
        ? null
        : "Use a number with a dot for decimals, such as 19.99.";
    case "currency":
      return /^[A-Za-z]{3}$/.test(value) ? null : "Use a three letter code, such as USD.";
    case "availability":
      return (AVAILABILITY as readonly string[]).includes(value) ? null : "Choose an availability.";
    default:
      return null;
  }
}

type Json = string | Json[] | { [key: string]: Json };

/** Leaves out empty values, so the output never holds a blank property. */
function compact(object: Record<string, Json | undefined>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === "undefined" || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 1) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function build(input: Input): Record<string, Json> {
  const v = (key: string) => (input.values[key] ?? "").trim();
  const images = lines(input.values.image ?? "");
  const image = images.length === 1 ? images[0] : images;
  const context = { "@context": "https://schema.org", "@type": input.type };
  switch (input.type) {
    case "Article":
      return compact({
        ...context,
        headline: v("headline"),
        image,
        datePublished: v("datePublished"),
        dateModified: v("dateModified"),
        author: v("authorName")
          ? compact({ "@type": "Person", name: v("authorName"), url: v("authorUrl") })
          : "",
      });
    case "FAQPage":
      return {
        ...context,
        mainEntity: input.questions.map((pair) => ({
          "@type": "Question",
          name: pair.question.trim(),
          acceptedAnswer: { "@type": "Answer", text: pair.answer.trim() },
        })),
      };
    case "Product":
      return compact({
        ...context,
        name: v("name"),
        description: v("description"),
        image,
        sku: v("sku"),
        brand: compact({ "@type": "Brand", name: v("brand") }),
        offers: compact({
          "@type": "Offer",
          price: v("price"),
          priceCurrency: v("priceCurrency").toUpperCase(),
          availability: v("availability") ? `https://schema.org/${v("availability")}` : "",
        }),
      });
    case "LocalBusiness":
      return compact({
        ...context,
        name: v("name"),
        image,
        address: compact({
          "@type": "PostalAddress",
          streetAddress: v("streetAddress"),
          addressLocality: v("addressLocality"),
          addressRegion: v("addressRegion"),
          postalCode: v("postalCode"),
          addressCountry: v("addressCountry").toUpperCase(),
        }),
        telephone: v("telephone"),
        url: v("url"),
        priceRange: v("priceRange"),
      });
    case "Organization":
      return compact({
        ...context,
        name: v("name"),
        url: v("url"),
        logo: v("logo"),
        description: v("description"),
        email: v("email"),
        telephone: v("telephone"),
        sameAs: lines(input.values.sameAs ?? ""),
      });
  }
}

export function run(input: Input): Result {
  const errors: Errors = {};
  if (input.type === "FAQPage") {
    if (input.questions.length < 1 || input.questions.length > LIMITS.maxQuestions) {
      errors.questions = `Add 1 to ${LIMITS.maxQuestions} questions.`;
    }
    for (const [index, pair] of input.questions.entries()) {
      for (const part of ["question", "answer"] as const) {
        const text = pair[part];
        if (text.length > LIMITS.maxField) {
          errors[`${part}-${index}`] = `Keep this under ${LIMITS.maxField} characters.`;
        } else if (text.trim() === "") {
          errors[`${part}-${index}`] =
            `Question ${index + 1} needs ${part === "question" ? "a question" : "an answer"}.`;
        }
      }
    }
  } else {
    for (const spec of FIELDS[input.type]) {
      const error = check(spec, input.values[spec.key] ?? "");
      if (error) errors[spec.key] = error;
    }
    if (
      input.type === "Article" &&
      FIELDS.Article.every((spec) => !input.values[spec.key]?.trim())
    ) {
      errors.headline = "Fill in at least one field; a headline is the usual start.";
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const json = JSON.stringify(build(input), null, 2);
  // "<" is written as its JSON escape, so a value holding "</script>" cannot end the script early.
  const safe = json.replace(/</g, `${String.fromCharCode(92)}u003c`);
  return {
    ok: true,
    json: safe,
    script: `<script type="application/ld+json">\n${safe}\n</script>`,
  };
}

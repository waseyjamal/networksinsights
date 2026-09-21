// Zod schemas for the JSON-LD the site emits (ADR 0039). They describe exactly the shapes in
// jsonld.ts, with no extra keys allowed, so a block that gains a property nobody meant to add
// fails a test. They are used by the unit tests, the build-output check and the browser tests.

import { z } from "zod";

const absoluteHttpsUrl = z
  .url({ protocol: /^https$/, hostname: /^networksinsights\.com$/ })
  .refine(
    (value) =>
      !value.includes("#") || value.endsWith("#organization") || value.endsWith("#website"),
    {
      error: "a URL with a fragment is only allowed for the organization and the website ids",
    },
  );

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listItem = z.strictObject({
  "@type": z.literal("ListItem"),
  position: z.int().positive(),
  name: z.string().min(1),
  item: absoluteHttpsUrl,
});

export const organizationSchema = z.strictObject({
  "@type": z.literal("Organization"),
  "@id": absoluteHttpsUrl,
  name: z.string().min(1),
  url: absoluteHttpsUrl,
  logo: absoluteHttpsUrl,
});

export const webSiteSchema = z.strictObject({
  "@type": z.literal("WebSite"),
  "@id": absoluteHttpsUrl,
  url: absoluteHttpsUrl,
  name: z.string().min(1),
  alternateName: z.string().min(1),
  description: z.string().min(1),
  inLanguage: z.literal("en"),
  publisher: z.strictObject({ "@id": absoluteHttpsUrl }),
});

export const breadcrumbListSchema = z.strictObject({
  "@type": z.literal("BreadcrumbList"),
  itemListElement: z
    .array(listItem)
    .min(2)
    .refine((items) => items.every((item, index) => item.position === index + 1), {
      error: "breadcrumb positions must count 1, 2, 3, …",
    }),
});

export const itemListSchema = z.strictObject({
  "@type": z.literal("ItemList"),
  itemListElement: z
    .array(
      z.strictObject({
        "@type": z.literal("ListItem"),
        position: z.int().positive(),
        name: z.string().min(1),
        url: absoluteHttpsUrl,
      }),
    )
    .min(1),
});

export const collectionPageSchema = z.strictObject({
  "@type": z.literal("CollectionPage"),
  url: absoluteHttpsUrl,
  name: z.string().min(1),
  description: z.string().min(1),
  inLanguage: z.literal("en"),
  mainEntity: itemListSchema.optional(),
});

/** The `applicationCategory` values of Google's software app documentation that we use. */
export const applicationCategorySchema = z.enum([
  "BusinessApplication",
  "DesignApplication",
  "DeveloperApplication",
  "MultimediaApplication",
  "ReferenceApplication",
  "UtilitiesApplication",
]);

export const webApplicationSchema = z.strictObject({
  "@type": z.literal("WebApplication"),
  name: z.string().min(1),
  url: absoluteHttpsUrl,
  description: z.string().min(1),
  applicationCategory: applicationCategorySchema,
  operatingSystem: z.literal("Any"),
  browserRequirements: z.literal("Requires JavaScript"),
  isAccessibleForFree: z.literal(true),
  inLanguage: z.literal("en"),
  offers: z.strictObject({
    "@type": z.literal("Offer"),
    price: z.literal("0"),
    priceCurrency: z.literal("USD"),
  }),
  dateModified: isoDate,
  publisher: z.strictObject({
    "@type": z.literal("Organization"),
    name: z.string().min(1),
    url: absoluteHttpsUrl,
  }),
});

export const faqPageSchema = z.strictObject({
  "@type": z.literal("FAQPage"),
  mainEntity: z
    .array(
      z.strictObject({
        "@type": z.literal("Question"),
        name: z.string().min(1),
        acceptedAnswer: z.strictObject({
          "@type": z.literal("Answer"),
          text: z.string().min(1),
        }),
      }),
    )
    .min(1),
});

export const jsonLdNodeSchema = z.discriminatedUnion("@type", [
  organizationSchema,
  webSiteSchema,
  breadcrumbListSchema,
  collectionPageSchema,
  webApplicationSchema,
  faqPageSchema,
]);

export const jsonLdDocumentSchema = z.strictObject({
  "@context": z.literal("https://schema.org"),
  "@graph": z.array(jsonLdNodeSchema).min(1),
});

export type ParsedJsonLd = z.infer<typeof jsonLdDocumentSchema>;

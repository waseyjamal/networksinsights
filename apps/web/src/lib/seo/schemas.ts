// Zod schemas for the JSON-LD the site emits (ADR 0039). They describe exactly the shapes in
// jsonld.ts, with no extra keys allowed, so a block that gains a property nobody meant to add
// fails a test. They are used by the unit tests, the build-output check and the browser tests.

import { z } from "zod";

const absoluteHttpsUrl = z
  .url({ protocol: /^https$/, hostname: /^networksinsights\.com$/ })
  .refine((value) => !value.includes("#"), {
    error: "a page URL has no fragment: only the node ids below have one",
  });

/** The three node ids of the site (jsonld.ts). Nothing else may be an `@id` or point at one. */
const organizationRef = z.strictObject({
  "@id": z.literal("https://networksinsights.com/#organization"),
});
const websiteId = z.literal("https://networksinsights.com/#website");
const founderId = z.literal("https://networksinsights.com/#founder");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listItem = z.strictObject({
  "@type": z.literal("ListItem"),
  position: z.int().positive(),
  name: z.string().min(1),
  item: absoluteHttpsUrl,
});

export const organizationSchema = z.strictObject({
  "@type": z.literal("Organization"),
  "@id": organizationRef.shape["@id"],
  name: z.string().min(1),
  url: absoluteHttpsUrl,
  logo: absoluteHttpsUrl,
  founder: z.strictObject({ "@id": founderId }),
});

/**
 * The founder: a name and the two profiles the About page links to, nothing else. A profile is not
 * on this site, so it is the one place an outside URL is allowed, and only these two.
 */
export const personSchema = z.strictObject({
  "@type": z.literal("Person"),
  "@id": founderId,
  name: z.string().min(1),
  sameAs: z
    .array(
      z.enum([
        "https://github.com/waseyjamal",
        "https://www.linkedin.com/in/wasey-jamal-472996253/",
      ]),
    )
    .min(1)
    .refine((urls) => new Set(urls).size === urls.length, { error: "sameAs repeats a profile" }),
});

export const aboutPageSchema = z.strictObject({
  "@type": z.literal("AboutPage"),
  url: absoluteHttpsUrl,
  name: z.string().min(1),
  description: z.string().min(1),
  inLanguage: z.literal("en"),
  about: organizationRef,
});

export const webSiteSchema = z.strictObject({
  "@type": z.literal("WebSite"),
  "@id": websiteId,
  url: absoluteHttpsUrl,
  name: z.string().min(1),
  alternateName: z.string().min(1),
  description: z.string().min(1),
  inLanguage: z.literal("en"),
  publisher: organizationRef,
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
  publisher: organizationRef,
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
  personSchema,
  aboutPageSchema,
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

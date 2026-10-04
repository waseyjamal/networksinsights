// The single source for the eleven tool categories (ADR 0030). The design system, the home
// page, the footer, the /tools page and the category pages are all generated from this list.
// The tool registry (Mission 8) builds on it.
//
// `id` is short and matches the --cat-* color tokens and the data-cat attribute
// (docs/design-system.md). `slug` is the flat, keyword-rich URL: /<slug>/. Slugs are reserved
// paths that no tool id may use.
//
// `intro` and `metaDescription` say what a category is for, never how many tools it has: the
// category page adds the real count from the registry (`categoryMetaDescription`).

import type { IconName } from "../components/ui/icons";
import { staticPagePaths } from "./site";

/**
 * The values Google's software app documentation accepts for `applicationCategory`. Every
 * category maps to one, so a tool page's structured data names its category the way Google asks.
 */
export type ApplicationCategory =
  | "BusinessApplication"
  | "DesignApplication"
  | "DeveloperApplication"
  | "MultimediaApplication"
  | "ReferenceApplication"
  | "UtilitiesApplication";

/**
 * The date the wording of the category pages last changed, as `YYYY-MM-DD`: the `lastmod` of a
 * category page that has no tool yet, and the floor for one that has (see `pageUpdated`, ADR 0040).
 */
export const categoriesUpdated = "2026-10-04";

export interface Category {
  id: string;
  /** Display name: tile title, H1 and page title. */
  name: string;
  /** URL segment. The page lives at /<slug>/. */
  slug: string;
  /** One line, shown on tiles and in lists. */
  description: string;
  /** Category accent token, without the leading "--": the icon chip tint (--cat-pdf, ...). */
  accent: `cat-${string}`;
  icon: IconName;
  /** The `applicationCategory` of a tool page's structured data (ADR 0039). */
  applicationCategory: ApplicationCategory;
  /** Two to three sentences for the category page. Unique per category. */
  intro: string;
  /** Meta description of the category page. Under 160 characters. */
  metaDescription: string;
}

/**
 * The meta description of a category page: what the category is for, then how many tools it has,
 * counted from the registry by the caller. A category with no tool says so instead of a number.
 */
export function categoryMetaDescription(
  category: Pick<Category, "metaDescription">,
  toolCount: number,
): string {
  if (toolCount === 0) return `${category.metaDescription} Coming soon to NetworksInsights.`;
  return `${category.metaDescription} ${toolCount} ${toolCount === 1 ? "tool" : "tools"} on NetworksInsights.`;
}

export const categories = [
  {
    id: "pdf",
    name: "PDF tools",
    slug: "pdf-tools",
    description: "Merge, split, compress and edit PDFs.",
    accent: "cat-pdf",
    icon: "pdf",
    applicationCategory: "UtilitiesApplication",
    intro:
      "For the small jobs PDFs always need: merging files, splitting out pages, shrinking a large document, rotating or editing. Where the browser can do the work, your file is processed on your device and never uploaded.",
    metaDescription:
      "Free PDF tools for merging, splitting, rotating, signing and converting PDF files, right in your browser.",
  },
  {
    id: "image",
    name: "Image tools",
    slug: "image-tools",
    description: "Resize, crop, convert and optimize.",
    accent: "cat-image",
    icon: "image",
    applicationCategory: "MultimediaApplication",
    intro:
      "Resize, crop, convert and compress pictures for the web, email or print. Most of these jobs are one file and a few settings, so they belong in a tab, not an installer. Where possible, images are processed on your device.",
    metaDescription:
      "Free image tools for resizing, cropping, converting and compressing pictures, right in your browser.",
  },
  {
    id: "video-audio",
    name: "Video and audio tools",
    slug: "video-audio-tools",
    description: "Compress, convert and extract.",
    accent: "cat-video-audio",
    icon: "video-audio",
    applicationCategory: "MultimediaApplication",
    intro:
      "Compress a clip, convert audio between formats, pull the sound out of a video or turn a moment into a GIF. Media files are large, so processing them on your own device avoids a slow upload. A tool will say plainly when a file has to leave your device.",
    metaDescription:
      "Free video and audio tools for compressing video, converting audio, extracting sound and making GIFs.",
  },
  {
    id: "text",
    name: "Text tools",
    slug: "text-tools",
    description: "Count, compare, clean and transform.",
    accent: "cat-text",
    icon: "text",
    applicationCategory: "UtilitiesApplication",
    intro:
      "Count words and characters, compare two versions of a text, clean up pasted content or change its case and format. These are quick jobs, so each tool aims to do one thing and show the result immediately.",
    metaDescription:
      "Free text tools for counting, comparing, cleaning and transforming text, right in your browser.",
  },
  {
    id: "calculators",
    name: "Calculators",
    slug: "calculators",
    description: "Quick answers for everyday math.",
    accent: "cat-calculators",
    icon: "calculators",
    applicationCategory: "UtilitiesApplication",
    intro:
      "Percentages, loans, fuel costs and other everyday arithmetic, worked out as you type. Each calculator should show its inputs and formula so you can check the answer instead of trusting it.",
    metaDescription: "Free online calculators for percentages, loans and other everyday math.",
  },
  {
    id: "converters",
    name: "Converters",
    slug: "converters",
    description: "Units, formats and encodings.",
    accent: "cat-converters",
    icon: "converters",
    applicationCategory: "UtilitiesApplication",
    intro:
      "Convert between units, number bases, encodings and data formats. When a conversion depends on outside data, such as an exchange rate, the tool will say where the numbers come from.",
    metaDescription: "Free online converters for units, number bases, encodings and data formats.",
  },
  {
    id: "generators",
    name: "Generators",
    slug: "generators",
    description: "Passwords, QR codes, placeholders and more.",
    accent: "cat-generators",
    icon: "generators",
    applicationCategory: "UtilitiesApplication",
    intro:
      "Create passwords, QR codes, placeholder text, random numbers and other things you would otherwise write by hand. Where randomness matters, as it does for passwords, tools use the browser's cryptographically secure random source.",
    metaDescription:
      "Free online generators for passwords, QR codes, placeholder text and random values.",
  },
  {
    id: "developer",
    name: "Developer tools",
    slug: "developer-tools",
    description: "Format, validate, test and debug.",
    accent: "cat-developer",
    icon: "developer",
    applicationCategory: "DeveloperApplication",
    intro:
      "Format and validate JSON, test regular expressions, decode tokens, encode and hash data. Small utilities for the moments when opening an editor or writing a script is more work than the task deserves.",
    metaDescription:
      "Free developer tools for formatting, validating, testing and debugging code and data.",
  },
  {
    id: "web-seo",
    name: "Web and SEO tools",
    slug: "web-seo-tools",
    description: "Meta tags, links, headers and audits.",
    accent: "cat-web-seo",
    icon: "web-seo",
    applicationCategory: "DeveloperApplication",
    intro:
      "Check meta tags, preview how a page might appear in search results, inspect headers and links, and prepare markup for the web. They help you find problems on a page you own before visitors and search engines do.",
    metaDescription:
      "Free web and SEO tools for checking meta tags, headers, links and page markup.",
  },
  {
    id: "color-design",
    name: "Color and design tools",
    slug: "color-design-tools",
    description: "Palettes, gradients and contrast.",
    accent: "cat-color-design",
    icon: "color-design",
    applicationCategory: "DesignApplication",
    intro:
      "Build palettes, convert between color formats, create gradients and check contrast ratios against WCAG. The math is small and repetitive, which makes it a good fit for a tool.",
    metaDescription:
      "Free color and design tools for palettes, gradients, color formats and contrast checks.",
  },
  {
    id: "date-time",
    name: "Date and time tools",
    slug: "date-time-tools",
    description: "Zones, durations and calendars.",
    accent: "cat-date-time",
    icon: "date-time",
    applicationCategory: "UtilitiesApplication",
    intro:
      "Compare time zones, count the days between two dates, add or subtract durations and find week numbers. Date arithmetic is easy to get wrong by hand, especially across time zones and daylight-saving changes.",
    metaDescription:
      "Free date and time tools for time zones, date differences, durations and calendars.",
  },
] as const satisfies readonly Category[];

/** The canonical link to a category page (paths end in a slash, ADR 0030). */
export function categoryHref(category: Pick<Category, "slug">): string {
  return `/${category.slug}/`;
}

/** The category with this id, or undefined. A tool's category is checked at build time (ADR 0033). */
export function categoryById(id: string): Category | undefined {
  return categories.find((category) => category.id === id);
}

export type CategoryId = (typeof categories)[number]["id"];

/**
 * Every URL segment a tool id may never use: the category slugs and the static pages. Mission 8's
 * registry validator enforces it (ADR 0014, ADR 0030).
 */
export const reservedPaths: readonly string[] = [
  ...categories.map((category) => category.slug),
  ...staticPagePaths,
  // The share images live under /og/ (ADR 0041), so no tool may take that path.
  "og",
  // The app icons live under /icons/ (ADR 0052).
  "icons",
];

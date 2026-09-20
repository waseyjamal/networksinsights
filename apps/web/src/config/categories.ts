// The single source for the eleven tool categories (ADR 0030). The design system, the home
// page, the footer, the /tools page and the category pages are all generated from this list.
// The tool registry (Mission 8) builds on it.
//
// `id` is short and matches the --cat-* color tokens and the data-cat attribute
// (docs/design-system.md). `slug` is the flat, keyword-rich URL: /<slug>/. Slugs are reserved
// paths that no tool id may use.
//
// `intro` and `metaDescription` say what a category is for, never how many tools it has.

import type { IconName } from "../components/ui/icons";
import { staticPagePaths } from "./site";

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
  /** Two to three sentences for the category page. Unique per category. */
  intro: string;
  /** Meta description of the category page. Under 160 characters. */
  metaDescription: string;
}

export const categories = [
  {
    id: "pdf",
    name: "PDF tools",
    slug: "pdf-tools",
    description: "Merge, split, compress and edit PDFs.",
    accent: "cat-pdf",
    icon: "pdf",
    intro:
      "For the small jobs PDFs always need: merging files, splitting out pages, shrinking a large document, rotating or editing. Where the browser can do the work, your file is processed on your device and never uploaded.",
    metaDescription:
      "Free PDF tools for merging, splitting, compressing and editing PDF files. Coming soon to NetworksInsights.",
  },
  {
    id: "image",
    name: "Image tools",
    slug: "image-tools",
    description: "Resize, crop, convert and optimize.",
    accent: "cat-image",
    icon: "image",
    intro:
      "Resize, crop, convert and compress pictures for the web, email or print. Most of these jobs are one file and a few settings, so they belong in a tab, not an installer. Where possible, images are processed on your device.",
    metaDescription:
      "Free image tools for resizing, cropping, converting and compressing pictures. Coming soon to NetworksInsights.",
  },
  {
    id: "video-audio",
    name: "Video and audio tools",
    slug: "video-audio-tools",
    description: "Trim, convert and extract.",
    accent: "cat-video-audio",
    icon: "video-audio",
    intro:
      "Trim a clip, convert between formats or pull the audio out of a video. Media files are large, so processing them on your own device avoids a slow upload. A tool will say plainly when a file has to leave your device.",
    metaDescription:
      "Free video and audio tools for trimming, converting and extracting audio from media files. Coming soon to NetworksInsights.",
  },
  {
    id: "text",
    name: "Text tools",
    slug: "text-tools",
    description: "Count, compare, clean and transform.",
    accent: "cat-text",
    icon: "text",
    intro:
      "Count words and characters, compare two versions of a text, clean up pasted content or change its case and format. These are quick jobs, so each tool aims to do one thing and show the result immediately.",
    metaDescription:
      "Free text tools for counting, comparing, cleaning and transforming text. Coming soon to NetworksInsights.",
  },
  {
    id: "calculators",
    name: "Calculators",
    slug: "calculators",
    description: "Quick answers for everyday math.",
    accent: "cat-calculators",
    icon: "calculators",
    intro:
      "Percentages, loans, fuel costs and other everyday arithmetic, worked out as you type. Each calculator should show its inputs and formula so you can check the answer instead of trusting it.",
    metaDescription:
      "Free online calculators for percentages, loans and other everyday math. Coming soon to NetworksInsights.",
  },
  {
    id: "converters",
    name: "Converters",
    slug: "converters",
    description: "Units, formats and encodings.",
    accent: "cat-converters",
    icon: "converters",
    intro:
      "Convert between units, number bases, encodings and data formats. When a conversion depends on outside data, such as an exchange rate, the tool will say where the numbers come from.",
    metaDescription:
      "Free online converters for units, number bases, encodings and data formats. Coming soon to NetworksInsights.",
  },
  {
    id: "generators",
    name: "Generators",
    slug: "generators",
    description: "Passwords, QR codes, placeholders and more.",
    accent: "cat-generators",
    icon: "generators",
    intro:
      "Create passwords, QR codes, placeholder text, random numbers and other things you would otherwise write by hand. Where randomness matters, as it does for passwords, tools use the browser's cryptographically secure random source.",
    metaDescription:
      "Free online generators for passwords, QR codes, placeholder text and random values. Coming soon to NetworksInsights.",
  },
  {
    id: "developer",
    name: "Developer tools",
    slug: "developer-tools",
    description: "Format, validate, test and debug.",
    accent: "cat-developer",
    icon: "developer",
    intro:
      "Format and validate JSON, test regular expressions, decode tokens, encode and hash data. Small utilities for the moments when opening an editor or writing a script is more work than the task deserves.",
    metaDescription:
      "Free developer tools for formatting, validating, testing and debugging code and data. Coming soon to NetworksInsights.",
  },
  {
    id: "web-seo",
    name: "Web and SEO tools",
    slug: "web-seo-tools",
    description: "Meta tags, links, headers and audits.",
    accent: "cat-web-seo",
    icon: "web-seo",
    intro:
      "Check meta tags, preview how a page might appear in search results, inspect headers and links, and prepare markup for the web. They help you find problems on a page you own before visitors and search engines do.",
    metaDescription:
      "Free web and SEO tools for checking meta tags, headers, links and page markup. Coming soon to NetworksInsights.",
  },
  {
    id: "color-design",
    name: "Color and design tools",
    slug: "color-design-tools",
    description: "Palettes, gradients and contrast.",
    accent: "cat-color-design",
    icon: "color-design",
    intro:
      "Build palettes, convert between color formats, create gradients and check contrast ratios against WCAG. The math is small and repetitive, which makes it a good fit for a tool.",
    metaDescription:
      "Free color and design tools for palettes, gradients, color formats and contrast checks. Coming soon to NetworksInsights.",
  },
  {
    id: "date-time",
    name: "Date and time tools",
    slug: "date-time-tools",
    description: "Zones, durations and calendars.",
    accent: "cat-date-time",
    icon: "date-time",
    intro:
      "Compare time zones, count the days between two dates, add or subtract durations and find week numbers. Date arithmetic is easy to get wrong by hand, especially across time zones and daylight-saving changes.",
    metaDescription:
      "Free date and time tools for time zones, date differences, durations and calendars. Coming soon to NetworksInsights.",
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
];

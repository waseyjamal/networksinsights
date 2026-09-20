// The eleven tool categories and their accent. The id matches the --cat-* color tokens and the
// data-cat attribute (docs/design-system.md). The tool registry (Mission 8) will own the counts.

import type { IconName } from "../components/ui/icons";

export interface Category {
  id: string;
  label: string;
  description: string;
  icon: IconName;
}

export const categories: Category[] = [
  { id: "pdf", label: "PDF", description: "Merge, split, compress and edit PDFs.", icon: "pdf" },
  {
    id: "image",
    label: "Image",
    description: "Resize, crop, convert and optimize.",
    icon: "image",
  },
  {
    id: "video-audio",
    label: "Video and audio",
    description: "Trim, convert and extract.",
    icon: "video-audio",
  },
  { id: "text", label: "Text", description: "Count, compare, clean and transform.", icon: "text" },
  {
    id: "calculators",
    label: "Calculators",
    description: "Quick answers for everyday math.",
    icon: "calculators",
  },
  {
    id: "converters",
    label: "Converters",
    description: "Units, currencies, formats and encodings.",
    icon: "converters",
  },
  {
    id: "generators",
    label: "Generators",
    description: "Passwords, QR codes, placeholders and more.",
    icon: "generators",
  },
  {
    id: "developer",
    label: "Developer",
    description: "Format, validate, test and debug.",
    icon: "developer",
  },
  {
    id: "web-seo",
    label: "Web and SEO",
    description: "Meta tags, links, headers and audits.",
    icon: "web-seo",
  },
  {
    id: "color-design",
    label: "Color and design",
    description: "Palettes, gradients and contrast.",
    icon: "color-design",
  },
  {
    id: "date-time",
    label: "Date and time",
    description: "Zones, durations and calendars.",
    icon: "date-time",
  },
];

// Tools made up to load-test search. There are no real tools until Mission 13, and search has to
// be measured at a thousand. These exist only in tests and reports: no page and no build imports
// this file, and the production registry never sees them (ADR 0045).
//
// Deterministic: the same count always gives the same tools, so a benchmark compares like with
// like and a failure reproduces.

import type { Tool } from "../registry/build";
import { toolOf } from "../seo/test-tools";

const VERBS = [
  "Compress",
  "Merge",
  "Split",
  "Convert",
  "Resize",
  "Crop",
  "Rotate",
  "Encode",
  "Decode",
  "Format",
  "Validate",
  "Generate",
  "Count",
  "Extract",
  "Optimize",
  "Preview",
  "Sort",
  "Clean",
  "Minify",
  "Compare",
] as const;

const OBJECTS = [
  "PDF",
  "Image",
  "Video",
  "Audio",
  "Text",
  "JSON",
  "CSV",
  "Color",
  "Date",
  "URL",
  "Base64",
  "HTML",
  "Markdown",
  "Spreadsheet",
  "Font",
  "Archive",
  "Password",
  "QR Code",
  "Hash",
  "Timestamp",
  "Unit",
  "Metadata",
  "Subtitle",
  "Icon",
  "Palette",
] as const;

const VARIANTS = [
  "",
  "Batch",
  "Lossless",
  "Quick",
  "Advanced",
  "Bulk",
  "Live",
  "Private",
  "Smart",
  "Simple",
] as const;

const FORMATS = [
  "PDF",
  "JPG",
  "PNG",
  "WEBP",
  "GIF",
  "SVG",
  "MP4",
  "MP3",
  "WAV",
  "DOCX",
  "CSV",
  "JSON",
  "XML",
  "TXT",
  "HTML",
  "MD",
] as const;

const CATEGORIES = [
  "pdf",
  "image",
  "video-audio",
  "text",
  "calculators",
  "converters",
  "generators",
  "developer",
  "web-seo",
  "color-design",
  "date-time",
] as const;

const kebab = (words: string) => words.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** `count` distinct tools with plausible names, tags and formats. `count` is at most 5,000. */
export function syntheticTools(count: number): Tool[] {
  return Array.from({ length: count }, (_, index) => {
    const verb = VERBS[index % VERBS.length] as string;
    const object = OBJECTS[Math.floor(index / VERBS.length) % OBJECTS.length] as string;
    const variant = VARIANTS[
      Math.floor(index / (VERBS.length * OBJECTS.length)) % VARIANTS.length
    ] as string;
    // Two tools with the same verb and object differ by variant; past 2,500 a numeral separates them.
    const round = Math.floor(index / (VERBS.length * OBJECTS.length * VARIANTS.length));
    const name = [variant, `${verb} ${object}`, round > 0 ? String(round + 1) : ""]
      .filter(Boolean)
      .join(" ");
    const from = FORMATS[index % FORMATS.length] as string;
    const to = FORMATS[(index * 7 + 3) % FORMATS.length] as string;
    const converts = verb === "Convert" || verb === "Encode" || verb === "Decode";
    return toolOf(kebab(name), CATEGORIES[index % CATEGORIES.length] as string, "2026-09-01", {
      name,
      summary: `${verb} ${object.toLowerCase()} files and text in your browser, with no sign-up and nothing to install.`,
      tags: [kebab(verb), kebab(object), from.toLowerCase()],
      ...(converts && from !== to ? { accepts: [from], produces: [to] } : {}),
    });
  });
}

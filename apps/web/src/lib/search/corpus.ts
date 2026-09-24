// A small, fixed set of records for the ranking tests. Test data only: it is never imported by a
// page or a build. Names and formats are ordinary ones, so a ranking failure reads like a real one.

import type { SearchRecord } from "./types";

const record = (
  id: string,
  name: string,
  category: string,
  summary: string,
  tags: string[],
  formats: { accepts?: string[]; produces?: string[] } = {},
): SearchRecord => ({ id, name, category, summary, tags, ...formats, href: `/${id}/` });

export const corpus: readonly SearchRecord[] = [
  record(
    "compress-pdf",
    "Compress PDF",
    "pdf",
    "Make a PDF file smaller so it is easy to send.",
    ["compress", "pdf", "reduce-size"],
    { accepts: ["PDF"], produces: ["PDF"] },
  ),
  record("merge-pdf", "Merge PDF", "pdf", "Join several PDF files into one document.", [
    "merge",
    "pdf",
    "combine",
  ]),
  record(
    "compress-image",
    "Compress Image",
    "image",
    "Shrink a picture and keep it sharp enough for the web.",
    ["compress", "image", "reduce-size"],
    { accepts: ["JPG", "PNG", "WEBP"], produces: ["JPG", "PNG", "WEBP"] },
  ),
  record(
    "compress-video",
    "Compress Video",
    "video-audio",
    "Reduce the size of a video file for sharing.",
    ["compress", "video"],
    { accepts: ["MP4"], produces: ["MP4"] },
  ),
  record("word-counter", "Word Counter", "text", "Count the words and characters in a text.", [
    "count",
    "words",
    "text",
  ]),
  record(
    "jpg-to-png",
    "JPG to PNG Converter",
    "converters",
    "Change a JPG picture into a PNG file.",
    ["convert", "jpg", "png"],
    { accepts: ["JPG"], produces: ["PNG"] },
  ),
  record(
    "png-to-jpg",
    "PNG to JPG Converter",
    "converters",
    "Change a PNG picture into a JPG file.",
    ["convert", "png", "jpg"],
    { accepts: ["PNG"], produces: ["JPG"] },
  ),
  record(
    "image-format-switcher",
    "Image Format Switcher",
    "converters",
    "Switch a picture from one file type to another.",
    ["convert", "image"],
    { accepts: ["JPEG"], produces: ["PNG"] },
  ),
  record(
    "picture-format-switcher",
    "Picture Format Switcher",
    "converters",
    "Switch a picture from one file type to another.",
    ["convert", "picture"],
    { accepts: ["PNG"], produces: ["JPEG"] },
  ),
  record(
    "pdf-to-word",
    "PDF to Word",
    "pdf",
    "Turn a PDF into an editable Word document.",
    ["pdf", "word", "convert"],
    { accepts: ["PDF"], produces: ["DOCX"] },
  ),
  record("base64-encoder", "Base64 Encoder", "developer", "Encode text or a file as Base64.", [
    "base64",
    "encode",
  ]),
  record(
    "video-and-audio-converter",
    "Video and Audio Converter",
    "video-audio",
    "Convert between common video and audio formats.",
    ["convert", "video", "audio"],
    { accepts: ["MP4", "MP3"], produces: ["MP4", "MP3"] },
  ),
  record("café-menu", "Café Menu Maker", "generators", "Lay out a menu for a small café.", [
    "menu",
  ]),
];

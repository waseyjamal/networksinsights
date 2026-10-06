import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS, RANGES } from "./logic";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export default defineTool({
  id: "photo-collage-maker",
  name: "Photo Collage Maker",
  category: "image",
  summary:
    "Put 2 to 6 of your photos into one collage in the browser: pick a layout, the spacing, border and background colours and the size, then save PNG or JPG.",
  tags: ["collage", "photos", "grid", "layout", "montage"],
  accepts: ["JPG", "PNG", "WebP"],
  produces: ["PNG", "JPG"],
  runtime: "client",
  status: "beta",
  input: z.object({
    layout: z.enum(["2-side", "2-stack", "3-left", "3-top", "4-grid", "6-grid"]),
    size: z.enum(["square", "portrait", "landscape", "story"]),
    spacing: z.number().int().min(RANGES.spacing.min).max(RANGES.spacing.max),
    border: z.number().int().min(RANGES.border.min).max(RANGES.border.max),
    borderColor: hex,
    background: hex,
    format: z.enum(["png", "jpg"]),
  }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["crop-image", "resize-image", "add-text-to-image", "images-to-gif"],
  added: "2026-10-06",
  updated: "2026-10-06",
});

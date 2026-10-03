import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "favicon-generator",
  name: "Favicon Generator",
  category: "web-seo",
  summary:
    "Turn one image into PNG favicons at 16, 32, 48, 180, 192 and 512 pixels, with the HTML link tags to paste.",
  tags: ["favicon", "icons", "png", "seo"],
  accepts: ["PNG", "JPG", "WebP"],
  produces: ["PNG", "ICO"],
  runtime: "worker",
  status: "beta",
  input: z.object({}),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["resize-image", "crop-image", "meta-tag-generator"],
  added: "2026-10-03",
  updated: "2026-10-03",
});

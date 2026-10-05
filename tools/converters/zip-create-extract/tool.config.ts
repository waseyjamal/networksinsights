import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { LIMITS } from "./logic";

export default defineTool({
  id: "zip-create-extract",
  name: "ZIP create and extract",
  category: "converters",
  summary:
    "Make a ZIP file from several files, or open a ZIP and save the files inside it, in your browser without uploading anything.",
  tags: ["zip", "archive", "extract", "compress", "unzip"],
  accepts: ["ZIP", "Any file"],
  produces: ["ZIP"],
  runtime: "worker",
  status: "beta",
  input: z.object({ mode: z.enum(["create", "extract"]), method: z.enum(["deflate", "store"]) }),
  limits: { maxInputBytes: LIMITS.maxInputBytes, maxFiles: LIMITS.maxFiles },
  related: ["file-encrypt-decrypt", "compress-pdf", "compress-image"],
  added: "2026-10-05",
  updated: "2026-10-05",
});

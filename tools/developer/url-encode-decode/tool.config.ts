import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";

export default defineTool({
  id: "url-encode-decode",
  name: "URL Encode Decode",
  category: "developer",
  summary:
    "Percent-encode or decode a URL or a URL component as you type, with a choice between encodeURI and encodeURIComponent behaviour.",
  tags: ["url", "encode", "decode", "percent-encoding", "encodeuri", "query-string"],
  runtime: "client",
  status: "beta",
  input: z.object({
    mode: z.enum(["encode", "decode"]),
    scope: z.enum(["url", "component"]),
    text: z.string(),
  }),
  related: ["base64", "json-formatter"],
  added: "2026-10-02",
  updated: "2026-10-02",
});

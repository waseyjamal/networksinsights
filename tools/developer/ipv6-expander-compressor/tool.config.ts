import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_CHARS } from "./logic";

export default defineTool({
  id: "ipv6-expander-compressor",
  name: "IPv6 Address Expander and Compressor",
  category: "developer",
  summary:
    "Expand an IPv6 address to all eight groups, or compress it to the one canonical short form that RFC 5952 defines.",
  tags: ["ipv6", "rfc-5952", "address", "network"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string().max(MAX_CHARS) }),
  limits: { maxInputBytes: MAX_CHARS },
  related: ["cidr-range-converter", "subnet-calculator"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_CHARS } from "./logic";

export default defineTool({
  id: "cidr-range-converter",
  name: "CIDR to IP Range Converter",
  category: "developer",
  summary:
    "Turn a CIDR block into its first and last address, or an IPv4 or IPv6 range into the fewest CIDR blocks that cover it exactly.",
  tags: ["cidr", "ip-range", "ipv4", "ipv6", "network"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string().max(MAX_CHARS) }),
  limits: { maxInputBytes: MAX_CHARS },
  related: ["subnet-calculator", "vlsm-calculator", "ipv6-expander-compressor"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

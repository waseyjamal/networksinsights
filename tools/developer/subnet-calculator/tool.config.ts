import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_CHARS } from "./logic";

export default defineTool({
  id: "subnet-calculator",
  name: "Subnet Calculator",
  category: "developer",
  summary:
    "Work out the network, broadcast, mask, wildcard and usable host range of any IPv4 address and prefix, from /0 to /32.",
  tags: ["ip", "subnet", "cidr", "ipv4", "network"],
  runtime: "client",
  status: "beta",
  input: z.object({ text: z.string().max(MAX_CHARS) }),
  limits: { maxInputBytes: MAX_CHARS },
  related: ["vlsm-calculator", "cidr-range-converter", "ipv6-expander-compressor"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

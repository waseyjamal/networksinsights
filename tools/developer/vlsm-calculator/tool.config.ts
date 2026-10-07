import { defineTool } from "@networksinsights/tool-sdk";
import { z } from "zod";
import { MAX_CHARS } from "./logic";

export default defineTool({
  id: "vlsm-calculator",
  name: "VLSM Calculator",
  category: "developer",
  summary:
    "Split one IPv4 network into subnets of different sizes, largest first, each sized for the hosts you need, with no overlap.",
  tags: ["vlsm", "subnet", "ipv4", "network", "cidr"],
  runtime: "client",
  status: "beta",
  input: z.object({ network: z.string().max(100), needs: z.string().max(MAX_CHARS) }),
  limits: { maxInputBytes: MAX_CHARS },
  related: ["subnet-calculator", "cidr-range-converter"],
  added: "2026-10-07",
  updated: "2026-10-07",
});

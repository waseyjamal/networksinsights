// A tool as a card of the ToolCardList (design system): every value comes from its manifest and
// its category config, so a card can never say something the tool page does not.

import type { ToolCardItem } from "../../components/ui/attrs";
import { categoryById } from "../../config/categories";
import type { Tool } from "./build";

export function toolCardItem(tool: Tool): ToolCardItem {
  const category = categoryById(tool.manifest.category);
  if (!category) throw new Error(`${tool.dir}: unknown category "${tool.manifest.category}"`);
  return {
    href: tool.href,
    name: tool.manifest.name,
    summary: tool.manifest.summary,
    category: category.id,
    icon: category.icon,
    beta: tool.manifest.status === "beta",
  };
}

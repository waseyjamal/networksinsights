// Reads the ADR folder, for gates that require an owner-approved decision (ADR 0047: a tool's
// security override must name an accepted ADR).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./tools";

export const adrDir = join(repoRoot, "docs", "adr");

/** Why the ADR numbered `number` cannot approve anything, or undefined when it is accepted. */
export function adrProblem(number: string, dir = adrDir): string | undefined {
  const file = existsSync(dir)
    ? readdirSync(dir).find((name) => name.startsWith(`${number}-`))
    : undefined;
  if (!file) return `there is no ADR ${number} in docs/adr/`;
  const status = /^Status:\s*(.+)$/m.exec(readFileSync(join(dir, file), "utf8"))?.[1]?.trim();
  if (status !== "Accepted")
    return `ADR ${number} (${file}) has Status: ${status ?? "none"}, not Accepted`;
  return undefined;
}

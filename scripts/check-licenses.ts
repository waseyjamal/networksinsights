// pnpm check:licenses
//
// Fails if any installed package, direct or transitive, dev or not, is under a licence outside the
// allowed set in scripts/lib/licenses.ts (ADR 0017, ADR 0049). It reads `pnpm licenses list --json`,
// so it sees exactly what the lockfile installed. CI runs it in the supply-chain job. Exit code 0
// means every licence is allowed, 1 that one is not, 2 that pnpm could not list them.

import { spawnSync } from "node:child_process";
import { checkLicenses, formatLicenseReport, parsePnpmLicenses } from "./lib/licenses";
import { repoRoot } from "./lib/tools";

function main(): number {
  const listed = spawnSync("pnpm", ["licenses", "list", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // pnpm is a .cmd shim on Windows, which only a shell can start.
    shell: process.platform === "win32",
  });
  if (listed.status !== 0) {
    console.error(`pnpm licenses list failed:\n${listed.stderr}`);
    return 2;
  }
  const packages = parsePnpmLicenses(listed.stdout);
  const problems = checkLicenses(packages);
  console.log(formatLicenseReport(packages.length, problems));
  return problems.length === 0 ? 0 : 1;
}

process.exit(main());

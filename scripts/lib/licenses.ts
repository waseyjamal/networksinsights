// The licence gate (ADR 0017, ADR 0049): every installed package, direct or transitive, dev or
// not, must be under a licence in the allowed set. Pure: the CLI in scripts/check-licenses.ts
// feeds it the output of `pnpm licenses list --json`.

/**
 * Licences every package may use. Permissive licences, weak file-level copyleft (MPL-2.0), the
 * font licence of our fonts (OFL-1.1) and the data licences of browser data packages. AGPL, GPL,
 * SSPL and non-commercial licences are never here (ADR 0017); adding one takes an ADR.
 */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
]);

/** A licence allowed for some packages only, with the decision that allowed it. */
export interface LicenseException {
  /** Package names this applies to. */
  packages: RegExp;
  licenses: readonly string[];
  /** Where the owner approved it. */
  approved: string;
}

export const LICENSE_EXCEPTIONS: readonly LicenseException[] = [
  {
    // sharp's prebuilt libvips binaries. Astro's image service and Miniflare use sharp at build
    // time only; nothing of it reaches a visitor. LGPL is not on the banned list, and the library
    // is used unmodified, as a separate dynamically linked binary.
    packages: /^@img\/sharp-/,
    licenses: ["LGPL-3.0-or-later"],
    approved: "ADR 0049, owner approval in Mission 12",
  },
];

/** One package as `pnpm licenses list --json` reports it. */
export interface InstalledPackage {
  name: string;
  versions: readonly string[];
  license: string;
}

export interface LicenseProblem {
  name: string;
  versions: readonly string[];
  license: string;
  reason: string;
}

type Token = { kind: "id"; value: string } | { kind: "and" | "or" | "with" | "open" | "close" };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of expression.replace(/[()]/g, " $& ").split(/\s+/).filter(Boolean)) {
    const upper = raw.toUpperCase();
    if (raw === "(") tokens.push({ kind: "open" });
    else if (raw === ")") tokens.push({ kind: "close" });
    else if (upper === "AND") tokens.push({ kind: "and" });
    else if (upper === "OR") tokens.push({ kind: "or" });
    else if (upper === "WITH") tokens.push({ kind: "with" });
    else tokens.push({ kind: "id", value: raw });
  }
  return tokens;
}

/**
 * Whether an SPDX licence expression is satisfied by the allowed identifiers: `A OR B` needs
 * either, `A AND B` needs both, `A WITH exception` needs `A` (an exception only adds permissions).
 * AND binds tighter than OR, as SPDX says. Anything unparseable is not allowed.
 */
export function satisfies(expression: string, allowed: (id: string) => boolean): boolean {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];

  const primary = (): boolean => {
    const token = tokens[position++];
    if (!token) throw new Error("unexpected end");
    if (token.kind === "open") {
      const value = or();
      if (tokens[position++]?.kind !== "close") throw new Error("missing )");
      return value;
    }
    if (token.kind !== "id") throw new Error(`unexpected ${token.kind}`);
    if (peek()?.kind === "with") {
      position++;
      if (tokens[position++]?.kind !== "id") throw new Error("WITH needs an exception");
    }
    return allowed(token.value);
  };
  const and = (): boolean => {
    let value = primary();
    while (peek()?.kind === "and") {
      position++;
      const right = primary();
      value = value && right;
    }
    return value;
  };
  const or = (): boolean => {
    let value = and();
    while (peek()?.kind === "or") {
      position++;
      const right = and();
      value = value || right;
    }
    return value;
  };

  try {
    if (tokens.length === 0) return false;
    const value = or();
    return position === tokens.length && value;
  } catch {
    return false;
  }
}

/** Every package whose licence is outside the policy. An empty array means the gate passes. */
export function checkLicenses(
  packages: readonly InstalledPackage[],
  allowedLicenses: ReadonlySet<string> = ALLOWED_LICENSES,
  exceptions: readonly LicenseException[] = LICENSE_EXCEPTIONS,
): LicenseProblem[] {
  const problems: LicenseProblem[] = [];
  for (const pkg of packages) {
    const extra = exceptions
      .filter((exception) => exception.packages.test(pkg.name))
      .flatMap((exception) => exception.licenses);
    const allowed = (id: string) => allowedLicenses.has(id) || extra.includes(id);
    const license = pkg.license.trim();
    if (license === "" || /^unknown$/i.test(license) || /^see license in/i.test(license)) {
      problems.push({ ...pkg, reason: "no licence is declared, so its terms are unknown" });
    } else if (!satisfies(license, allowed)) {
      problems.push({
        ...pkg,
        reason: "this licence is not in the allowed set (ADR 0017, ADR 0049)",
      });
    }
  }
  return problems.sort((a, b) => a.name.localeCompare(b.name));
}

/** `pnpm licenses list --json`: licence to packages. Flattened, each package with its licence. */
export function parsePnpmLicenses(json: string): InstalledPackage[] {
  const data = JSON.parse(json) as Record<
    string,
    Array<{ name: string; versions?: string[]; version?: string; license?: string }>
  >;
  return Object.entries(data).flatMap(([license, packages]) =>
    packages.map((pkg) => ({
      name: pkg.name,
      versions: pkg.versions ?? (pkg.version ? [pkg.version] : []),
      license: pkg.license ?? license,
    })),
  );
}

export function formatLicenseReport(packages: number, problems: readonly LicenseProblem[]): string {
  if (problems.length === 0) {
    return `Licence check: ${packages} packages, every licence is in the allowed set.`;
  }
  const lines = problems.map(
    (problem) =>
      `  ✗ ${problem.name}@${problem.versions.join(", ")}: ${problem.license}\n      ${problem.reason}`,
  );
  return `Licence check: ${problems.length} of ${packages} packages are outside the allowed set.\n\n${lines.join("\n")}\n\nReplace the package, or record an owner-approved exception in scripts/lib/licenses.ts with an ADR (docs/runbooks/security.md).`;
}

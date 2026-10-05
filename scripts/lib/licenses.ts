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
  /** When set, only these exact versions; any other installed version is checked as usual. */
  versions?: readonly string[];
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
  {
    // pdf-lib 1.17.1 compresses PDF streams with pako 1.0.11, part of the zlib port, which keeps
    // the zlib licence notice. Zlib is permissive; it is allowed for this package and version only.
    packages: /^pako$/,
    versions: ["1.0.11"],
    licenses: ["Zlib"],
    approved: "ADR 0057, owner approval in Tools batch 2",
  },
  {
    // libheif-js 1.23.2 (libheif and libde265 compiled to WebAssembly) decodes HEIC photos in
    // HEIC to JPG. Its wasm is served unmodified as a separate file, so it can be replaced.
    packages: /^libheif-js$/,
    versions: ["1.23.2"],
    licenses: ["LGPL-3.0"],
    approved: "ADR 0060, owner approval in Tools batch 5A",
  },
  {
    // wasm-media-encoders 0.7.0: its mp3.wasm is LAME 3.100, LGPL-2.0-or-later (the override
    // below says so, whatever the package declares). The MP3 tools serve that wasm unmodified as
    // a separate file, so it can be replaced. This version only; LGPL stays banned elsewhere.
    packages: /^wasm-media-encoders$/,
    versions: ["0.7.0"],
    licenses: ["LGPL-2.0-or-later"],
    approved: "ADR 0064, owner approval in Tools batch 6B",
  },
];

/**
 * Packages whose declared licence leaves out code they ship. The gate checks the licence here
 * instead of the declared one, for every version of the package.
 */
export const LICENSE_OVERRIDES: Readonly<Record<string, { license: string; why: string }>> = {
  "wasm-media-encoders": {
    license: "MIT AND LGPL-2.0-or-later",
    why: "declares MIT for its JavaScript, but its mp3.wasm is LAME, LGPL-2.0-or-later (ADR 0064)",
  },
};

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
  overrides: Readonly<Record<string, { license: string }>> = LICENSE_OVERRIDES,
): LicenseProblem[] {
  const problems: LicenseProblem[] = [];
  for (const declared of packages) {
    const override = Object.hasOwn(overrides, declared.name) ? overrides[declared.name] : undefined;
    const pkg = override ? { ...declared, license: override.license } : declared;
    const extra = exceptions
      .filter(
        (exception) =>
          exception.packages.test(pkg.name) &&
          (exception.versions === undefined ||
            (pkg.versions.length > 0 &&
              pkg.versions.every((version) => exception.versions?.includes(version)))),
      )
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

import { describe, expect, it } from "vitest";
import {
  ALLOWED_LICENSES,
  checkLicenses,
  formatLicenseReport,
  parsePnpmLicenses,
  satisfies,
} from "./lib/licenses";

const allowed = (id: string) => ALLOWED_LICENSES.has(id);

describe("satisfies", () => {
  it("reads single identifiers", () => {
    expect(satisfies("MIT", allowed)).toBe(true);
    expect(satisfies("GPL-3.0-only", allowed)).toBe(false);
  });

  it("needs either side of OR and both sides of AND", () => {
    expect(satisfies("MIT OR GPL-3.0-only", allowed)).toBe(true);
    expect(satisfies("(MIT OR Apache-2.0)", allowed)).toBe(true);
    expect(satisfies("MIT AND GPL-3.0-only", allowed)).toBe(false);
    expect(satisfies("Apache-2.0 AND LGPL-3.0-or-later", allowed)).toBe(false);
  });

  it("binds AND tighter than OR", () => {
    // GPL OR (MIT AND ISC): allowed through the right side.
    expect(satisfies("GPL-2.0-only OR MIT AND ISC", allowed)).toBe(true);
    // (GPL OR MIT) AND AGPL would be allowed by a left-to-right reading, and must not be.
    expect(satisfies("GPL-2.0-only OR MIT AND AGPL-3.0-only", allowed)).toBe(false);
  });

  it("treats a WITH exception as the licence it extends", () => {
    expect(satisfies("Apache-2.0 WITH LLVM-exception", allowed)).toBe(true);
    expect(satisfies("GPL-2.0-only WITH Classpath-exception-2.0", allowed)).toBe(false);
  });

  it("refuses what it cannot parse", () => {
    for (const expression of ["", "MIT OR", "(MIT", "MIT)", "AND MIT", "MIT WITH"]) {
      expect(satisfies(expression, allowed), expression).toBe(false);
    }
  });
});

describe("checkLicenses", () => {
  const pkg = (name: string, license: string) => ({ name, versions: ["1.0.0"], license });

  it("passes the licences in the allowed set", () => {
    expect(
      checkLicenses([
        pkg("a", "MIT"),
        pkg("b", "(MIT OR Apache-2.0)"),
        pkg("fonts", "OFL-1.1"),
        pkg("caniuse-lite", "CC-BY-4.0"),
      ]),
    ).toEqual([]);
  });

  it("fails copyleft, non-commercial and missing licences", () => {
    const problems = checkLicenses([
      pkg("gpl", "GPL-3.0-or-later"),
      pkg("agpl", "AGPL-3.0-only"),
      pkg("sspl", "SSPL-1.0"),
      pkg("nc", "CC-BY-NC-4.0"),
      pkg("none", "Unknown"),
      pkg("custom", "SEE LICENSE IN LICENSE.md"),
    ]);
    expect(problems.map((problem) => problem.name)).toEqual([
      "agpl",
      "custom",
      "gpl",
      "nc",
      "none",
      "sspl",
    ]);
  });

  it("allows LGPL for sharp's libvips binaries only", () => {
    expect(
      checkLicenses([
        pkg("@img/sharp-win32-x64", "Apache-2.0 AND LGPL-3.0-or-later"),
        pkg("@img/sharp-libvips-linux-x64", "LGPL-3.0-or-later"),
      ]),
    ).toEqual([]);
    expect(checkLicenses([pkg("some-lib", "LGPL-3.0-or-later")])).toHaveLength(1);
    expect(checkLicenses([pkg("@img/other", "LGPL-3.0-or-later")])).toHaveLength(1);
    expect(checkLicenses([pkg("sharp-lookalike", "LGPL-3.0-or-later")])).toHaveLength(1);
  });

  it("does not let the sharp exception allow GPL", () => {
    expect(checkLicenses([pkg("@img/sharp-x", "GPL-3.0-only")])).toHaveLength(1);
  });

  it("allows Zlib for pako 1.0.11 only", () => {
    const pako = (versions: string[], license = "(MIT AND Zlib)") => ({
      name: "pako",
      versions,
      license,
    });
    expect(checkLicenses([pako(["1.0.11"])])).toEqual([]);
    expect(checkLicenses([pako(["2.1.0"])])).toHaveLength(1);
    expect(checkLicenses([pako(["1.0.11", "2.1.0"])])).toHaveLength(1);
    expect(checkLicenses([pako(["1.0.11"], "GPL-3.0-only")])).toHaveLength(1);
    expect(ALLOWED_LICENSES.has("Zlib")).toBe(false);
  });

  it("still rejects Zlib for every other package", () => {
    expect(checkLicenses([pkg("zlib-port", "Zlib")])).toHaveLength(1);
    expect(checkLicenses([pkg("pako-lookalike", "(MIT AND Zlib)")])).toHaveLength(1);
    expect(checkLicenses([{ name: "other", versions: ["1.0.11"], license: "Zlib" }])).toHaveLength(
      1,
    );
  });
});

describe("parsePnpmLicenses and the report", () => {
  it("flattens pnpm's licence-to-packages map", () => {
    const json = JSON.stringify({
      MIT: [{ name: "a", versions: ["1.0.0", "2.0.0"], license: "MIT" }],
      "GPL-3.0": [{ name: "b", versions: ["3.0.0"], license: "GPL-3.0" }],
    });
    const packages = parsePnpmLicenses(json);
    expect(packages).toEqual([
      { name: "a", versions: ["1.0.0", "2.0.0"], license: "MIT" },
      { name: "b", versions: ["3.0.0"], license: "GPL-3.0" },
    ]);
    const report = formatLicenseReport(packages.length, checkLicenses(packages));
    expect(report).toContain("1 of 2 packages");
    expect(report).toContain("b@3.0.0: GPL-3.0");
  });
});

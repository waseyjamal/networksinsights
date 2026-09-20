import { describe, expect, it } from "vitest";
import tokensCss from "../styles/tokens.css?raw";
import { composite, contrastRatio, inGamut, mixOklab, oklchToSrgb, type Rgb, toHex } from "./color";
import { categories, pairs, TEXT, UI } from "./contrast-pairs";
import { parseTokens, resolveColor, type Theme, themeColors } from "./tokens";

const tokens = parseTokens(tokensCss);
const themes: Theme[] = ["light", "dark"];

/** Runtime variables that are not colors: they need a light and a dark value but no bridge. */
const isColorToken = (name: string) => !name.startsWith("shadow-") && name !== "glow";
const names = (map: Map<string, string>) => [...map.keys()].map((k) => k.slice(2));

describe("tokens.css: light and dark parity", () => {
  it("parses a non-trivial token set", () => {
    expect(tokens.light.size).toBeGreaterThan(50);
    expect(tokens.dark.size).toBeGreaterThan(50);
    expect(tokens.staticTokens.size).toBeGreaterThan(50);
  });

  it("gives every light token a dark value", () => {
    const missing = names(tokens.light).filter(
      (n) => n !== "color-scheme" && !tokens.dark.has(`--${n}`),
    );
    expect(missing).toEqual([]);
  });

  it("gives every dark token a light value", () => {
    const missing = names(tokens.dark).filter((n) => !tokens.light.has(`--${n}`));
    expect(missing).toEqual([]);
  });

  it("bridges every color token to a Tailwind utility, and only those", () => {
    const lightColors = names(tokens.light).filter(isColorToken).sort();
    expect([...tokens.bridge].sort()).toEqual(lightColors);
  });

  it("keeps the palette theme-independent: numbered steps live in @theme static only", () => {
    for (const name of tokens.bridge) expect(name).not.toMatch(/-\d+$/);
    for (const name of tokens.staticTokens.keys()) {
      if (!name.startsWith("--color-")) continue;
      expect(name).toMatch(/^--color-(white|black|[a-z]+-\d+)$/);
    }
  });

  it("makes light and dark differ for the surfaces that define each theme", () => {
    for (const name of ["bg", "surface", "fg", "border"]) {
      expect(tokens.light.get(`--${name}`)).not.toBe(tokens.dark.get(`--${name}`));
    }
  });
});

describe("tokens.css: values", () => {
  it("resolves every color token to a valid, in-gamut OKLCH color in both themes", () => {
    const problems: string[] = [];
    for (const theme of themes) {
      const scope = theme === "light" ? tokens.light : tokens.dark;
      for (const [name, value] of scope) {
        if (!tokens.bridge.has(name.slice(2))) continue;
        try {
          const rgb = oklchToSrgb(resolveColor(value, scope, tokens.staticTokens));
          if (!inGamut(rgb)) problems.push(`${theme} ${name}: outside sRGB`);
        } catch (error) {
          problems.push(`${theme} ${name}: ${(error as Error).message}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the palette inside the sRGB gamut", () => {
    const outside = [...tokens.staticTokens]
      .filter(([name]) => name.startsWith("--color-"))
      .filter(([, value]) => !inGamut(oklchToSrgb(value)))
      .map(([name]) => name);
    expect(outside).toEqual([]);
  });

  it("uses a deep navy for the dark background, not pure black", () => {
    const bg = themeColors(tokens, "dark").get("bg") as Rgb;
    expect(toHex(bg)).not.toBe("#000000");
    expect(bg.b).toBeGreaterThan(bg.r);
  });
});

describe("tokens.css: WCAG 2.2 AA contrast", () => {
  for (const theme of themes) {
    describe(theme, () => {
      const colors = themeColors(tokens, theme);
      const get = (name: string): Rgb => {
        const color = colors.get(name);
        if (!color) throw new Error(`Unknown token ${name}`);
        return color;
      };

      it("passes every declared text/background pair", () => {
        const failures = pairs()
          .map((p) => ({ ...p, ratio: contrastRatio(get(p.fg), get(p.bg)) }))
          .filter((p) => p.ratio < p.min)
          .map((p) => `${p.fg} on ${p.bg}: ${p.ratio.toFixed(2)} < ${p.min}`);
        expect(failures).toEqual([]);
      });

      it("keeps category icons at 3:1 on their own tinted chip", () => {
        // The chip is color-mix(in oklab, accent 14%, surface). See .ni-icon-tint in components.css.
        const failures: string[] = [];
        for (const c of categories) {
          for (const s of ["surface", "bg"]) {
            const chip = mixOklab(get(`cat-${c}`), get(s), 0.14);
            const ratio = contrastRatio(get(`cat-${c}`), chip);
            if (ratio < UI) failures.push(`cat-${c} on chip over ${s}: ${ratio.toFixed(2)}`);
          }
        }
        expect(failures).toEqual([]);
      });

      it("keeps hero text readable where all three aurora glows overlap", () => {
        // Mirrors .ni-aurora in components.css: indigo 30%, violet 24%, cyan 22% over the page.
        const glows: Array<[string, number]> = [
          ["indigo-500", 0.3],
          ["violet-500", 0.24],
          ["cyan-400", 0.22],
        ];
        let backdrop = get("bg");
        for (const [name, alpha] of glows) {
          const value = tokens.staticTokens.get(`--color-${name}`);
          if (!value) throw new Error(`Missing palette token ${name}`);
          backdrop = composite({ ...oklchToSrgb(value), a: alpha }, backdrop);
        }
        for (const fg of ["fg", "fg-muted"]) {
          expect(contrastRatio(get(fg), backdrop)).toBeGreaterThanOrEqual(TEXT);
        }
      });

      it("keeps text readable on the glass surface, over the page and over the brand color", () => {
        const failures: string[] = [];
        // Worst cases behind the command bar: the page itself and a strong brand-colored aurora.
        const backdrops = [get("bg"), get("brand")];
        for (const [i, backdrop] of backdrops.entries()) {
          const glass = composite(get("glass"), backdrop);
          for (const fg of ["fg", "fg-muted", "fg-subtle"]) {
            const ratio = contrastRatio(get(fg), glass);
            if (ratio < TEXT)
              failures.push(`${fg} on glass over ${i === 0 ? "bg" : "brand"}: ${ratio.toFixed(2)}`);
          }
        }
        expect(failures).toEqual([]);
      });
    });
  }
});

// The share images (Open Graph and X cards): what each one says, and how it is laid out (ADR 0041).
//
// Everything on a card is data the page already shows: the title is the page's H1, the line under
// it is the page's own summary or description, and a tool's card names its category. There are no
// counts and no claims. Colors are read from tokens.css, the same file the site's CSS is built
// from, so a card can never drift from the design. This file is pure: it builds a tree of boxes
// and text and does not draw it. og-render.ts draws it.

import type { Node } from "@takumi-rs/core";
import { type Category, categories, categoryHref } from "../../config/categories";
import { homeHero, site } from "../../config/site";
import tokensCss from "../../styles/tokens.css?raw";
import { oklchToSrgb, type Rgb, toHex } from "../color";
import type { Tool } from "../registry/build";
import { parseTokens, themeColors } from "../tokens";
import { HOME_SHARE_IMAGE, SHARE_IMAGE, shareImagePath } from "./head";

/** What one share image says. */
export interface ShareCard {
  /** The file slug: `home`, `pdf-tools`, `word-counter`. The image is `/og/<slug>.png`. */
  slug: string;
  /** The page's H1. */
  title: string;
  /** The line under it: the page's summary or description. */
  subtitle: string;
  /** A small label above the title: a tool's category. */
  label?: string;
}

/** The card of the home page. Every page without a card of its own shares it. */
export const homeCard: ShareCard = {
  slug: "home",
  title: homeHero.headline,
  subtitle: homeHero.lead,
};

export const categoryCard = (
  category: Pick<Category, "slug" | "name" | "description">,
): ShareCard => ({
  slug: category.slug,
  title: category.name,
  subtitle: category.description,
});

export const toolCard = (tool: Pick<Tool, "manifest">): ShareCard => ({
  slug: tool.manifest.id,
  title: tool.manifest.name,
  subtitle: tool.manifest.summary,
  label: categories.find((category) => category.id === tool.manifest.category)?.name ?? "",
});

/** The card of the home page, of every category page and of every tool page. */
export function shareCards(tools: readonly Tool[]): ShareCard[] {
  return [homeCard, ...categories.map(categoryCard), ...tools.map(toolCard)];
}

/** What a card shows, in words, for the image's alt text. */
export const shareAlt = (card: ShareCard): string =>
  `${site.name}: ${card.title}. ${card.subtitle}`;

/** The share image of a card: `{ path, alt }`, the shape `buildHead` takes. */
export function shareImageOf(card: ShareCard): { path: string; alt: string } {
  return {
    path: card.slug === "home" ? HOME_SHARE_IMAGE : shareImagePath(card.slug),
    alt: shareAlt(card),
  };
}

/** The colors of a card, in the dark theme, as hex strings, with translucent glows as #rrggbbaa. */
export interface SharePalette {
  bg: string;
  fg: string;
  fgMuted: string;
  border: string;
  brand: string;
  brandSoft: string;
  brandSoftFg: string;
  /** Two soft glows drawn behind the card, from the brand palette. */
  glowPrimary: string;
  glowPrimaryClear: string;
  glowSecondary: string;
  glowSecondaryClear: string;
}

/** A color with an alpha, as `#rrggbbaa`, which the renderer reads. */
const withAlpha = (color: Rgb, alpha: number) =>
  `${toHex(color)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;

/** The same color fully transparent, so a gradient fades out without passing through gray. */
const clear = (color: Rgb) => withAlpha(color, 0);

/** Reads the palette from tokens.css. It throws if a token the card needs has gone missing. */
export function sharePalette(css = tokensCss): SharePalette {
  const tokens = parseTokens(css);
  const dark = themeColors(tokens, "dark");
  const semantic = (name: string): Rgb => {
    const color = dark.get(name);
    if (!color) throw new Error(`tokens.css has no --${name} token`);
    return color;
  };
  const palette = (name: string): Rgb => {
    const value = tokens.staticTokens.get(`--color-${name}`);
    if (!value) throw new Error(`tokens.css has no --color-${name} token`);
    return oklchToSrgb(value);
  };
  return {
    bg: toHex(semantic("bg")),
    fg: toHex(semantic("fg")),
    fgMuted: toHex(semantic("fg-muted")),
    border: toHex(semantic("border")),
    brand: toHex(semantic("brand")),
    brandSoft: toHex(semantic("brand-soft")),
    brandSoftFg: toHex(semantic("brand-soft-fg")),
    glowPrimary: withAlpha(palette("indigo-500"), 0.42),
    glowPrimaryClear: clear(palette("indigo-500")),
    glowSecondary: withAlpha(palette("violet-500"), 0.22),
    glowSecondaryClear: clear(palette("violet-500")),
  };
}

/** The constellation mark of the wordmark (components/ui/Wordmark.astro), as an SVG data URI. */
export function constellationMark(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g stroke="${color}" stroke-width="1.6" stroke-linecap="round" opacity="0.55"><line x1="6" y1="23" x2="13" y2="10"/><line x1="13" y1="10" x2="21" y2="19"/><line x1="21" y1="19" x2="27" y2="7"/><line x1="21" y1="19" x2="15" y2="27"/></g><g fill="${color}"><circle cx="6" cy="23" r="2.6"/><circle cx="13" cy="10" r="3"/><circle cx="21" cy="19" r="3.4"/><circle cx="27" cy="7" r="2.4"/><circle cx="15" cy="27" r="2.2"/></g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** The title is sized by its length, so a long name never runs off the card. */
export function titleSize(title: string): number {
  if (title.length <= 22) return 92;
  if (title.length <= 36) return 76;
  return 60;
}

const PADDING = 72;

/** The tree of boxes and text for one card, 1200 by 630. */
export function cardNode(card: ShareCard, palette: SharePalette = sharePalette()): Node {
  const text = (value: string, style: Record<string, string | number>): Node => ({
    type: "text",
    text: value,
    style,
  });

  return {
    type: "container",
    style: {
      width: SHARE_IMAGE.width,
      height: SHARE_IMAGE.height,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: PADDING,
      backgroundColor: palette.bg,
      backgroundImage: `radial-gradient(circle at 88% 0%, ${palette.glowPrimary}, ${palette.glowPrimaryClear} 55%), radial-gradient(circle at 100% 100%, ${palette.glowSecondary}, ${palette.glowSecondaryClear} 45%)`,
      color: palette.fg,
      fontFamily: "Geist",
    },
    children: [
      {
        type: "container",
        style: { display: "flex", alignItems: "center", gap: 16 },
        children: [
          { type: "image", src: constellationMark(palette.brand), width: 56, height: 56 },
          text(site.name, { fontSize: 32, fontWeight: 650, color: palette.fg }),
        ],
      },
      {
        type: "container",
        style: { display: "flex", flexDirection: "column", gap: 24, maxWidth: 1000 },
        children: [
          ...(card.label
            ? [
                {
                  type: "container",
                  style: {
                    display: "flex",
                    alignSelf: "flex-start",
                    padding: "8px 20px",
                    borderRadius: 999,
                    backgroundColor: palette.brandSoft,
                  },
                  children: [
                    text(card.label, { fontSize: 26, fontWeight: 600, color: palette.brandSoftFg }),
                  ],
                } satisfies Node,
              ]
            : []),
          text(card.title, {
            fontSize: titleSize(card.title),
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
            color: palette.fg,
          }),
          text(card.subtitle, { fontSize: 34, lineHeight: 1.3, color: palette.fgMuted }),
        ],
      },
    ],
  };
}

/** The page each card belongs to, for a test that wants to walk cards and pages together. */
export function pageOfCard(card: ShareCard): string {
  if (card.slug === "home") return "/";
  const category = categories.find((item) => item.slug === card.slug);
  return category ? categoryHref(category) : `/${card.slug}/`;
}

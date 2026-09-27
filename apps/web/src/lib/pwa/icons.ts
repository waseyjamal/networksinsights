// The app icons and favicons, drawn at build time from the constellation mark (ADR 0052). This file
// is pure: it builds the trees and the SVG. icon-render.ts draws them.

import type { Node } from "@takumi-rs/core";
import { constellationMark, sharePalette } from "../seo/og";
import type { AppIcon } from "./paths";

/** The colors of every icon: the dark theme's page with the brand mark, like the share images. */
export function iconColors(): { background: string; mark: string } {
  const palette = sharePalette();
  return { background: palette.bg, mark: palette.brand };
}

/**
 * How much of the icon the mark takes. An `any` icon is a rounded square with the mark large in it.
 * A maskable icon fills the square, and the mark stays well inside the safe zone: the circle of
 * 40 percent radius in the middle that every launcher mask keeps (W3C Manifest, "purpose").
 */
export const MARK_SHARE = { any: 0.68, maskable: 0.5 } as const;
/** The corner radius of an `any` icon, as a share of its size. */
export const CORNER_SHARE = 0.22;

export function iconNode(icon: Pick<AppIcon, "size" | "purpose">): Node {
  const { background, mark } = iconColors();
  const markSize = Math.round(icon.size * MARK_SHARE[icon.purpose]);
  return {
    type: "container",
    style: {
      width: icon.size,
      height: icon.size,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: background,
      borderRadius: icon.purpose === "any" ? Math.round(icon.size * CORNER_SHARE) : 0,
    },
    children: [{ type: "image", src: constellationMark(mark), width: markSize, height: markSize }],
  };
}

/** /favicon.svg: the `any` icon as a vector, so it is sharp at every size. */
export function faviconSvg(): string {
  const { background, mark } = iconColors();
  const inset = Number(((32 * (1 - MARK_SHARE.any)) / 2).toFixed(2));
  const scale = MARK_SHARE.any;
  const radius = Number((32 * CORNER_SHARE).toFixed(2));
  const decoded = decodeURIComponent(
    constellationMark(mark).replace(/^data:image\/svg\+xml;utf8,/, ""),
  );
  const inner = decoded.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${radius}" fill="${background}"/><g transform="translate(${inset} ${inset}) scale(${scale})">${inner}</g></svg>`;
}

/**
 * An ICO file that holds PNG images, one per size. Every browser that reads /favicon.ico on its
 * own accepts PNG entries (Windows Vista and later, all current browsers).
 */
export function icoOf(images: ReadonlyArray<{ size: number; png: Uint8Array }>): Uint8Array {
  const header = 6;
  const entry = 16;
  let offset = header + entry * images.length;
  const total = offset + images.reduce((sum, image) => sum + image.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon
  view.setUint16(4, images.length, true);
  images.forEach((image, index) => {
    const at = header + entry * index;
    // 0 means 256 in the one-byte width and height fields.
    view.setUint8(at, image.size >= 256 ? 0 : image.size);
    view.setUint8(at + 1, image.size >= 256 ? 0 : image.size);
    view.setUint8(at + 2, 0); // no palette
    view.setUint8(at + 3, 0); // reserved
    view.setUint16(at + 4, 1, true); // color planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, image.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(image.png, offset);
    offset += image.png.length;
  });
  return out;
}

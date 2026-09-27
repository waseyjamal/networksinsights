// Draws the app icons to PNG with the share images' renderer, Takumi (ADR 0041, ADR 0052). The
// icons have no text, so no font is registered. Same icon, same bytes.

import { Renderer } from "@takumi-rs/core";
import { iconNode } from "./icons";
import type { AppIcon } from "./paths";

let renderer: Renderer | undefined;

export async function renderIcon(icon: Pick<AppIcon, "size" | "purpose">): Promise<Uint8Array> {
  renderer ??= new Renderer();
  const png = await renderer.render(iconNode(icon), {
    width: icon.size,
    height: icon.size,
    format: "png",
  });
  return new Uint8Array(png);
}

// The web app manifest and the app icons (ADR 0052). The name comes from config/site.ts and the
// colors from tokens.css, so the installed app looks like the site and nothing is typed twice.

import { site } from "../../config/site";
import tokensCss from "../../styles/tokens.css?raw";
import { toHex } from "../color";
import { parseTokens, themeColors } from "../tokens";
import { appIcons, iconPath } from "./paths";

/** The page background of a theme, as hex, from tokens.css. */
export function themeBackground(theme: "light" | "dark", css = tokensCss): string {
  const bg = themeColors(parseTokens(css), theme).get("bg");
  if (!bg) throw new Error("tokens.css has no --bg token");
  return toHex(bg);
}

export function webManifest() {
  return {
    id: "/",
    name: site.name,
    short_name: site.name,
    description: site.description,
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The splash screen and the title bar before the page paints, from the light theme like the
    // default <meta name="theme-color">. A page then sets its own from the visitor's theme.
    background_color: themeBackground("light"),
    theme_color: themeBackground("light"),
    categories: ["utilities", "productivity"],
    icons: appIcons
      .filter((icon) => icon.name !== "apple-touch-icon")
      .map((icon) => ({
        src: iconPath(icon),
        sizes: `${icon.size}x${icon.size}`,
        type: "image/png",
        purpose: icon.purpose,
      })),
    // A Trusted Web Activity (the Play Store app) will add `related_applications` when it exists
    // (docs/runbooks/play-store-twa.md). Until then the site never asks to install an app instead.
    prefer_related_applications: false,
  };
}

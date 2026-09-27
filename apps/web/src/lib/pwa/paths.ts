// The addresses of the installable app's files (ADR 0052). Plain data: the build integration that
// writes sw.js reads it in Node, so it imports nothing.

export const MANIFEST_PATH = "/manifest.webmanifest";

/** The page shown for a page that was never kept on the device. */
export const OFFLINE_PATH = "/offline/";

/** One app icon: a square PNG of the constellation mark on the brand background. */
export interface AppIcon {
  /** The file name under /icons/, without `.png`. */
  name: string;
  size: number;
  /**
   * `any` icons draw the mark at the size of the wordmark's mark. `maskable` icons keep it inside
   * the middle 80 percent, the safe zone a launcher's mask never cuts (W3C Manifest, "purpose").
   */
  purpose: "any" | "maskable";
}

export const appIcons: readonly AppIcon[] = [
  { name: "icon-192", size: 192, purpose: "any" },
  { name: "icon-512", size: 512, purpose: "any" },
  { name: "maskable-192", size: 192, purpose: "maskable" },
  { name: "maskable-512", size: 512, purpose: "maskable" },
  // iOS home screen icon (<link rel="apple-touch-icon">). iOS draws its own rounded corners and
  // does not read the manifest's icons, so it gets the full-bleed, maskable layout.
  { name: "apple-touch-icon", size: 180, purpose: "maskable" },
];

export const iconPath = (icon: Pick<AppIcon, "name">) => `/icons/${icon.name}.png`;

/** Every icon file, for the service worker's shell. */
export const iconFiles = () => appIcons.map(iconPath);

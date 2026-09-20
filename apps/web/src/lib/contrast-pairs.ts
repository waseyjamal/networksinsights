// The text/background and UI-part pairs the design system promises to keep accessible.
// tokens.test.ts fails the build if a pair drops below its minimum in either theme, and the
// /design-system page prints the same pairs with their measured ratios.

/** WCAG 2.2 AA: body text (SC 1.4.3). */
export const TEXT = 4.5;
/** WCAG 2.2 AA: large text and UI parts (SC 1.4.3, SC 1.4.11). */
export const UI = 3;

export const surfaces = ["bg", "surface", "surface-raised", "surface-sunken"] as const;

export const categories = [
  "pdf",
  "image",
  "video-audio",
  "text",
  "calculators",
  "converters",
  "generators",
  "developer",
  "web-seo",
  "color-design",
  "date-time",
] as const;

export const tones = ["success", "warning", "danger", "info"] as const;

export interface Pair {
  /** Token of the foreground (text, icon or border). */
  fg: string;
  /** Token of the background it sits on. */
  bg: string;
  /** Minimum contrast ratio. */
  min: number;
  /** Where the pair is used. */
  note?: string;
}

export function pairs(): Pair[] {
  const list: Pair[] = [];
  for (const s of surfaces) {
    list.push({ fg: "fg", bg: s, min: TEXT, note: "body text" });
    list.push({ fg: "fg-muted", bg: s, min: TEXT, note: "secondary text" });
    list.push({ fg: "fg-subtle", bg: s, min: TEXT, note: "placeholders, captions" });
    list.push({ fg: "brand-text", bg: s, min: TEXT, note: "links" });
    for (const t of tones) list.push({ fg: `${t}-text`, bg: s, min: TEXT, note: `${t} text` });
    // UI parts that sit directly on a surface: control borders, focus ring, brand UI, tones.
    list.push({ fg: "border-strong", bg: s, min: UI, note: "control borders" });
    list.push({ fg: "ring", bg: s, min: UI, note: "focus ring" });
    list.push({ fg: "brand-ui", bg: s, min: UI, note: "checked controls, progress" });
    for (const t of tones) list.push({ fg: t, bg: s, min: UI, note: `${t} icon and border` });
    for (const c of categories)
      list.push({ fg: `cat-${c}`, bg: s, min: UI, note: "category icon" });
  }
  list.push({ fg: "brand-fg", bg: "brand", min: TEXT, note: "primary button" });
  list.push({ fg: "brand-fg", bg: "brand-hover", min: TEXT, note: "primary button, hover" });
  list.push({ fg: "brand-fg", bg: "brand-active", min: TEXT, note: "primary button, pressed" });
  list.push({ fg: "brand-ui-fg", bg: "brand-ui", min: UI, note: "check mark, switch thumb" });
  list.push({ fg: "brand-soft-fg", bg: "brand-soft", min: TEXT, note: "brand badge" });
  list.push({ fg: "brand-text", bg: "brand-soft", min: TEXT, note: "link on tint" });
  list.push({ fg: "fg", bg: "brand-soft", min: TEXT, note: "text on tint" });
  for (const t of tones) {
    list.push({ fg: `${t}-text`, bg: `${t}-soft`, min: TEXT, note: `${t} badge, alert title` });
    list.push({ fg: "fg", bg: `${t}-soft`, min: TEXT, note: `${t} alert body` });
    list.push({ fg: t, bg: `${t}-soft`, min: UI, note: `${t} alert icon` });
  }
  list.push({ fg: "on-danger", bg: "danger-solid", min: TEXT, note: "danger button" });
  list.push({ fg: "on-danger", bg: "danger-solid-hover", min: TEXT, note: "danger button, hover" });
  list.push({ fg: "inverse-fg", bg: "inverse", min: TEXT, note: "tooltip" });
  // A checked control or progress bar must stand out from its track.
  list.push({ fg: "brand-ui", bg: "surface-sunken", min: UI, note: "progress bar on track" });
  list.push({ fg: "border-strong", bg: "brand-soft", min: UI, note: "border on tint" });
  // Dropzone in its hover and active state.
  list.push({ fg: "fg-muted", bg: "brand-soft", min: TEXT, note: "dropzone hint" });
  list.push({ fg: "fg-subtle", bg: "brand-soft", min: TEXT, note: "dropzone hint" });
  list.push({ fg: "brand-ui", bg: "brand-soft", min: UI, note: "dropzone border" });
  return list;
}

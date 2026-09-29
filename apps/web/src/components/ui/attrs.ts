// Framework-neutral markup contract of the design system.
//
// Styles live in ONE place: src/styles/components.css. The Astro components and the React
// components both call these helpers, so they emit the same class names, data attributes and
// ARIA attributes. attrs.parity.test.ts renders both and fails if the markup drifts.

import type { IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ControlSize = "sm" | "md" | "lg";
export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
export type AlertTone = "info" | "success" | "warning" | "danger";
export type CardPadding = "none" | "sm" | "md" | "lg";
export type SkeletonShape = "text" | "circle" | "rect";
export type DropzoneState = "idle" | "active" | "error";
export type TooltipSide = "top" | "bottom";
/** Where a file is in a tool's work: waiting its turn, being worked on, finished, or failed. */
export type FileResultState = "waiting" | "working" | "done" | "error";

export const PRIVACY_TEXT = "Runs in your browser — files never leave your device";

/** Joins class names, skipping empty values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function buttonAttrs({
  variant = "secondary",
  size = "md",
  loading = false,
}: {
  variant?: ButtonVariant | undefined;
  size?: ControlSize | undefined;
  loading?: boolean | undefined;
}) {
  return {
    "data-variant": variant,
    "data-size": size,
    // A loading button stays focusable (no `disabled`), so keyboard users do not lose their place.
    ...(loading
      ? { "data-loading": "true", "aria-busy": "true" as const, "aria-disabled": "true" as const }
      : {}),
  };
}

/** Hint and error wiring shared by Input, Textarea and Select. */
export function controlAttrs({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return {
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": "true" as const } : {}),
  };
}

export function badgeAttrs({ tone = "neutral" }: { tone?: BadgeTone | undefined }) {
  return { "data-tone": tone };
}

export function cardAttrs({
  padding = "md",
  interactive = false,
}: {
  padding?: CardPadding | undefined;
  interactive?: boolean | undefined;
}) {
  return {
    "data-padding": padding,
    ...(interactive ? { "data-interactive": "true" } : {}),
  };
}

/** One card of a ToolCardList. Every field comes from a tool's manifest and its category. */
export interface ToolCardItem {
  href: string;
  name: string;
  summary: string;
  /** Category id: tints the icon chip (data-cat). */
  category: string;
  icon: IconName;
  /** True for a beta tool: the card shows a "Beta" badge. */
  beta?: boolean | undefined;
}

/** One number of a StatGrid. `value` is already formatted (digits grouped, units added). */
export interface StatItem {
  label: string;
  value: string;
  /** A stable hook for tests and scripts, set as data-stat. */
  id?: string | undefined;
}

/**
 * One run of a MatchText. A segment with `match` is drawn as a highlighted match, and `match` is
 * its number, set as data-match; a segment without it is plain text between matches.
 */
export interface MatchSegment {
  text: string;
  match?: number | undefined;
}

export const alertIcon: Record<AlertTone, IconName> = {
  info: "info",
  success: "check-circle",
  warning: "alert",
  danger: "x-circle",
};

export function alertAttrs({ tone = "info" }: { tone?: AlertTone | undefined }) {
  // Errors interrupt (role="alert"); the rest are polite status messages.
  return { "data-tone": tone, role: tone === "danger" ? ("alert" as const) : ("status" as const) };
}

/** Progress value as a percentage string for the --ni-value custom property. */
export function progressPercent(value: number | undefined): string {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  return `${Math.round(clamped * 10) / 10}%`;
}

export function progressAttrs({ value, label }: { value?: number | undefined; label: string }) {
  const indeterminate = value === undefined;
  return {
    role: "progressbar" as const,
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    ...(indeterminate
      ? { "data-indeterminate": "true" }
      : { "aria-valuenow": Math.round(Math.min(100, Math.max(0, value))) }),
  };
}

export function skeletonAttrs({ shape = "text" }: { shape?: SkeletonShape | undefined }) {
  return { "data-shape": shape, "aria-hidden": "true" as const };
}

export function dropzoneAttrs({
  state = "idle",
  disabled = false,
}: {
  state?: DropzoneState | undefined;
  disabled?: boolean | undefined;
}) {
  return { "data-state": state, ...(disabled ? { "aria-disabled": "true" as const } : {}) };
}

export function fileResultAttrs({ state = "waiting" }: { state?: FileResultState | undefined }) {
  return { "data-state": state, ...(state === "working" ? { "aria-busy": "true" as const } : {}) };
}

export function tooltipAttrs({ side = "top" }: { side?: TooltipSide | undefined }) {
  return { "data-side": side };
}

export interface TabItem {
  id: string;
  label: string;
}

export const tabIds = (prefix: string, id: string) => ({
  tab: `${prefix}-tab-${id}`,
  panel: `${prefix}-panel-${id}`,
});

export function tabAttrs(prefix: string, id: string, selected: boolean) {
  const ids = tabIds(prefix, id);
  return {
    role: "tab" as const,
    id: ids.tab,
    "aria-controls": ids.panel,
    "aria-selected": selected ? ("true" as const) : ("false" as const),
    tabIndex: selected ? 0 : -1,
  };
}

export function tabPanelAttrs(prefix: string, id: string) {
  const ids = tabIds(prefix, id);
  return { role: "tabpanel" as const, id: ids.panel, "aria-labelledby": ids.tab, tabIndex: 0 };
}

/** Moves between tabs with the WAI-ARIA Tabs keys. Returns the new index, or null for other keys. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export const themeOptions = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
] as const satisfies ReadonlyArray<{ value: string; label: string; icon: IconName }>;

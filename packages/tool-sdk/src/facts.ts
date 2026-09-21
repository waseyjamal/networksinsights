// The "Quick facts" of a tool page, built only from the manifest (ADR 0044).
//
// A fact is either a constant that is true of every tool on the site (free, no sign-up) or a value
// read from the manifest. Nothing here is typed in by a tool author, so a page cannot claim a
// limit that does not exist or say a file stays on the device when the runtime sends it to us.
// The same list feeds the visible definition list, the structured data and their tests.
//
// This file imports only types, so the page, the scripts and the tests can all use it.

import { privacyStatement } from "./privacy";
import type { IsoDate, ToolLimits, ToolManifest } from "./types";

export type QuickFactId =
  | "price"
  | "signup"
  | "runs"
  | "uploaded"
  | "limits"
  | "accepts"
  | "produces"
  | "updated";

export interface QuickFact {
  id: QuickFactId;
  /** The term shown in the definition list. */
  label: string;
  /** The definition shown next to it. */
  value: string;
}

/** The part of a manifest the facts are read from. */
export type QuickFactsSource = Pick<
  ToolManifest,
  "runtime" | "limits" | "accepts" | "produces" | "updated"
>;

/** What the limits line says when the manifest sets none. Every tool ships this way today. */
export const NO_FIXED_LIMIT = "No fixed limit";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * `2026-09-21` as `September 21, 2026`. Read from the text, never through a `Date` and a time
 * zone, so the page says the same thing on every machine that builds it.
 */
export function formatIsoDate(date: IsoDate): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = MONTHS[Number(match?.[2]) - 1];
  if (!match || month === undefined) throw new Error(`Not an ISO date: ${date}`);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/** Bytes as a person reads them: `500 bytes`, `5 MB`, `1.5 GB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number.parseFloat(value.toFixed(1))} ${units[unit]}`;
}

/** The limits of a tool as one line, or "No fixed limit" when the manifest sets none. */
export function describeLimits(limits: ToolLimits | undefined): string {
  const parts: string[] = [];
  if (limits?.maxInputBytes !== undefined) {
    parts.push(`Up to ${formatBytes(limits.maxInputBytes)} per input`);
  }
  if (limits?.maxFiles !== undefined) {
    parts.push(`Up to ${limits.maxFiles} ${limits.maxFiles === 1 ? "file" : "files"} at once`);
  }
  if (limits?.maxRunsPerDay !== undefined) {
    parts.push(`Up to ${limits.maxRunsPerDay} runs per day`);
  }
  return parts.length > 0 ? parts.join("; ") : NO_FIXED_LIMIT;
}

/**
 * The quick facts of a tool, in the order the page shows them. `accepts` and `produces` appear
 * only when the manifest lists formats; everything else is always there.
 */
export function quickFacts(manifest: QuickFactsSource): QuickFact[] {
  const onDevice = privacyStatement(manifest.runtime).onDevice;
  const facts: QuickFact[] = [
    { id: "price", label: "Price", value: "Free" },
    { id: "signup", label: "Sign-up", value: "Not required" },
    {
      id: "runs",
      label: "Where it runs",
      value: onDevice ? "On your device" : "On our server",
    },
    { id: "uploaded", label: "Files uploaded", value: onDevice ? "No" : "Yes" },
    { id: "limits", label: "Limits", value: describeLimits(manifest.limits) },
  ];
  if (manifest.accepts && manifest.accepts.length > 0) {
    facts.push({ id: "accepts", label: "Accepts", value: manifest.accepts.join(", ") });
  }
  if (manifest.produces && manifest.produces.length > 0) {
    facts.push({ id: "produces", label: "Produces", value: manifest.produces.join(", ") });
  }
  facts.push({ id: "updated", label: "Updated", value: formatIsoDate(manifest.updated) });
  return facts;
}

// The manifest schema and defineTool(). Zod 4 (ADR 0006).
//
// defineTool() does not validate. It types the manifest so the editor catches most mistakes while
// the tool is being written, and returns it unchanged. Validation happens once, centrally, in
// validateTools(), which knows the folder each manifest came from and can name it in the error
// (ADR 0033). A schema error thrown from inside a tool.config.ts would not know that.

import { z } from "zod";
import type { ToolManifest } from "./types";

/** Lowercase words joined by single hyphens. Digits are allowed: `base64-encoder`, `sha-256`. */
export const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `YYYY-MM-DD`, and a date that really exists. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The longest summary that search engines will show in full. */
export const SUMMARY_MAX_LENGTH = 160;

const kebabCase = (label: string) =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .regex(KEBAB_CASE, `${label} must be kebab-case (lowercase words joined by single hyphens)`);

const isoDate = (label: string) =>
  z
    .string()
    .regex(ISO_DATE, `${label} must be an ISO date, YYYY-MM-DD`)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    }, `${label} must be a real calendar date`);

const positiveInt = (label: string) => z.int().positive(`${label} must be a positive whole number`);

export const toolLimitsSchema = z.strictObject({
  maxInputBytes: positiveInt("limits.maxInputBytes").optional(),
  maxFiles: positiveInt("limits.maxFiles").optional(),
  maxRunsPerDay: positiveInt("limits.maxRunsPerDay").optional(),
});

/**
 * The manifest schema. `input` is checked for being a Zod schema, not for its shape: what a tool
 * accepts is the tool's business.
 *
 * Summaries may contain digits. Real tool names do (Base64, SHA-256, MP4, UTF-8, H.264). Invented
 * counts are kept out by the "never invent content" rule in AGENTS.md and by review, not by a
 * character ban that would block honest names.
 */
export const toolManifestSchema = z.strictObject({
  id: kebabCase("id"),
  name: z.string().min(1, "name must not be empty").max(60, "name must be at most 60 characters"),
  category: kebabCase("category"),
  summary: z
    .string()
    .min(20, "summary must be at least 20 characters")
    .max(
      SUMMARY_MAX_LENGTH - 1,
      `summary must be under ${SUMMARY_MAX_LENGTH} characters, because it is the meta description`,
    ),
  tags: z
    .array(kebabCase("each tag"))
    .min(1, "tags must have at least one tag")
    .max(8, "tags must have at most eight tags")
    .refine((tags) => new Set(tags).size === tags.length, "tags must not repeat"),
  runtime: z.enum(["client", "worker", "server"]),
  status: z.enum(["beta", "stable", "deprecated"]),
  input: z.custom<z.ZodType>(
    (value) => value instanceof z.ZodType,
    "input must be a Zod schema (ADR 0006)",
  ),
  related: z
    .array(kebabCase("each related id"))
    .max(6, "related must have at most six tool ids")
    .refine((ids) => new Set(ids).size === ids.length, "related must not repeat a tool id"),
  limits: toolLimitsSchema.optional(),
  added: isoDate("added"),
  updated: isoDate("updated"),
});

/**
 * Types a tool manifest and returns it unchanged. Every `tool.config.ts` default-exports this.
 *
 * ```ts
 * export default defineTool({ id: "word-counter", ... });
 * ```
 */
export function defineTool<const TManifest extends ToolManifest>(manifest: TManifest): TManifest {
  return manifest;
}

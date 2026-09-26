// The per-tool security override (ADR 0047). Every page gets the same strict headers. A tool that
// genuinely needs more (cross-origin isolation for multi-threaded WebAssembly, or one more
// origin to fetch from) says so in its manifest, names the ADR that approved it, and gets it on
// its own page only. `pnpm check:tools` fails if that ADR is missing or not accepted.

import { z } from "zod";

/**
 * The only directives an override may widen. Scripts and styles are never among them: a tool can
 * never allow inline code or a script from another origin.
 */
export const EXTENDABLE_DIRECTIVES = [
  "connect-src",
  "img-src",
  "media-src",
  "font-src",
  "worker-src",
] as const;

export type ExtendableDirective = (typeof EXTENDABLE_DIRECTIVES)[number];

/**
 * An HTTPS origin, optionally with a leading wildcard label: `https://api.example.com`,
 * `https://*.example.com`. No path, no keyword, no scheme-only source: nothing that widens a
 * policy further than one named service.
 */
export const HTTPS_ORIGIN =
  /^https:\/\/(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?$/;

export const toolSecuritySchema = z
  .strictObject({
    adr: z
      .string()
      .regex(/^\d{4}$/, "security.adr must be the four-digit number of the ADR that approved it"),
    crossOriginIsolated: z.literal(true).optional(),
    sources: z
      .partialRecord(
        z.enum(EXTENDABLE_DIRECTIVES),
        z
          .array(
            z
              .string()
              .regex(
                HTTPS_ORIGIN,
                "each security source must be an https origin such as https://api.example.com, with no path and no keyword",
              ),
          )
          .min(1)
          .max(8),
      )
      .optional(),
  })
  .refine(
    (security) => security.crossOriginIsolated === true || security.sources !== undefined,
    "security must ask for crossOriginIsolated or sources; remove it if the defaults are enough",
  );

/** The directives an override adds to its page's policy: `["connect-src https://api.example.com"]`. */
export function overrideDirectives(security: {
  sources?: Partial<Record<ExtendableDirective, readonly string[]>> | undefined;
}): Array<`${ExtendableDirective} ${string}`> {
  return EXTENDABLE_DIRECTIVES.flatMap((directive) => {
    const sources = security.sources?.[directive];
    return sources && sources.length > 0 ? [`${directive} ${sources.join(" ")}` as const] : [];
  });
}

/** The marker the tool page carries, which the security-headers integration reads. */
export function overrideMarker(security: {
  adr: string;
  crossOriginIsolated?: true | undefined;
}): string {
  return `adr=${security.adr}${security.crossOriginIsolated ? "; cross-origin-isolated" : ""}`;
}

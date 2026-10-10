// /.well-known/security.txt, generated (RFC 9116). The file says where to report a problem with
// the site. `Expires` is a fixed date that someone renews on purpose: a date computed at build time
// would never expire, which is exactly what RFC 9116 asks a file not to do. The test fails once the
// date has passed, and `pnpm check:seo` fails on a build whose file has expired.

import { site } from "../../config/site";

export const securityTxt = {
  contact: "mailto:contact@networksinsights.com",
  /** RFC 9116 wants a date-time with a zone. Renew it before it passes. */
  expires: "2027-10-10T00:00:00.000Z",
} as const;

export const SECURITY_TXT_PATH = "/.well-known/security.txt";

export function buildSecurityTxt(input: { contact: string; expires: string; url: string }): string {
  return `${[
    "# NetworksInsights security.txt (RFC 9116). Generated: do not edit by hand.",
    `Contact: ${input.contact}`,
    `Expires: ${input.expires}`,
    "Preferred-Languages: en",
    `Canonical: ${input.url}${SECURITY_TXT_PATH}`,
  ].join("\n")}\n`;
}

export const securityTxtBody = () => buildSecurityTxt({ ...securityTxt, url: site.url });

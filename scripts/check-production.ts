// pnpm check:production [--url <site>] [--attempts <n>] [--preview]
//
// Requests the live site and checks what the SEO work depends on: above all, that /tools answers
// with a permanent redirect to /tools/ (docs/runbooks/seo-redirects.md). CI runs it after every
// production deploy, retrying for about a minute while the deploy settles. It fails until the
// redirect rule exists in the Cloudflare dashboard. It also checks every security and cache
// header (ADR 0047, ADR 0048). With --preview it checks a preview deployment on workers.dev: the
// same headers plus X-Robots-Tag: noindex, and no redirect; CI runs it on each pull request's
// preview. Exit code 0 means every check passed, 1 that one failed, 2 that the command was used
// wrongly.

import { parseArgs } from "node:util";
import { site } from "../apps/web/src/config/site";
import { formatChecks, runWithRetries } from "./lib/production";

const HELP = `Usage: pnpm check:production [--url <site>] [--attempts <n>] [--preview]

  --url <site>      the site to check; defaults to ${site.url}
  --attempts <n>    try up to n times, ten seconds apart, before failing (default 1)
  --preview         the site is a preview deployment: expect noindex, skip the redirect
  --help            show this text`;

async function main(): Promise<number> {
  let values: {
    url?: string | undefined;
    attempts?: string | undefined;
    preview?: boolean | undefined;
    help?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        url: { type: "string" },
        attempts: { type: "string" },
        preview: { type: "boolean" },
        help: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const attempts = values.attempts === undefined ? 1 : Number(values.attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
    console.error(`--attempts must be a whole number from 1 to 60.\n\n${HELP}`);
    return 2;
  }

  const base = values.url ?? site.url;
  if (values.preview && values.url === undefined) {
    console.error(`--preview needs --url <the preview address>.\n\n${HELP}`);
    return 2;
  }
  const checks = await runWithRetries({
    base,
    attempts,
    launched: site.launched,
    preview: values.preview ?? false,
  });
  console.log(formatChecks(checks, base));
  return checks.every((check) => check.ok) ? 0 : 1;
}

process.exit(await main());

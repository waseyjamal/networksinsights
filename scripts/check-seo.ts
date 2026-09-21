// pnpm check:seo [--dist <folder>] [--json]
//
// Checks the build output (apps/web/dist) for what search engines and share previews will read:
// canonical links, Open Graph and Twitter/X tags, share images, structured data, robots.txt,
// sitemaps and llms.txt (ADR 0038 to 0041). Run it after `pnpm build`; CI does. Exit code 0 means
// everything agrees; 1 means a problem; 2 means the command was used wrongly.

import { join } from "node:path";
import { parseArgs } from "node:util";
import { site } from "../apps/web/src/config/site";
import { checkSeo, formatSeoReport } from "./lib/seo";
import { repoRoot } from "./lib/tools";

const HELP = `Usage: pnpm check:seo [--dist <folder>] [--json]

Checks the build output for canonical links, Open Graph and Twitter/X tags, share images,
structured data, robots.txt, sitemaps and llms.txt, so run \`pnpm build\` first.

  --dist <path>   the build output; defaults to apps/web/dist
  --json          print the result as JSON
  --help          show this text`;

function main(): number {
  let values: { dist?: string | undefined; json?: boolean | undefined; help?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      options: {
        dist: { type: "string" },
        json: { type: "boolean" },
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

  const dist = values.dist ?? join(repoRoot, "apps", "web", "dist");
  const report = checkSeo({ dist, launched: site.launched });
  console.log(
    values.json
      ? JSON.stringify(
          { ok: report.problems.length === 0, launched: site.launched, ...report },
          null,
          2,
        )
      : formatSeoReport(report, dist),
  );
  return report.problems.length === 0 ? 0 : 1;
}

process.exit(main());

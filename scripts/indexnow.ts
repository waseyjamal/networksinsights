// pnpm indexnow snapshot --out <folder>
// pnpm indexnow submit --previous <folder> [--dist <folder>]
//
// Tells search engines which URLs changed in a production deploy (ADR 0042). CI runs `snapshot`
// before it deploys and `submit` after. The key comes from the INDEXNOW_KEY environment variable.
// Exit code 0 means it did its job or had a good reason not to; 1 means IndexNow or the key file
// failed; 2 means the command was used wrongly. CI runs it with `continue-on-error`.

import { join } from "node:path";
import { parseArgs } from "node:util";
import { snapshotLive, submitChanged } from "./lib/indexnow-run";
import { repoRoot } from "./lib/tools";

const HELP = `Usage:
  pnpm indexnow snapshot --out <folder>
  pnpm indexnow submit --previous <folder> [--dist <folder>]

  snapshot   save the sitemaps that are live now (run before the deploy)
  submit     announce the URLs that are new or changed since the snapshot (run after it)

  --out <path>        where snapshot saves the sitemaps
  --previous <path>   the folder snapshot saved into
  --dist <path>       the build output; defaults to apps/web/dist
  --help              show this text`;

async function main(): Promise<number> {
  let values: {
    out?: string | undefined;
    previous?: string | undefined;
    dist?: string | undefined;
    help?: boolean | undefined;
  };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      options: {
        out: { type: "string" },
        previous: { type: "string" },
        dist: { type: "string" },
        help: { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}

${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const [command] = positionals;
  if (command === "snapshot" && typeof values.out === "string") {
    const saved = await snapshotLive({ dir: values.out });
    console.log(
      saved.length === 0
        ? "The live site has no sitemap yet, so this deploy will announce every URL."
        : `Saved ${saved.length} live sitemap ${saved.length === 1 ? "file" : "files"}: ${saved.join(", ")}`,
    );
    return 0;
  }
  if (command === "submit" && typeof values.previous === "string") {
    const dist =
      typeof values.dist === "string" ? values.dist : join(repoRoot, "apps", "web", "dist");
    const outcome = await submitChanged({
      dist,
      previousDir: values.previous,
      key: process.env.INDEXNOW_KEY?.trim(),
    });
    console.log(`IndexNow: ${outcome.message}`);
    return outcome.status === "failed" ? 1 : 0;
  }
  console.error(HELP);
  return 2;
}

process.exit(await main());

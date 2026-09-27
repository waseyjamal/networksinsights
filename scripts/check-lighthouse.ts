// pnpm check:lighthouse [--runs <n>] [--page <path>] [--json] [--out <folder>]
//
// The site-wide performance budgets (ADR 0052): Lighthouse, on its default mobile profile, against
// the production build in apps/web/dist, on the home page, /tools/, one category page and every
// tool page. Each page is measured several times and judged on the median, because one run on a
// shared machine can be slow by chance. Run it after `pnpm build`. CI runs it on every pull request.
//
// The build is served by `astro preview`, the main E2E server. It sends every file uncompressed,
// where Cloudflare sends brotli, so the numbers here are a little worse than production's: a page
// within budget here is within budget live. Chrome is the Chromium that Playwright installs
// (`pnpm --filter web exec playwright install chromium`).
//
// Exit code 0 means every page is within budget; 1 means a page is over, or a run failed; 2 means
// the command was used wrongly.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import lighthouse from "lighthouse";
import {
  CATEGORIES,
  formatResults,
  judge,
  keyPages,
  type PageResult,
  type Run,
  runOf,
} from "./lib/lighthouse";
import { defaultToolsRoot, listToolFolders, repoRoot } from "./lib/tools";

const HELP = `Usage: pnpm check:lighthouse [--runs <n>] [--page <path>] [--json] [--out <folder>]

Measures the key pages of the build with Lighthouse (mobile), so run \`pnpm build\` first.

  --runs <n>      runs per page, judged on the median (default 3)
  --page <path>   measure one page, such as /word-counter/
  --json          print the result as JSON
  --out <folder>  also write each page's last report there, as HTML and JSON
  --help          show this text`;

const webDir = join(repoRoot, "apps", "web");
const PORT = 8790;
const origin = `http://127.0.0.1:${PORT}`;

/** Starts `astro preview` over dist and waits until it answers. */
async function startServer(): Promise<ChildProcess> {
  // Astro's own entry point, run by this Node: no shell, no pnpm in between, one process to stop.
  const astroPackage = createRequire(join(webDir, "package.json")).resolve("astro/package.json");
  const astro = join(dirname(astroPackage), "bin", "astro.mjs");
  const server = spawn(
    process.execPath,
    [astro, "preview", "--host", "127.0.0.1", "--port", String(PORT)],
    {
      cwd: webDir,
      // Astro starts the preview server in the background when it detects a coding agent; this
      // keeps it in the foreground, as the E2E config does (ADR 0043).
      env: { ...process.env, ASTRO_PREVIEW_BACKGROUND: "false" },
      stdio: "ignore",
    },
  );
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${origin}/`)).ok) return server;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stop(server);
  throw new Error(`astro preview did not answer on ${origin} within two minutes`);
}

/** Starts Playwright's Chromium with a DevTools port for Lighthouse, and returns the port. */
async function startChrome(profile: string): Promise<{ chrome: ChildProcess; port: number }> {
  const require = createRequire(join(webDir, "package.json"));
  const { chromium } = require("@playwright/test") as {
    chromium: { executablePath(): string };
  };
  const chrome = spawn(
    chromium.executablePath(),
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-gpu",
      // GitHub's Ubuntu runners do not allow Chrome's sandbox; Playwright turns it off there too.
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const port = await new Promise<number>((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${log}`)), 30_000);
    chrome.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    chrome.on("exit", (code) => reject(new Error(`Chrome exited with ${code}:\n${log}`)));
  });
  return { chrome, port };
}

/** Stops a process and waits, at most five seconds, until it has exited. */
async function stopAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  stop(child);
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
}

function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  // Chrome starts helper processes: on Windows end the whole tree.
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
  else child.kill("SIGTERM");
}

async function main(): Promise<number> {
  let values: {
    runs?: string | undefined;
    page?: string | undefined;
    json?: boolean | undefined;
    out?: string | undefined;
    help?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        runs: { type: "string" },
        page: { type: "string" },
        json: { type: "boolean" },
        out: { type: "string" },
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
  const runs = Number(values.runs ?? 3);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error(`--runs takes a whole number of at least 1.\n\n${HELP}`);
    return 2;
  }

  // A tool's folder name is its id and its URL (docs/tool-contract.md).
  const all = keyPages(listToolFolders(defaultToolsRoot).map(([, id]) => id));
  const pages = values.page === undefined ? all : all.filter((path) => path === values.page);
  if (pages.length === 0) {
    console.error(`${values.page} is not a key page. The key pages are: ${all.join(", ")}`);
    return 2;
  }

  const profile = mkdtempSync(join(tmpdir(), "ni-lighthouse-"));
  const server = await startServer();
  let chrome: ChildProcess | undefined;
  const results: PageResult[] = [];
  try {
    const started = await startChrome(profile);
    chrome = started.chrome;
    for (const path of pages) {
      const measured: Run[] = [];
      let last: { html: string; json: string } | undefined;
      for (let index = 0; index < runs; index++) {
        const result = await lighthouse(`${origin}${path}`, {
          port: started.port,
          output: "html",
          logLevel: "error",
          onlyCategories: [...CATEGORIES],
        });
        if (!result) throw new Error(`Lighthouse returned nothing for ${path}`);
        measured.push(runOf(result.lhr));
        last = {
          html: typeof result.report === "string" ? result.report : (result.report[0] ?? ""),
          json: JSON.stringify(result.lhr),
        };
      }
      const judged = judge(path, measured);
      results.push(judged);
      if (!values.json) console.error(`measured ${path} (${runs} runs)`);
      if (values.out && last) {
        mkdirSync(values.out, { recursive: true });
        const name = path === "/" ? "home" : path.replaceAll("/", "");
        writeFileSync(join(values.out, `${name}.html`), last.html);
        writeFileSync(join(values.out, `${name}.json`), last.json);
      }
    }
  } finally {
    if (chrome) await stopAndWait(chrome);
    await stopAndWait(server);
    try {
      // Chrome's helper processes can hold the profile for a moment after Chrome has exited.
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      console.error(`Could not delete the temporary Chrome profile ${profile}; delete it by hand.`);
    }
  }

  const ok = results.every((result) => result.problems.length === 0);
  if (values.json) console.log(JSON.stringify({ ok, pages: results }, null, 2));
  else console.log(formatResults(results));
  return ok ? 0 : 1;
}

process.exitCode = await main();

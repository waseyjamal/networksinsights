import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cspHash } from "./hash";
import { headerPolicy, headerRules, readPage, renderHeadersFile } from "./headers-file";

// The per-tool override (ADR 0047) behind Cloudflare's own static-asset engine: `wrangler dev`
// over a tiny site with one approved override. It proves what the unit tests can only assume:
// that `! Content-Security-Policy` then a new value replaces the site-wide policy on that page
// alone, instead of adding a second policy that could only narrow it. Slow tier: it starts a
// process (ADR 0043).

const web = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PORT = 8797;
const SITE = `default-src 'none'; script-src 'self' '${cspHash("x()")}'`;
const WIDER = `${SITE}; connect-src 'self' https://api.example.com`;
const html = (policy: string, marker = "") =>
  `<!doctype html><html><head><meta http-equiv="content-security-policy" content="${policy}">${marker}</head><body><script>x()</script></body></html>`;

let root = "";
let server: ChildProcess | undefined;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "ni-override-"));
  const dist = join(root, "dist");
  mkdirSync(join(dist, "big-tool"), { recursive: true });
  writeFileSync(join(dist, "index.html"), html(SITE));
  const marker = '<meta name="ni-security-override" content="adr=0051; cross-origin-isolated">';
  writeFileSync(join(dist, "big-tool", "index.html"), html(WIDER, marker));
  const pages = [readPage("/", html(SITE)), readPage("/big-tool/", html(WIDER, marker))];
  writeFileSync(join(dist, "_headers"), renderHeadersFile(headerRules(pages)));
  writeFileSync(
    join(root, "wrangler.jsonc"),
    JSON.stringify({
      name: "override-test",
      compatibility_date: "2026-09-16",
      assets: { directory: "./dist" },
    }),
  );
  server = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      join(root, "wrangler.jsonc"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(PORT),
    ],
    {
      cwd: web,
      shell: process.platform === "win32",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    },
  );
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("wrangler dev did not start");
}, 90_000);

afterAll(async () => {
  const exited = new Promise((resolve) => {
    server?.once("exit", resolve);
    setTimeout(resolve, 10_000);
  });
  // On Windows the shell's child (workerd) outlives a plain kill; end the whole tree.
  if (process.platform === "win32" && server?.pid) {
    spawn("taskkill", ["/pid", String(server.pid), "/t", "/f"]);
  } else {
    server?.kill();
  }
  await exited;
  // Windows releases the files a moment after the process ends.
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 30_000);

describe("a per-tool security override behind Cloudflare's engine", { tags: ["slow"] }, () => {
  it("leaves every other page on the site-wide policy", async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/`);
    expect(response.headers.get("content-security-policy")).toBe(headerPolicy(SITE));
    expect(response.headers.get("cross-origin-embedder-policy")).toBe(null);
  });

  it("replaces the policy on the override page, with one policy, and isolates it", async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/big-tool/`);
    // One header value: a second, appended policy would show as a comma-joined pair.
    expect(response.headers.get("content-security-policy")).toBe(headerPolicy(WIDER));
    expect(response.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });
});

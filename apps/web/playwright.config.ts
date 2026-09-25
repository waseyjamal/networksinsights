import { defineConfig, devices } from "@playwright/test";
import { edgePort, edgeURL } from "./e2e/edge";

const port = 4321;
const baseURL = `http://127.0.0.1:${port}`;

// E2E tests run against the production build served by `astro preview`.
// Run `pnpm test:e2e` from the repo root: it builds first, then starts Playwright.
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Locally at most 2 workers: three browser engines at Playwright's default worker count can
  // exhaust the memory of a developer machine (ADR 0026). CI keeps Playwright's default.
  ...(process.env.CI ? {} : { workers: 2 }),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: `pnpm preview --host 127.0.0.1 --port ${port}`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Astro 7 detects a coding agent and then starts `astro preview` as a detached background
      // process, which Playwright cannot supervise (on Windows it is killed with its parent, see
      // withastro/astro#18019). `ASTRO_PREVIEW_BACKGROUND` is Astro's own opt-out: when it is set to
      // any non-empty value the agent detection is skipped and the server stays in the foreground.
      // CI is not an agent, so there it changes nothing (ADR 0043).
      env: { ASTRO_PREVIEW_BACKGROUND: "false" },
    },
    // The same build behind Cloudflare's own static-asset engine, for the header and CSP tests
    // (e2e/edge.ts). Wrangler runs locally and deploys nothing; metrics stay off.
    {
      command: `pnpm exec wrangler dev --config e2e/wrangler.e2e.jsonc --ip 127.0.0.1 --port ${edgePort}`,
      url: edgeURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  ],
});

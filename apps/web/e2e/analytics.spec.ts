import { expect, type Page, type Request, test } from "@playwright/test";
import { EVENTS, UMAMI_HOST } from "../src/config/analytics";
import { site } from "../src/config/site";
import { edgePort, edgeURL } from "./edge";

// Analytics and error reporting (ADR 0051), against `wrangler dev`, so the tracker runs under the
// real Content-Security-Policy. The tracker sends only on the production hostname, so Chromium
// resolves that name to the local edge server; Umami's endpoint is answered by the test and
// nothing leaves the machine. The CI e2e job builds with a test website id; a local build without
// UMAMI_WEBSITE_ID has no analytics, and these tests are skipped.

test.use({
  baseURL: edgeURL,
  launchOptions: { args: [`--host-resolver-rules=MAP ${site.domain} 127.0.0.1`] },
});
test.skip(({ browserName }) => browserName !== "chromium", "host mapping is a Chromium switch");

const PROD = `http://${site.domain}:${edgePort}`;
const TOOL = "/word-counter/";

interface Sent {
  type: string;
  payload: Record<string, unknown> & { name?: string; data?: Record<string, unknown> };
}

/** Answers Umami's endpoint locally and records every body the tracker sends. */
async function captureUmami(page: Page) {
  const sent: Sent[] = [];
  const requests: Request[] = [];
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST",
    "access-control-allow-headers":
      "content-type, x-umami-website-id, x-umami-hostname, x-umami-cache",
  };
  await page.route(`${UMAMI_HOST}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    requests.push(request);
    sent.push(request.postDataJSON() as Sent);
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: "{}",
    });
  });
  return { sent, requests };
}

async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

const events = (sent: Sent[], name: string) =>
  sent.filter((body) => body.type === "event" && body.payload.name === name);

test.beforeAll(async ({ request }) => {
  const html = await (await request.get(`${edgeURL}/`)).text();
  test.skip(
    !html.includes("data-website-id"),
    "this build has no UMAMI_WEBSITE_ID, so there are no analytics to test",
  );
});

test("sends a page view without the query, the hash or a cookie", async ({ page, context }) => {
  const { sent, requests } = await captureUmami(page);
  const violations = await watchViolations(page);
  await page.goto(`${PROD}${TOOL}?q=private-words#also-private`);
  await expect.poll(() => sent.filter((body) => !body.payload.name).length).toBe(1);

  const [view] = sent;
  expect(String(view?.payload.url)).toContain(TOOL);
  expect(JSON.stringify(sent)).not.toMatch(/private-words|also-private/);
  for (const request of requests) expect(await request.headerValue("cookie")).toBeNull();
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(await violations()).toEqual([]);
});

test("sends one tool-used event with the tool's id and nothing typed", async ({ page }) => {
  const { sent } = await captureUmami(page);
  const violations = await watchViolations(page);
  await page.goto(`${PROD}${TOOL}`);
  await expect(page.locator("astro-island")).not.toHaveAttribute("ssr", "");

  const box = page.getByRole("textbox", { name: "Your text" });
  await box.fill("a very secret sentence");
  await box.pressSequentially(" and more");
  await expect.poll(() => events(sent, EVENTS.toolUsed).length).toBe(1);
  await page.waitForTimeout(300);

  expect(events(sent, EVENTS.toolUsed)).toHaveLength(1);
  expect(events(sent, EVENTS.toolUsed)[0]?.payload.data).toEqual({ tool: "word-counter" });
  expect(JSON.stringify(sent)).not.toContain("secret");
  expect(await violations()).toEqual([]);
});

test("reports an uncaught error without what a visitor typed", async ({ page }) => {
  const { sent } = await captureUmami(page);
  await page.goto(`${PROD}${TOOL}`);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i += 1) {
      setTimeout(() => {
        throw new Error(`bad input 'my secret' at https://x.example/y for a@b.co ${1234567 + i}`);
      });
    }
  });
  await expect.poll(() => events(sent, EVENTS.error).length).toBe(1);
  await page.waitForTimeout(300);

  // The five differ only in a long number, which is scrubbed, so they are one report.
  const reports = events(sent, EVENTS.error);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.payload.data).toMatchObject({
    name: "Error",
    message: "bad input <text> at <url> for <email> <number>",
    tool: "word-counter",
  });
  expect(JSON.stringify(sent)).not.toMatch(/secret|x\.example|a@b\.co|1234567/);
});

test("sends Core Web Vitals when the page is left", async ({ page }) => {
  const { sent } = await captureUmami(page);
  await page.goto(`${PROD}/`);
  await expect.poll(() => sent.length).toBe(1);
  await page.evaluate(() => dispatchEvent(new Event("pagehide")));
  await expect.poll(() => sent.filter((body) => body.type === "performance").length).toBe(1);
  const vitals = sent.find((body) => body.type === "performance")?.payload ?? {};
  // TTFB is known for every load. The paint metrics depend on the engine painting, which a
  // headless run does not always report, so only their type is checked when they are there.
  expect(typeof vitals.ttfb).toBe("number");
  for (const metric of ["fcp", "lcp", "cls", "inp"]) {
    if (metric in vitals) expect(typeof vitals[metric]).toBe("number");
  }
});

test("sends nothing on another hostname, or when the browser asks not to be tracked", async ({
  page,
}) => {
  const { sent } = await captureUmami(page);
  await page.goto(`${edgeURL}${TOOL}`);
  await page.getByRole("textbox", { name: "Your text" }).fill("words");
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);

  await page.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "doNotTrack", { get: () => "1" }),
  );
  await page.goto(`${PROD}${TOOL}`);
  await page.getByRole("textbox", { name: "Your text" }).fill("words");
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
});

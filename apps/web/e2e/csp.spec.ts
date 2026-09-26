import { expect, type Page, test } from "@playwright/test";
import { platformDependentFeatures } from "../src/config/headers";
import { edgeURL } from "./edge";
import { pages } from "./pages";

// The Content-Security-Policy in the three engines (ADR 0047), against `wrangler dev`, which sends
// the header exactly as Cloudflare does (e2e/edge.ts). Every page must load with zero violations,
// in both themes and with search open; an inline script that is not ours must be refused.

test.use({ baseURL: edgeURL });

/** The other E2E server, `astro preview`, which ignores _headers (playwright.config.ts). */
const PREVIEW_URL = "http://127.0.0.1:4321";

interface Violation {
  directive: string;
  blocked: string;
  sample: string;
}

/** Records every violation the page reports, from before its first script runs. */
async function watchViolations(page: Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    const seen: Array<{ directive: string; blocked: string; sample: string }> = [];
    (window as unknown as { __cspViolations: typeof seen }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      });
    });
  });
  return () =>
    page.evaluate(
      () => (window as unknown as { __cspViolations: Violation[] }).__cspViolations ?? [],
    );
}

/**
 * Console lines about a policy: CSP refusals and Permissions-Policy warnings. A denied feature that
 * this Chromium build does not know (config/headers.ts, platformDependentFeatures) is not a problem.
 */
function watchPolicyConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const platform = platformDependentFeatures.some((name) =>
      text.includes(`Unrecognized feature: '${name}'`),
    );
    if (platform) return;
    if (/content.security.policy|permissions.policy|unrecognized feature|refused to/i.test(text)) {
      lines.push(`${message.type()}: ${text}`);
    }
  });
  return lines;
}

async function openSearch(page: Page) {
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog", { name: "Search tools" });
  await expect(dialog).toBeVisible();
  await page.getByRole("combobox", { name: "Search tools" }).fill("pdf");
  // The module and the index both loaded: the dialog answers the query. With the real index that
  // is "No tools yet" when it is empty and "No results" when it has tools; the other stays hidden.
  await expect(
    dialog.locator("[data-ni-search-empty]:not([hidden]), [data-ni-search-none]:not([hidden])"),
  ).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`zero violations, ${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const sitePage of pages) {
      test(`${sitePage.path} with search open`, async ({ page }) => {
        const violations = await watchViolations(page);
        const consoleLines = watchPolicyConsole(page);
        // The stored choice runs the theme script's other branch as well as the media query.
        await page.addInitScript((value) => {
          try {
            localStorage.setItem("ni-theme", value);
          } catch {}
        }, theme);

        const response = await page.goto(sitePage.path);
        expect(response?.status()).toBe(sitePage.status);
        expect(response?.headers()["content-security-policy"]).toContain("default-src 'none'");
        // The inline theme script ran: its hash is in the policy.
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("html")).toHaveAttribute("data-theme-js", "");
        // Islands hydrated (the design-system page has React ones).
        for (const island of await page.locator("astro-island").all()) {
          await expect(island).not.toHaveAttribute("ssr");
        }
        await openSearch(page);

        expect(await violations(), "CSP violations").toEqual([]);
        expect(consoleLines, "policy messages in the console").toEqual([]);
      });
    }
  });
}

test.describe("what the policy refuses", () => {
  test("an inline script and an inline event handler that are not ours never run", async ({
    page,
  }) => {
    const violations = await watchViolations(page);
    // The fixture: the real /about/ response, with the real headers, plus markup an attacker
    // would inject. Nothing extra is built or shipped.
    await page.route("**/about/", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "</body>",
        `<script>window.__inlineRan = true</script><img src="/favicon.svg" alt="" onload="window.__handlerRan = true"></body>`,
      );
      await route.fulfill({ response, body });
    });

    await page.goto("/about/");
    await expect
      .poll(async () => (await violations()).map((violation) => violation.directive).sort())
      .toEqual(expect.arrayContaining(["script-src-attr", "script-src-elem"]));
    const ran = await page.evaluate(() => {
      const flags = window as unknown as { __inlineRan?: boolean; __handlerRan?: boolean };
      return { inline: flags.__inlineRan ?? false, handler: flags.__handlerRan ?? false };
    });
    expect(ran).toEqual({ inline: false, handler: false });
  });

  test("another site cannot frame a page", async ({ page }) => {
    // A page on another origin (the astro preview port; both are loopback, so no local-network
    // rule gets in the way) that tries to show /about/ in a frame. The control frame shows the
    // same page from `astro preview`, which sends no headers: it must render, which proves the
    // check below would see our heading if the policy let it through.
    await page.route(`${PREVIEW_URL}/framer-fixture/`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><title>framer</title><iframe name="control" src="${PREVIEW_URL}/about/"></iframe><iframe name="target" src="${edgeURL}/about/"></iframe>`,
      }),
    );
    // The frame is requested, and its response arrives with its headers; the browser must then
    // refuse to show it. A refused frame does not fire `load` in every engine, and Chromium
    // reports it as a failed request, so wait for the request to settle either way.
    const framed = page.waitForRequest(`${edgeURL}/about/`);
    await page.goto(`${PREVIEW_URL}/framer-fixture/`, { waitUntil: "domcontentloaded" });
    await (await framed).response();
    await expect(page.frameLocator("iframe[name=control]").locator("h1")).toContainText("About");
    // Give the engine time to render the frame, which it must not do.
    await page.waitForTimeout(1_000);
    const frame = page.frame({ name: "target" });
    // The frame is refused: it never holds the About page. Firefox's error document in a refused
    // frame never answers an evaluate, so a frame that stays silent for five seconds counts as
    // refused too; what matters is that no engine shows our heading.
    const heading = await Promise.race([
      frame?.evaluate(() => document.querySelector("h1")?.textContent ?? "").catch(() => ""),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 5_000)),
    ]);
    expect(heading ?? "").not.toContain("About");
  });
});

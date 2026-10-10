import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { site } from "../src/config/site";
import { collectErrors } from "./helpers";
import { notFoundPath, pages } from "./pages";

// Every page, in light and dark: status, one H1, no console errors, axe, noindex, title.
// Until launch every page is `noindex, nofollow` (ADR 0029). After launch only the 404, design-system
// and offline pages stay noindex; every other page carries no robots tag at all.

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`site pages in ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const item of pages) {
      test(`${item.path}`, async ({ page }, testInfo) => {
        const errors = collectErrors(page);
        // Every request the page makes must succeed. The one exception is the document of the
        // 404 page itself, which Chromium also reports as a console error.
        const failedRequests: string[] = [];
        page.on("response", (response) => {
          if (response.status() >= 400 && response.request().resourceType() !== "document") {
            failedRequests.push(`${response.status()} ${response.url()}`);
          }
        });
        const response = await page.goto(item.path);
        expect(response?.status(), "status").toBe(item.status);

        await expect(page.getByRole("heading", { level: 1 }), "one H1").toHaveCount(1);
        await expect(page, "title").toHaveTitle(item.title);
        const robots = page.locator('head meta[name="robots"]');
        const staysNoindex = item.path === notFoundPath || item.path === "/design-system/";
        if (!site.launched || staysNoindex) {
          await expect(robots, "noindex").toHaveAttribute("content", /noindex/);
        } else {
          await expect(robots, "indexable: no robots tag").toHaveCount(0);
        }
        await expect(page.locator("main")).toHaveCount(1);
        await expect(page.locator("footer")).toHaveCount(1);

        // Let the page settle (fonts, theme script) before scanning and before judging errors.
        await page.evaluate(() => document.fonts.ready);
        expect(failedRequests, "failed requests").toEqual([]);
        const own404 = /Failed to load resource: the server responded with a status of 404/;
        expect(
          errors.filter((error) => item.status !== 404 || !own404.test(error)),
          "console errors",
        ).toEqual([]);

        if (item.axe) {
          const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
          const incomplete = results.incomplete.map((rule) => `${rule.id} (${rule.nodes.length})`);
          testInfo.annotations.push({
            type: "axe-incomplete",
            description: incomplete.join(", ") || "none",
          });
          console.log(
            `axe ${item.path} ${scheme} ${testInfo.project.name}: ${results.passes.length} rules passed, ${results.violations.length} violations, incomplete: ${incomplete.join(", ") || "none"}`,
          );
          expect(
            results.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              nodes: violation.nodes.map((node) => node.target),
            })),
            "axe violations",
          ).toEqual([]);
        }
      });
    }
  });
}

// ADR 0057: the minifier drops licence comments from the bundles, so the notices of the libraries
// the tools ship live on the About page. The built page must still carry them, and the licence
// files of PDF.js's data files must be served.
test("the About page keeps the open-source notices", async ({ page, request }) => {
  await page.goto("/about/");
  const pako = page.locator('[data-credit-notice="pako"]');
  await expect(pako).toContainText("Jean-loup Gailly and Mark Adler");
  await expect(pako).toContainText("This notice may not be removed or altered");
  await expect(page.locator('[data-credit-notice="pdf-lib"]')).toContainText("Andrew Dillon");
  await expect(page.locator('[data-credit-notice="PDF.js (pdfjs-dist)"]')).toContainText(
    "Mozilla Foundation",
  );
  const lgpl = page.locator('[data-credit-notice="libheif-js (libheif and libde265)"]');
  await expect(lgpl).toContainText("GNU Lesser General Public License, version 3");
  await expect(
    page.locator('[data-credit-source="libheif-js (libheif and libde265)"] a'),
  ).toHaveCount(4);
  const links = await page
    .locator('a[href^="/vendor/"]')
    .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
  expect(links.length).toBeGreaterThan(0);
  for (const href of links) expect((await request.get(href)).status(), href).toBe(200);
});

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { REVOKE_AFTER_MS } from "../src/lib/runtime/save-file";
import { edgeURL } from "./edge";

// saveFile() (ADR 0050) in the three engines, from the design system's React island, under the
// real Content-Security-Policy: the file arrives with a safe name and its content, and the object
// URL it used is revoked once the download has started.

test.use({ baseURL: edgeURL });

test("saveFile downloads a file with a safe name, under the site's CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content.security.policy|refused to/i.test(message.text())) violations.push(message.text());
  });
  // Record every object URL the page creates and revokes.
  await page.addInitScript(() => {
    const log = { created: [] as string[], revoked: [] as string[] };
    (window as unknown as { __objectUrls: typeof log }).__objectUrls = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = create(object);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      log.revoked.push(url);
      revoke(url);
    };
  });
  // The revoke happens REVOKE_AFTER_MS after the click, on the real clock: Playwright's fake clock
  // makes Firefox report an eval the page never does, which this test must not confuse with ours.
  test.setTimeout(90_000);

  await page.goto("/design-system/");
  const button = page.getByRole("button", { name: "Download a sample file" });
  await expect(button).toBeEnabled();
  // The island has hydrated when React owns the button.
  await expect(page.locator("astro-island").first()).not.toHaveAttribute("ssr");

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("-design system sample.txt");
  const path = await download.path();
  expect(await readFile(path, "utf8")).toBe("A file made on this device.");

  const urls = () =>
    page.evaluate(
      () =>
        (window as unknown as { __objectUrls: { created: string[]; revoked: string[] } })
          .__objectUrls,
    );
  const before = await urls();
  expect(before.created).toHaveLength(1);
  expect(before.revoked).toEqual([]);
  await expect
    .poll(async () => (await urls()).revoked, {
      timeout: REVOKE_AFTER_MS + 15_000,
      intervals: [1_000],
    })
    .toEqual(before.created);
  expect(violations).toEqual([]);
});

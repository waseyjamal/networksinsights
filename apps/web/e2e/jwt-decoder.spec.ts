import AxeBuilder from "@axe-core/playwright";
import { quickFacts } from "@networksinsights/tool-sdk";
import { expect, type Page, test } from "@playwright/test";
import manifest from "../../../tools/developer/jwt-decoder/tool.config";
import { site } from "../src/config/site";
import { jsonLdDocumentSchema } from "../src/lib/seo/schemas";
import { edgeURL } from "./edge";
import { collectErrors } from "./helpers";
import { openTool } from "./tool-page";

// JWT Decoder in the three engines, against `wrangler dev`, so the page runs under the real
// Content-Security-Policy and headers (e2e/edge.ts). It hydrates, decodes the sample token of its
// page into header, payload and signature, says an expired, a valid and a not-yet-valid token
// apart, names the part and character that break a token, sends nothing while a token is typed,
// and its structured data and Quick facts match the page.

test.use({ baseURL: edgeURL });

const PATH = "/jwt-decoder/";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The sample token of the page: HS256, no exp claim. */
const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

/** A token with these claims. Its dates are far from now, so the answer never depends on the clock. */
function tokenWith(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}.c2lnbmF0dXJl`;
}

const YEAR_2100 = 4102444800;

const box = (page: Page) => page.getByRole("textbox", { name: "Your token" });
const header = (page: Page) => page.locator("#jwt-decoder-header");
const payload = (page: Page) => page.locator("#jwt-decoder-payload");
const signature = (page: Page) => page.locator("#jwt-decoder-signature");
const state = (page: Page) => page.locator("#jwt-decoder-state");
const detail = (page: Page) => page.locator("#jwt-decoder-detail");
const stat = (page: Page, id: string) => page.locator(`[data-stat="${id}"] dd`);

/** Records CSP violations from before the first script runs. */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI} ${event.sample}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** Opens the page and waits until the island has hydrated (Astro drops `ssr` when it has). */
async function open(page: Page) {
  await openTool(page, PATH);
}

test("hydrates, says it does not verify, decodes the sample token, and clears", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const violations = await watchViolations(page);
  await open(page);

  await expect(page.getByText("This tool does not verify the signature")).toBeVisible();
  await expect(header(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Copy header" })).toBeDisabled();

  await box(page).fill(SAMPLE);
  await expect(header(page)).toHaveValue('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  await expect(payload(page)).toHaveValue(
    '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}',
  );
  await expect(signature(page)).toHaveValue("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
  await expect(page.getByText("Algorithm: HS256")).toBeVisible();
  await expect(
    page.getByText("32 bytes, in Base64URL as written. It is not verified."),
  ).toBeVisible();
  await expect(state(page)).toHaveText("No expiry");
  await expect(stat(page, "iat")).toHaveText("2018-01-18 01:30:22 UTC");

  // A Bearer prefix and line breaks are ignored.
  await box(page).fill(`Bearer ${SAMPLE.slice(0, 40)}\n${SAMPLE.slice(40)}`);
  await expect(signature(page)).toHaveValue("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(box(page)).toHaveValue("");
  await expect(header(page)).toHaveValue("");
  await expect(payload(page)).toHaveValue("");
  await expect(state(page)).toHaveCount(0);

  expect(errors).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("tells an expired, a valid and a not-yet-valid token apart", async ({ page }) => {
  await open(page);

  await box(page).fill(tokenWith({ exp: 1516239022 }));
  await expect(state(page)).toHaveText("Expired");
  await expect(detail(page)).toContainText("Expired ");
  await expect(detail(page)).toContainText(" ago, at 2018-01-18 01:30:22 UTC.");
  await expect(stat(page, "exp")).toHaveText("2018-01-18 01:30:22 UTC");

  await box(page).fill(tokenWith({ iat: 1516239022, exp: YEAR_2100 }));
  await expect(state(page)).toHaveText("Valid now");
  await expect(detail(page)).toContainText("Expires in ");
  await expect(detail(page)).toContainText(", at 2100-01-01 00:00:00 UTC.");
  await expect(stat(page, "exp")).toHaveText("2100-01-01 00:00:00 UTC");

  await box(page).fill(tokenWith({ nbf: YEAR_2100, exp: YEAR_2100 + 3600 }));
  await expect(state(page)).toHaveText("Not valid yet");
  await expect(detail(page)).toContainText(", at 2100-01-01 00:00:00 UTC.");
  await expect(stat(page, "nbf")).toHaveText("2100-01-01 00:00:00 UTC");

  await box(page).fill(tokenWith({ exp: "tomorrow" }));
  await expect(state(page)).toHaveText("Cannot check");
  await expect(detail(page)).toContainText("The exp claim is not a number of seconds.");
});

test("names the part and the character that break a token, then recovers", async ({ page }) => {
  await open(page);

  await box(page).fill("not-a-token");
  await expect(page.locator("#jwt-decoder-error")).toContainText("has no dot");
  await expect(header(page)).toHaveValue("");
  await expect(state(page)).toHaveCount(0);

  const [head, body, sig] = SAMPLE.split(".");
  await box(page).fill(`${head}.${(body ?? "").replace("IiwibmFt", "Iiwi!mFt")}.${sig}`);
  await expect(page.locator("#jwt-decoder-error")).toContainText(
    'Character 29 of the payload, "!", is not Base64URL.',
  );

  await box(page).fill("a.b.c.d.e");
  await expect(page.locator("#jwt-decoder-error")).toContainText("encrypted token (a JWE)");

  await box(page).fill(SAMPLE);
  await expect(page.locator("#jwt-decoder-error")).toHaveCount(0);
  await expect(header(page)).toHaveValue('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
});

test("sends nothing while a token is typed", async ({ page }) => {
  await open(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await box(page).fill(SAMPLE);
  await expect(payload(page)).not.toHaveValue("");
  await box(page).fill(tokenWith({ exp: YEAR_2100 }));
  await expect(state(page)).toHaveText("Valid now");
  expect(requests).toEqual([]);
});

test("copies each part to the clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "only Chromium lets a test grant clipboard access");
  await context.grantPermissions(["clipboard-write"]);
  await open(page);
  // The site's permissions policy does not let a page read the clipboard back, so the test records
  // what the page writes to it.
  await page.evaluate(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text: string) => {
      copied.push(text);
      return write(text);
    };
  });
  const copied = () => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  await box(page).fill(SAMPLE);

  await page.getByRole("button", { name: "Copy header" }).click();
  await expect(page.getByText("Header copied to the clipboard.")).toBeVisible();
  await page.getByRole("button", { name: "Copy payload" }).click();
  await expect(page.getByText("Payload copied to the clipboard.")).toBeVisible();
  await page.getByRole("button", { name: "Copy signature" }).click();
  await expect(page.getByText("Signature copied to the clipboard.")).toBeVisible();

  expect(await copied()).toEqual([
    '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
    '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}',
    "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
  ]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe finds no violations, ${theme} theme`, async ({ page }) => {
    // Reduced motion switches the button colour transitions off, so axe never measures contrast
    // in the middle of one.
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await open(page);
    await box(page).fill("a.b");
    await expect(page.locator("#jwt-decoder-error")).toBeVisible();
    let results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);

    for (const [claims, label] of [
      [{ exp: YEAR_2100 }, "Valid now"],
      [{ exp: 1516239022 }, "Expired"],
      [{ nbf: YEAR_2100 }, "Not valid yet"],
      [{ iat: 1516239022 }, "No expiry"],
    ] as const) {
      await box(page).fill(tokenWith(claims));
      await expect(state(page)).toHaveText(label);
      results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    }
  });
}

test("its structured data says what the page shows", async ({ page }) => {
  await open(page);
  const scripts = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
  expect(scripts).toHaveLength(1);
  const graph = jsonLdDocumentSchema.parse(JSON.parse(scripts[0] ?? ""))["@graph"];

  const app = graph.find((node) => node["@type"] === "WebApplication");
  if (!app || !("applicationCategory" in app)) throw new Error("no WebApplication node");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(app.name);
  expect(app.name).toBe(manifest.name);
  expect(app.url).toBe(`${site.url}${PATH}`);
  expect(app.description).toBe(manifest.summary);
  await expect(page.locator("main").getByText(manifest.summary).first()).toBeVisible();
  expect(app.dateModified).toBe(manifest.updated);
  expect("aggregateRating" in app).toBe(false);

  const faq = graph.find((node) => node["@type"] === "FAQPage");
  if (!faq || !("mainEntity" in faq)) throw new Error("no FAQPage node");
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(2);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const entry of faq.mainEntity) {
    await expect(page.getByRole("heading", { level: 3, name: entry.name })).toBeVisible();
    expect(text).toContain(entry.acceptedAnswer.text);
  }
});

test("Quick facts are the manifest's, in order", async ({ page }) => {
  await open(page);
  const section = page.getByRole("region", { name: "Quick facts" });
  const facts = quickFacts(manifest);
  await expect(section.locator("dt")).toHaveText(facts.map((fact) => fact.label));
  await expect(section.locator("dd")).toHaveText(facts.map((fact) => fact.value));
  await expect(section.locator("time")).toHaveAttribute("datetime", manifest.updated);
});

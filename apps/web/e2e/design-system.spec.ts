import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { bodyBackground, collectErrors, expectedBackground } from "./helpers";

const path = "/design-system/";

/** What the before-first-paint probe records in the page. */
interface Seen {
  atBody?: string | null;
  changesAfterBody: number;
}
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("/design-system", () => {
  test("is a noindex page with one h1 and the standard landmarks", async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(1);
  });

  test("is complete HTML without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Signal" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Components" })).toBeVisible();
    // The theme toggle needs JavaScript, so it stays hidden without it.
    await expect(page.locator(".ni-theme-toggle").first()).toBeHidden();
    await context.close();
  });

  test("loads both fonts from the site itself", async ({ page }) => {
    await page.goto(path);
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      // Firefox serializes family names with quotes, the others without.
      return [...document.fonts]
        .filter((f) => f.status === "loaded")
        .map((f) => f.family.replaceAll('"', ""));
    });
    expect(loaded.some((family) => family.startsWith("Geist-"))).toBe(true);
    expect(loaded.some((family) => family.startsWith("Geist Mono-"))).toBe(true);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`/design-system in ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("logs no console errors", async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Wait for the React island, so errors thrown while it starts are captured too.
      await expect(page.getByRole("button", { name: "Run in React" })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("has zero axe violations (WCAG 2.2 AA)", async ({ page }, testInfo) => {
      // The page is large (131-row contrast table, 11 tiles) and Firefox scans it slowly when
      // three browsers run at once. This is a slower test, not a flaky one.
      test.slow();
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Run in React" })).toBeVisible();
      // Open the contrast table so its 131 rows are scanned too.
      await page.locator("summary").click();
      const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
      const incomplete = results.incomplete.map((item) => `${item.id} (${item.nodes.length})`);
      testInfo.annotations.push({
        type: "axe-incomplete",
        description: incomplete.join(", ") || "none",
      });
      console.log(
        `axe ${scheme} ${testInfo.project.name}: ${results.passes.length} rules passed, incomplete: ${incomplete.join(", ") || "none"}`,
      );
      expect(
        results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    });

    test("follows the system theme by default", async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
      const bytes = await bodyBackground(page);
      const expected = expectedBackground(scheme);
      for (const i of [0, 1, 2] as const)
        expect(Math.abs((bytes[i] ?? 0) - expected[i])).toBeLessThanOrEqual(1);
    });
  });
}

test.describe("theme toggle", () => {
  test("persists the choice after a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(path);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "system");

    await page.getByRole("radio", { name: "Dark" }).first().check();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("ni-theme"))).toBe("dark");
    const dark = expectedBackground("dark");
    const painted = await bodyBackground(page);
    for (const i of [0, 1, 2] as const)
      expect(Math.abs((painted[i] ?? 0) - dark[i])).toBeLessThanOrEqual(1);

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("radio", { name: "Dark" }).first()).toBeChecked();

    await page.getByRole("radio", { name: "Light" }).first().check();
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");

    await page.getByRole("radio", { name: "System" }).first().check();
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "system");
  });

  test("keeps the theme-color metas in step with a manual choice", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(path);
    const colors = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('meta[name="theme-color"]')].map((m) =>
          m.getAttribute("content"),
        ),
      );
    const [lightColor, darkColor] = await colors();
    expect(lightColor).not.toBe(darkColor);

    await page.getByRole("radio", { name: "Dark" }).first().check();
    expect(await colors()).toEqual([darkColor, darkColor]);

    await page.getByRole("radio", { name: "System" }).first().check();
    expect(await colors()).toEqual([lightColor, darkColor]);
  });

  test("can be used with the keyboard", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(path);
    await page.getByRole("radio", { name: "Light" }).first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("theme before first paint", () => {
  // Records data-theme the moment <body> exists (the parser has passed the head script but
  // nothing has painted yet) and counts every later change.
  const probe = (stored: string | null) => {
    (window as unknown as { __seen: Seen }).__seen = { changesAfterBody: 0 };
    const seen = (window as unknown as { __seen: Seen }).__seen;
    if (stored !== null) {
      try {
        localStorage.setItem("ni-theme", stored);
      } catch {}
    }
    new MutationObserver((_records, observer) => {
      if (document.body) {
        seen.atBody = document.documentElement.getAttribute("data-theme");
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === "data-theme" && document.body) {
          seen.changesAfterBody = Number(seen.changesAfterBody) + 1;
        }
      }
    }).observe(document, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
  };

  const cases: Array<{
    name: string;
    stored: string | null;
    scheme: "light" | "dark";
    theme: string;
    painted: "light" | "dark";
  }> = [
    {
      name: "no choice, system dark",
      stored: null,
      scheme: "dark",
      theme: "system",
      painted: "dark",
    },
    {
      name: "no choice, system light",
      stored: null,
      scheme: "light",
      theme: "system",
      painted: "light",
    },
    {
      name: "stored dark, system light",
      stored: "dark",
      scheme: "light",
      theme: "dark",
      painted: "dark",
    },
    {
      name: "stored light, system dark",
      stored: "light",
      scheme: "dark",
      theme: "light",
      painted: "light",
    },
    {
      name: "invalid stored value",
      stored: "purple",
      scheme: "dark",
      theme: "system",
      painted: "dark",
    },
  ];

  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await page.emulateMedia({ colorScheme: c.scheme });
      await page.addInitScript(probe, c.stored);
      await page.goto(path);
      const seen = await page.evaluate(() => (window as unknown as { __seen: Seen }).__seen);
      expect(seen.atBody).toBe(c.theme);
      expect(seen.changesAfterBody).toBe(0);
      const painted = await bodyBackground(page);
      const expected = expectedBackground(c.painted);
      for (const i of [0, 1, 2] as const)
        expect(Math.abs((painted[i] ?? 0) - expected[i])).toBeLessThanOrEqual(1);
    });
  }
});

test.describe("reduced motion", () => {
  test("runs the constellation and glow animations by default", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(path);
    const running = await page.evaluate(() => ({
      node: document.querySelector(".ni-constellation__node")?.getAnimations().length ?? 0,
      layer: document.querySelector(".ni-constellation__layer")?.getAnimations().length ?? 0,
      aurora: document.querySelector(".ni-aurora")?.getAnimations().length ?? 0,
    }));
    expect(running.node).toBeGreaterThan(0);
    expect(running.layer).toBeGreaterThan(0);
    expect(running.aurora).toBeGreaterThan(0);
  });

  test("stops the constellation and every other animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    const state = await page.evaluate(() => {
      const node = document.querySelector(".ni-constellation__node");
      const button = document.querySelector(".ni-btn");
      return {
        allAnimations: document.getAnimations().length,
        nodeAnimationName: node ? getComputedStyle(node).animationName : "missing",
        nodeAnimations: node?.getAnimations().length ?? -1,
        transition: button ? getComputedStyle(button).transitionProperty : "missing",
      };
    });
    expect(state.nodeAnimationName).toBe("none");
    expect(state.nodeAnimations).toBe(0);
    expect(state.allAnimations).toBe(0);
    expect(state.transition).toBe("none");
  });

  test("marks the constellation as decorative", async ({ page }) => {
    await page.goto(path);
    await expect(page.locator(".ni-constellation")).toHaveAttribute("aria-hidden", "true");
    for (const aurora of await page.locator(".ni-aurora").all()) {
      await expect(aurora).toHaveAttribute("aria-hidden", "true");
    }
  });
});

test.describe("components", () => {
  test("tabs follow the WAI-ARIA keyboard pattern", async ({ page }) => {
    await page.goto(path);
    const tabs = page.locator("#ds-tabs-tab-one, #ds-tabs-tab-two, #ds-tabs-tab-three");
    const first = page.locator("#ds-tabs-tab-one");
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#ds-tabs-tab-two")).toBeFocused();
    await expect(page.locator("#ds-tabs-tab-two")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#ds-tabs-panel-two")).toBeVisible();
    await expect(page.locator("#ds-tabs-panel-one")).toBeHidden();
    await page.keyboard.press("End");
    await expect(page.locator("#ds-tabs-tab-three")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(first).toBeFocused();
    // Roving tabindex: only the selected tab is in the tab order.
    expect(await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("tabindex")))).toEqual([
      "0",
      "-1",
      "-1",
    ]);
  });

  test("a tooltip shows on focus and Esc dismisses it", async ({ page }) => {
    await page.goto(path);
    const trigger = page.getByRole("button", { name: "Hover or focus me" }).first();
    const tip = page.locator("#ds-tip-top");
    await expect(tip).toBeHidden();
    await trigger.focus();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the React island works: loading button, tabs and validation", async ({ page }) => {
    await page.goto(path);
    const run = page.getByRole("button", { name: "Run in React" });
    await run.click();
    await expect(page.getByRole("button", { name: "Working" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.getByRole("button", { name: "Run in React" })).toBeVisible();

    await page.getByRole("tab", { name: "Usage" }).click();
    await expect(
      page.getByText("Import from the design system's React entry point."),
    ).toBeVisible();

    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await email.fill("ada@example.com");
    await expect(email).not.toHaveAttribute("aria-invalid", "true");
  });

  test("has a visible focus ring on every kind of control", async ({ page }) => {
    await page.goto(path);
    const controls = [
      page.locator("#ds-input"),
      page.getByRole("button", { name: "Primary" }).first(),
      page.getByRole("checkbox", { name: "Unchecked" }),
      page.getByRole("switch", { name: "Off" }),
    ];
    for (const control of controls) {
      await control.focus();
      const outline = await control.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      expect(outline.style).not.toBe("none");
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
  });

  test("shows the privacy badge in the tool workspace", async ({ page }) => {
    await page.goto(path);
    await expect(
      page
        .locator("#ds-workspace-title")
        .locator("xpath=ancestor::section")
        .getByText("Runs in your browser — files never leave your device"),
    ).toBeVisible();
  });
});

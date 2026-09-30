import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import { categories, categoryHref } from "../src/config/categories";
import { corpus } from "../src/lib/search/corpus";
import { createEngine } from "../src/lib/search/engine";
import { type FixtureGroup, filterFixtureHtml } from "../src/lib/search/filter-fixture";
import { buildSearchIndex } from "../src/lib/search/index-build";
import { syntheticTools } from "../src/lib/search/synthetic";
import type { SearchRecord } from "../src/lib/search/types";
import { collectRequests, isSearchRequest } from "./helpers";
import { siteTools } from "./pages";

// Instant search (Mission 11, ADR 0045 and 0046), in the three engines.
//
// The built site has few real tools, so tests that need results answer the index request
// themselves, with the fixed `corpus` or with synthetic tools; the "No tools yet" tests answer it
// with an empty index.

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const INDEX_URL = /\/search-index\.[0-9a-f]+\.json$/;
const MODULE_URL = /\/_astro\/search-ui\.[\w-]+\.js$/;

async function serveIndex(page: Page, records: readonly SearchRecord[]) {
  const body = JSON.stringify({ version: 1, tools: records });
  await page.route(INDEX_URL, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Search tools" });
const inputOf = (page: Page) => page.getByRole("combobox", { name: "Search tools" });
const headerBar = (page: Page) =>
  page.locator(".ni-header__nav").getByRole("link", { name: "Search tools" });

async function openByShortcut(page: Page, keys = "Control+K") {
  await page.keyboard.press(keys);
  await expect(dialogOf(page)).toBeVisible();
  await expect(inputOf(page)).toBeFocused();
}

test.describe("opening search", () => {
  test("a click on the command bar in the header opens it, with focus in the field", async ({
    page,
  }) => {
    await page.goto("/about/");
    await headerBar(page).click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(inputOf(page)).toBeFocused();
    await expect(page).toHaveURL(/\/about\/$/);
  });

  test("a click on the command bar on the home page opens it too", async ({ page }) => {
    await page.goto("/");
    await page.locator("main .ni-commandbar").click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(inputOf(page)).toBeFocused();
  });

  for (const [name, keys] of [
    ["Ctrl+K", "Control+K"],
    ["Cmd+K", "Meta+K"],
    ["/", "/"],
  ] as const) {
    test(`${name} opens it from the page`, async ({ page }) => {
      await page.goto("/about/");
      await openByShortcut(page, keys);
    });
  }

  test("Ctrl+K opens it even while typing in a field", async ({ page }) => {
    await page.goto("/about/");
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.id = "probe";
      document.body.prepend(field);
    });
    await page.locator("#probe").focus();
    await openByShortcut(page);
  });

  test("/ typed in a field is a character, and does not open it", async ({ page }) => {
    await page.goto("/about/");
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.id = "probe";
      document.body.prepend(field);
    });
    await page.locator("#probe").focus();
    await page.keyboard.type("a/b");
    await expect(page.locator("#probe")).toHaveValue("a/b");
    await expect(dialogOf(page)).toBeHidden();
  });

  test("a plain letter and Ctrl+J do not open it", async ({ page }) => {
    await page.goto("/about/");
    await page.keyboard.press("k");
    await page.keyboard.press("Control+J");
    await expect(dialogOf(page)).toBeHidden();
  });

  test("it can be opened again after closing, with the field empty", async ({ page }) => {
    await page.goto("/about/");
    await openByShortcut(page);
    await inputOf(page).fill("abc");
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toBeHidden();
    await openByShortcut(page);
    await expect(inputOf(page)).toHaveValue("");
  });
});

test.describe("opening search on a touch screen", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 780 } });

  test("a tap on the command bar in the menu opens it", async ({ page }) => {
    await page.goto("/about/");
    await page.locator(".ni-menu > summary").tap();
    await page.locator(".ni-menu__panel").getByRole("link", { name: "Search tools" }).tap();
    await expect(dialogOf(page)).toBeVisible();
    await expect(inputOf(page)).toBeFocused();
    // Playwright's Firefox cannot tap inside a modal dialog, so closing is a click.
    await page.getByRole("button", { name: "Close search" }).click();
    await expect(dialogOf(page)).toBeHidden();
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the command bar is a real link that goes to all tools", async ({ page }) => {
    const requests = collectRequests(page);
    await page.goto("/about/");
    const link = headerBar(page);
    await expect(link).toHaveAttribute("href", "/tools/");
    await link.click();
    await expect(page).toHaveURL(/\/tools\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "All tools" })).toBeVisible();
    expect(requests.filter(isSearchRequest)).toEqual([]);
  });

  test("the dialog is not on the page, and no Ctrl+K hint promises a shortcut", async ({
    page,
  }) => {
    await page.goto("/about/");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".ni-header__nav .ni-commandbar__hint")).toBeHidden();
  });
});

test.describe("using search", () => {
  test.beforeEach(async ({ page }) => {
    await serveIndex(page, corpus);
    await page.goto("/about/");
    await openByShortcut(page);
  });

  test("shows the categories before anything is typed", async ({ page }) => {
    const nav = dialogOf(page).getByRole("navigation", { name: "Browse by category" });
    await expect(nav.getByRole("link")).toHaveCount(categories.length);
    for (const category of categories) {
      await expect(nav.getByRole("link", { name: category.name })).toHaveAttribute(
        "href",
        categoryHref(category),
      );
    }
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(inputOf(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("lists results as options, marks the first as active, and counts them", async ({ page }) => {
    const expected = createEngine(corpus)
      .search("compress")
      .hits.map((hit) => hit.record.name);
    await inputOf(page).pressSequentially("compress");
    const options = page.getByRole("option");
    await expect(options).toHaveCount(expected.length);
    await expect(inputOf(page)).toHaveAttribute("aria-expanded", "true");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(inputOf(page)).toHaveAttribute(
      "aria-activedescendant",
      (await options.first().getAttribute("id")) ?? "",
    );
    // The browser gives the order the engine gives.
    for (const [index, name] of expected.entries()) {
      await expect(options.nth(index).locator(".ni-search__result-name")).toHaveText(name);
    }
    await expect(dialogOf(page).locator(".ni-search__count")).toHaveText(
      `${expected.length} tools found`,
    );
  });

  test("announces the count in a polite live region", async ({ page }) => {
    await inputOf(page).fill("compress");
    await expect(dialogOf(page).locator("[data-ni-search-live]")).toHaveText("3 tools found");
    await expect(dialogOf(page).locator("[data-ni-search-live]")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  test("each result shows the name, its category and its summary", async ({ page }) => {
    await inputOf(page).fill("word counter");
    const first = page.getByRole("option").first();
    await expect(first.locator(".ni-search__result-name")).toHaveText("Word Counter");
    await expect(first.locator(".ni-search__result-category")).toHaveText("Text tools");
    await expect(first.locator(".ni-search__result-summary")).toContainText(
      "Count the words and characters in a text.",
    );
    // The category accent tints the icon chip and nothing else.
    await expect(first).toHaveAttribute("data-cat", "text");
    await expect(first.locator(".ni-icon-tint svg")).toHaveCount(1);
  });

  test("marks the matched text, only what was typed for a prefix", async ({ page }) => {
    await inputOf(page).fill("merg");
    const marks = page.getByRole("option").first().locator(".ni-search__result-name mark");
    await expect(marks).toHaveText(["Merg"]);
  });

  test("finds a tool through a typo", async ({ page }) => {
    await inputOf(page).fill("comprss pdf");
    await expect(page.getByRole("option").first().locator(".ni-search__result-name")).toHaveText(
      "Compress PDF",
    );
  });

  test("finds format queries, the tool that goes JPG to PNG first", async ({ page }) => {
    await inputOf(page).fill("jpg to png");
    const names = page.getByRole("option").locator(".ni-search__result-name");
    await expect(names.first()).toHaveText("JPG to PNG Converter");
    const all = await names.allTextContents();
    expect(all.indexOf("JPG to PNG Converter")).toBeLessThan(all.indexOf("PNG to JPG Converter"));
  });

  test("hints at the formats when only a format matched", async ({ page }) => {
    await inputOf(page).fill("webp");
    const hint = page.getByRole("option").first().locator(".ni-search__result-hint");
    await expect(hint).toHaveText("Accepts WEBP · Produces WEBP");
  });

  test("ArrowDown and ArrowUp move the active result and wrap around", async ({ page }) => {
    await inputOf(page).fill("compress");
    const options = page.getByRole("option");
    const active = async () => {
      const id = await inputOf(page).getAttribute("aria-activedescendant");
      return id ? page.locator(`#${id}`).locator(".ni-search__result-name").textContent() : null;
    };
    const names = await options.locator(".ni-search__result-name").allTextContents();
    expect(names.length).toBe(3);
    expect(await active()).toBe(names[0]);
    await page.keyboard.press("ArrowDown");
    expect(await active()).toBe(names[1]);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    expect(await active()).toBe(names[0]);
    await page.keyboard.press("ArrowUp");
    expect(await active()).toBe(names[2]);
    // Exactly one option is selected at a time, and focus never leaves the field.
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
    await expect(inputOf(page)).toBeFocused();
  });

  test("Enter opens the active result", async ({ page }) => {
    await inputOf(page).fill("compress");
    await page.keyboard.press("ArrowDown");
    const target = await page.getByRole("option").nth(1).getAttribute("href");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${target}$`));
  });

  test("clicking a result opens it", async ({ page }) => {
    await inputOf(page).fill("word counter");
    await page.getByRole("option").first().click();
    await expect(page).toHaveURL(/\/word-counter\/$/);
  });

  test("says plainly when nothing matches, and offers the categories", async ({ page }) => {
    await inputOf(page).fill("zzzzqq");
    await expect(dialogOf(page)).toContainText("No tools match “zzzzqq”");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(
      dialogOf(page).getByRole("navigation", { name: "Browse by category" }).getByRole("link"),
    ).toHaveCount(categories.length);
    await expect(dialogOf(page).locator(".ni-search__count")).toHaveText("No tools found");
  });

  test("returns to the categories when the field is cleared", async ({ page }) => {
    await inputOf(page).fill("compress");
    await expect(page.getByRole("option")).toHaveCount(3);
    await inputOf(page).fill("");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(
      dialogOf(page).getByRole("navigation", { name: "Browse by category" }),
    ).toBeVisible();
    await expect(inputOf(page)).not.toHaveAttribute("aria-activedescendant", /.+/);
  });

  test("Esc closes it", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toBeHidden();
  });

  test("the close button and a click on the backdrop close it", async ({ page }) => {
    await inputOf(page).fill("compress");
    await page.getByRole("button", { name: "Close search" }).click();
    await expect(dialogOf(page)).toBeHidden();
    // Reopened at once, before the dialog's close event has run: it opens empty, focus stays in the
    // field and is not sent back to the page by that late event.
    await openByShortcut(page);
    await expect(inputOf(page)).toHaveValue("");
    // A click on the dialog itself, left of the panel, is a click on the backdrop. Clicking through
    // the locator waits until the dialog is stable and checks that the point lands on it, where a
    // raw mouse click could fire while the panel was still animating in.
    await dialogOf(page).click({ position: { x: 4, y: 400 } });
    await expect(dialogOf(page)).toBeHidden();
  });

  test("a click inside the panel does not close it", async ({ page }) => {
    await dialogOf(page).locator(".ni-search__heading").click();
    await expect(dialogOf(page)).toBeVisible();
  });
});

test.describe("focus", () => {
  test.beforeEach(async ({ page }) => {
    await serveIndex(page, corpus);
  });

  test("returns to the command bar when Esc closes it after a click", async ({ page }) => {
    await page.goto("/about/");
    await headerBar(page).click();
    await expect(dialogOf(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialogOf(page)).toBeHidden();
    await expect(headerBar(page)).toBeFocused();
  });

  test("returns to what had focus when a shortcut opened it", async ({ page }) => {
    await page.goto("/about/");
    const link = page.locator("footer").getByRole("link").first();
    await link.focus();
    await openByShortcut(page);
    await page.keyboard.press("Escape");
    await expect(link).toBeFocused();
  });

  test("returns to the command bar when nothing had focus", async ({ page }) => {
    await page.goto("/about/");
    await openByShortcut(page, "/");
    await page.keyboard.press("Escape");
    await expect(headerBar(page)).toBeFocused();
  });

  test("keeps Tab inside the dialog while it is open", async ({ page }) => {
    await page.goto("/about/");
    await openByShortcut(page);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      // Focus is in the dialog, or has gone up into the browser's own toolbar, where the page has
      // no focus (activeElement is then <body>). It never reaches the inert page behind.
      const inside = await page.evaluate(
        () =>
          document.activeElement === document.body ||
          document.activeElement?.closest("dialog.ni-search") !== null,
      );
      expect(inside).toBe(true);
    }
  });
});

test.describe("what the words on the page cannot do", () => {
  const hostile: SearchRecord = {
    id: "hostile",
    name: '<img src=x onerror="window.__pwned=1"> Script',
    summary: "A <b>bold</b> script tool &amp; more.",
    category: "text",
    tags: ["script"],
    href: "/hostile/",
  };

  test("markup in a tool's name is shown as text, never parsed", async ({ page }) => {
    await serveIndex(page, [hostile]);
    await page.goto("/about/");
    await openByShortcut(page);
    await inputOf(page).fill("script");
    const option = page.getByRole("option").first();
    await expect(option.locator(".ni-search__result-name")).toContainText(
      '<img src=x onerror="window.__pwned=1"> Script',
    );
    await expect(option.locator(".ni-search__result-summary")).toContainText(
      "A <b>bold</b> script tool &amp; more.",
    );
    expect(await option.locator("img, b, script").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
    await expect(option.locator("mark").first()).toHaveText("Script");
  });

  test("markup typed into the field is shown as text, never parsed", async ({ page }) => {
    await serveIndex(page, [hostile]);
    await page.goto("/about/");
    await openByShortcut(page);
    await inputOf(page).fill('<img src=x onerror="window.__pwned=1">zzzz');
    await expect(dialogOf(page)).toContainText("No tools match");
    expect(await dialogOf(page).locator("img").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
  });
});

test.describe("an empty site and a broken index", () => {
  test("with no tools it says so: No tools yet, and offers the categories", async ({ page }) => {
    await serveIndex(page, []);
    await page.goto("/about/");
    await openByShortcut(page);
    await expect(dialogOf(page)).toContainText("No tools yet");
    await inputOf(page).fill("anything");
    await expect(dialogOf(page)).toContainText("No tools yet");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(
      dialogOf(page).getByRole("navigation", { name: "Browse by category" }).getByRole("link"),
    ).toHaveCount(categories.length);
  });

  test("when the index cannot be fetched it says so and links to all tools", async ({ page }) => {
    await page.route(INDEX_URL, (route) => route.fulfill({ status: 404, body: "gone" }));
    await page.goto("/about/");
    await openByShortcut(page);
    await expect(dialogOf(page)).toContainText("Search could not load");
    await expect(dialogOf(page).getByRole("link", { name: "see every tool" })).toHaveAttribute(
      "href",
      "/tools/",
    );
  });

  test("an index that is not one is treated as unavailable, not as empty", async ({ page }) => {
    await page.route(INDEX_URL, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: '{"nope":true}' }),
    );
    await page.goto("/about/");
    await openByShortcut(page);
    await expect(dialogOf(page)).toContainText("Search could not load");
  });
});

test.describe("search code loads on intent, not before", () => {
  const intents: Record<string, (page: Page) => Promise<void>> = {
    hover: async (page) => {
      await headerBar(page).hover();
    },
    focus: async (page) => {
      await headerBar(page).focus();
    },
    "pointer press": async (page) => {
      const box = await headerBar(page).boundingBox();
      if (!box) throw new Error("the command bar has no box");
      // The centre: the link has rounded corners, and a press on one would miss it.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
    },
    "shortcut key": async (page) => {
      await page.keyboard.press("Control+K");
    },
  };

  for (const [name, intend] of Object.entries(intents)) {
    test(`nothing of search is requested until ${name}, then the module and the index are`, async ({
      page,
    }) => {
      const requests = collectRequests(page);
      await page.goto("/about/", { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      expect(requests.filter(isSearchRequest), "before intent").toEqual([]);

      const module = page.waitForRequest((request) =>
        MODULE_URL.test(new URL(request.url()).pathname),
      );
      const index = page.waitForRequest((request) =>
        INDEX_URL.test(new URL(request.url()).pathname),
      );
      await intend(page);
      await Promise.all([module, index]);
    });
  }

  test("reading the page asks for nothing: moving the mouse, scrolling, typing letters", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await page.goto("/about/", { waitUntil: "networkidle" });
    await page.mouse.move(20, 500);
    await page.mouse.move(400, 600);
    await page.mouse.wheel(0, 300);
    await page.keyboard.press("a");
    await page.keyboard.press("k");
    await page.waitForTimeout(500);
    expect(requests.filter(isSearchRequest)).toEqual([]);
  });

  test("the module and the index are fetched once, however many times search opens", async ({
    page,
  }) => {
    const requests = collectRequests(page);
    await page.goto("/about/");
    await openByShortcut(page);
    await page.keyboard.press("Escape");
    await openByShortcut(page);
    await page.keyboard.press("Escape");
    await headerBar(page).hover();
    await page.waitForTimeout(300);
    const search = requests.filter(isSearchRequest);
    expect(search.filter((url) => MODULE_URL.test(new URL(url).pathname))).toHaveLength(1);
    expect(search.filter((url) => INDEX_URL.test(new URL(url).pathname))).toHaveLength(1);
  });

  test("if the module cannot load, the command bar still goes to all tools", async ({ page }) => {
    await page.route(MODULE_URL, (route) => route.abort());
    await page.goto("/about/");
    await headerBar(page).click();
    await expect(page).toHaveURL(/\/tools\/$/);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`accessibility with the dialog open, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    const scan = async (page: Page, state: string, testInfo: { project: { name: string } }) => {
      const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
      console.log(
        `axe search dialog (${state}, ${scheme}, ${testInfo.project.name}): ${results.passes.length} rules passed, ${results.violations.length} violations`,
      );
      expect(
        results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => node.html.slice(0, 120)),
        })),
      ).toEqual([]);
    };

    test("the categories, before anything is typed", async ({ page }, testInfo) => {
      await serveIndex(page, corpus);
      await page.goto("/about/");
      await openByShortcut(page);
      await expect(dialogOf(page).getByRole("navigation")).toBeVisible();
      await scan(page, "categories", testInfo);
    });

    test("results, with the first one active", async ({ page }, testInfo) => {
      await serveIndex(page, corpus);
      await page.goto("/about/");
      await openByShortcut(page);
      await inputOf(page).fill("compress");
      await expect(page.getByRole("option")).toHaveCount(3);
      await scan(page, "results", testInfo);
      await page.keyboard.press("ArrowDown");
      await scan(page, "results, second active", testInfo);
    });

    test("a format hint in a result", async ({ page }, testInfo) => {
      await serveIndex(page, corpus);
      await page.goto("/about/");
      await openByShortcut(page);
      await inputOf(page).fill("webp");
      await expect(page.locator(".ni-search__result-hint")).toBeVisible();
      await scan(page, "format hint", testInfo);
    });

    test("no results", async ({ page }, testInfo) => {
      await serveIndex(page, corpus);
      await page.goto("/about/");
      await openByShortcut(page);
      await inputOf(page).fill("zzzzqq");
      await expect(dialogOf(page)).toContainText("No tools match");
      await scan(page, "no results", testInfo);
    });

    test("No tools yet, on an empty index", async ({ page }, testInfo) => {
      await serveIndex(page, []);
      await page.goto("/about/");
      await openByShortcut(page);
      await expect(dialogOf(page)).toContainText("No tools yet");
      await scan(page, "no tools yet", testInfo);
    });

    test("the search could not load state", async ({ page }, testInfo) => {
      await page.route(INDEX_URL, (route) => route.fulfill({ status: 500, body: "" }));
      await page.goto("/about/");
      await openByShortcut(page);
      await expect(dialogOf(page)).toContainText("Search could not load");
      await scan(page, "error", testInfo);
    });
  });
}

test.describe("keypress to results, at 1,000 synthetic tools", () => {
  // Two measures, both from the keydown event to a point the visitor cares about:
  //   dom    the results are in the page. This is our code (the engine and the rendering) and does
  //          not depend on the browser's compositor, so it is asserted strictly in every engine.
  //   frame  the browser has painted them: the part of INP the page controls. The target is under
  //          50 ms. Playwright's WebKit is a software-rendered build whose frames take several
  //          times longer when other tests run beside it (measured 14 ms alone, 131 ms loaded on
  //          the same machine), so there the number is reported and only bounded loosely.
  test("renders results within the INP target", async ({ page, browserName }, testInfo) => {
    const records = buildSearchIndex(syntheticTools(1000)).tools;
    await serveIndex(page, records);
    await page.goto("/about/");
    await openByShortcut(page);
    // The first results warm the engine and the JIT. The measured keystrokes come after.
    await inputOf(page).pressSequentially("compress");
    await expect(page.getByRole("option").first()).toBeVisible();
    await inputOf(page).fill("");

    await page.evaluate(() => {
      const state = window as unknown as {
        __frame: number[];
        __dom: number[];
        __t0: number;
        __events: number[];
      };
      state.__frame = [];
      state.__dom = [];
      state.__events = [];
      state.__t0 = 0;
      const field = document.querySelector<HTMLInputElement>("[data-ni-search-input]");
      addEventListener(
        "keydown",
        (event) => {
          if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
            state.__t0 = event.timeStamp;
          }
        },
        true,
      );
      // Registered after the dialog's own listener, so it runs once the results are in the DOM.
      // The next frame plus a task is after the browser has painted them.
      field?.addEventListener("input", () => {
        const start = state.__t0;
        state.__t0 = 0;
        if (!start) return;
        state.__dom.push(performance.now() - start);
        requestAnimationFrame(() =>
          setTimeout(() => state.__frame.push(performance.now() - start), 0),
        );
      });
      // The browser's own INP-style measure, where it has one: the Event Timing API.
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) state.__events.push(entry.duration);
        }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
      } catch {
        // Not every engine has it.
      }
    });

    const queries = ["compress pdf", "jpg to png", "convert video", "resize image", "qr code"];
    for (const query of queries) {
      await page.keyboard.type(query, { delay: 40 });
      await page.waitForTimeout(60);
      await inputOf(page).fill("");
    }
    await page.waitForTimeout(300);

    const { frame, dom, events } = await page.evaluate(() => {
      const state = window as unknown as {
        __frame: number[];
        __dom: number[];
        __events: number[];
      };
      return { frame: state.__frame, dom: state.__dom, events: state.__events };
    });
    const percentile = (values: number[], fraction: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
    };
    const describe = (values: number[]) =>
      `median ${percentile(values, 0.5).toFixed(1)} ms, p95 ${percentile(values, 0.95).toFixed(1)} ms, max ${percentile(values, 1).toFixed(1)} ms`;
    console.log(
      `keypress to results at 1,000 tools (${testInfo.project.name}), ${frame.length} keystrokes: in the page ${describe(dom)}; painted ${describe(frame)}` +
        (events.length > 0
          ? `; Event Timing: ${events.length} events over 16 ms, longest ${Math.max(...events).toFixed(0)} ms`
          : browserName === "chromium"
            ? "; Event Timing: no event over 16 ms"
            : ""),
    );
    expect(frame.length).toBeGreaterThanOrEqual(30);
    expect(dom.length).toBe(frame.length);
    expect(percentile(dom, 0.95), "keypress to results in the page, p95").toBeLessThan(50);
    if (browserName === "webkit") {
      expect(percentile(frame, 0.5), "keypress to paint, median").toBeLessThan(250);
    } else {
      expect(percentile(frame, 0.5), "keypress to paint, median").toBeLessThan(50);
      expect(percentile(frame, 0.95), "keypress to paint, p95").toBeLessThan(100);
    }
  });
});

// The /tools/ page filter, on a list long enough to filter. These tests splice the markup of a
// page with the fixed corpus (filter-fixture.ts, checked against the real page by
// tools-filter.test.ts) into the built page, in place of its real list. The real loader and the
// real search module then do the work.
const fixtureGroups: FixtureGroup[] = categories
  .map((category) => ({
    id: category.id,
    name: category.name,
    href: categoryHref(category),
    tools: corpus
      .filter((record) => record.category === category.id)
      .map((record) => ({ name: record.name, href: record.href })),
  }))
  .filter((group) => group.tools.length > 0);

async function toolsPageWithList(page: Page) {
  await page.route("**/tools/", async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /<div class="grid gap-8" data-ni-tools>[\s\S]*?(?=<\/main>)/,
      filterFixtureHtml(fixtureGroups),
    );
    await route.fulfill({
      response,
      body,
      headers: { ...response.headers(), "content-length": String(Buffer.byteLength(body)) },
    });
  });
  await page.goto("/tools/");
}

const rowLinks = (page: Page) => page.locator("[data-ni-filter-list] li > a");

test.describe("the /tools/ filter with JavaScript", () => {
  test.beforeEach(async ({ page }) => {
    await serveIndex(page, corpus);
  });

  test("is shown, labelled, and nothing is hidden until it is used", async ({ page }) => {
    const requests = collectRequests(page);
    await toolsPageWithList(page);
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await expect(filter).toBeVisible();
    await expect(rowLinks(page)).toHaveCount(corpus.length);
    await expect(page.locator("[data-ni-filter-list] [hidden]")).toHaveCount(0);
    expect(requests.filter(isSearchRequest), "before intent").toEqual([]);
  });

  test("filters the list with the same engine, in place, without reordering", async ({ page }) => {
    await toolsPageWithList(page);
    const before = await rowLinks(page).evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    );
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await filter.focus();
    await filter.fill("compress");

    const expected = createEngine(corpus)
      .search("compress", { limit: 100 })
      .hits.map((hit) => hit.record.href);
    const visible = page.locator("[data-ni-filter-list] li:not([hidden]) > a");
    await expect(visible).toHaveCount(expected.length);
    const shown = await visible.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    );
    expect([...shown].sort()).toEqual([...expected].sort());
    // Same order as on the page before: the list is filtered, not re-ranked.
    expect(shown).toEqual(before.filter((href) => shown.includes(href)));
    await expect(page.locator("[data-ni-filter-status]")).toHaveText(
      `${expected.length} of ${corpus.length} tools`,
    );
  });

  test("hides a category heading when none of its tools match", async ({ page }) => {
    await toolsPageWithList(page);
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await filter.focus();
    await filter.fill("word counter");
    const groups = page.locator("[data-ni-filter-group]:not([hidden])");
    await expect(groups).toHaveCount(1);
    await expect(groups.first().getByRole("heading")).toHaveText("Text tools");
  });

  test("finds a tool through a typo", async ({ page }) => {
    await toolsPageWithList(page);
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await filter.focus();
    await filter.fill("comprss");
    await expect(page.locator("[data-ni-filter-list] li:not([hidden]) > a")).toHaveCount(3);
  });

  test("says so when nothing matches, and Clear filter brings the whole list back", async ({
    page,
  }) => {
    await toolsPageWithList(page);
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await filter.focus();
    await filter.fill("zzzzqq");
    await expect(page.locator("[data-ni-filter-none]")).toContainText("No tool matches “zzzzqq”");
    await expect(page.locator("[data-ni-filter-list] li:not([hidden])")).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filter" }).click();
    await expect(filter).toHaveValue("");
    await expect(filter).toBeFocused();
    await expect(page.locator("[data-ni-filter-none]")).toBeHidden();
    await expect(page.locator("[data-ni-filter-list] li:not([hidden])")).toHaveCount(corpus.length);
  });

  test("an emptied field shows every tool again", async ({ page }) => {
    await toolsPageWithList(page);
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await filter.focus();
    await filter.fill("pdf");
    await filter.fill("");
    await expect(page.locator("[data-ni-filter-list] li:not([hidden])")).toHaveCount(corpus.length);
    await expect(page.locator("[data-ni-filter-status]")).toHaveText("");
  });

  test("loads the search code when the filter gets focus", async ({ page }) => {
    await toolsPageWithList(page);
    const module = page.waitForRequest((request) =>
      MODULE_URL.test(new URL(request.url()).pathname),
    );
    await page.getByRole("searchbox", { name: "Filter tools" }).focus();
    await module;
  });

  test("leaves the whole list visible when the index cannot load, and says so", async ({
    page,
  }) => {
    await page.route(INDEX_URL, (route) => route.fulfill({ status: 500, body: "" }));
    await toolsPageWithList(page);
    const filter = page.getByRole("searchbox", { name: "Filter tools" });
    await filter.focus();
    await filter.fill("compress");
    await expect(page.locator("[data-ni-filter-status]")).toContainText("Filtering is unavailable");
    await expect(page.locator("[data-ni-filter-list] li:not([hidden])")).toHaveCount(corpus.length);
  });

  test("the search dialog still works on the same page", async ({ page }) => {
    await toolsPageWithList(page);
    await openByShortcut(page);
    await inputOf(page).fill("word");
    await expect(page.getByRole("option").first()).toBeVisible();
  });
});

test.describe("the /tools/ filter without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the filter is not shown, the full list is, and every link works", async ({ page }) => {
    const requests = collectRequests(page);
    await toolsPageWithList(page);
    await expect(page.getByRole("searchbox", { name: "Filter tools" })).toBeHidden();
    await expect(page.locator("[data-ni-filter-status]")).toBeHidden();
    await expect(rowLinks(page)).toHaveCount(corpus.length);
    for (const link of await rowLinks(page).all()) await expect(link).toBeVisible();
    await rowLinks(page).first().click();
    await expect(page).not.toHaveURL(/\/tools\/$/);
    expect(requests.filter(isSearchRequest)).toEqual([]);
  });
});

// The empty /tools/ page (no filter box, an honest empty state) is checked in
// tools-filter-empty.test.ts, since the built site has tools.
test.describe("the /tools/ page with the real tools", () => {
  test("says how many tools there are and lists each one as a card", async ({ page }) => {
    await page.goto("/tools/");
    const count = siteTools.length;
    await expect(page.locator("[data-ni-tool-count]")).toContainText(
      `${count} ${count === 1 ? "tool" : "tools"} in`,
    );
    for (const tool of siteTools) {
      const card = page.locator(`main a.ni-toolcard[href="${tool.path}"]`);
      await expect(card.locator(".ni-toolcard__name")).toHaveText(tool.name);
      await expect(card.locator(".ni-toolcard__summary")).toHaveText(tool.summary);
    }
    await expect(page.getByText("No tools are live yet")).toHaveCount(0);
  });
});

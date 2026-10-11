// The app shell (ADR 0072): which install path each browser gets, which clicks show the navigation
// bar, the markup it drives, and the press feedback CSS. How the control changes state in a real
// browser is in e2e/app-shell.spec.ts.

import { readFileSync } from "node:fs";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import AppShell from "../../components/layout/AppShell.astro";
import InstallButton from "../../components/ui/InstallButton.astro";
import { type InstallWindow, installPlatform, type LinkClick, startsNavigation } from "./app-shell";

// Real user agent strings, one per browser the install control has to tell apart.
const UA = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
  firefoxDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  instagram:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Instagram 400.0.0.0.0 Android",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.0]",
  whatsapp:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 WhatsApp/2.25.1",
};

interface Browser {
  userAgent?: string;
  maxTouchPoints?: number;
  prompt?: boolean;
  safari?: boolean;
  firefox?: boolean;
  coarse?: boolean;
  /** `display-mode: standalone` matches: an installed app on Android or a desktop. */
  standalone?: boolean;
  /** `navigator.standalone` is true: an app added to the Home Screen on iOS. */
  homeScreen?: boolean;
}

/** A window with only the features `options` names, the way installPlatform tests for them. */
const env = (options: Browser): InstallWindow => ({
  matchMedia: (query) => ({
    matches: query.includes("standalone")
      ? Boolean(options.standalone)
      : query.includes("coarse") && Boolean(options.coarse),
  }),
  navigator: {
    userAgent: options.userAgent ?? "",
    maxTouchPoints: options.maxTouchPoints ?? 0,
    ...(options.homeScreen ? { standalone: true } : {}),
  },
  ...(options.prompt ? { onbeforeinstallprompt: null } : {}),
  ...(options.safari ? { safari: {} } : {}),
  ...(options.firefox ? { mozInnerScreenX: 0 } : {}),
});

describe("installPlatform", () => {
  it("uses the browser's own prompt in Chromium, on Android and on a desktop", () => {
    expect(installPlatform(env({ prompt: true, userAgent: UA.chromeAndroid }))).toBe("prompt");
    expect(installPlatform(env({ prompt: true, userAgent: UA.chromeWindows }))).toBe("prompt");
  });

  it("shows the Share steps on iPhone and iPad, in any browser there", () => {
    expect(installPlatform(env({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 }))).toBe("ios");
    expect(installPlatform(env({ userAgent: UA.iphoneChrome, maxTouchPoints: 5 }))).toBe("ios");
    // iPadOS asks for the desktop site: only its touch screen tells it from a Mac.
    expect(installPlatform(env({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 }))).toBe("ios");
  });

  it("shows File, then Add to Dock in Safari on a Mac", () => {
    expect(installPlatform(env({ userAgent: UA.macSafari, safari: true }))).toBe("mac-safari");
  });

  it("shows the menu steps in Firefox on Android, and nothing in Firefox on a desktop", () => {
    expect(
      installPlatform(env({ userAgent: UA.firefoxAndroid, firefox: true, coarse: true })),
    ).toBe("firefox-android");
    expect(installPlatform(env({ userAgent: UA.firefoxDesktop, firefox: true }))).toBe("none");
  });

  it("asks the visitor to open a real browser inside a social app, even where Chromium is underneath", () => {
    expect(installPlatform(env({ userAgent: UA.instagram, prompt: true }))).toBe("in-app");
    expect(installPlatform(env({ userAgent: UA.facebookIos, maxTouchPoints: 5 }))).toBe("in-app");
    expect(installPlatform(env({ userAgent: UA.whatsapp }))).toBe("in-app");
  });

  it("offers nothing once the site runs as an installed app", () => {
    for (const userAgent of Object.values(UA)) {
      expect(installPlatform(env({ standalone: true, prompt: true, userAgent }))).toBe("none");
      expect(installPlatform(env({ homeScreen: true, userAgent }))).toBe("none");
    }
  });
});

describe("startsNavigation", () => {
  const here = "https://networksinsights.com/merge-pdf/";
  const plain: LinkClick = {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  const link = (href: string, target = "", download = false) => ({
    href,
    target,
    hasAttribute: () => download,
  });

  it("is true for a plain click on another page of the site", () => {
    expect(startsNavigation(plain, link("/split-pdf/"), here)).toBe(true);
    expect(startsNavigation(plain, link("https://networksinsights.com/"), here)).toBe(true);
    expect(startsNavigation(plain, link("/merge-pdf/?a=1"), here)).toBe(true);
    expect(startsNavigation(plain, link("/split-pdf/", "_self"), here)).toBe(true);
  });

  it("is false when nothing loads in this tab", () => {
    expect(startsNavigation(plain, link("#faq"), here)).toBe(false);
    expect(startsNavigation(plain, link("/merge-pdf/#faq"), here)).toBe(false);
    expect(startsNavigation(plain, link("https://github.com/"), here)).toBe(false);
    expect(startsNavigation(plain, link("/a/", "_blank"), here)).toBe(false);
    expect(startsNavigation(plain, link("/a/", "", true), here)).toBe(false);
    expect(startsNavigation(plain, null, here)).toBe(false);
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(startsNavigation({ ...plain, [key]: true }, link("/a/"), here), key).toBe(false);
    }
    expect(startsNavigation({ ...plain, button: 1 }, link("/a/"), here)).toBe(false);
    expect(startsNavigation({ ...plain, defaultPrevented: true }, link("/a/"), here)).toBe(false);
  });
});

describe("the shell markup", () => {
  let html: string;
  beforeAll(async () => {
    html = await (await AstroContainer.create()).renderToString(AppShell);
  });

  it("hides the bar from assistive technology and announces install states politely", () => {
    expect(html).toMatch(/<div class="ni-navbar" data-ni-nav aria-hidden="true">/);
    expect(html).toMatch(/<p class="sr-only" aria-live="polite" data-ni-install-status>/);
    // A tool's own status message must stay the only role="status" on its page.
    expect(html).not.toContain('role="status"');
  });

  it("is a labelled native dialog that shows only the steps of the platform the script names", () => {
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="ni-install-title"/);
    const css = readFileSync(new URL("../../styles/components.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.ni-install-dialog \[data-steps\] \{\s*display: none;/);
    for (const steps of ["ios", "mac-safari", "firefox-android", "in-app"]) {
      expect(html).toContain(`data-steps="${steps}"`);
      expect(css).toContain(`.ni-install-dialog[data-platform="${steps}"] [data-steps="${steps}"]`);
    }
    expect(html).toContain("Add to Home Screen");
    expect(html).toContain("Add to Dock");
    // Astro drops the whitespace of a line break before an element: each label keeps its space.
    expect(html).not.toMatch(/[a-z,]<strong/);
    expect(html).not.toMatch(/<\/strong>[a-z]/);
    expect(html).toContain("Open this page in Chrome or Safari");
  });

  it("renders the install control hidden, so a page without JavaScript never shows it", async () => {
    const button = await (await AstroContainer.create()).renderToString(InstallButton);
    expect(button).toMatch(/<button type="button" class="ni-install" data-ni-install hidden>/);
  });
});

describe("press feedback CSS", () => {
  const css = readFileSync(new URL("../../styles/components.css", import.meta.url), "utf8");
  const tappable = [
    ".ni-btn",
    ".ni-tab",
    ".ni-header__link",
    ".ni-menu__summary",
    ".ni-menu__list a",
    ".ni-toolcard",
    ".ni-tile",
    '.ni-card[data-interactive="true"]',
    ".ni-linklist a",
    ".ni-footer__list a",
    ".ni-breadcrumbs a",
    ".ni-theme-toggle__opt",
    ".ni-install",
  ];

  it("gives every shared tappable element an :active state and touch-action: manipulation", () => {
    const touch = css.match(/:where\(([^)]*)\)\s*\{\s*touch-action: manipulation;/);
    expect(touch, "the touch-action rule").not.toBeNull();
    for (const selector of tappable) {
      expect(css, selector).toContain(`${selector}:active`);
      expect(touch?.[1], selector).toContain(selector);
    }
  });

  it("removes the tap highlight only together with the :active states, and keeps focus rings", () => {
    expect(css.match(/-webkit-tap-highlight-color: transparent/g)).toHaveLength(1);
    const base = readFileSync(new URL("../../styles/base.css", import.meta.url), "utf8");
    expect(base).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--ring\)/);
  });

  it("moves an element on press only when motion is allowed", () => {
    const section = css.slice(css.indexOf("Press feedback"));
    const scales = [...section.matchAll(/transform: scale\(0\.97\)/g)];
    expect(scales).toHaveLength(1);
    const motion = section.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(motion).toBeGreaterThan(-1);
    expect(section.indexOf("transform: scale(0.97)")).toBeGreaterThan(motion);
    // Nothing outside that block moves a pressed element.
    expect(css).not.toMatch(/:active[^{]*\{[^}]*translateY/);
  });
});

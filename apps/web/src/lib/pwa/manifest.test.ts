import { describe, expect, it, vi } from "vitest";
import { site } from "../../config/site";
import { faviconSvg, iconColors, iconNode, icoOf, MARK_SHARE } from "./icons";
import { themeBackground, webManifest } from "./manifest";
import { appIcons, iconPath } from "./paths";
import { registerServiceWorker, KEEP_OPEN_PAGES as SENT } from "./register";
import { KEEP_OPEN_PAGES as HEARD } from "./service-worker";

describe("webManifest", () => {
  const manifest = webManifest();

  it("has what Chrome needs to install the site", () => {
    expect(manifest).toMatchObject({
      name: site.name,
      short_name: "NetworksInsights",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    const any = manifest.icons.filter((icon) => icon.purpose === "any").map((icon) => icon.sizes);
    expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("takes its colors from the tokens", () => {
    expect(manifest.theme_color).toBe(themeBackground("light"));
    expect(manifest.background_color).toBe(themeBackground("light"));
    expect(themeBackground("dark")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("never asks to install a store app instead", () => {
    expect(manifest.prefer_related_applications).toBe(false);
  });

  it("lists each icon file once, the iOS icon only in the page", () => {
    const srcs = manifest.icons.map((icon) => icon.src);
    expect(new Set(srcs).size).toBe(srcs.length);
    expect(srcs).not.toContain("/icons/apple-touch-icon.png");
    expect(appIcons.map(iconPath)).toContain("/icons/apple-touch-icon.png");
  });
});

describe("icons", () => {
  it("draws a maskable icon's mark inside the safe zone", () => {
    // The safe zone is a circle of 40 percent radius. The mark is square, so its corners are the
    // farthest points: half its diagonal must fit.
    expect((MARK_SHARE.maskable * Math.SQRT2) / 2).toBeLessThanOrEqual(0.4);
  });

  it("uses the brand colors, and rounds only the `any` icon", () => {
    const { background } = iconColors();
    const any = iconNode({ size: 192, purpose: "any" }) as unknown as {
      style: Record<string, unknown>;
    };
    const maskable = iconNode({ size: 192, purpose: "maskable" }) as unknown as {
      style: Record<string, unknown>;
    };
    expect(any.style.backgroundColor).toBe(background);
    expect(any.style.borderRadius).toBeGreaterThan(0);
    expect(maskable.style.borderRadius).toBe(0);
  });

  it("writes the favicon as a small SVG of the mark", () => {
    const svg = faviconSvg();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/);
    expect(svg).toContain(iconColors().mark);
    expect(svg).not.toMatch(/<script|on\w+=/);
  });

  it("writes an ICO file that holds the PNG images", () => {
    const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]);
    const ico = icoOf([
      { size: 16, png: png(1) },
      { size: 256, png: png(2) },
    ]);
    const view = new DataView(ico.buffer);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(2);
    expect(view.getUint8(6)).toBe(16);
    expect(view.getUint8(22)).toBe(0); // 256 is written as 0
    const offset = view.getUint32(6 + 12, true);
    expect([...ico.subarray(offset, offset + 5)]).toEqual([...png(1)]);
    expect(ico.length).toBe(6 + 16 * 2 + 10);
  });
});

describe("registerServiceWorker", () => {
  const setup = (readyState: DocumentReadyState, controller: unknown = null) => {
    const calls: unknown[][] = [];
    const listeners: string[] = [];
    const messages: string[] = [];
    const nav = {
      serviceWorker: {
        controller,
        ready: Promise.resolve({ active: { postMessage: (m: string) => messages.push(m) } }),
        register: async (...args: unknown[]) => {
          calls.push(args);
        },
      },
    };
    const win = {
      document: { readyState },
      addEventListener: (type: string, listener: () => void) => {
        listeners.push(type);
        listener();
      },
    };
    return { calls, listeners, messages, nav, win: win as never };
  };

  it("asks the worker to keep the page on a first visit only", async () => {
    expect(SENT).toBe(HEARD);
    const first = setup("complete");
    registerServiceWorker(first.nav, first.win, true);
    await vi.waitFor(() => expect(first.messages).toEqual([SENT]));
    const later = setup("complete", {});
    registerServiceWorker(later.nav, later.win, true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(later.messages).toEqual([]);
  });

  it("registers /sw.js for the whole site after load, never from the HTTP cache", () => {
    const { calls, listeners, nav, win } = setup("loading");
    registerServiceWorker(nav, win, true);
    expect(listeners).toEqual(["load"]);
    expect(calls).toEqual([["/sw.js", { scope: "/", updateViaCache: "none" }]]);
  });

  it("registers at once when the page has already loaded", () => {
    const { calls, listeners, nav, win } = setup("complete");
    registerServiceWorker(nav, win, true);
    expect(listeners).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("does nothing in the dev server or in a browser without service workers", () => {
    const dev = setup("complete");
    registerServiceWorker(dev.nav, dev.win, false);
    expect(dev.calls).toEqual([]);
    const none = setup("complete");
    expect(() => registerServiceWorker({}, none.win, true)).not.toThrow();
  });
});

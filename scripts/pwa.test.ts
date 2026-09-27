import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPwa, formatPwaReport, isServiceWorkerScript } from "./lib/pwa";

const REGISTER = "_astro/ServiceWorker.astro_astro_type_script_index_0_lang.AbC.js";

/** A PNG with only a signature and an IHDR header, enough for pngSize. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const page = (extra = "") =>
  `<html><head><link rel="manifest" href="/manifest.webmanifest"></head><body><div data-ni-search></div><script type="module" src="/${REGISTER}"></script>${extra}</body></html>`;

const manifest = {
  name: "NetworksInsights",
  short_name: "NetworksInsights",
  start_url: "/",
  display: "standalone",
  theme_color: "#ffffff",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ],
};

let dist: string;
const write = (path: string, content: string | Buffer) => {
  const file = join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "ni-pwa-"));
  write("index.html", page());
  write("offline/index.html", page());
  write(REGISTER, 'navigator.serviceWorker.register("/sw.js")');
  write("sw.js", '"use strict";{self.addEventListener("fetch",()=>{})}');
  write("manifest.webmanifest", JSON.stringify(manifest));
  write("icons/icon-192.png", png(192, 192));
  write("icons/icon-512.png", png(512, 512));
});

afterEach(() => rmSync(dist, { recursive: true, force: true }));

const problems = () => checkPwa(dist).violations.map((v) => v.problem);

describe("checkPwa", () => {
  it("passes a complete build and reports its sizes", () => {
    const report = checkPwa(dist);
    expect(report.violations).toEqual([]);
    expect(report.pages).toBe(2);
    expect(report.icons).toBe(2);
    expect(formatPwaReport(report)).toMatch(/✓ ServiceWorker\.astro.*on 2 pages/);
    expect(formatPwaReport(report)).toMatch(/✓ sw\.js/);
  });

  it("fails a page without the registration script, or with it twice", () => {
    write("about/index.html", page().replace(/<script[^>]*><\/script>/, ""));
    write("terms/index.html", page(`<script type="module" src="/${REGISTER}"></script>`));
    expect(problems()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/has 0 service worker registration scripts/),
        expect.stringMatching(/has 2 service worker registration scripts/),
      ]),
    );
  });

  it("fails a page that does not link the manifest", () => {
    write("about/index.html", page().replace(/<link rel="manifest"[^>]*>/, ""));
    expect(problems()).toContain("does not link the manifest");
  });

  it("fails a registration script over 1 KB gzip", () => {
    write(REGISTER, randomBytes(4000));
    expect(problems()).toEqual([expect.stringMatching(/the limit is 1024 B/)]);
  });

  it("fails a build without sw.js, or one that imports code", () => {
    write("sw.js", 'importScripts("/other.js")');
    expect(problems()).toEqual(["sw.js imports code"]);
    rmSync(join(dist, "sw.js"));
    expect(problems()).toEqual(["the build has no service worker"]);
  });

  it("fails a build without the offline page", () => {
    rmSync(join(dist, "offline"), { recursive: true });
    expect(problems()).toEqual(["the build has no offline page"]);
  });

  it("fails a manifest that Chrome could not install from", () => {
    write(
      "manifest.webmanifest",
      JSON.stringify({
        ...manifest,
        display: "browser",
        short_name: "",
        icons: [manifest.icons[0]],
      }),
    );
    expect(problems()).toEqual(
      expect.arrayContaining([
        "the manifest has no short_name",
        'display is "browser"',
        "the manifest has no 512x512 icon for any purpose",
      ]),
    );
  });

  it("fails an icon that is missing or not the size it says", () => {
    write("icons/icon-512.png", png(500, 500));
    rmSync(join(dist, "icons", "icon-192.png"));
    expect(problems()).toEqual(
      expect.arrayContaining([
        "the icon /icons/icon-192.png is missing or not a PNG",
        "the icon /icons/icon-512.png says 512x512 but is 500x500",
      ]),
    );
  });
});

describe("helpers", () => {
  it("recognizes the registration script and nothing else", () => {
    expect(isServiceWorkerScript(REGISTER)).toBe(true);
    expect(
      isServiceWorkerScript("_astro/SearchDialog.astro_astro_type_script_index_0_lang.X.js"),
    ).toBe(false);
  });
});

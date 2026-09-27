import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { iconFiles } from "./paths";
import { buildConfig, buildGraph, renderServiceWorker, workerSource } from "./sw-build";

const source = readFileSync(join(import.meta.dirname, "service-worker.ts"), "utf8");

let dist: string;
const write = (path: string, text = "") => {
  const file = join(dist, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "ni-sw-"));
  const page = (island = "") =>
    `<link rel="stylesheet" href="/_astro/Base.A.css"><script type="module" src="/_astro/SearchDialog.B.js"></script>${island}`;
  write("index.html", page());
  write("tools/index.html", page());
  write("offline/index.html", page());
  write(
    "word-counter/index.html",
    page(`<astro-island component-url="/_astro/ui.C.js" renderer-url="/_astro/client.D.js">`),
  );
  write("manifest.webmanifest", "{}");
  for (const icon of iconFiles()) write(icon.slice(1));
  write("_astro/Base.A.css", "@font-face{src:url(/_astro/fonts/g.woff2)}");
  write("_astro/fonts/g.woff2");
  write("_astro/SearchDialog.B.js", 'addEventListener("x",()=>import("./search-ui.S.js"))');
  write("_astro/search-ui.S.js", 'fetch("/search-index.abc.json")');
  write(
    "_astro/ui.C.js",
    'import{a}from"./react.E.js";const w=new Worker(new URL("/_astro/worker-F.js",""+import.meta.url));import("./lazy.G.js")',
  );
  write("_astro/react.E.js", "export const a=1");
  write("_astro/client.D.js", 'import"./react.E.js"');
  write("_astro/worker-F.js", 'fetch("/_astro/codec.H.wasm")');
  write("_astro/codec.H.wasm");
  write("_astro/lazy.G.js", "");
});

afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe("buildGraph", () => {
  it("records static, dynamic, worker, wasm and font edges, and none into search", () => {
    expect(buildGraph(dist)).toEqual({
      "Base.A.css": ["fonts/g.woff2"],
      "client.D.js": ["react.E.js"],
      "ui.C.js": ["lazy.G.js", "react.E.js", "worker-F.js"],
      "worker-F.js": ["codec.H.wasm"],
    });
  });
});

describe("buildConfig", () => {
  it("keeps the offline page, home, /tools/, the manifest, icons and their files", () => {
    const config = buildConfig(dist);
    expect(config.offline).toBe("/offline/");
    expect(config.shell.slice(0, 4)).toEqual([
      "/offline/",
      "/",
      "/tools/",
      "/manifest.webmanifest",
    ]);
    expect(config.shell).toEqual(expect.arrayContaining(iconFiles()));
    expect(config.shell).toEqual(
      expect.arrayContaining([
        "/_astro/Base.A.css",
        "/_astro/fonts/g.woff2",
        "/_astro/SearchDialog.B.js",
      ]),
    );
    expect(config.shell.join()).not.toMatch(/search-ui|search-index|ui\.C/);
  });

  it("changes version exactly when a built file changes", () => {
    const first = buildConfig(dist).version;
    expect(buildConfig(dist).version).toBe(first);
    write("word-counter/index.html", "<p>changed</p>");
    expect(buildConfig(dist).version).not.toBe(first);
  });

  it("fails the build when a shell file is missing", () => {
    rmSync(join(dist, "icons"), { recursive: true });
    expect(() => buildConfig(dist)).toThrow(/icons\/icon-192\.png/);
  });
});

describe("the built sw.js", () => {
  it("is plain JavaScript with no import or export", () => {
    const code = workerSource(source);
    expect(code).not.toMatch(/^\s*(?:import|export)\b/m);
    expect(code).not.toMatch(/\binterface\b/);
  });

  it("runs as a classic script and registers its four listeners", () => {
    const listeners: string[] = [];
    const self = {
      location: { origin: "https://networksinsights.com" },
      registration: {},
      clients: {},
      addEventListener: (type: string) => listeners.push(type),
    };
    new Script(renderServiceWorker(source, buildConfig(dist))).runInNewContext({ self, URL });
    expect(listeners.sort()).toEqual(["activate", "fetch", "install", "message"]);
  });
});

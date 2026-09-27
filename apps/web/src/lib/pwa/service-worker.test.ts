import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closure,
  FILES_CACHE,
  filesOfPage,
  isKeepable,
  KEEP_OPEN_PAGES,
  MAX_PAGES,
  PAGES_CACHE,
  pageKey,
  routeOf,
  type SwConfig,
  start,
} from "./service-worker";

const ORIGIN = "https://networksinsights.com";

const req = (url: string, init: { method?: string; mode?: string; range?: boolean } = {}) => ({
  method: init.method ?? "GET",
  url: new URL(url, ORIGIN).href,
  mode: init.mode ?? "cors",
  headers: new Headers(init.range ? { range: "bytes=0-1" } : {}),
});

describe("routeOf", () => {
  it("answers pages, built files and other same-origin files", () => {
    expect(routeOf(req("/word-counter/", { mode: "navigate" }), ORIGIN)).toBe("page");
    expect(routeOf(req("/_astro/ui.X.js"), ORIGIN)).toBe("file");
    expect(routeOf(req("/icons/icon-192.png"), ORIGIN)).toBe("other");
  });

  it("leaves alone what it must never keep", () => {
    expect(routeOf(req("/word-counter/", { method: "POST", mode: "navigate" }), ORIGIN)).toBe(
      "none",
    );
    expect(routeOf(req("https://gateway.umami.is/api/send"), ORIGIN)).toBe("none");
    expect(routeOf(req("/api/convert"), ORIGIN)).toBe("none");
    expect(routeOf(req("/api/", { mode: "navigate" }), ORIGIN)).toBe("none");
    expect(routeOf(req("/_astro/video.mp4", { range: true }), ORIGIN)).toBe("none");
    expect(routeOf(req("/sw.js"), ORIGIN)).toBe("none");
  });
});

describe("pageKey", () => {
  it("keeps a page once, whatever its query or fragment", () => {
    expect(pageKey(`${ORIGIN}/tools/?utm_source=x#top`)).toBe(`${ORIGIN}/tools/`);
  });
});

describe("isKeepable", () => {
  const response = (status: number, type = "basic", cacheControl?: string) => ({
    status,
    type,
    headers: new Headers(cacheControl ? { "cache-control": cacheControl } : {}),
  });
  it("keeps whole, successful, same-origin answers", () => {
    expect(isKeepable(response(200))).toBe(true);
    expect(isKeepable(response(200, "basic", "public, max-age=0, must-revalidate"))).toBe(true);
  });
  it("never keeps errors, partial or opaque answers, or no-store", () => {
    expect(isKeepable(response(404))).toBe(false);
    expect(isKeepable(response(206))).toBe(false);
    expect(isKeepable(response(0, "opaqueredirect"))).toBe(false);
    expect(isKeepable(response(200, "opaque"))).toBe(false);
    expect(isKeepable(response(200, "basic", "private, no-store"))).toBe(false);
  });
});

describe("filesOfPage and closure", () => {
  const html = `<link rel="stylesheet" href="/_astro/Base.A.css"><style>@font-face{src:url(/_astro/fonts/g.woff2) format("woff2")}</style>
<script type="module" src="/_astro/SearchDialog.B.js"></script>
<astro-island component-url="/_astro/ui.C.js" renderer-url="/_astro/client.D.js"></astro-island>
<a href="/about/">About</a><img src="/og/home.png">`;

  it("finds every built file a page names, and nothing else", () => {
    expect(filesOfPage(html).sort()).toEqual(
      ["Base.A.css", "SearchDialog.B.js", "client.D.js", "fonts/g.woff2", "ui.C.js"].sort(),
    );
  });

  it("follows the graph to every file a page needs", () => {
    const graph = { "ui.C.js": ["react.E.js", "worker-F.js"], "react.E.js": ["ui.C.js"] };
    expect(closure(["ui.C.js"], graph).sort()).toEqual(
      ["/_astro/react.E.js", "/_astro/ui.C.js", "/_astro/worker-F.js"].sort(),
    );
  });
});

// A small in-memory Cache Storage, enough for the worker: entries keep insertion order, and a
// put moves an entry to the end, as the Cache API does.
class FakeCache {
  entries = new Map<string, Response>();
  async match(key: string | Request) {
    return this.entries.get(typeof key === "string" ? new URL(key, ORIGIN).href : key.url)?.clone();
  }
  async put(key: string | Request, response: Response) {
    const url = typeof key === "string" ? new URL(key, ORIGIN).href : key.url;
    this.entries.delete(url);
    this.entries.set(url, response);
  }
  async delete(key: Request | string) {
    return this.entries.delete(typeof key === "string" ? new URL(key, ORIGIN).href : key.url);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async addAll(requests: Request[]) {
    for (const request of requests) {
      const response = await fetch(request);
      if (!response.ok) throw new TypeError(`addAll: ${request.url} answered ${response.status}`);
      await this.put(request, response);
    }
  }
}

class FakeStorage {
  stores = new Map<string, FakeCache>();
  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(key: string | Request) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    return undefined;
  }
  urls(name: string) {
    return [...(this.stores.get(name)?.entries.keys() ?? [])].map((url) => new URL(url).pathname);
  }
}

/** A site the fake network serves. Each response is a "basic" one, as a same-origin fetch gives. */
const site: Record<string, { body: string; type: string; cacheControl?: string }> = {
  "/": { body: `<link href="/_astro/Base.A.css">`, type: "text/html" },
  "/tools/": { body: `<link href="/_astro/Base.A.css">`, type: "text/html" },
  "/offline/": { body: "<h1>You are offline</h1>", type: "text/html" },
  "/word-counter/": {
    body: `<link href="/_astro/Base.A.css"><astro-island component-url="/_astro/ui.C.js" renderer-url="/_astro/client.D.js">`,
    type: "text/html",
  },
  "/secret/": { body: "<p>private</p>", type: "text/html", cacheControl: "no-store" },
  "/manifest.webmanifest": { body: "{}", type: "application/manifest+json" },
  "/_astro/Base.A.css": { body: "body{}", type: "text/css" },
  "/_astro/ui.C.js": { body: "import './react.E.js'", type: "text/javascript" },
  "/_astro/client.D.js": { body: "", type: "text/javascript" },
  "/_astro/react.E.js": { body: "", type: "text/javascript" },
};

const config: SwConfig = {
  version: "v2",
  offline: "/offline/",
  shell: ["/offline/", "/", "/tools/", "/manifest.webmanifest", "/_astro/Base.A.css"],
  graph: { "ui.C.js": ["react.E.js"] },
};

/** Marks a response "basic", as a browser does for same-origin answers; its clones stay basic. */
function asBasic(response: Response): Response {
  const clone = response.clone.bind(response);
  Object.defineProperty(response, "type", { value: "basic" });
  Object.defineProperty(response, "clone", { value: () => asBasic(clone()) });
  return response;
}

function basic(body: string, type: string, cacheControl?: string): Response {
  return asBasic(
    new Response(body, {
      status: 200,
      headers: {
        "content-type": type,
        ...(cacheControl ? { "cache-control": cacheControl } : {}),
      },
    }),
  );
}

describe("the worker", () => {
  let storage: FakeStorage;
  let online: boolean;
  let fetched: string[];
  let listeners: Map<string, (event: never) => void>;
  let openWindows: string[];
  const scope = {
    location: { origin: ORIGIN },
    registration: { navigationPreload: { enable: vi.fn(async () => {}) } },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: async () => openWindows.map((url) => ({ url })),
    },
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type: string, listener: (event: never) => void) =>
      listeners.set(type, listener),
  };

  beforeEach(() => {
    storage = new FakeStorage();
    online = true;
    fetched = [];
    listeners = new Map();
    openWindows = [];
    vi.stubGlobal("caches", storage);
    vi.stubGlobal("fetch", async (input: string | Request) => {
      const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
      fetched.push(url.pathname);
      if (!online) throw new TypeError("Failed to fetch");
      const page = site[url.pathname];
      if (!page) {
        return asBasic(new Response("not found", { status: 404 }));
      }
      return basic(page.body, page.type, page.cacheControl);
    });
    start(scope, config);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Fires a lifecycle event and waits for everything it asked to wait for. */
  async function lifecycle(type: "install" | "activate") {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
  }

  /** Fires a fetch event; returns the answer, or undefined when the worker left it alone. */
  async function request(path: string, init: { method?: string; mode?: string } = {}) {
    const waits: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    const request = new Request(new URL(path, ORIGIN), { method: init.method ?? "GET" });
    Object.defineProperty(request, "mode", { value: init.mode ?? "cors" });
    listeners.get("fetch")?.({
      request,
      preloadResponse: Promise.resolve(undefined),
      respondWith: (p: Promise<Response>) => {
        answer = p;
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    } as never);
    const response = answer ? await answer : undefined;
    // Everything the worker kept in the background, then anything that kept waiting added.
    while (waits.length > 0) await waits.shift();
    return response;
  }

  it("keeps the shell at install and takes over at once", async () => {
    await lifecycle("install");
    expect(storage.urls("ni-shell-v2")).toEqual(config.shell);
    expect(scope.skipWaiting).toHaveBeenCalled();
  });

  it("on update, drops the old shell and keeps kept pages and files", async () => {
    const old = await storage.open("ni-shell-v1");
    await old.put("/", basic("old", "text/html"));
    const pages = await storage.open(PAGES_CACHE);
    await pages.put("/word-counter/", basic("kept", "text/html"));
    const files = await storage.open(FILES_CACHE);
    await files.put("/_astro/old-chunk.js", basic("", "text/javascript"));

    await lifecycle("install");
    await lifecycle("activate");
    expect(await storage.keys()).not.toContain("ni-shell-v1");
    expect(await storage.keys()).toContain("ni-shell-v2");
    expect(storage.urls(PAGES_CACHE)).toContain("/word-counter/");
    expect(storage.urls(FILES_CACHE)).toContain("/_astro/old-chunk.js");
    expect(scope.clients.claim).toHaveBeenCalled();
    expect(scope.registration.navigationPreload.enable).toHaveBeenCalled();
  });

  it("keeps the open page when a first visit asks, with every file it needs", async () => {
    openWindows = [`${ORIGIN}/word-counter/?from=search`, "https://elsewhere.example/"];
    await lifecycle("install");
    await lifecycle("activate");
    // Activation keeps nothing itself, so the page's own requests never wait for it.
    expect(storage.urls(PAGES_CACHE)).toEqual([]);
    const waits: Promise<unknown>[] = [];
    listeners.get("message")?.({
      data: "something else",
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    } as never);
    expect(waits).toEqual([]);
    listeners.get("message")?.({
      data: KEEP_OPEN_PAGES,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    } as never);
    await Promise.all(waits);
    expect(storage.urls(PAGES_CACHE)).toEqual(["/word-counter/"]);
    expect(storage.urls(FILES_CACHE).sort()).toEqual(
      ["/_astro/client.D.js", "/_astro/react.E.js", "/_astro/ui.C.js"].sort(),
    );
  });

  it("answers a page from the network and keeps it, with its files", async () => {
    await lifecycle("install");
    const response = await request("/word-counter/", { mode: "navigate" });
    expect(await response?.text()).toContain("ui.C.js");
    expect(storage.urls(PAGES_CACHE)).toEqual(["/word-counter/"]);
    expect(storage.urls(FILES_CACHE)).toContain("/_astro/react.E.js");
  });

  it("offline, answers a kept page, and the offline page for one never kept", async () => {
    await lifecycle("install");
    await request("/word-counter/", { mode: "navigate" });
    online = false;
    expect(await (await request("/word-counter/", { mode: "navigate" }))?.text()).toContain(
      "ui.C.js",
    );
    expect(await (await request("/tools/", { mode: "navigate" }))?.text()).toContain("Base.A.css");
    expect(await (await request("/about/", { mode: "navigate" }))?.text()).toContain(
      "You are offline",
    );
    // A built file the page needs comes from the device.
    expect((await request("/_astro/react.E.js"))?.status).toBe(200);
  });

  it("online, never answers a kept copy when the network answers", async () => {
    await lifecycle("install");
    await request("/word-counter/", { mode: "navigate" });
    site["/word-counter/"] = { body: "<p>new build</p>", type: "text/html" };
    try {
      expect(await (await request("/word-counter/", { mode: "navigate" }))?.text()).toBe(
        "<p>new build</p>",
      );
      expect(await (await storage.match("/word-counter/"))?.text()).toBe("<p>new build</p>");
    } finally {
      site["/word-counter/"] = {
        body: `<link href="/_astro/Base.A.css"><astro-island component-url="/_astro/ui.C.js" renderer-url="/_astro/client.D.js">`,
        type: "text/html",
      };
    }
  });

  it("never keeps a no-store page, an error, or anything it does not answer", async () => {
    await lifecycle("install");
    expect((await request("/secret/", { mode: "navigate" }))?.status).toBe(200);
    expect((await request("/gone/", { mode: "navigate" }))?.status).toBe(404);
    expect(await request("/api/convert", { method: "POST" })).toBeUndefined();
    expect(await request("/api/convert")).toBeUndefined();
    expect(storage.urls(PAGES_CACHE)).toEqual([]);
  });

  it("serves built files cache first and keeps the ones it fetched", async () => {
    await lifecycle("install");
    await request("/_astro/client.D.js");
    fetched = [];
    await request("/_astro/client.D.js");
    expect(fetched).toEqual([]);
    expect(storage.urls(FILES_CACHE)).toEqual(["/_astro/client.D.js"]);
  });

  it("keeps at most MAX_PAGES pages, dropping the oldest", async () => {
    const pages = await storage.open(PAGES_CACHE);
    for (let index = 0; index < MAX_PAGES; index++) {
      await pages.put(`/p${index}/`, basic("", "text/html"));
    }
    await request("/word-counter/", { mode: "navigate" });
    const kept = storage.urls(PAGES_CACHE);
    expect(kept).toHaveLength(MAX_PAGES);
    expect(kept).not.toContain("/p0/");
    expect(kept.at(-1)).toBe("/word-counter/");
  });
});

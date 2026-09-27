// The service worker (ADR 0052). The build turns this file into dist/sw.js: the TypeScript is
// stripped, the `export` keywords go, and the build's settings and a call to `start` are added
// (lib/pwa/sw-build.ts). It imports nothing, so the file is the whole worker. Tests import the pure
// functions below; nothing here runs on import.
//
// What it does, and nothing more:
//   - Pages: network first, so a visitor online always gets the current page. A page that answered
//     is kept on the device, with every file it needs (its island, its chunks, a tool's worker
//     and .wasm), so a tool that runs in the browser works offline after one visit. The page of
//     that first visit loaded before the worker existed; it asks the worker to keep it. Offline, the
//     kept copy answers; a page never kept gets the offline page.
//   - Hashed files (/_astro/*): cache first. Their names change when their content does.
//   - Never kept: anything but GET, other origins (the analytics endpoint), /api/, range requests,
//     and any response that says `no-store`.
//   - Search stays out of the page until intent (ADR 0046): its module and index are never fetched
//     ahead; they are kept only after a visitor has opened search.
//   - Updates: a new build is a new sw.js. It installs its shell next to the old one, takes over
//     at once, and deletes the old shell. Kept pages and files stay, so a tab still open on the
//     previous version keeps its code.

/** What the build writes into sw.js. */
export interface SwConfig {
  /** A hash of the build. A new build is a new worker and a new shell cache. */
  version: string;
  /** The page shown for a page that was never kept. */
  offline: string;
  /** Kept at install: the offline page, the home page, /tools/, the manifest, icons and their files. */
  shell: string[];
  /**
   * Which files each built file loads, as paths under /_astro/: `{"ui.X.js": ["client.Y.js"]}`.
   * Only files that load others are listed. Edges into search are left out (ADR 0046).
   */
  graph: Record<string, string[]>;
}

export const ASSET_PREFIX = "/_astro/";
export const SHELL_PREFIX = "ni-shell-";
export const PAGES_CACHE = "ni-pages";
export const FILES_CACHE = "ni-files";
/** The most pages and files kept. The oldest written goes first. */
export const MAX_PAGES = 100;
export const MAX_FILES = 600;
/** What a page sends on a first visit (lib/pwa/register.ts has the same string). */
export const KEEP_OPEN_PAGES = "ni-keep-open-pages";
/** With a kept copy at hand, a page waits this long for the network before the copy answers. */
export const NETWORK_TIMEOUT_MS = 4000;

export type Route = "page" | "file" | "other" | "none";

/** How the worker treats a request. "none" means it does not answer: the browser fetches as usual. */
export function routeOf(
  request: { method: string; url: string; mode: string; headers: { has(name: string): boolean } },
  origin: string,
): Route {
  if (request.method !== "GET" || request.headers.has("range")) return "none";
  const url = new URL(request.url);
  if (url.origin !== origin) return "none";
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return "none";
  if (request.mode === "navigate") return "page";
  if (url.pathname.startsWith(ASSET_PREFIX)) return "file";
  return "other";
}

/** A page is kept once, whatever query or fragment it was opened with. */
export function pageKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/** True for a response worth keeping: a whole, successful, same-origin answer that allows it. */
export function isKeepable(response: {
  status: number;
  type: string;
  headers: { get(name: string): string | null };
}): boolean {
  if (response.status !== 200 || response.type !== "basic") return false;
  return !/\bno-store\b/i.test(response.headers.get("cache-control") ?? "");
}

/**
 * The built files a page names in its HTML, as paths under /_astro/: stylesheets, scripts, island
 * code (attributes) and fonts (the `url()` of its inline @font-face rules).
 */
export function filesOfPage(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?:="|url\(\s*["']?)\/_astro\/([^"'?#)\s]+)/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Every file reachable from `entries` through the graph, `entries` included, as /_astro/ URLs. */
export function closure(entries: readonly string[], graph: Readonly<SwConfig["graph"]>): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...(graph[file] ?? []));
  }
  return [...seen].map((file) => `${ASSET_PREFIX}${file}`);
}

// The parts of the service worker scope this file uses. The web app's type checker has the DOM
// library, not the worker one, and the two cannot be loaded together.
interface WaitEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends WaitEvent {
  request: Request;
  preloadResponse: Promise<Response | undefined>;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  location: { origin: string };
  registration: { navigationPreload?: { enable(): Promise<void> } };
  clients: {
    claim(): Promise<void>;
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<ReadonlyArray<{ url: string }>>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
}

/** Wires the worker up. The built sw.js calls it once with its settings. */
export function start(scope: WorkerScope, config: SwConfig): void {
  const shellName = `${SHELL_PREFIX}${config.version}`;
  const origin = scope.location.origin;

  const trim = async (name: string, max: number) => {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    await Promise.all(
      keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)),
    );
  };

  /** Keeps every file a page needs that is not kept yet. A file that fails is skipped. */
  const keepFilesOf = async (html: string) => {
    const files = await caches.open(FILES_CACHE);
    await Promise.all(
      closure(filesOfPage(html), config.graph).map(async (url) => {
        if (await caches.match(url)) return;
        try {
          const response = await fetch(url);
          if (isKeepable(response)) await files.put(url, response);
        } catch {
          // Offline or gone: the page still works online, and the next visit tries again.
        }
      }),
    );
    await trim(FILES_CACHE, MAX_FILES);
  };

  /** Keeps a page that answered, and every file it needs. */
  const keepPage = async (key: string, response: Response) => {
    const type = response.headers.get("content-type") ?? "";
    if (!isKeepable(response) || !type.startsWith("text/html")) return;
    const pages = await caches.open(PAGES_CACHE);
    await pages.put(key, response.clone());
    await trim(PAGES_CACHE, MAX_PAGES);
    await keepFilesOf(await response.text());
  };

  /**
   * The page a visitor is on when the worker first starts was loaded before it existed, so the
   * worker never saw it. On that first visit the page asks (KEEP_OPEN_PAGES), and the open pages are
   * fetched again (usually a 304 from the browser's own cache) and kept, so the first visit to a
   * tool is enough for it to work offline.
   */
  const keepOpenPages = async () => {
    // Uncontrolled too: the message can arrive before activation has claimed the page.
    const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(
      windows.map(async ({ url }) => {
        if (new URL(url).origin !== origin) return;
        try {
          await keepPage(pageKey(url), await fetch(pageKey(url)));
        } catch {
          // Offline already: nothing to keep.
        }
      }),
    );
  };

  const keptPage = async (key: string) =>
    (await (await caches.open(PAGES_CACHE)).match(key)) ??
    (await (await caches.open(shellName)).match(key));

  const offlinePage = async () =>
    (await (await caches.open(shellName)).match(config.offline)) ?? Response.error();

  const page = async (event: FetchEventLike): Promise<Response> => {
    const key = pageKey(event.request.url);
    const network = (async () => {
      const response = (await event.preloadResponse) ?? (await fetch(event.request));
      event.waitUntil(
        keepPage(pageKey(response.url || event.request.url), response.clone()).catch(() => {}),
      );
      return response;
    })();
    const kept = await keptPage(key);
    if (!kept) return network.catch(offlinePage);
    // A slow network does not hold a kept page back. The network answer still updates the copy.
    network.catch(() => {});
    const timeout = new Promise<Response>((resolve) =>
      setTimeout(() => resolve(kept), NETWORK_TIMEOUT_MS),
    );
    return Promise.race([network, timeout]).catch(() => kept);
  };

  const file = async (request: Request): Promise<Response> => {
    const hit = await caches.match(request.url);
    if (hit) return hit;
    const response = await fetch(request);
    if (isKeepable(response)) {
      const files = await caches.open(FILES_CACHE);
      await files.put(request.url, response.clone());
      await trim(FILES_CACHE, MAX_FILES);
    }
    return response;
  };

  const other = async (request: Request): Promise<Response> => {
    try {
      return await fetch(request);
    } catch (error) {
      const hit = await caches.match(request.url);
      if (hit) return hit;
      throw error;
    }
  };

  scope.addEventListener("install", (event: WaitEvent) => {
    event.waitUntil(
      (async () => {
        const shell = await caches.open(shellName);
        // `reload`: fresh from the network, never an older copy from the HTTP cache.
        await shell.addAll(
          config.shell.map((url) => new Request(new URL(url, origin), { cache: "reload" })),
        );
        await scope.skipWaiting();
      })(),
    );
  });

  scope.addEventListener("activate", (event: WaitEvent) => {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith(SHELL_PREFIX) && name !== shellName)
            .map((name) => caches.delete(name)),
        );
        // The page request starts while the worker boots, so network first costs no extra time.
        await scope.registration.navigationPreload?.enable();
        await scope.clients.claim();
      })(),
    );
  });

  // Not done on activate: fetches wait for activation to finish, and keeping pages takes seconds.
  scope.addEventListener("message", (event: WaitEvent & { data: unknown }) => {
    if (event.data === KEEP_OPEN_PAGES) event.waitUntil(keepOpenPages());
  });

  scope.addEventListener("fetch", (event: FetchEventLike) => {
    const route = routeOf(event.request, origin);
    if (route === "page") event.respondWith(page(event));
    else if (route === "file") event.respondWith(file(event.request));
    else if (route === "other") event.respondWith(other(event.request));
  });
}

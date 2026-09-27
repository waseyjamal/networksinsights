// Registers /sw.js once the page has loaded (ADR 0052). `updateViaCache: "none"` makes the browser
// ask the server for sw.js on every check, so a new build reaches visitors on their next visit.

export const SERVICE_WORKER_URL = "/sw.js";

/**
 * The message a page sends the worker on a first visit: this page loaded before any worker
 * existed, so keep it. The same string is in service-worker.ts, which imports nothing; a test
 * keeps the two equal.
 */
export const KEEP_OPEN_PAGES = "ni-keep-open-pages";

interface Registrar {
  serviceWorker?: {
    controller: unknown;
    ready: Promise<{ active: { postMessage(message: string): void } | null }>;
    register(url: string, options: { scope: string; updateViaCache: "none" }): Promise<unknown>;
  };
}

export function registerServiceWorker(
  nav: Registrar,
  win: Pick<Window, "addEventListener"> & { document: Pick<Document, "readyState"> },
  production = import.meta.env.PROD,
): void {
  const worker = nav.serviceWorker;
  if (!production || !worker) return;
  // No controller: the worker did not answer this page, so it has not kept it.
  const firstVisit = !worker.controller;
  const register = () => {
    // A browser that refuses (private mode, storage off) keeps the site working without it.
    worker
      .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
      .then(async () => {
        if (firstVisit) (await worker.ready).active?.postMessage(KEEP_OPEN_PAGES);
      })
      .catch(() => {});
  };
  if (win.document.readyState === "complete") register();
  else win.addEventListener("load", register, { once: true });
}

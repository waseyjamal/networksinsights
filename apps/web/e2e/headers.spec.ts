import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import {
  embeddablePaths,
  HTML_CACHE_CONTROL,
  IMMUTABLE,
  previewHeaders,
  securityHeaders,
} from "../src/config/headers";
import { LIBHEIF_BASE } from "../src/config/libheif";
import { PDFJS_BASE } from "../src/config/pdfjs";
import { TESSERACT_BASE } from "../src/config/tesseract";
import { headerPolicy, readPage } from "../src/lib/security/headers-file";
import { edgePort, edgeURL } from "./edge";
import { notFoundPath, pages } from "./pages";

// Every response header, as Cloudflare's static-asset engine sends it from dist/_headers
// (ADR 0048). The engine is `wrangler dev` over the build just made (e2e/edge.ts). The live site
// is checked the same way by `pnpm check:production` after each deploy.
//
// Headers do not depend on the browser, so these run once, in chromium.

test.skip(({ browserName }) => browserName !== "chromium", "headers are the same in every engine");
test.use({ baseURL: edgeURL });

const dist = new URL("../dist/", import.meta.url);
const html = (file: string) => readFileSync(new URL(file, dist), "utf8");

/** The policy the header must carry: the home page's <meta> policy plus frame-ancestors. */
const expectedPolicy = (() => {
  const policy = readPage("/", html("index.html")).policy;
  if (!policy) throw new Error("dist/index.html has no CSP <meta>: run pnpm build");
  return headerPolicy(policy);
})();

/** A file path of each kind the build makes, read from the build so the hashes are current. */
const assetPaths = (() => {
  const home = html("index.html");
  const script = /<script type="module" src="(\/_astro\/[^"]+\.js)"/.exec(home)?.[1];
  const style = /<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/.exec(home)?.[1];
  const font = /href="(\/_astro\/fonts\/[^"]+\.woff2)"/.exec(home)?.[1];
  const index = /data-index="(\/search-index\.[0-9a-f]+\.json)"/.exec(home)?.[1];
  if (!script || !style || !font || !index) throw new Error("the home page lost an asset link");
  return { script, style, font, index };
})();

const everyPath = [
  ...pages.map((page) => page.path),
  assetPaths.script,
  assetPaths.style,
  assetPaths.font,
  assetPaths.index,
  "/favicon.svg",
  "/favicon.ico",
  "/og/home.png",
  "/robots.txt",
];

const isEmbeddable = (path: string) =>
  embeddablePaths.some((pattern) =>
    pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );

test.describe("security headers on every response", () => {
  for (const path of everyPath) {
    test(path, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(path === notFoundPath ? 404 : 200);
      const headers = response.headers();
      for (const [name, value] of Object.entries(securityHeaders)) {
        const expected =
          name === "Cross-Origin-Resource-Policy" && isEmbeddable(path) ? "cross-origin" : value;
        expect(headers[name.toLowerCase()], name).toBe(expected);
      }
      expect(headers["content-security-policy"], "Content-Security-Policy").toBe(expectedPolicy);
      expect(headers["cross-origin-embedder-policy"], "no page is cross-origin isolated").toBe(
        undefined,
      );
      expect(headers["x-robots-tag"], "never on the production host").toBe(undefined);
    });
  }
});

test.describe("cache headers", () => {
  test("hashed assets and the search index are immutable for a year", async ({ request }) => {
    for (const path of [assetPaths.script, assetPaths.style, assetPaths.font, assetPaths.index]) {
      const response = await request.get(path);
      expect(response.headers()["cache-control"], path).toBe(IMMUTABLE);
    }
  });

  test("versioned vendor folders are immutable for a year, Tesseract's is not (ADR 0061)", async ({
    request,
  }) => {
    for (const path of [`${PDFJS_BASE}cmaps/LICENSE.txt`, `${LIBHEIF_BASE}LICENSE.txt`]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()["cache-control"], path).toBe(IMMUTABLE);
    }
    const tesseract = await request.get(`${TESSERACT_BASE}LICENSE-tesseract.js.txt`);
    expect(tesseract.status()).toBe(200);
    expect(tesseract.headers()["cache-control"]).toBe(HTML_CACHE_CONTROL);
  });

  test("pages always revalidate, with an ETag", async ({ request }) => {
    for (const path of ["/", "/tools/", "/about/", notFoundPath]) {
      const response = await request.get(path);
      expect(response.headers()["cache-control"], path).toBe(HTML_CACHE_CONTROL);
    }
    const etag = (await request.get("/")).headers().etag;
    expect(etag).toBeTruthy();
    const again = await request.get("/", { headers: { "if-none-match": etag ?? "" } });
    expect(again.status()).toBe(304);
  });
});

/** A request with a chosen Host header, which the browser-side request API cannot set. */
function headersFor(
  host: string,
  path = "/",
): Promise<Record<string, string | string[] | undefined>> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port: edgePort, path, headers: { host } },
      (response) => {
        response.resume();
        resolve(response.headers);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test.describe("X-Robots-Tag", () => {
  const previewHost = "pr-12-networksinsights.example.workers.dev";

  test("a preview deployment on workers.dev sends noindex, on pages and files", async () => {
    for (const path of ["/", "/tools/", notFoundPath, "/favicon.svg"]) {
      const headers = await headersFor(previewHost, path);
      expect(headers["x-robots-tag"], path).toBe(previewHeaders["X-Robots-Tag"]);
      // The security headers are the same on a preview.
      expect(headers["content-security-policy"], path).toBe(expectedPolicy);
    }
  });

  test("the production domain never sends it", async () => {
    for (const path of ["/", "/tools/", notFoundPath]) {
      const headers = await headersFor("networksinsights.com", path);
      expect(headers["x-robots-tag"], path).toBe(undefined);
    }
  });
});

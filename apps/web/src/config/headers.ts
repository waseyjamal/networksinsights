// The one source for every HTTP response header the site sets (ADR 0047, ADR 0048).
//
// Cloudflare reads them from `dist/_headers`, which the security-headers integration writes after
// every build from this file and from the Content-Security-Policy that Astro computed. The same
// values drive `pnpm check:production` and the E2E header tests, so a header cannot be changed in
// one place and forgotten in another. Nothing else may write a response header.

/**
 * Content-Security-Policy, deny by default. Each source is here because something needs it; the
 * reason is next to it and in ADR 0047. Astro adds the hashes of our inline scripts and styles to
 * `script-src` and `style-src` at build time.
 */
export const csp = {
  /** Directives Astro writes into the page's `<meta>` policy as well as the header. */
  directives: [
    "default-src 'none'",
    // Self-hosted fonts; `data:` and `blob:` images for previews of the visitor's own files.
    "font-src 'self'",
    "img-src 'self' data: blob:",
    // Audio and video results a tool made on the device.
    "media-src 'self' blob:",
    // The search index today, a same-origin server endpoint from Mission 15. Nothing else.
    "connect-src 'self'",
    // Web Workers from our own bundles, and the ones libraries start from a blob: URL.
    "worker-src 'self' blob:",
    // The installable app's manifest (ADR 0022).
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ],
  /**
   * `'wasm-unsafe-eval'` lets code that is already allowed compile WebAssembly. It does not allow
   * `eval()` of JavaScript, and there is no `'unsafe-inline'`: inline scripts run only by hash.
   */
  scriptResources: ["'self'", "'wasm-unsafe-eval'"],
  /**
   * `<style>` elements and stylesheets: our own files and Astro's hashed inline styles only.
   * Style attributes (`style="--x: 1"`, which React and our components render) are allowed: an
   * attribute cannot run script, and every way CSS could send data out is limited to our own
   * origin by img-src, font-src and connect-src (ADR 0047).
   */
  styleElementResources: ["'self'"],
  styleAttributeResources: ["'unsafe-inline'"],
  /** Directives a `<meta>` policy cannot carry (CSP 3, section 3.3), so they go in the header only. */
  headerOnly: ["frame-ancestors 'none'"],
} as const;

/**
 * Features denied here that some Chromium builds do not know, and warn about: Chromium on Linux
 * has no Web Bluetooth, so it prints "Unrecognized feature: 'bluetooth'". The denial is kept,
 * because Chrome on Windows, macOS and Android does know it and would otherwise allow it on our
 * origin. The CSP E2E test ignores that warning for these names only.
 */
export const platformDependentFeatures: readonly string[] = ["bluetooth"];

/**
 * Permissions-Policy: every powerful feature is denied, except four that tools will use on our
 * own origin and that still ask nothing more of the visitor than a click. Camera, microphone and
 * screen capture stay denied until a tool needs them; adding one takes an ADR (ADR 0048).
 * Only names Chromium recognizes are listed: an unknown one prints a console warning. That is why
 * web-share is not written out: its default allowlist is already our own origin ("self"), and
 * Chromium builds without the Web Share API reject the name. attribution-reporting is left out
 * for the same reason; browsers that know it still get no ad attribution from a site with no ads.
 */
export const permissions: Readonly<Record<string, "none" | "self">> = {
  accelerometer: "none",
  autoplay: "self",
  bluetooth: "none",
  "browsing-topics": "none",
  camera: "none",
  "clipboard-read": "none",
  "compute-pressure": "none",
  "display-capture": "none",
  "encrypted-media": "none",
  fullscreen: "self",
  gamepad: "none",
  geolocation: "none",
  gyroscope: "none",
  hid: "none",
  "identity-credentials-get": "none",
  "idle-detection": "none",
  "local-fonts": "none",
  magnetometer: "none",
  microphone: "none",
  midi: "none",
  "otp-credentials": "none",
  payment: "none",
  "picture-in-picture": "self",
  "private-state-token-issuance": "none",
  "private-state-token-redemption": "none",
  "publickey-credentials-create": "none",
  "publickey-credentials-get": "none",
  "screen-wake-lock": "none",
  serial: "none",
  "storage-access": "none",
  usb: "none",
  "window-management": "none",
  "xr-spatial-tracking": "none",
};

/** `camera=(), fullscreen=(self), ...` in the order above. */
export function permissionsPolicy(): string {
  return Object.entries(permissions)
    .map(([feature, allow]) => `${feature}=(${allow === "self" ? "self" : ""})`)
    .join(", ");
}

/**
 * Headers on every response: pages, files, the 404 page. The Content-Security-Policy is not here
 * because it depends on the build (it carries Astro's hashes); the integration adds it.
 */
export const securityHeaders = {
  // Two years, every subdomain. No `preload` until the owner decides at launch: leaving the
  // preload list takes months to reach browsers (ADR 0048, docs/launch-checklist.md).
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  // Other sites learn our origin, never the path or query of the page a visitor came from.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": permissionsPolicy(),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // Older browsers that do not know frame-ancestors.
  "X-Frame-Options": "DENY",
} as const;

/**
 * Files other sites may embed: share images (chat apps and social sites show them) and the
 * favicons. They answer `Cross-Origin-Resource-Policy: cross-origin` instead of `same-origin`.
 */
export const embeddablePaths = ["/og/*", "/favicon.ico", "/favicon.svg"] as const;

/** A year, never revalidated. Only for files whose name carries a hash of their content. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Content-hashed files: a change of content is a change of name. Everything else (every HTML page
 * included) keeps Cloudflare's default, `public, max-age=0, must-revalidate` with an ETag, so a
 * visit always revalidates and an unchanged page answers 304 (ADR 0048).
 */
export const immutablePaths = ["/_astro/*", "/search-index.*"] as const;

/** What Cloudflare sends for HTML when no rule sets Cache-Control. check:production expects it. */
export const HTML_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * Preview deployments (`pr-13-networksinsights.<account>.workers.dev`). They must never be
 * indexed, whatever the launch flag says, and production must never send this (ADR 0048).
 */
export const previewPattern = "https://:alias.:account.workers.dev/*";
export const previewHeaders = { "X-Robots-Tag": "noindex" } as const;

/**
 * The name of the <meta> a tool page with an approved security override carries (ADR 0047). The
 * security-headers integration reads it and sends that page its own header rule.
 */
export const OVERRIDE_META = "ni-security-override";

/** Cloudflare's limits for a `_headers` file. The integration fails the build above them. */
export const HEADERS_MAX_RULES = 100;
export const HEADERS_MAX_LINE = 2000;

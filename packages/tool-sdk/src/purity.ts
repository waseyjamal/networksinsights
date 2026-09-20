// What a tool's logic.ts may reach for. The analyzer that enforces this lives in the web app,
// because it needs the TypeScript compiler; the rules live here, in one place (ADR 0031).
//
// The point of the rule is that the same logic runs unchanged in all three runtimes (ADR 0012):
// the browser main thread, a Web Worker and a Cloudflare Worker. So the allowed globals are the
// web-standard APIs that exist in all three, and nothing else.

/**
 * The only packages a logic.ts may import, besides its own relative files.
 *
 * It starts at Zod and this SDK on purpose. Adding a library — a PDF engine, an image codec —
 * takes an ADR that states its license, its size and why it is needed (AGENTS.md), and one line
 * here. That makes every third-party dependency inside tool logic a recorded decision.
 */
export const ALLOWED_IMPORTS: readonly string[] = ["zod", "@networksinsights/tool-sdk"];

/**
 * Globals a logic.ts may use: ECMAScript built-ins, plus the web-standard APIs that browsers,
 * Web Workers and Cloudflare Workers all have.
 */
export const ALLOWED_GLOBALS: readonly string[] = [
  // ECMAScript built-ins.
  "Array",
  "ArrayBuffer",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "Float32Array",
  "Float64Array",
  "Infinity",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "isFinite",
  "isNaN",
  "Iterator",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "parseFloat",
  "parseInt",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "URIError",
  "WeakMap",
  "WeakRef",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  // Web standards present in browsers, Web Workers and Cloudflare Workers.
  "AbortController",
  "AbortSignal",
  "Blob",
  "CompressionStream",
  "DecompressionStream",
  "DOMException",
  "Event",
  "EventTarget",
  "File",
  "FormData",
  "ReadableStream",
  "TextDecoder",
  "TextDecoderStream",
  "TextEncoder",
  "TextEncoderStream",
  "TransformStream",
  "URL",
  "URLPattern",
  "URLSearchParams",
  "WritableStream",
  "atob",
  "btoa",
  "clearTimeout",
  "console",
  "crypto",
  "performance",
  "queueMicrotask",
  "setTimeout",
  "structuredClone",
];

/**
 * Globals that are refused with a reason of their own. Anything not in ALLOWED_GLOBALS is refused
 * anyway; these are the mistakes worth explaining properly.
 */
export const BANNED_GLOBALS: Readonly<Record<string, string>> = {
  document: "the DOM belongs in ui.tsx, not in tool logic",
  window: "the DOM belongs in ui.tsx, not in tool logic",
  navigator: "the DOM belongs in ui.tsx, not in tool logic",
  location: "the DOM belongs in ui.tsx, not in tool logic",
  history: "the DOM belongs in ui.tsx, not in tool logic",
  alert: "the DOM belongs in ui.tsx, not in tool logic",
  localStorage: "tool logic must not keep state between runs",
  sessionStorage: "tool logic must not keep state between runs",
  indexedDB: "tool logic must not keep state between runs",
  caches: "tool logic must not keep state between runs",
  self: "a global escape hatch: name the API you need instead",
  globalThis: "a global escape hatch: name the API you need instead",
  Worker: "logic.ts is what a worker runs; it does not start one (worker.ts does)",
  fetch: "tool logic makes no network calls: the runtime decides what leaves the device",
  XMLHttpRequest: "tool logic makes no network calls: the runtime decides what leaves the device",
  WebSocket: "tool logic makes no network calls: the runtime decides what leaves the device",
  EventSource: "tool logic makes no network calls: the runtime decides what leaves the device",
  Request: "tool logic makes no network calls: the runtime decides what leaves the device",
  Response: "tool logic makes no network calls: the runtime decides what leaves the device",
  Headers: "tool logic makes no network calls: the runtime decides what leaves the device",
  process: "Node-only, so the same logic could not run in the browser",
  Buffer: "Node-only, so the same logic could not run in the browser: use Uint8Array",
  require: "Node-only, so the same logic could not run in the browser: use an import",
  __dirname: "Node-only, so the same logic could not run in the browser",
  __filename: "Node-only, so the same logic could not run in the browser",
  global: "Node-only, so the same logic could not run in the browser",
};

/** File extensions a logic.ts may never import: they belong to the UI, not to the logic. */
export const BANNED_IMPORT_EXTENSIONS: readonly string[] = [
  ".tsx",
  ".jsx",
  ".astro",
  ".css",
  ".mdx",
  ".md",
];

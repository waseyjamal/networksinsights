// Every `import ... from "zod"` in the web app resolves here (astro.config.mjs, resolve.alias),
// so Zod is configured before any schema can parse (ADR 0047).
//
// Zod 4 compiles fast validators with `new Function`, and finds out whether it may by trying
// `Function("")` once. The site's Content-Security-Policy forbids eval, so the answer is always no,
// but the attempt itself is reported as a CSP violation, in the console and to any listener, on
// every page where a tool validates in the browser. `jitless` makes Zod skip the attempt and use
// its ordinary validators, which is what it would fall back to anyway. Zod's own source says the
// option exists for strict CSPs.

import { config } from "zod/v4/core";

config({ jitless: true });

export * from "zod/v4";
export { z as default } from "zod/v4";

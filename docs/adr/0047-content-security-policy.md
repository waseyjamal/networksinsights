# 0047. Content-Security-Policy

Status: Accepted
Date: 2026-09-24

## Context

The site runs other people's words through its pages: tool names, files a visitor opens, text they type. A Content-Security-Policy is the browser's last line of defence if one of those words ever becomes markup. It has to be strict from the start, because every tool added later inherits it, and loosening a policy later is easy while tightening one is not. It also has to leave room for what tools will need: Web Workers, WebAssembly, previews and downloads of the visitor's own files, and a server endpoint on our own origin (Mission 15).

The site is static HTML on Cloudflare's static-asset engine, with no adapter (ADR 0007, ADR 0027). Astro 7.3 has stable CSP support (`security.csp`): it hashes every script and style it bundles and writes the policy into each page as `<meta http-equiv="content-security-policy">`. Two facts from the CSP 3 specification shape the design: a `<meta>` policy does not apply to anything above it in the document, and it cannot carry `frame-ancestors`, `report-uri` or `sandbox`. Astro can hand its policy to a host as headers only through an adapter feature (`staticHeaders`), which the site does not have. Astro does not hash `is:inline` scripts; its documentation says to add their hashes yourself.

## Decision

**The policy.** Deny by default, and allow exactly what the site and its tools use:

| Directive | Value | Why it is safe |
|---|---|---|
| `default-src` | `'none'` | Everything not listed below is refused. |
| `script-src` | `'self' 'wasm-unsafe-eval'` + hashes | Our own files and our own inline scripts, by SHA-256. No `'unsafe-inline'`, no `'unsafe-eval'`, no other origin. `'wasm-unsafe-eval'` lets code that is already allowed compile WebAssembly; it does not allow `eval()` of JavaScript, and WebAssembly cannot touch the page except through that code. |
| `style-src-elem` | `'self'` + hashes | Our stylesheet and Astro's hashed inline `<style>` blocks (the `@font-face` rules). |
| `style-src-attr` | `'unsafe-inline'` | Style attributes: our components set CSS variables with them (`Constellation`, `Progress`), and React renders them for tools. An attribute cannot run script, and every way CSS could send data out (`url()`) is limited to our origin by `img-src`, `font-src` and `connect-src`. Hashing each attribute would break on values computed at run time. This also makes Astro's build warning about Shiki moot: Shiki highlights with style attributes, which are allowed. |
| `img-src` | `'self' data: blob:` | `blob:` and `data:` show previews of the visitor's own files and results. Images cannot run code, and a `blob:` URL can only be made by code already running on our origin. |
| `media-src` | `'self' blob:` | Audio and video results a tool made on the device. |
| `font-src` | `'self'` | The self-hosted Geist fonts (ADR 0028). |
| `connect-src` | `'self'` | The search index today, and the Mission 15 server endpoint, which is on our own origin. No third party is ever contacted. |
| `worker-src` | `'self' blob:` | Web Workers from our bundles (Mission 14), and the ones libraries start from a `blob:` URL. As with images, only code already allowed can make one. |
| `manifest-src` | `'self'` | The installable app (ADR 0022). |
| `object-src` | `'none'` | No plugins. |
| `base-uri` | `'none'` | No `<base>` can redirect relative URLs. |
| `form-action` | `'none'` | The site has no forms that submit anywhere. |
| `frame-ancestors` | `'none'` | No site may frame ours (clickjacking). Header only. |

Downloads (`<a download href="blob:…">`) are navigations, not fetches, so no directive is needed for them.

**Where it lives.** `apps/web/src/config/headers.ts` holds every directive, with the reason next to each. `astro.config.mjs` turns on `security.csp` with those directives, and adds the SHA-256 of the theme script (`src/lib/theme-script.ts`, a constant string).

**How it is sent.** Twice, the same policy.
- Astro writes it into every page as a `<meta>`, so `astro preview` and any host that ignores `_headers` still enforce it.
- The integration `src/integrations/security-headers.ts` runs after every build. It reads the policy back out of every built page, adds `frame-ancestors 'none'`, and writes it into `dist/_headers` with the other headers (ADR 0048). The header covers the whole document, including the theme script above the `<meta>`.

The build fails if:
- a page carries an inline script or `<style>` whose hash is not in its policy, which is the mistake that would otherwise ship a page that silently breaks;
- two pages without an approved override carry different policies, because one `/*` rule sends one policy;
- `frame-ancestors` appears in the `<meta>`, where it is ignored;
- `_headers` would pass Cloudflare's limits of 100 rules or 2,000 characters a line.

**Zod runs jitless.** Zod 4 finds out whether it may compile validators by trying `Function("")` once. The policy forbids it, so Zod falls back to its ordinary validators, but the attempt is still reported as a violation on every page that validates in the browser. In the web app, `zod` resolves to `src/lib/zod-jitless.ts`, which sets Zod's `jitless` option before anything else can parse. Zod's own source says the option exists for strict CSPs.

**Per-page overrides, only with an ADR.** A tool that genuinely needs more declares it in its manifest:

```ts
security: {
  adr: "0051",                 // the accepted ADR that approved it
  crossOriginIsolated: true,   // optional: Cross-Origin-Embedder-Policy: require-corp
  sources: { "connect-src": ["https://api.example.com"] }, // optional
}
```

- `sources` may widen `connect-src`, `img-src`, `media-src`, `font-src` and `worker-src` only, with https origins only: no keyword, no scheme, no path. Scripts and styles can never be widened.
- `pnpm check:tools` fails unless the named ADR exists in `docs/adr/` with `Status: Accepted`.
- The tool page adds the sources to its own `<meta>` (Astro's `Astro.csp.insertDirective`) and carries a marker. The integration then writes one rule for that page that replaces the site-wide policy (`! Content-Security-Policy`, then the new one) and adds COEP when asked. The slow test `override.slow.test.ts` proves the replacement in Cloudflare's own engine (`wrangler dev`); without the `!` the page would get two policies, and a second policy can only narrow.

Cross-origin isolation is the expected first use: multi-threaded WebAssembly needs `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy: same-origin` (already site-wide, ADR 0048) and `Cross-Origin-Embedder-Policy: require-corp`. Every resource the site loads is same-origin, so COEP breaks nothing on such a page. It is not site-wide because it would block any future third-party embed (ADR 0015).

**Tested in real browsers.** `e2e/csp.spec.ts` runs against `wrangler dev` over the build (`e2e/wrangler.e2e.jsonc`), which applies `_headers` as Cloudflare does. It covers:
- every page, in light and dark, with search open, in Chromium, Firefox and WebKit: zero `securitypolicyviolation` events and no CSP or Permissions-Policy console message;
- an inline script and an inline event handler injected into a real response, with its real headers, must never run;
- another origin must not be able to frame a page, with a control frame that proves the check can see a framed page.

## Consequences

- Good: an injected `<script>`, an inline `onerror=` handler, `eval`, a plugin, a `<base>` hijack, a form posting elsewhere and framing are all refused by the browser, even if a bug ever lets markup through.
- Good: what tools will need is already allowed, and each allowance is harmless on its own: workers, WebAssembly, previews of the visitor's files, a same-origin API.
- Good: a new inline script cannot slip in unnoticed; the build names it.
- Cost: every inline script needs its hash in `astro.config.mjs`. There is one today.
- Cost: style attributes are allowed. A strict `style-src-attr` would need every dynamic style moved into classes, in our code and in every tool.
- Cost: no violation reports are collected. There is no endpoint until Mission 15, and Report-To would send visitors' data to one.

## Future options

- **Trusted Types** (`require-trusted-types-for 'script'`): the browser itself would refuse strings passed to `innerHTML` and the other HTML sinks, turning the safe-rendering rule (ADR 0050) from a code check into an enforced one. Not tried in Mission 12, by the owner's decision. Before adding it: check that Astro's island runtime and React never pass a string to a sink, and that every engine the site supports enforces it or ignores it harmlessly.
- **Reporting**: `report-to` a same-origin endpoint once the server runtime exists, with no personal data kept.

## Revisit when

- Astro can send its policy as headers without an adapter: drop the integration's read-back.
- A second inline script is needed: first try to make it a file.
- A tool needs a script from another origin: that is a new ADR, not an override.

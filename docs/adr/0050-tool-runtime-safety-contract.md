# 0050. Tool runtime safety contract

Status: Accepted
Date: 2026-09-24

## Context

Every tool handles something a visitor brings: a file, pasted text, a URL. With 500+ tools written over time, often by AI agents, safety cannot depend on each tool remembering the same few rules. The rules have to be written once, given helpers that make the safe way the easy way, and checked by a gate. Three areas need it now: files a tool gives back, words a tool shows, and, from Mission 15, tools that run on the server.

## Decision

### 1. Downloads

A tool gives the visitor a file only through `saveFile(data, name, options)` from `@ui`:
- It names the file with `safeFilename()` from the SDK:
  - path separators, control characters and the characters Windows forbids become `-`;
  - bidirectional and zero-width characters are removed, so `photo[U+202E]gnp.exe` cannot pose as a PNG;
  - leading dots and trailing dots and spaces go;
  - Windows reserved names (CON, NUL, COM1…) get a suffix;
  - the name fits in 255 UTF-8 bytes and keeps its extension.
- It types the file with `mimeTypeFor()`: an allowlist of extensions, and `application/octet-stream` for anything else. It always makes a new `Blob` with that type, whatever type the data claimed.
- It always downloads (`<a download>`) and never opens the file in a tab. An HTML or SVG result opened from a `blob:` URL would run as a page of this site.
- It revokes the object URL 30 seconds after the click. The browser reads the file when the download starts, and Firefox and Safari fail a download whose URL is revoked in the same task.

`safeFilename` and `mimeTypeFor` are pure and live in the SDK (`@networksinsights/tool-sdk/download`), so `logic.ts` may use them to name a result. `saveFile` touches the page and lives in the web app.

Tested:
- unit tests for the name and type rules;
- a fake browser for the object-URL life cycle, including a click that throws;
- a real download in Chromium, Firefox and WebKit under the site's CSP, from the design system's React island, checking the name, the content and the revoke.

### 2. Rendering user text

Words from a visitor or a file reach the page as text, never as markup or code.
- In React: `{value}`. React escapes it.
- Outside React: `setText(node, value)` (`textContent`).
- A URL from a visitor becomes an `href` only through `safeUrl(value)`, which returns an absolute `https:`, `http:` or `mailto:` URL, or nothing. `javascript:`, `data:`, `blob:` and anything relative are refused.

The gate `safe-rendering` in `pnpm check:tools` reads the syntax of every tool's `ui.tsx`, `logic.ts` and `worker.ts` with the TypeScript compiler (so a comment or a string that mentions a sink is never reported). It fails, naming the line, on:
- assigning `innerHTML`, `outerHTML` or `srcdoc`;
- calling `insertAdjacentHTML`, `createContextualFragment`, `setHTMLUnsafe`, `parseHTMLUnsafe`, `parseFromString` or `document.write`;
- using `eval`, `Function` or `DOMParser`;
- passing a string to `setTimeout` or `setInterval`;
- the JSX attributes `dangerouslySetInnerHTML` and `srcDoc`;
- a literal `javascript:` URL in JSX.

`safe-rendering.test.ts` runs the same check on every real tool in `pnpm test`. The CSP (ADR 0047) is the second line: even a missed sink cannot run an injected script.

### 3. The server runtime (the contract Mission 15 implements)

A tool with `runtime: "server"` runs its `logic.ts` in the site's Cloudflare Worker, behind an endpoint on our own origin. The endpoint must:

1. **Validate first.** Parse the request body with the tool's manifest `input` schema (Zod) before any work. On failure answer `400` with a fixed message. Unknown fields are refused, never passed through.
2. **Limit size.**
   - Refuse a body over the tool's `limits.maxInputBytes` (or a platform default, set in Mission 15) with `413`, checked from `Content-Length` before reading, and again while reading, since the header can lie.
   - Limit the number of files (`limits.maxFiles`).
   - Give every request a time limit.
3. **Rate-limit per IP.**
   - Use Cloudflare's rate limiting, per client IP and per tool, and answer `429` with `Retry-After`.
   - The IP is used only to count, and is never written anywhere.
4. **Cap spending hard.**
   - Every paid call (AI, ADR 0013) is counted against a daily budget in a counter shared by all instances.
   - When the cap is reached, the endpoint answers `503` for the rest of the UTC day and the tool page falls back to the browser path or says so.
   - The cap fails closed: if the counter cannot be read, no paid call is made.
5. **Log nothing a visitor sent.**
   - No request body, no file content, no query text, no IP in logs, traces or error reports.
   - Logs may carry the tool id, the status, the duration, the size class and an error code.
   - Worker observability sampling must be configured so it cannot capture a body.
6. **Store nothing.**
   - No user data is written to KV, D1, R2, a cache or a third party.
   - A file is processed in memory and dropped when the response is sent.
   - A third-party API that retains data is not used; the owner approves any processor in the ADR for that tool.
7. **Answer safely.**
   - Same origin only: no CORS headers.
   - `POST` with a JSON or multipart body only, and `Cache-Control: no-store`.
   - Errors are generic and never echo input or a stack.
   - The security headers of ADR 0048 on every response.
8. **Say so on the page.** The privacy statement comes from `runtime` (ADR 0034) and already says the input is sent to our server. Nothing else may claim more.

Mission 15 adds the middleware that enforces 1 to 7 for every server tool, so no tool writes its own, with tests for each item.

### Where the rules are written

`docs/tool-contract.md` has "Downloads", "Rendering user text", "Security overrides" and "Server runtime". AGENTS.md has the short form.

## Consequences

- Good: the safe path is one import, and the unsafe paths fail a gate with the line number and the fix.
- Good: Mission 15 starts from a written, testable contract instead of designing one under time pressure.
- Cost: a tool that genuinely needs to render markup (a Markdown previewer, an HTML formatter) cannot use `innerHTML`. It must build its output from a parsed tree with DOM methods or React elements, or render into a sandboxed, CSP-restricted frame; that is an ADR when it comes.

## Revisit when

- Trusted Types are adopted (ADR 0047): the gate can relax where the browser enforces the rule.
- Mission 15 sets the platform defaults for size, time and rate: record them here.

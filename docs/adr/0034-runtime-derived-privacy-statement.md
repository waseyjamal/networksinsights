# 0034. Runtime-derived privacy statement

Status: Accepted
Date: 2026-09-20

## Context

"Private by design" is the site's main promise (ADR 0016), and every tool page states it in a badge
on the workspace card. Most tools run on the device; some cannot and must send the input to a
server (ADR 0012).

If the sentence were written by the tool author, a server tool could carry "files never leave your
device" — by a copy-and-paste, or because the runtime changed later and the text did not. That
would be the worst kind of wrong: a privacy claim that is false, on the page that makes the promise.

## Decision

The privacy statement is derived from the manifest's `runtime`, in one function, and nobody writes
it by hand.

```ts
privacyStatement("client" | "worker")  // on-device
privacyStatement("server")             // sent to us
```

| Runtime | Statement | Badge |
|---|---|---|
| `client`, `worker` | Runs in your browser — files never leave your device | success, lock |
| `server` | Runs on our server — your input is sent to us to be processed | info, upload |

The two sentences live in `packages/tool-sdk/src/privacy.ts`, which imports nothing, so the design
system can be checked against them without pulling Zod into a browser bundle.

`ToolWorkspace` — the Astro component and its React twin — takes the sentence and an on-device flag
as props, defaulting to the on-device case for the design system's own examples. The tool page
passes what `privacyStatement()` returned. A tool author has no way to set the text.

The design system's `PRIVACY_TEXT` stays where it was, in `components/ui/attrs.ts`, and a test
asserts it is the same string as the SDK's on-device statement. That keeps the runtime coupling at
zero and makes drift a failing test.

## Consequences

- The badge is honest by construction: changing a tool's `runtime` changes what the page claims,
  in the same commit, with no second edit to remember.
- A tool cannot make a privacy claim at all, which is the point.
- Both statements are fixed sentences. A tool that needs to say something more specific — which
  server, what is kept and for how long — needs a new ADR and a new field, not free text.
- Mission 15's server tool is the first to show the second statement; until then only the first is
  ever rendered.

## Revisit when

A tool needs to say more about what happens to its input than the runtime alone implies, or a
runtime is added.

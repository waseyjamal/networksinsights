import { describe, expect, it } from "vitest";
import {
  csp,
  HEADERS_MAX_LINE,
  HEADERS_MAX_RULES,
  OVERRIDE_META,
  permissionsPolicy,
  securityHeaders,
} from "../../config/headers";
import { themeScript } from "../theme-script";
import { cspHash } from "./hash";
import {
  type BuiltPage,
  directivesOf,
  headerPolicy,
  headerRules,
  readPage,
  renderHeadersFile,
  sitePolicy,
  unhashedInline,
} from "./headers-file";

const POLICY = `default-src 'none'; script-src 'self' '${cspHash("ok()")}'; style-src-elem 'self' '${cspHash("p{}")}'`;
const meta = (policy: string) => `<meta http-equiv="content-security-policy" content="${policy}">`;
const page = (path: string, policy = POLICY, override?: BuiltPage["override"]): BuiltPage => ({
  path,
  policy,
  override,
});

describe("reading a built page", () => {
  it("reads the policy and passes inline code whose hash is in it", () => {
    const html = `<head>${meta(POLICY)}<style>p{}</style><script>ok()</script><script type="application/ld+json">{"a":1}</script><script type="module" src="/_astro/x.js"></script></head>`;
    expect(readPage("/", html)).toEqual({ path: "/", policy: POLICY, override: undefined });
  });

  it("fails the build on an inline script or style the policy would refuse", () => {
    expect(() => readPage("/", `${meta(POLICY)}<script>evil()</script>`)).toThrow(
      /would refuse inline script "evil\(\)/,
    );
    expect(() => readPage("/", `${meta(POLICY)}<script type="module">evil()</script>`)).toThrow(
      /inline script/,
    );
    expect(() => readPage("/", `${meta(POLICY)}<style>body{}</style>`)).toThrow(/inline style/);
  });

  it("does not ask JSON-LD for a hash: it is data, not code", () => {
    expect(unhashedInline(`<script type="application/ld+json">{"x":1}</script>`, POLICY)).toEqual(
      [],
    );
  });

  it("refuses a page with two CSP metas", () => {
    expect(() => readPage("/", meta(POLICY) + meta(POLICY))).toThrow(/2 CSP <meta>/);
  });

  it("reads an override marker", () => {
    const html = `${meta(POLICY)}<meta name="${OVERRIDE_META}" content="adr=0051; cross-origin-isolated">`;
    expect(readPage("/t/", html).override).toEqual({ adr: "0051", crossOriginIsolated: true });
    expect(() =>
      readPage("/t/", `${meta(POLICY)}<meta name="${OVERRIDE_META}" content="x">`),
    ).toThrow(/must name an ADR/);
  });
});

describe("the site policy", () => {
  it("is the home page's, and every page without an override must match it", () => {
    expect(sitePolicy([page("/"), page("/about/")])).toBe(directivesOf(POLICY).join("; "));
    expect(() =>
      sitePolicy([page("/"), page("/about/", `${POLICY}; connect-src https://x.example`)]),
    ).toThrow(/different Content-Security-Policy.*without an approved override/s);
  });

  it("fails when a page has no policy at all", () => {
    expect(() =>
      sitePolicy([page("/"), { path: "/x/", policy: undefined, override: undefined }]),
    ).toThrow(/\/x\/ has no Content-Security-Policy/);
  });

  it("fails when an override changes nothing", () => {
    expect(() =>
      sitePolicy([page("/"), page("/t/", POLICY, { adr: "0051", crossOriginIsolated: false })]),
    ).toThrow(/declares a security override but its policy is the site's/);
  });

  it("adds frame-ancestors, which a <meta> cannot carry, and refuses it in the <meta>", () => {
    expect(headerPolicy(POLICY)).toBe(`${directivesOf(POLICY).join("; ")}; frame-ancestors 'none'`);
    expect(() => headerPolicy(`${POLICY}; frame-ancestors 'self'`)).toThrow(/ignored there/);
  });
});

describe("the _headers file", () => {
  it("sends the policy and every security header on every path", () => {
    const text = renderHeadersFile(headerRules([page("/"), page("/about/")]));
    const global = text.split("\n\n").find((block) => block.startsWith("/*\n")) ?? "";
    expect(global).toContain(`Content-Security-Policy: ${headerPolicy(POLICY)}`);
    for (const [name, value] of Object.entries(securityHeaders)) {
      expect(global).toContain(`  ${name}: ${value}`);
    }
  });

  it("sends noindex to preview hosts only, never to a path rule", () => {
    const rules = headerRules([page("/")]);
    const robots = rules.filter((rule) =>
      rule.lines.some((line) => line.startsWith("X-Robots-Tag")),
    );
    expect(robots.map((rule) => rule.pattern)).toEqual(["https://:alias.:account.workers.dev/*"]);
  });

  it("gives an override page its own policy and, when asked, cross-origin isolation", () => {
    const wider = `${POLICY}; connect-src 'self' https://api.example.com`;
    const rules = headerRules([
      page("/"),
      page("/big-tool/", wider, { adr: "0051", crossOriginIsolated: true }),
    ]);
    expect(rules.at(-1)).toEqual({
      pattern: "/big-tool/",
      lines: [
        "! Content-Security-Policy",
        `Content-Security-Policy: ${headerPolicy(wider)}`,
        "Cross-Origin-Embedder-Policy: require-corp",
      ],
    });
  });

  it("fails the build past Cloudflare's limits instead of dropping rules", () => {
    const many = Array.from({ length: HEADERS_MAX_RULES + 1 }, (_, i) => ({
      pattern: `/p${i}/`,
      lines: ["X-A: b"],
    }));
    expect(() => renderHeadersFile(many)).toThrow(/at most 100/);
    expect(() =>
      renderHeadersFile([{ pattern: "/*", lines: [`X-Long: ${"a".repeat(HEADERS_MAX_LINE)}`] }]),
    ).toThrow(/2000/);
  });
});

describe("config/headers.ts", () => {
  it("denies camera, microphone and screen capture; allows four features on our origin", () => {
    const policy = permissionsPolicy();
    for (const feature of ["camera", "microphone", "display-capture", "geolocation", "payment"]) {
      expect(policy).toContain(`${feature}=()`);
    }
    for (const feature of ["fullscreen", "picture-in-picture", "autoplay"]) {
      expect(policy).toContain(`${feature}=(self)`);
    }
    expect(policy).not.toMatch(/=\(\*\)|https?:/);
  });

  it("never allows inline or eval'd script, and denies by default", () => {
    expect(csp.directives[0]).toBe("default-src 'none'");
    expect(csp.scriptResources).not.toContain("'unsafe-inline'");
    expect(csp.scriptResources).not.toContain("'unsafe-eval'");
    expect(csp.styleElementResources).not.toContain("'unsafe-inline'");
    for (const directive of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      expect(csp.directives).toContain(directive);
    }
    expect(csp.headerOnly).toEqual(["frame-ancestors 'none'"]);
  });

  it("keeps HSTS at two years with subdomains and without preload until launch", () => {
    expect(securityHeaders["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });

  it("hashes the theme script exactly as the page carries it", () => {
    expect(
      unhashedInline(`<script>${themeScript}</script>`, `script-src '${cspHash(themeScript)}'`),
    ).toEqual([]);
  });
});

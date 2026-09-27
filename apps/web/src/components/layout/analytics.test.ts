import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { site } from "../../config/site";
import Analytics from "./Analytics.astro";

// The tracker tag (ADR 0051). Its attributes are the privacy settings the privacy page promises,
// so each one is checked here; e2e/analytics.spec.ts checks what the tracker then sends.

const settings = { websiteId: "0f8fad5b-d9cb-469f-a165-70867728950e", domains: site.domain };

describe("Analytics", () => {
  it("loads Umami's tracker from our origin, deferred, with the promised settings", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(Analytics, { props: { settings } });
    const tag = html.match(/<script\b[^>]*data-website-id[^>]*>/)?.[0] ?? "";

    expect(tag).toMatch(/\sdefer\b/);
    expect(tag).not.toContain('type="module"');
    // A same-origin path: /_astro/umami-tracker.<hash>.js in a build, the source file in tests.
    expect(tag).toMatch(/src="\/[^"/][^"]*umami-tracker[^"]*"/);
    expect(tag).toContain(`data-website-id="${settings.websiteId}"`);
    expect(tag).toContain(`data-domains="${site.domain}"`);
    for (const flag of ["performance", "exclude-search", "exclude-hash", "do-not-track"]) {
      expect(tag).toContain(`data-${flag}="true"`);
    }
    // Nothing that would send cookies or name another host.
    expect(tag).not.toMatch(/data-(?:host-url|fetch-credentials|before-send)/);
  });
});

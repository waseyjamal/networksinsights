import { privacyStatement, privacyStatements, type ToolManifest } from "@networksinsights/tool-sdk";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { categoryById } from "../../config/categories";
import { toolTitle } from "../../config/site";
import type { Tool } from "../../lib/registry/build";
import { PRIVACY_TEXT } from "../ui/attrs";
import Content from "./fixture-content.astro";
import Island from "./fixture-island.astro";
import ToolPage from "./ToolPage.astro";

// The tool page template, rendered with a fixture tool. No real tool exists yet, and this test
// must keep working when one does, so the island and the content are stand-ins with the same
// shape: an Astro component each, exactly as the registry hands the route (ADR 0033).

const category = categoryById("text");
if (!category) throw new Error("the text category is missing");

function toolOf(overrides: Partial<ToolManifest> = {}): Tool {
  const manifest: ToolManifest = {
    id: "word-counter",
    name: "Word counter",
    category: "text",
    summary: "Count the words, characters and lines in any text, as you type.",
    tags: ["words"],
    runtime: "client",
    status: "beta",
    input: z.object({ text: z.string() }),
    related: [],
    added: "2026-09-20",
    updated: "2026-09-20",
    ...overrides,
  };
  return { manifest, dir: `tools/text/${manifest.id}`, href: `/${manifest.id}/` };
}

const related: Tool[] = [toolOf({ id: "case-converter", name: "Case converter", related: [] })];

let container: Awaited<ReturnType<typeof AstroContainer.create>>;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const render = (tool: Tool, links: readonly Tool[] = []) =>
  container.renderToString(ToolPage, {
    props: { tool, category, related: links, Island, Content },
  });

describe("the tool page", () => {
  let html = "";
  beforeAll(async () => {
    html = await render(toolOf(), related);
  });

  it('titles the page "<name> — Free online tool | NetworksInsights"', () => {
    expect(html).toContain("<title>Word counter — Free online tool | NetworksInsights</title>");
    expect(html).toContain(toolTitle("Word counter"));
  });

  it("uses the summary as the meta description, so the page and the search result agree", () => {
    const description = html
      .match(/<meta[^>]*name="description"[^>]*>/)?.[0]
      ?.match(/content="([^"]*)"/)?.[1];
    expect(description).toBe(toolOf().manifest.summary);
  });

  it("walks Home, category, tool in the breadcrumbs, with the tool as the current page", () => {
    const start = html.indexOf('aria-label="Breadcrumb"');
    const breadcrumbs = html.slice(start, html.indexOf("</nav>", start));
    expect(breadcrumbs).toContain('<a href="/">Home</a>');
    expect(breadcrumbs).toContain('<a href="/text-tools/">Text tools</a>');
    expect(breadcrumbs).toContain('<span aria-current="page">Word counter</span>');
  });

  it("makes the tool name the one H1, with the summary under it", () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>Word counter</h1>");
    expect(html).toContain(toolOf().manifest.summary);
  });

  it("puts the island inside the workspace card", () => {
    const workspace = html.slice(html.indexOf('class="ni-workspace"'));
    expect(workspace).toContain("fixture island");
  });

  it("renders the content sections below the workspace, in the prose block", () => {
    const prose = html.indexOf('class="ni-prose"');
    expect(prose).toBeGreaterThan(html.indexOf('class="ni-workspace"'));
    for (const section of ["How to use", "Examples", "Limits", "FAQ"]) {
      expect(html.slice(prose)).toContain(`<h2>${section}</h2>`);
    }
  });

  it("links the related tools and the way back to the category", () => {
    expect(html).toContain('aria-label="Related tools"');
    expect(html).toContain('<a href="/case-converter/">Case converter</a>');
    expect(html).toContain('<a href="/text-tools/">All text tools</a>');
    expect(html).toContain('<a href="/tools/">All tools</a>');
  });

  it("leaves out the related list when a tool has no related tools", async () => {
    expect(await render(toolOf())).not.toContain('aria-label="Related tools"');
  });
});

describe("the status badge", () => {
  /** The badge in the workspace header, as tone and label. */
  const statusBadge = (html: string) =>
    html
      .slice(html.indexOf('class="ni-workspace__header"'))
      .match(/<span class="ni-badge" data-tone="([a-z]+)"[^>]*>([^<]+)<\/span>/);

  it("marks a beta tool", async () => {
    const badge = statusBadge(await render(toolOf({ status: "beta" })));
    expect(badge?.[1]).toBe("warning");
    expect(badge?.[2]).toBe("Beta");
  });

  it("marks a deprecated tool, so nobody mistakes it for one that is kept up", async () => {
    const badge = statusBadge(await render(toolOf({ status: "deprecated" })));
    expect(badge?.[1]).toBe("danger");
    expect(badge?.[2]).toBe("Deprecated");
  });

  it("says nothing about a stable tool", async () => {
    const html = await render(toolOf({ status: "stable" }));
    expect(html).not.toContain("Beta");
    expect(html).not.toContain("Deprecated");
  });
});

describe("the privacy badge is derived from the runtime, never written by hand", () => {
  for (const runtime of ["client", "worker"] as const) {
    it(`promises nothing leaves the device for a ${runtime} tool`, async () => {
      const html = await render(toolOf({ runtime }));
      expect(html).toContain(privacyStatements.onDevice);
      expect(html).not.toContain(privacyStatements.server);
      expect(html).toContain('data-tone="success"');
    });
  }

  it("says plainly that a server tool sends the input to us", async () => {
    const html = await render(toolOf({ runtime: "server" }));
    expect(html).toContain(privacyStatements.server);
    expect(html).not.toContain(privacyStatements.onDevice);
    expect(html).not.toContain("never leave your device");
  });

  it("keeps the design system's default in step with the SDK's on-device statement", () => {
    expect(PRIVACY_TEXT).toBe(privacyStatements.onDevice);
    expect(privacyStatement("client").text).toBe(PRIVACY_TEXT);
  });
});

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it, vi } from "vitest";

// A registry with no tools: /tools/ then has nothing to filter, so it shows no filter and says so
// plainly (ADR 0033). The real registry has tools since Mission 13, so this one is mocked.
vi.mock("../registry", () => ({
  tools: [],
  getTool: () => undefined,
  toolsInCategory: () => [],
  toolCount: () => 0,
}));

const { default: ToolsPage } = await import("../../pages/tools.astro");

describe("the /tools/ page with no tools", () => {
  it("shows the honest empty state and no filter box", async () => {
    const container = await AstroContainer.create();
    const html = await container.renderToString(ToolsPage, {
      request: new Request("https://networksinsights.com/tools/"),
    });
    expect(html).toContain("No tools are live yet");
    expect(html).not.toContain("data-ni-filter");
    expect(html).not.toContain("Filter tools");
  });
});

import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import ToolsPage from "../../pages/tools.astro";

// The real registry, which has no tools until Mission 13: /tools/ then has nothing to filter, so it
// shows no filter and says so plainly (ADR 0033).

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

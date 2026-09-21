// The markup of the /tools/ page as it looks once there are tools, for the browser tests.
//
// The production site has no tools until Mission 13, so the built /tools/ has no list to filter.
// The Playwright tests splice this markup into the real built page, and the real search module
// and loader then drive it. It is a copy of what tools.astro, ToolFilter.astro and LinkList.astro
// print, so tools-filter.test.ts renders the real page and fails if the two ever disagree on a
// hook the script reads. Test support only: no page imports it.

export interface FixtureGroup {
  id: string;
  name: string;
  href: string;
  tools: readonly { name: string; href: string }[];
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function filterFixtureHtml(groups: readonly FixtureGroup[]): string {
  const sections = groups
    .map(
      (group) =>
        `<section class="space-y-4" aria-labelledby="category-${group.id}" data-ni-filter-group>` +
        `<h2 id="category-${group.id}" class="text-2xl"><a href="${group.href}">${escapeHtml(group.name)}</a></h2>` +
        `<ul class="ni-linklist">${group.tools
          .map((tool) => `<li><a href="${tool.href}">${escapeHtml(tool.name)}</a></li>`)
          .join("")}</ul>` +
        "</section>",
    )
    .join("");
  return (
    '<div class="grid gap-8">' +
    '<div class="ni-filter" data-ni-filter>' +
    '<div class="ni-field"><label class="ni-field__label" for="tool-filter">Filter tools</label>' +
    '<input class="ni-input" id="tool-filter" type="search" placeholder="Filter by name, task or file type" autocomplete="off" spellcheck="false" data-ni-filter-input></div>' +
    '<p class="ni-filter__status" role="status" aria-live="polite" data-ni-filter-status></p>' +
    '<div class="ni-filter__none" data-ni-filter-none hidden><p>No tool matches “<span data-ni-filter-query></span>”. Check the spelling or try fewer words.</p>' +
    '<button class="ni-filter__clear" type="button" data-ni-filter-clear>Clear filter</button></div>' +
    "</div>" +
    `<div class="grid gap-8" data-ni-filter-list>${sections}</div>` +
    "</div>"
  );
}

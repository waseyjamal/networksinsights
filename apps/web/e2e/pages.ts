import { existsSync, readdirSync, readFileSync } from "node:fs";
import { categories, categoryHref } from "../src/config/categories";
import { homeTitle, pageTitle, sitePages, toolTitle } from "../src/config/site";

// Every page of the site, built from the same configs the site is built from.

export interface SitePage {
  path: string;
  /** Expected <title>. */
  title: string;
  /** Expected HTTP status. */
  status: 200 | 404;
  /** Run the axe scan in the shared page test (the design system has its own, larger one). */
  axe: boolean;
}

export const notFoundPath = "/this-page-does-not-exist/";

/** One real tool, read from its folder under tools/ (the browser tests do not load the registry). */
export interface SiteTool {
  id: string;
  name: string;
  category: string;
  summary: string;
  path: string;
}

const toolsRoot = new URL("../../../tools/", import.meta.url);

/** Every tool folder, with the fields the browser tests compare against the built page. */
export const siteTools: SiteTool[] = readdirSync(toolsRoot, { withFileTypes: true })
  // Only category folders: tools/ also holds node_modules and config files.
  .filter((entry) => entry.isDirectory() && categories.some((item) => item.id === entry.name))
  .flatMap((category) =>
    readdirSync(new URL(`${category.name}/`, toolsRoot), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(new URL(`${category.name}/${entry.name}/tool.config.ts`, toolsRoot)),
      )
      .map((tool) => {
        const config = readFileSync(
          new URL(`${category.name}/${tool.name}/tool.config.ts`, toolsRoot),
          "utf8",
        );
        const field = (name: string) =>
          config.match(new RegExp(`\\b${name}:\\s*"([^"]*)"`))?.[1] ?? "";
        return {
          id: tool.name,
          name: field("name"),
          category: category.name,
          summary: field("summary"),
          path: `/${tool.name}/`,
        };
      }),
  );

export const pages: SitePage[] = [
  { path: "/", title: homeTitle, status: 200, axe: true },
  { path: sitePages.tools.href, title: pageTitle("All tools"), status: 200, axe: true },
  ...categories.map((category) => ({
    path: categoryHref(category),
    title: pageTitle(category.name),
    status: 200 as const,
    axe: true,
  })),
  ...siteTools.map((tool) => ({
    path: tool.path,
    title: toolTitle(tool.name),
    status: 200 as const,
    axe: true,
  })),
  { path: sitePages.about.href, title: pageTitle("About"), status: 200, axe: true },
  { path: sitePages.contact.href, title: pageTitle("Contact"), status: 200, axe: true },
  { path: sitePages.privacy.href, title: pageTitle("Privacy"), status: 200, axe: true },
  { path: sitePages.terms.href, title: pageTitle("Terms"), status: 200, axe: true },
  { path: "/design-system/", title: pageTitle("Design system"), status: 200, axe: false },
  { path: notFoundPath, title: pageTitle("Page not found"), status: 404, axe: true },
];

/** Pages whose HTML file is built (the 404 page is served for any unknown path). */
export const builtPaths = pages.filter((page) => page.status === 200).map((page) => page.path);

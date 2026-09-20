import { categories, categoryHref } from "../src/config/categories";
import { homeTitle, pageTitle, sitePages } from "../src/config/site";

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

export const pages: SitePage[] = [
  { path: "/", title: homeTitle, status: 200, axe: true },
  { path: sitePages.tools.href, title: pageTitle("All tools"), status: 200, axe: true },
  ...categories.map((category) => ({
    path: categoryHref(category),
    title: pageTitle(category.name),
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

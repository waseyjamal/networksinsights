// The structured data (JSON-LD) of every page, built from the same data the page is built from
// (ADR 0039). Nothing here is typed in per page: a page hands over its breadcrumbs, its tools or
// its FAQ, and gets nodes back. `schemas.ts` holds the matching Zod schemas, which the tests
// use to prove every block is well formed and says nothing the page does not show.
//
// What is left out on purpose:
//  - No `aggregateRating` or `review`. The site has none, and one is never invented (AGENTS.md).
//    Google's software app rich result needs one, so a tool page is valid markup without it and
//    is not eligible for that rich result.
//  - No `SearchAction`. There is no site search yet, and Google no longer shows a search box
//    for it.
//  - No `sameAs`. The site has no profiles to point to.

import type { FaqEntry } from "@networksinsights/tool-sdk";
import type { Category } from "../../config/categories";
import { site } from "../../config/site";
import type { Tool } from "../registry/build";
import { fileUrl, pageUrl } from "./urls";

/** One step of a breadcrumb trail, as the page shows it. The last has no `href`. */
export interface Crumb {
  label: string;
  href?: string;
}

export type { FaqEntry };

export interface OrganizationNode {
  "@type": "Organization";
  "@id": string;
  name: string;
  url: string;
  logo: string;
}

export interface WebSiteNode {
  "@type": "WebSite";
  "@id": string;
  url: string;
  name: string;
  alternateName: string;
  description: string;
  inLanguage: "en";
  publisher: { "@id": string };
}

export interface BreadcrumbListNode {
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
}

export interface ItemListNode {
  "@type": "ItemList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    url: string;
  }>;
}

export interface CollectionPageNode {
  "@type": "CollectionPage";
  url: string;
  name: string;
  description: string;
  inLanguage: "en";
  mainEntity?: ItemListNode;
}

export interface WebApplicationNode {
  "@type": "WebApplication";
  name: string;
  url: string;
  description: string;
  applicationCategory: Category["applicationCategory"];
  operatingSystem: "Any";
  browserRequirements: "Requires JavaScript";
  isAccessibleForFree: true;
  inLanguage: "en";
  offers: { "@type": "Offer"; price: "0"; priceCurrency: "USD" };
  dateModified: string;
  publisher: { "@type": "Organization"; name: string; url: string };
}

export interface FaqPageNode {
  "@type": "FAQPage";
  mainEntity: Array<{
    "@type": "Question";
    name: string;
    acceptedAnswer: { "@type": "Answer"; text: string };
  }>;
}

export type JsonLdNode =
  | OrganizationNode
  | WebSiteNode
  | BreadcrumbListNode
  | CollectionPageNode
  | WebApplicationNode
  | FaqPageNode;

export interface JsonLdDocument {
  "@context": "https://schema.org";
  "@graph": JsonLdNode[];
}

/** The `@id` of the organization and of the website, on the home page. */
export const organizationId = `${site.url}/#organization`;
export const websiteId = `${site.url}/#website`;

/** The graph of the home page: who runs the site and what the site is. */
export function homeNodes(): [OrganizationNode, WebSiteNode] {
  return [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: site.name,
      url: `${site.url}/`,
      logo: fileUrl("/favicon.svg"),
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      url: `${site.url}/`,
      name: site.name,
      alternateName: site.domain,
      description: site.description,
      inLanguage: "en",
      publisher: { "@id": organizationId },
    },
  ];
}

/**
 * The breadcrumb trail of a page. `crumbs` is the same list the visible breadcrumbs are drawn from.
 * The last crumb is the page itself, so its URL is the page's own `path`.
 */
export function breadcrumbNode(crumbs: readonly Crumb[], path: string): BreadcrumbListNode {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item: pageUrl(index === crumbs.length - 1 ? path : (crumb.href ?? path)),
    })),
  };
}

/** A page that lists other pages: `/tools/` and a category page. `items` are what it lists. */
export function collectionNode(input: {
  path: string;
  name: string;
  description: string;
  items: ReadonlyArray<{ name: string; href: string }>;
}): CollectionPageNode {
  const node: CollectionPageNode = {
    "@type": "CollectionPage",
    url: pageUrl(input.path),
    name: input.name,
    description: input.description,
    inLanguage: "en",
  };
  // An empty list is left out: a list with nothing in it says nothing.
  if (input.items.length > 0) {
    node.mainEntity = {
      "@type": "ItemList",
      itemListElement: input.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: pageUrl(item.href),
      })),
    };
  }
  return node;
}

/**
 * The nodes of a tool page: the web application, and the FAQ when the content has one. The
 * facts come from the manifest, the same manifest the visible "Quick facts" are built from
 * (ADR 0044). schema.org has no property for where a tool runs, its limits or the formats it
 * accepts, so those stay in the visible list only.
 */
export function toolNodes(input: {
  tool: Pick<Tool, "href" | "manifest">;
  category: Pick<Category, "applicationCategory">;
  faq: readonly FaqEntry[];
}): [WebApplicationNode, ...FaqPageNode[]] {
  const { manifest, href } = input.tool;
  const app: WebApplicationNode = {
    "@type": "WebApplication",
    name: manifest.name,
    url: pageUrl(href),
    description: manifest.summary,
    applicationCategory: input.category.applicationCategory,
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    isAccessibleForFree: true,
    inLanguage: "en",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    dateModified: manifest.updated,
    publisher: { "@type": "Organization", name: site.name, url: `${site.url}/` },
  };
  if (input.faq.length === 0) return [app];
  return [
    app,
    {
      "@type": "FAQPage",
      mainEntity: input.faq.map((entry) => ({
        "@type": "Question",
        name: entry.question,
        acceptedAnswer: { "@type": "Answer", text: entry.answer },
      })),
    },
  ];
}

/** Wraps nodes as one JSON-LD document. */
export function graph(nodes: readonly JsonLdNode[]): JsonLdDocument {
  return { "@context": "https://schema.org", "@graph": [...nodes] };
}

/** The two line separators that JSON allows but older JavaScript does not accept in a string. */
const BACKSLASH = String.fromCharCode(92);
const LINE_SEPARATORS = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)] as const;

/**
 * The text of a `<script type="application/ld+json">` block. Every less-than sign is written as
 * the escape sequence backslash, u, 0, 0, 3, c, so no text in a page (a tool name, an FAQ answer)
 * can end the script element or open a comment inside it. The result is still the same JSON.
 */
export function serializeJsonLd(document: JsonLdDocument): string {
  const unicodeEscape = (character: string) =>
    `${BACKSLASH}u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  let json = JSON.stringify(document).replaceAll("<", unicodeEscape("<"));
  for (const separator of LINE_SEPARATORS)
    json = json.replaceAll(separator, unicodeEscape(separator));
  return json;
}

// IndexNow: telling search engines which URLs changed after a deploy (ADR 0042).
//
// The logic is pure so it can be tested without a network: which URLs changed between two
// sitemaps, how to cut them into requests, and what a request looks like. scripts/indexnow.ts
// does the fetching. IndexNow is supported by Bing, Yandex, Naver, Seznam.cz, Yep and Amazon.
// Google does not support it.

import { site } from "../../config/site";
import { readUrlset } from "./sitemap";

/** The shared endpoint: a submission here is passed on to every participating search engine. */
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** The most URLs one request may carry. */
export const INDEXNOW_BATCH_SIZE = 10_000;

/** A key is 8 to 128 characters: letters, digits and dashes. */
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

export function isValidKey(key: string | undefined): key is string {
  return key !== undefined && INDEXNOW_KEY_PATTERN.test(key);
}

/** The key file lives at the root of the site and is named after the key. */
export const keyFilePath = (key: string) => `/${key}.txt`;

export interface UrlState {
  loc: string;
  lastmod: string | undefined;
}

/** The URLs of some sitemap files' text, each with its `lastmod`. */
export function urlsOfSitemaps(xmlFiles: readonly string[]): UrlState[] {
  return xmlFiles.flatMap((xml) => readUrlset(xml));
}

/**
 * The URLs to announce: the ones that are new, and the ones whose `lastmod` changed. A URL that
 * was removed is not announced (it will answer 404), and one that did not change never is: the
 * IndexNow guidance is to submit only what changed.
 */
export function changedUrls(previous: readonly UrlState[], next: readonly UrlState[]): string[] {
  const before = new Map(previous.map((item) => [item.loc, item.lastmod]));
  return next
    .filter((item) => !before.has(item.loc) || before.get(item.loc) !== item.lastmod)
    .map((item) => item.loc)
    .sort();
}

/** Cuts a list into requests of at most `size` items. */
export function batches<T>(items: readonly T[], size = INDEXNOW_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
}

export interface IndexNowBody {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** The JSON body of one request. Every URL must be on this site's host, or the request is refused. */
export function requestBody(key: string, urlList: readonly string[]): IndexNowBody {
  if (!isValidKey(key))
    throw new Error("The IndexNow key must be 8 to 128 letters, digits or dashes.");
  const foreign = urlList.find((url) => new URL(url).origin !== site.url);
  if (foreign) throw new Error(`Not a URL of ${site.url}: ${foreign}`);
  return {
    host: site.domain,
    key,
    keyLocation: `${site.url}${keyFilePath(key)}`,
    urlList: [...urlList],
  };
}

export interface SubmitResult {
  /** How many URLs were in the request. */
  urls: number;
  /** The HTTP status. 200 and 202 mean accepted. */
  status: number;
}

/** Sends the URLs in as many requests as they need. Returns one result per request. */
export async function submitUrls(
  key: string,
  urls: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<SubmitResult[]> {
  const results: SubmitResult[] = [];
  for (const chunk of batches(urls)) {
    const response = await fetchFn(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(requestBody(key, chunk)),
    });
    results.push({ urls: chunk.length, status: response.status });
  }
  return results;
}

/** 200 means the key was checked; 202 means the request was accepted and the key is checked later. */
export const isAccepted = (status: number) => status === 200 || status === 202;

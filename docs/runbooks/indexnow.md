# Runbook: IndexNow

Why and how it works: [ADR 0042](../adr/0042-indexnow.md). After every production deploy of a launched site, CI tells Bing, Yandex, Naver, Seznam, Yep and Amazon which URLs are new or changed. Google is not part of IndexNow.

It does nothing until the site is launched (`launched` in `apps/web/src/config/site.ts`) and a key exists.

## Set it up (once)

1. Make a key: 32 hexadecimal characters.

   ```
   openssl rand -hex 16
   ```

2. GitHub: the repository, **Settings**, **Secrets and variables**, **Actions**, the **Variables** tab (not Secrets), **New repository variable**. Name `INDEXNOW_KEY`, value the key.

   It is a variable because the key is public by design: it is published at `https://networksinsights.com/<key>.txt`, and that file is how the search engines check that you own the site.
3. Nothing else. The next production build writes `<key>.txt` into the site, and the deploy job announces the changed URLs.

## Check it

- After the first launched deploy, `https://networksinsights.com/<key>.txt` shows the key and nothing else.
- In the `deploy` job's log, the step **Announce changed URLs to IndexNow** prints one line: `IndexNow: Sent 63 URLs to IndexNow in 1 request.` or the reason it did nothing (`The site is not launched`, `INDEXNOW_KEY is not set`, `No URL is new or changed since the last deploy`).
- Bing Webmaster Tools, **IndexNow**, lists the submissions.

## Rotate the key

Change the variable's value and deploy. The old key file disappears with the next build and the new one appears.

## If the step says it failed

The step is allowed to fail and never fails a deploy.

- **`The key file … is not live`:** the build ran without `INDEXNOW_KEY`, or the variable is not a valid key (8 to 128 letters, digits and dashes). Fix the variable and deploy again.
- **Status 403:** the key file does not hold the key that was sent. The key changed between the build and the announcement; deploy again.
- **Status 422:** a URL was not on `networksinsights.com`. That cannot happen from the sitemaps; report it.
- **Status 429:** too many requests. IndexNow asks for at most one submission of a URL per few minutes; deploys that close together are the usual cause. Nothing to do.

## Run it by hand

Never from a local machine against production without a reason. To try the logic: `pnpm indexnow snapshot --out /some/folder`, then after a build `INDEXNOW_KEY=<key> pnpm indexnow submit --previous /some/folder`. While `launched` is false it prints that it did nothing.

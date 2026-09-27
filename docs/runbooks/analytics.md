# Runbook: analytics and error reports

Why and how it works: [ADR 0051](../adr/0051-analytics-and-error-reporting.md). The site counts page views, tool use, Core Web Vitals and scrubbed JavaScript errors with Umami Cloud, without cookies. Nothing is collected until a website id is set.

## Set it up (once)

1. Sign up at [cloud.umami.is](https://cloud.umami.is/) on the free **Hobby** plan. Check the plan's current limits on [umami.is/pricing](https://umami.is/pricing): on 2026-09-27 they were 100k events a month and 6 months of data.
2. **Settings**, **Websites**, **Add website**: name `NetworksInsights`, domain `networksinsights.com`. Open the new website's **Edit** page and copy its **Website ID** (a UUID). Ignore the tracking code Umami shows: the site already carries the tracker (served from its own origin), configured in `apps/web/src/components/layout/Analytics.astro`.
3. GitHub: the repository, **Settings**, **Secrets and variables**, **Actions**, the **Variables** tab, **New repository variable**. Name `UMAMI_WEBSITE_ID`, value the Website ID. It is a variable, not a secret: the id is in every page.
4. Merge or re-run a deploy to `main`. Only the production build reads the variable. Previews and local builds stay without analytics, and the tracker sends nothing on any hostname but `networksinsights.com` anyway.
5. Check: open `https://networksinsights.com/privacy/`. Its Analytics section now describes Umami. Open a tool, type something, and within a minute Umami's **Realtime** view shows the visit.
6. Leave your own visits out: on the live site, open the browser console and run `localStorage.setItem("umami.disabled", "1")`. Do it in each browser you use.

## Read the dashboard

- **Which tools are popular**: **Overview**, the **Pages** table (page views per tool URL). For use rather than views: **Events**, the event `tool-used`, then its property `tool`.
- **Core Web Vitals**: the **Performance** tab. It lists LCP, INP, CLS, FCP and TTFB per page, at the 75th percentile. Google's "good" thresholds are LCP under 2.5 s, INP under 200 ms and CLS under 0.1.
- **Errors**: **Events**, the event `js-error`, and its properties `name`, `message`, `source`, `line` and `tool`. `source` is our file under `/_astro/`, or `external` for a browser extension's code, which you can usually ignore. After a spike, compare `source` with the files of the current deploy.

## Turn it off

Delete the `UMAMI_WEBSITE_ID` variable and deploy. The pages then carry no analytics script, and the privacy page says there are no analytics. To also remove the data, delete the website in Umami.

## If the free plan runs out

Each page view costs about two events (the view and its Web Vitals report). Either upgrade in Umami, or turn Web Vitals off: remove `data-performance` from `Analytics.astro` and the Web Vitals line from `privacy.astro` in one pull request.

## Update the tracker

Follow `apps/web/src/lib/analytics/VENDOR.md`. Never point the page at `cloud.umami.is/script.js` instead: that would need a third-party `script-src` (ADR 0047).

// The second server the E2E tests use: `wrangler dev` over the same `dist`. Unlike `astro preview`
// it applies `dist/_headers` exactly as Cloudflare does, so the header and CSP tests run against
// the real rules (ADR 0047, ADR 0048). It serves local files only and deploys nothing.

export const edgePort = 8787;
export const edgeURL = `http://127.0.0.1:${edgePort}`;

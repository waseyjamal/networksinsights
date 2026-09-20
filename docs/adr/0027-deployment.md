# 0027. Deployment

Status: Accepted
Date: 2026-09-20

## Context

The site needs a deploy pipeline that a developer's machine cannot bypass, that shows every pull request on a real URL before merge, and that can roll back fast. The repository is private on the GitHub Free plan, so branch protection and required checks are not available (ADR 0025).

## Decision

**Hosting.** Cloudflare Workers with static assets (ADR 0007). One Worker, `networksinsights`, configured in `apps/web/wrangler.jsonc`:

- Static assets only, no Worker script yet. Assets come from the Astro build output (`./dist`).
- `not_found_handling: "404-page"` serves the nearest `404.html` with status 404. `html_handling: "auto-trailing-slash"` (the default, set explicitly) matches Astro's directory output.
- `compatibility_date` is set to the release date of the `workerd` bundled with the pinned Wrangler, never a future date.
- Custom Domain `networksinsights.com` (`routes` with `custom_domain: true`). `workers_dev` is `false`, so the site is reachable only on our domain.
- `preview_urls` is `true`.

**Canonical address.** `https://networksinsights.com`, the apex, no `www`. A Custom Domain does not answer `www`, so a `www` to apex redirect is a separate Cloudflare rule. It is not part of Mission 5 and is tracked as a follow-up.

**Deploys happen only in CI.** Nobody runs `wrangler login` or `wrangler deploy` on a local machine, and there are no local credential files. There is no `deploy` script in `package.json`. The Cloudflare secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist only as GitHub Actions secrets and are used only through `${{ secrets.* }}`, on the one step that needs them.

**Pipeline.** The deploy jobs live in `.github/workflows/ci.yml` next to `quality` and `e2e`, because `needs` gates them inside one run. A separate workflow would need `workflow_run`, which runs with secrets in the default-branch context and is more fragile and riskier.

- Job `preview`: on pull requests from this repository (forks and Dependabot get no secrets, so they get no preview), after `quality` and `e2e`. It builds, runs `wrangler versions upload --preview-alias pr-<N>`, and posts or updates one PR comment with the preview URL. It is the only job with `pull-requests: write`.
- Job `deploy`: on push to `main`, after `quality` and `e2e`. It builds and runs `wrangler deploy`. Permissions are `contents: read`. It runs in concurrency group `deploy-production` with `cancel-in-progress: false`, so a production deploy is never cancelled midway.
- Workflow `.github/workflows/rollback.yml`: manual (`workflow_dispatch`) with a required `version_id` input. It runs only from `main`, checks that the input is a UUID, and runs `wrangler rollback`. It uses the same `deploy-production` group with cancel off, so a rollback and a deploy never overlap. It skips `quality` and `e2e` on purpose.
- Every job that touches Cloudflare builds from the same commit and lockfile. Artifacts are not passed between jobs, which keeps the jobs simple at the cost of about a minute each.

**Wrangler through pnpm, not `cloudflare/wrangler-action`.** Wrangler is a pinned devDependency of `apps/web` (4.133.0) and runs as `pnpm --filter web exec wrangler`. That gives one Wrangler version everywhere, taken from the lockfile and subject to `minimumReleaseAge`, and it adds no third-party action that would hold the deploy token. The action also does not set `deployment-url` for `versions` commands (wrangler-action issue 343), and it does not prefer the project's own Wrangler.

**Gating replaces branch protection.** Production deploys need both `quality` and `e2e` to pass in the same run. On the Free plan this is our substitute for required checks. It is not a full one: it protects production, not `main` itself. Someone can still merge a red pull request, but that merge cannot reach production while a check is red.

**Amends ADR 0025.** The workflow-level concurrency was `cancel-in-progress: true` for every ref. It is now `${{ github.event_name == 'pull_request' }}`: a newer push still cancels the checks of a pull request, but never a run on `main`. ADR 0025 said no job uses secrets. That is now true only of `quality` and `e2e`.

**Dependency exception.** Wrangler 4.133.0 depends on `unenv 2.0.0-rc.24` and `miniflare 5.20260916.0-alpha`. Every Wrangler 4.x release we checked (4.100 to 4.135) depends on the same `unenv` rc, so no version avoids it. The owner approved this on 2026-09-20. The rule "no alpha, beta, rc or canary versions" (AGENTS.md) applies to the dependencies we choose directly, not to transitive ones. Wrangler 4.133.0 is the newest version that passes `minimumReleaseAge` (4.134.0 and 4.135.0 were too new on that day). Its `workerd` dependency has a build script, which stays denied: `workerd: false` in `allowBuilds`. Deploys do not run `workerd`.

## Consequences

- No local machine can deploy. A deploy needs a merge to `main`, with both checks green.
- A pull request gets a preview at `https://pr-<N>-networksinsights.<account>.workers.dev`, where `<account>` is the account's workers.dev subdomain. The same alias moves to the newest version of the pull request.
- Preview URLs exist only on `workers.dev` and are public. Search engines could index them. Mission 12 (security) should add a `noindex` header for `workers.dev` hosts.
- Wrangler and its `workerd` binary add a large `node_modules` (about 150 MB on one platform), so every install is slower on developer machines and CI.
- The API token needs at least Account, Workers Scripts, Edit, and Zone, Workers Routes, Edit for the Custom Domain. The scope cannot be checked from the repository. It is verified by the first production deploy after Mission 5 merges.
- A rollback changes only what is served. It does not revert code. The next push to `main` deploys forward again, so the bad commit must also be reverted (runbook: `docs/runbooks/deploy-and-rollback.md`).
- Cloudflare's own git integration (Workers Builds) must stay disconnected. It would deploy a second time, outside this pipeline.

## Revisit when

- Wrangler ships stable versions of `unenv` and `miniflare`. Then the transitive exception can end.
- The account moves to GitHub Pro or higher and gets required checks on `main`. Then the job gating becomes a second layer, not the only one.
- We need a staging environment, or the Worker gets a script (Mission 15).

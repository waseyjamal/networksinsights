# Runbook: deploy and rollback

Why it works this way: [ADR 0027](../adr/0027-deployment.md). Deploys happen only through CI. Never run `wrangler login` or `wrangler deploy` on a local machine, and never create local credential files.

## How deploys happen

| Event | What runs | Result |
|---|---|---|
| Pull request to `main` | `quality`, `e2e`, then `preview` | A preview version at `https://pr-<N>-networksinsights.<account>.workers.dev`, posted as one PR comment that is updated on every push |
| Push (merge) to `main` | `quality`, `e2e`, then `deploy` | `wrangler deploy` to production at `https://networksinsights.com` |
| Manual run of "Rollback production" | `rollback` | `wrangler rollback` to the version you name |

- `deploy` needs both `quality` and `e2e` green in the same run. On the GitHub Free plan this is our substitute for branch protection.
- A production deploy is never cancelled midway. A newer push waits for the running deploy, and a waiting deploy is replaced by the newest one. Deploys and rollbacks share the concurrency group `deploy-production`.
- Previews work only after the first production deploy exists. Until `wrangler deploy` has created the Worker, `preview` fails with "You cannot upload a new version of a Worker that does not yet exist". This is expected on the Mission 5 pull request only.
- Forks and Dependabot pull requests get no preview, because they do not receive the secrets.
- The secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` live only in GitHub (Settings, Secrets and variables, Actions). To rotate the token, create a new one in Cloudflare and replace the GitHub secret.
- Do not connect Cloudflare's own git integration (Workers Builds) to this repository. It would deploy a second time, outside this pipeline.

## Deploy a change

1. Open a pull request from a `mission/NN-short-name` branch.
2. Wait for `quality`, `e2e` and `preview` to pass. Open the preview link from the PR comment and check the change.
3. The owner merges. The `deploy` job runs on `main`.
4. Check production: `https://networksinsights.com/` answers 200, and an unknown path such as `/no-such-page` answers 404 with the "Page not found" page.

## Roll back production

A rollback creates a new deployment of an earlier version. It does not change git. Do it in this order.

### 1. Find the version ID to go back to

Open the Cloudflare dashboard: Workers & Pages, `networksinsights`, Deployments (or Versions). Pick the last good version and copy its version ID (a UUID). Only the 100 most recent versions can be rolled back to. The `deploy` job log of the last good run also shows the version it deployed.

### 2. Roll back (preferred: GitHub Actions)

1. On GitHub open Actions, then "Rollback production", then "Run workflow".
2. Keep the branch on `main`. The job refuses to run from any other branch.
3. Paste the version ID into `version_id` and run it.

Or from a terminal (this uses your GitHub login only, not Cloudflare credentials):

```
gh workflow run rollback.yml --ref main -f version_id=<VERSION_ID>
gh run watch
```

### 3. Backup: the Cloudflare dashboard

Use this only if GitHub Actions is unavailable. Workers & Pages, `networksinsights`, Deployments, the three-dot menu next to the target version, Rollback.

### 4. Check

- `curl -sI https://networksinsights.com/` answers 200.
- In the dashboard, Deployments shows a new deployment at 100% for the version you chose.

### 5. Fix forward (do not skip)

A rollback changes only what is served. The bad commit is still on `main`, and the next merge deploys forward and brings the problem back. Open a pull request that reverts the bad commit (`git revert <sha>` on a `mission/NN-short-name` branch), and merge it through the normal pipeline.

## If something fails

- **Authentication error (code 10000) or a missing permission on `deploy`:** the API token lacks a scope. It needs at least Account, Workers Scripts, Edit, and Zone, Workers Routes, Edit for the Custom Domain. DNS, Edit on the zone may also be needed.
- **Custom Domain error about an existing DNS record:** delete the existing `networksinsights.com` record in Cloudflare DNS (a Custom Domain cannot be created on a hostname that has a CNAME), then run the deploy again.
- **`preview` cannot find a preview URL:** open the "Upload preview version" step log. The URL must look like `https://pr-<N>-networksinsights.<account>.workers.dev`.
- **Rollback refused because of bindings:** rollbacks are blocked when bindings changed between versions. The Worker has no bindings today.

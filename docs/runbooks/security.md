# Runbook: security

Why it works this way: [ADR 0047](../adr/0047-content-security-policy.md) (CSP), [ADR 0048](../adr/0048-security-headers.md) (headers), [ADR 0049](../adr/0049-supply-chain-automation.md) (supply chain), [ADR 0050](../adr/0050-tool-runtime-safety-contract.md) (tool runtime safety).

## A dependency alert fires

It arrives in one of three ways: the `supply-chain` job fails on a pull request or on `main`, the weekly "Supply chain" workflow fails, or GitHub shows a Dependabot alert (Security tab).

1. **Read what it is.** Open the failed job. `pnpm audit` prints the package, the advisory (GHSA-…), its severity, the vulnerable range and the path that pulls it in. Locally: `pnpm audit --audit-level moderate`, and `pnpm why <package> -r` to see who depends on it.
2. **Decide whether it can reach a visitor.** Is the package in the browser bundle, or build-time only (Astro, Vite, Playwright, Wrangler)? Does the vulnerable function run at all? Note the answer in the pull request that fixes it. Severity still decides the gate: moderate or higher fails, whatever the reach.
3. **Fix it, in this order of preference:**
   1. Update the direct dependency that pulls it in to a release that fixes it: `pnpm update <direct-dependency>@<fixed version>`, exact version, on a branch. If Dependabot has opened a pull request for it, use that one.
   2. If only a transitive dependency has the fix, add an exact override in `pnpm-workspace.yaml` under `overrides:`, with a comment naming the advisory, and remove it once the direct dependency catches up.
   3. If there is no fix yet and the vulnerable code cannot run in our use, the owner may approve ignoring that one advisory: add `--ignore GHSA-…` to both audit steps (`ci.yml` and `supply-chain.yml`) with a comment naming the advisory, the reason and a date to check again. Never ignore a whole severity.
4. **A fixed release younger than three days.** `minimumReleaseAge` (ADR 0019) refuses it, on purpose. If the owner decides it cannot wait: add that exact version, and only it, to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` (for example `- some-package@1.2.4`; pnpm accepts a single version) with a comment naming the advisory and the date; install; merge; and remove the entry once the three days have passed. Never lower `minimumReleaseAge` itself.
5. **Check and merge.** `pnpm install`, `pnpm check`, `pnpm audit --audit-level moderate`, `pnpm check:licenses`. The pull request's `lockfile` comment shows exactly what moved. The owner merges.

**The licence gate fails** (`pnpm check:licenses`): the report names the package, its version and its licence. Replace the package, or find which dependency pulls it in (`pnpm why <name> -r`) and replace that. A licence can only be added to the allowed set, or as a package-scoped exception in `scripts/lib/licenses.ts`, with an ADR the owner accepts (ADR 0017).

**`pnpm audit signatures` fails**: a tarball's registry signature does not verify. Do not merge. Delete `node_modules` and the pnpm store entry for that package, install again, and run the check again. If it still fails, report it to npm (security@npmjs.com) and pin the last version that verifies.

**Dependabot fails on pnpm 11.** Dependabot's pnpm 11 support is a beta (September 2026). If its runs fail (Insights, Dependency graph, Dependabot), note the error in an issue. If it keeps failing, replace it with Renovate: install the Renovate GitHub App on this repository only, add `renovate.json` with `"minimumReleaseAge": "3 days"`, `"rangeStrategy": "pin"`, a weekly schedule and the same grouping, remove the npm entry from `.github/dependabot.yml`, and record it in a new ADR that amends ADR 0049.

## Add a CSP exception for a tool

Almost no tool needs one. Before you start, check the tool cannot do its work with what the policy already allows: same-origin files, Web Workers (also from `blob:`), WebAssembly, `blob:` and `data:` images and media.

1. **Write an ADR** (next free number, template `docs/adr/0000-template.md`). It must say which tool, exactly what it needs (cross-origin isolation, or one named https origin per directive), why the tool cannot work without it, what that origin receives from the visitor (then check the privacy page), and when to remove it. Status `Proposed`.
2. **The owner accepts it** and sets `Status: Accepted`. `pnpm check:tools` refuses the override until then.
3. **Declare it in the tool's manifest** (`tool.config.ts`):

   ```ts
   security: {
     adr: "0051",
     crossOriginIsolated: true, // only if the tool needs SharedArrayBuffer
     sources: { "connect-src": ["https://api.example.com"] }, // only if it needs an origin
   },
   ```

   Only `connect-src`, `img-src`, `media-src`, `font-src` and `worker-src` can be widened, only with https origins. Scripts and styles cannot.
4. **Build and check.** `pnpm build` prints `_headers written: N rules` with one more rule than before; `dist/_headers` has a block for `/<tool-id>/` that starts with `! Content-Security-Policy`. Run `pnpm check:tools --tool <tool-id>` and `pnpm test:e2e`.
5. **Verify on the preview.** In the pull request's preview, open the tool page and check, in the browser's developer tools, the response headers of the page: one `Content-Security-Policy` with the new source, and `Cross-Origin-Embedder-Policy: require-corp` if asked; `self.crossOriginIsolated` is `true` in the console for an isolated page. Other pages are unchanged.

To change the site-wide policy instead (every page), edit `csp` in `apps/web/src/config/headers.ts` with a new ADR that amends ADR 0047. Never add `'unsafe-inline'` or `'unsafe-eval'` to scripts.

**A new inline script** (rare: prefer a file). Put its source in a constant string, render it with `set:html` from that constant, and add `cspHash(source)` to `scriptDirective.hashes` in `astro.config.mjs`, as the theme script does. The build fails with the script's first words if you forget.

## Rotate the Cloudflare API token

The token is the GitHub Actions secret `CLOUDFLARE_API_TOKEN`. It is used by `preview`, `deploy` and `rollback`, and nowhere else. It exists only in Cloudflare and in GitHub, never on a machine. Rotate it once a year, when someone who could see it leaves, or at once if it may have leaked.

1. **Roll it in Cloudflare.** Dashboard, My Profile, API Tokens. Next to the token used by this repository, open the three-dot menu, **Roll**, **Confirm**. Cloudflare shows the new value once. Rolling keeps the same permissions and **invalidates the old value immediately**, so do the next step straight away; a deploy in between would fail.
   - If it may have leaked, roll it first, before anything else.
   - Its permissions must stay: Account, Workers Scripts, Edit; Zone, Workers Routes, Edit (for the custom domain); add nothing else.
2. **Replace the GitHub secret.** GitHub, the repository, Settings, Secrets and variables, Actions, `CLOUDFLARE_API_TOKEN`, **Update secret**, paste, save. Do not paste the token anywhere else: not in a chat, a file, an issue or a terminal.
3. **Prove it works.** Re-run the `preview` job of any open pull request (Actions, the run, Re-run jobs). It must upload a version. If none is open, the next pull request proves it; the next merge to `main` also runs `deploy`.
4. **If it leaked:** in Cloudflare, check the account's audit log (Manage Account, Audit Log) for actions you did not make since the leak, and check Workers & Pages, `networksinsights`, Deployments, for versions no pipeline made. Roll back with the "Rollback production" workflow if production was changed ([deploy runbook](deploy-and-rollback.md)).

`CLOUDFLARE_ACCOUNT_ID` is not a secret in the same sense (it identifies the account, it grants nothing) and does not need rotating.

# 0025. CI pipeline

Status: Accepted
Date: 2026-09-20

## Context

Git hooks (ADR 0024) can be skipped with `--no-verify`, so they are not the last line of defence. Every change to `main` needs an automated gate that cannot be skipped from a developer's machine.

## Decision

Use GitHub Actions. The workflow is `.github/workflows/ci.yml`.

- Triggers: `pull_request` targeting `main`, and `push` to `main`.
- Top-level `permissions: contents: read`, the least privilege the jobs need. No job asks for more, and no job uses secrets.
- Concurrency group `ci-<workflow>-<ref>` with `cancel-in-progress`, so a newer push to the same ref cancels the older run.
- Every action is pinned to a full commit SHA, with the release in a comment. Tags can be moved, SHAs cannot. The current pins:
  - `actions/checkout` v7.0.1
  - `actions/setup-node` v7.0.0
  - `pnpm/action-setup` v6.1.0
  - `actions/upload-artifact` v7.0.1
- `.github/dependabot.yml` opens weekly pull requests for GitHub Actions only, so the pinned SHAs stay current. npm dependency automation comes in Mission 12.
- Node comes from `.node-version` (`setup-node` with `node-version-file`). pnpm comes from the `packageManager` field (`pnpm/action-setup` with no version input). The pnpm store is cached through `setup-node`'s `cache: pnpm`. `HUSKY=0` turns off git hook setup during install (ADR 0024).
- Runner: `ubuntu-24.04`, pinned so the image does not change under us.
- Job `quality` (10-minute timeout): `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`.
- Job `e2e` (20-minute timeout, `needs: quality`): install, `playwright install --with-deps`, `pnpm test:e2e` (ADR 0026). The Playwright report is uploaded as an artifact when the job fails.
- The job names `quality` and `e2e` are fixed, because branch protection matches on them.
- Checkout uses `persist-credentials: false`, so the token is not left in the workspace.

Repository settings (set with `gh api` in Mission 4): squash merge only, merge commits and rebase merges disabled, branches deleted automatically after merge.

## Consequences

- A pull request cannot show green without lint, types, unit tests, a production build and E2E tests all passing on a clean machine.
- CI installs from the frozen lockfile, so a lockfile that does not match `package.json` fails the build.
- **Required checks are not enforced yet.** The repository is private on the GitHub Free plan, which does not support rulesets or branch protection on private repositories (the rulesets API answers 403 "Upgrade to GitHub Pro or make this repository public"). The intended ruleset on `main` is: require a pull request, require the `quality` and `e2e` checks with the branch up to date, require linear history, block force pushes and deletion, and allow no bypass actors. Until it exists, the rule is a process rule: the owner merges only when both jobs are green. Agents never merge (AGENTS.md).
- The repository stays private. Making it public only to get branch protection was rejected.
- The E2E job installs three browsers on every run and does not cache them. That costs about a minute and keeps the job simple.

## Revisit when

The account moves to GitHub Pro or higher, or the repository becomes public. Then create the ruleset described above. Also revisit if CI time makes pull requests slow, for example to cache browsers or run engines in parallel jobs.

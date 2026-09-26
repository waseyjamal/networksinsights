# 0049. Supply chain: updates, audits, licences and lockfile review

Status: Accepted
Date: 2026-09-24

Extends [ADR 0019](0019-supply-chain-policy.md) (exact versions, three-day minimum release age, build scripts denied) and [ADR 0017](0017-license-policy.md) (licence policy).

## Context

ADR 0019 made every install careful. Nothing made updates happen, found a known vulnerability in a package already installed, or checked a transitive dependency's licence. The repository is private on the GitHub Free plan, so GitHub's dependency-review action, which would do some of this, is not available (it needs GitHub Code Security or Advanced Security on a private repository).

## Decision

**Updates: Dependabot**, already used for GitHub Actions, and part of GitHub, so no third-party app gets write access.
- npm, weekly on Monday at 06:00 UTC.
- `cooldown: default-days: 3`, matching `minimumReleaseAge: 4320`, so a pull request is only opened for a version `pnpm install` will accept.
- `versioning-strategy: increase`, so exact pins stay exact.
- Minor and patch updates grouped into one pull request; each major on its own; at most five open.
- GitHub Actions get the same cooldown and one group.
- Caveat: Dependabot's pnpm 11 support was released as a beta in September 2026 (dependabot-core #14794). If a run fails on pnpm 11, the runbook covers moving to Renovate, which needs its GitHub App installed.
- Security updates come from Dependabot alerts, which the owner turns on. Cooldown does not delay them, but a fix younger than three days still fails `pnpm install`. The exception is in the runbook.

**Vulnerability gate: `pnpm audit --audit-level moderate`**, in the `supply-chain` job of `ci.yml`.
- It covers every installed package, dev and transitive, and reads the GitHub Advisory Database through the npm registry.
- It is built into the pinned pnpm, so it adds no tool. osv-scanner would add a binary to pin, and dependency-review is unavailable here.
- A registry error fails the job: an unanswered audit is not a passed one.
- `pnpm audit signatures` verifies every tarball's registry signature in the same job.
- `preview` and `deploy` wait for `supply-chain`.
- `.github/workflows/supply-chain.yml` runs the same checks on `main` every Monday, because advisories arrive for packages that have not changed.

**Licence gate: `pnpm check:licenses`** reads `pnpm licenses list --json`, which lists every installed package, dev and transitive.
- It evaluates SPDX expressions: OR needs one side allowed, AND needs both, and a `WITH` exception counts as the licence it extends.
- It fails on a licence outside the allowed set, and on a missing or unknown one.
- Allowed: MIT, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, Python-2.0, OFL-1.1, Unlicense.
- One exception, approved by the owner in Mission 12: `LGPL-3.0-or-later` for `@img/sharp-*` only. These are sharp's prebuilt libvips binaries, used unmodified at build time by Astro's image service and by Miniflare, and never shipped to a visitor.
- 363 packages pass today on the Windows development machine. CI checks its own Linux install, which lists the Linux platform packages instead.

**Lockfile review.** The `lockfile` job runs on every pull request that changes `pnpm-lock.yaml`.
- `scripts/lockfile-diff.ts` lists each workspace's direct dependency changes, then every package added, removed or updated anywhere in the tree.
- It flags a version whose integrity hash changed, which a genuine republish can never do.
- The result is posted as one pull-request comment, updated on each push, and written to the job summary.
- The job installs nothing: the script uses only Node built-ins and runs with plain `node`, so no third-party code runs while the job holds permission to comment.
- Dependabot pull requests can comment too: GitHub lets a workflow give their read-only token `pull-requests: write`.
- The lockfile does not record licences or build scripts. The licence gate covers licences, and pnpm 11 refuses an unlisted build script at install (`allowBuilds`, ADR 0019).

## Consequences

- Good: updates arrive on a schedule, already three days old, grouped so they are read rather than skimmed.
- Good: a known vulnerability or a disallowed licence anywhere in the tree stops the pipeline before a deploy.
- Good: a reviewer sees what a lockfile change really does without reading 5,000 lines of YAML.
- Cost: a new advisory can turn `main` red with no code change. That is intended; the runbook says what to do.
- Cost: `pnpm audit` depends on the registry being up. A registry outage blocks deploys until it is back.

## Revisit when

- The repository becomes public or gets Code Security: dependency-review can replace parts of this.
- Dependabot fails on pnpm 11 or 12: move to Renovate.
- A dependency needs a licence outside the set: an ADR, then a line in `scripts/lib/licenses.ts`.

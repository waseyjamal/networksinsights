# 0019. Supply-chain policy

Status: Accepted
Date: 2026-09-19

## Context

Dependencies are a supply-chain risk.

## Decision

Use exact versions only. Set a 3-day minimum release age (minimumReleaseAge: 4320 minutes in pnpm-workspace.yaml). Deny dependency build scripts by default. esbuild is denied, and build and check pass without it. Urgent security fixes may bypass the age rule only through an owner-approved exception.

## Consequences

New releases wait 3 days before they can be installed. Build scripts never run unless the owner approves.

## Revisit when

No trigger set.

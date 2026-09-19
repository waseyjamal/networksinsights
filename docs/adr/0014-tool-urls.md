# 0014. Tool URLs independent of category, with a redirects registry

Status: Accepted
Date: 2026-09-19

## Context

Categories can change, and no URL may ever return 404.

## Decision

A tool lives at /<tool-id> at the site root, independent of its category. Renames go through a redirects registry.

## Consequences

Moving a tool between categories never changes its URL. Build-time gates check URL uniqueness and reserved paths.

## Revisit when

No trigger set.

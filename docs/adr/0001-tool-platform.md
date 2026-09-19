# 0001. Tool platform

Status: Accepted
Date: 2026-09-19

## Context

The site starts at 500+ tools and grows without limit, so tools must be cheap to add and consistent.

## Decision

Every tool is one folder that follows one contract (docs/tool-contract.md).

## Consequences

Pages, listings, sitemap, search, structured data and other outputs are generated from the manifest. Build-time gates enforce the contract.

## Revisit when

The contract is finalized in Mission 8.

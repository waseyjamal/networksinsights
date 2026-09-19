# 0009. pnpm 11 workspaces monorepo

Status: Accepted
Date: 2026-09-19

## Context

The repository holds the web app now and shared packages later.

## Decision

Use a pnpm 11 workspaces monorepo with apps/* and packages/*.

## Consequences

Shared packages (tool SDK, UI) can be added under packages/* without restructuring.

## Revisit when

No trigger set.

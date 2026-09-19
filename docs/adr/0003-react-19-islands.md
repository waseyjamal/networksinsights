# 0003. React 19 for islands

Status: Accepted
Date: 2026-09-19

## Context

Islands need a UI library.

## Decision

Use React 19 for islands. It has the largest ecosystem, and its runtime is cached across tool pages.

## Consequences

React is loaded only where an island needs it. Tool logic stays free of React imports.

## Revisit when

No trigger set.

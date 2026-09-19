# 0013. AI fallback chain with rate limits and a spending cap

Status: Accepted
Date: 2026-09-19

## Context

Some tools use AI, and server AI costs money.

## Decision

Try built-in browser AI first, then an in-browser model (WebGPU/WASM), then server AI. Server AI has per-user rate limits and a hard daily spending cap.

## Consequences

Most AI work can stay on the device. Server AI spending cannot exceed the daily cap.

## Revisit when

No trigger set.

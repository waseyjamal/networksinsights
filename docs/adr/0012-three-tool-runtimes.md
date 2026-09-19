# 0012. Three tool runtimes: browser, worker, server

Status: Accepted
Date: 2026-09-19

## Context

Tools differ in weight and in whether they can run on the user's device.

## Decision

Every tool declares one runtime: client (browser), worker (Web Worker) or server.

## Consequences

The manifest carries the runtime. Tool logic stays pure TypeScript so it can run in any of the three.

## Revisit when

No trigger set.

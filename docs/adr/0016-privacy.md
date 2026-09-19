# 0016. Privacy: process files on the user's device

Status: Accepted
Date: 2026-09-19

## Context

Tools handle user files.

## Decision

Process files on the user's device whenever possible.

## Consequences

Tools prefer the client and worker runtimes. The server runtime is used only when the work cannot run on the device.

## Revisit when

No trigger set.

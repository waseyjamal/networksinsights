// The tests read their fixtures with Vite's import.meta.glob, which Vitest provides. Only the
// piece of its type that the tests use is declared, so the SDK needs no dependency on Vite.

interface ImportMeta {
  glob<T = unknown>(
    pattern: string | readonly string[],
    options?: { eager?: boolean; query?: string; import?: string },
  ): Record<string, T>;
}

// Two globals that every runtime has and the ES library does not describe. Only the tests use
// them, to print a timing; nothing in the SDK's own code may.
declare const performance: { now(): number };
declare const console: { log(...data: unknown[]): void };

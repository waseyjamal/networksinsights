// Gives `tsc` an input while tools/ is empty, and declares nothing else. Every tool folder under
// tools/<category>/<tool>/ is type-checked by `pnpm typecheck`, which is the only place a tool's
// ui.tsx is checked, because `astro check` covers apps/web alone.
export {};

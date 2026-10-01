// Gives `tsc` an input while tools/ is empty, and the one type tools share. Every tool folder under
// tools/<category>/<tool>/ is type-checked by `pnpm typecheck`, which is the only place a tool's
// ui.tsx is checked, because `astro check` covers apps/web alone. It has no import or export, so
// the declaration below is global.

// A file a tool loads by URL on demand, such as a model or a .wasm file: the bundler emits it as a
// hashed file under /_astro/ and the import is its URL (ADR 0057).
declare module "*?url" {
  const url: string;
  export default url;
}

// Where PDF.js finds its data files on this site (ADR 0057). The route
// `pages/vendor/pdfjs/[...path].ts` copies them; PDF to JPG passes these URLs to PDF.js.

/** Matches `pdfjs-dist` in tools/package.json. A test keeps the two in step. */
export const PDFJS_VERSION = "6.3.289";

export const PDFJS_BASE = `/vendor/pdfjs/${PDFJS_VERSION}/`;

/** The folders copied, and which files of each. LICENSE files always go with their folder. */
export const PDFJS_VENDOR_FOLDERS = [
  { folder: "wasm", include: /^(openjpeg\.wasm|jbig2\.wasm|qcms_bg\.wasm|LICENSE_[A-Z0-9_]+)$/ },
  { folder: "standard_fonts", include: /^([A-Za-z-]+\.(pfb|ttf)|LICENSE_[A-Z0-9_]+)$/ },
  { folder: "cmaps", include: /^([A-Za-z0-9-]+\.bcmap|LICENSE)$/ },
  { folder: "iccs", include: /^([A-Za-z0-9-]+\.icc|LICENSE)$/ },
] as const;

/** The name a file is served under: LICENSE files get `.txt`, so a browser shows them as text. */
export function publishedName(name: string): string {
  return /(^|\/)LICENSE[A-Z0-9_]*$/.test(name) ? `${name}.txt` : name;
}

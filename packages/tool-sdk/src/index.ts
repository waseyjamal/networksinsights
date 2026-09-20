// @networksinsights/tool-sdk — the tool contract, as code.
//
// Pure TypeScript and Zod. No React, no Astro, no DOM: a tool's manifest and logic must be
// readable from the browser, a Web Worker and a server alike (ADR 0031, docs/tool-contract.md).

export { checkContent, outlineContent, REQUIRED_SECTIONS } from "./content";
export { ISLAND_SOURCE, normalizeSource, OPTIONAL_FILES, REQUIRED_FILES } from "./files";
export {
  defineTool,
  ISO_DATE,
  KEBAB_CASE,
  SUMMARY_MAX_LENGTH,
  toolLimitsSchema,
  toolManifestSchema,
} from "./manifest";
export { type PrivacyStatement, privacyStatement, privacyStatements } from "./privacy";
export {
  ALLOWED_GLOBALS,
  ALLOWED_IMPORTS,
  BANNED_GLOBALS,
  BANNED_IMPORT_EXTENSIONS,
} from "./purity";
export type { IsoDate, ToolLimits, ToolManifest, ToolRuntime, ToolStatus } from "./types";
export {
  type ContractViolation,
  formatViolation,
  ToolContractError,
  type ToolEntry,
  type ValidateOptions,
  validateTools,
} from "./validate";

// @networksinsights/tool-sdk — the tool contract, as code.
//
// Pure TypeScript and Zod. No React, no Astro, no DOM: a tool's manifest and logic must be
// readable from the browser, a Web Worker and a server alike (ADR 0031, docs/tool-contract.md).

export {
  BUDGET_REASON_MIN_LENGTH,
  DEFAULT_INITIAL_JS_KB,
  DEFAULT_ON_DEMAND_JS_KB,
  INITIAL_JS_CEILING_KB,
  ON_DEMAND_JS_CEILING_KB,
  type ResolvedBudget,
  resolveBudget,
} from "./budget";
export {
  type ContentParts,
  type ContentSection,
  checkContent,
  outlineContent,
  REQUIRED_SECTIONS,
  readContent,
} from "./content";
export {
  DOWNLOAD_TYPES,
  FALLBACK_TYPE,
  MAX_FILENAME_BYTES,
  mimeTypeFor,
  safeFilename,
} from "./download";
export {
  describeLimits,
  formatBytes,
  formatIsoDate,
  NO_FIXED_LIMIT,
  type QuickFact,
  type QuickFactId,
  type QuickFactsSource,
  quickFacts,
} from "./facts";
export { type FaqEntry, faqPairs, toPlainText } from "./faq";
export { ISLAND_SOURCE, normalizeSource, OPTIONAL_FILES, REQUIRED_FILES } from "./files";
export {
  defineTool,
  FORMAT_NAME,
  ISO_DATE,
  KEBAB_CASE,
  SUMMARY_MAX_LENGTH,
  toolBudgetSchema,
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
export * from "./quality";
export {
  EXTENDABLE_DIRECTIVES,
  type ExtendableDirective,
  HTTPS_ORIGIN,
  overrideDirectives,
  overrideMarker,
  toolSecuritySchema,
} from "./security";
export type {
  IsoDate,
  ToolBudget,
  ToolLimits,
  ToolManifest,
  ToolRuntime,
  ToolSecurity,
  ToolStatus,
} from "./types";
export {
  type ContractViolation,
  formatViolation,
  indentMessage,
  ToolContractError,
  type ToolEntry,
  type ValidateOptions,
  validateTools,
} from "./validate";

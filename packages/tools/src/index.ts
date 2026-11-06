/**
 * @factlot/tools — the FactLot tool catalog and native tool definitions for every major AI platform.
 *
 * ```ts
 * import { anthropicTools, runTool } from "@factlot/tools";
 * const response = await client.messages.create({ ..., tools: anthropicTools() });
 * // for each tool_use block:
 * const outcome = runTool(block.name, block.input); // { ok, result } | { ok: false, error }
 * ```
 */
export * from "./catalog.ts";
export * from "./providers.ts";
export * from "./registry.ts";
export * from "./limits.ts";
export {
  DOC_LIMITS,
  REVIEW_CONFIDENCE_THRESHOLD,
  factId,
  validateFact,
} from "./documents.ts";
export { PREDICATES as INGEST_PREDICATES } from "./quotes.ts";
export { describePredicate, predicateCatalog } from "./predicates.ts";
export {
  PACKAGE_FORMAT,
  PACKAGE_VERSION,
  SIGNING_PREFIX,
  canonicalJson,
  leafHash,
  merkleRoot,
  signFactPackage,
} from "./packages.ts";
export { CHARTS, USE_CATEGORIES, vocabularyDocuments } from "./vocabularies.ts";
export type {
  Chart,
  ChartCategory,
  ChartSection,
  ChartTotal,
  UseCategory,
} from "./vocabularies.ts";

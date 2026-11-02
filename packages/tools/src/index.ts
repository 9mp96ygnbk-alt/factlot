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

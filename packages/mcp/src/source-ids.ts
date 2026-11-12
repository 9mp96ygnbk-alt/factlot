// No imports: scripts/mcp/gen-resources.ts uses this without loading the MCP server.

/**
 * The catalog source a registry source id belongs to: itself, or the longest catalog id it extends
 * (a snapshot of another roll year or file of one source, such as tx-brazos-cad-2016).
 */
export function catalogSourceId(
  ids: readonly string[],
  id: string,
): string | undefined {
  if (ids.includes(id)) return id;
  return ids
    .filter((x) => id.startsWith(`${x}-`))
    .sort((a, b) => b.length - a.length)[0];
}

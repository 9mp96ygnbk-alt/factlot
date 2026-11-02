/**
 * @factlot/mcp — FactLot as an MCP server for any MCP-capable agent.
 *
 * Registers every tool in the FactLot catalog (calculators, IDs, fact validation),
 * plus `search` / `fetch` over a built-in knowledge base (required by ChatGPT deep
 * research and company knowledge) and `schema_get`. Transport-agnostic: use stdio
 * (bin) locally, or Streamable HTTP via @factlot/server for remote connectors.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { jsonSchemas } from "@factlot/schema";
import { registryPath, runTool, tools } from "@factlot/tools";
import { z } from "zod";

import { fetchDoc, searchCorpus } from "./knowledge.ts";

export { corpus, fetchDoc, searchCorpus } from "./knowledge.ts";
export type { KnowledgeDoc } from "./knowledge.ts";

export const SERVER_NAME = "factlot";
export const SERVER_VERSION = "0.1.0";

export const SERVER_INSTRUCTIONS =
  "FactLot tools for commercial real estate. Use calc_* tools for ALL lease, CAM, rent, loan, and return math instead of computing in-context; cite the returned formula id and steps and surface warnings. Use id_* tools to produce canonical FactLot IDs for parcels, legal entities, spaces, and documents so records join across systems. Use fact_validate before emitting facts. Use search/fetch to find which tool or predicate fits a task.";

function json(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

export interface CreateServerOptions {
  /** Register registry_* tools. Default: only when a registry is configured (FACTLOT_REGISTRY_DB). */
  registry?: boolean;
}

export function createServer(opts: CreateServerOptions = {}): McpServer {
  const withRegistry = opts.registry ?? registryPath() !== undefined;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const tool of tools) {
    if (tool.requires === "registry" && !withRegistry) continue;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { ...READ_ONLY, title: tool.title },
      },
      (args: unknown): CallToolResult => {
        const outcome = runTool(tool.name, args);
        if (outcome.ok) return json(outcome.result);
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify(outcome.error, null, 2) },
          ],
        };
      },
    );
  }

  // ChatGPT deep research / company knowledge contract: results as a JSON string in one text item.
  server.registerTool(
    "search",
    {
      title: "Search FactLot knowledge",
      description:
        "Search FactLot's knowledge base (tools, inputs, CRE predicates, ID and fact specifications). Returns matching document ids, titles, and URLs; call fetch for full text.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "What you are looking for, e.g. 'CAM cap non-cumulative' or 'loan sizing DSCR'.",
          ),
      },
      annotations: { ...READ_ONLY, title: "Search FactLot knowledge" },
    },
    ({ query }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: searchCorpus(query).map((d) => ({
              id: d.id,
              title: d.title,
              url: d.url,
            })),
          }),
        },
      ],
    }),
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch a FactLot knowledge document",
      description:
        "Fetch the full text of a FactLot knowledge document by the id returned from search.",
      inputSchema: {
        id: z
          .string()
          .describe(
            "Document id from search, e.g. tool:calc_cam_reconciliation.",
          ),
      },
      annotations: {
        ...READ_ONLY,
        title: "Fetch a FactLot knowledge document",
      },
    },
    ({ id }) => {
      const doc = fetchDoc(id);
      if (!doc) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "NotFound",
                message: `no document "${id}"`,
              }),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(doc) }] };
    },
  );

  server.registerTool(
    "schema_get",
    {
      title: "FactLot JSON Schemas",
      description:
        "Return the FactLot data model (Fact, Provenance, SourceRef, Rights, Relationship) as JSON Schema.",
      inputSchema: {},
      annotations: { ...READ_ONLY, title: "FactLot JSON Schemas" },
    },
    () => json(jsonSchemas()),
  );

  return server;
}

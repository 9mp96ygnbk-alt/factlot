/**
 * @factlot/mcp — FactLot as an MCP server for any MCP-capable agent.
 *
 * Registers every tool in the FactLot catalog (calculators, IDs, fact validation),
 * plus `search` / `fetch` over a built-in knowledge base (required by ChatGPT deep
 * research and company knowledge) and `schema_get`. Transport-agnostic: use stdio
 * (bin) locally, or Streamable HTTP via @factlot/server for remote connectors.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { jsonSchemas } from "@factlot/schema";
import {
  RegistryUnavailableError,
  registryAvailable,
  registrySnapshot,
  runToolAsync,
  tools,
} from "@factlot/tools";
import { z } from "zod";

import { NO_MATCH_NOTE, fetchDoc, searchCorpus } from "./knowledge.ts";
import { LOCAL_TOOL_SPECS } from "./local.ts";

export { NO_MATCH_NOTE, corpus, fetchDoc, searchCorpus } from "./knowledge.ts";
export { LOCAL_TOOLS } from "./local.ts";
export type { KnowledgeDoc } from "./knowledge.ts";

export const SERVER_NAME = "factlot";
export const SERVER_VERSION = "0.5.0";

/** The Texas unequal-appraisal recipe, in order, for agents that see the whole tool list at once. */
export const TX_PACKET_INSTRUCTIONS = [
  "Texas unequal-appraisal packet, in order:",
  "1 registry_resolve_parcel (county_fips, apn) or registry_search_address gives the parcel URN.",
  "2 registry_get gives cited facts and value_history by tax year.",
  "3 registry_tx_equity_candidates lists candidates under FactLot's default rule (see selection_rule) for the person to review and edit; FactLot does not select comparables.",
  "4 calc_tx_unequal_appraisal with the reviewed calc_args (normalize_by improvement_area_sf when areas differ; adjustments only with evidence); relay flags and warnings.",
  "5 rules_tx_property_tax_protest_deadline (tax_year, notice_delivered_date if known): status says open or passed as of today; next_season gives the next year.",
  "6 report_create kind tx_unequal_appraisal with the step 4 arguments: pdf (evidence packet) or xlsx (adjustment grid).",
  "calc_critical_dates and its ICS calendar are for lease notice windows, not protests.",
].join("\n");

/** Rules that hold for every tool. */
export const GENERAL_INSTRUCTIONS =
  "Results are facts and arithmetic, not appraisal, legal or tax advice. Relay every warning and each source's rights (ai_use, redistribution) to the person. Registry lookups and reports are metered (account_usage shows use, with a key); input errors are free.";

export const SERVER_INSTRUCTIONS = [
  "FactLot: commercial real estate (CRE) tools with deterministic, cited results. Covers net effective rent, rent schedules, CAM reconciliation, debt sizing (DSCR, LTV, debt yield), loan amortization, yield maintenance and defeasance, ASC 842 lease remeasurement, WALT, NPV, IRR, DCF pro forma, direct capitalization (cap rate), LP/GP equity waterfalls, 1031 exchange deadlines, hotel RevPAR and ADR, multifamily rent rolls, lease critical dates, lease abstract verification, GSA lease comps, Texas property tax protest deadlines, Texas unequal-appraisal arithmetic, and parcel and owner IDs. Use calc_* tools for this math instead of computing in context; cite the returned formula ID and steps, and surface every warning. To read a lease or other document, extract each value with its verbatim quote and page, then call doc_verify_facts (doc_abstract_lease for a lease and its amendments, doc_compare for an estoppel or rent roll, doc_verify_claim for one claim, doc_spread_statement for a T-12, doc_check_use_conflict for exclusives); FactLot checks each value against its quote and returns cited facts. Use id_* for canonical IDs of parcels, entities, buildings, spaces and documents, rules_* for statutory deadlines, lease_comp_search for comps, and fact_validate or fact_package_create before handing facts on. For a Texas unequal-appraisal comparison, registry_tx_equity_candidates lists candidate parcels from the subject's appraisal district roll (calc_args is that list in the calculator's input shape, for the person to review and edit), and calc_tx_unequal_appraisal does the arithmetic on the comparables and adjustments the person chose. registry_coverage lists the regions the hosted registry holds and is never metered: call it before a registry lookup. Use search and fetch to find the right tool.",
  TX_PACKET_INSTRUCTIONS,
  GENERAL_INSTRUCTIONS,
].join("\n\n");

function json(data: unknown): CallToolResult {
  // structuredContent plus the same JSON as text: the MCP spec (2025-06-18) asks a tool that
  // returns structured content to also return it serialized in a text block, for clients that
  // read only text.
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

interface ErrorObject {
  error: string;
  message: string;
  issues: { path: string; message: string }[];
  coverage?: unknown;
}

/** The REST error object (error, message, issues) as an MCP tool error. */
function toolError(error: ErrorObject): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(error, null, 2) }],
  };
}

type Handler = (args: unknown) => CallToolResult | Promise<CallToolResult>;

/** Validate a non-catalog tool's arguments, reporting failures as the catalog does. */
function validated<S extends z.ZodType>(
  schema: S,
  run: (args: z.output<S>) => CallToolResult | Promise<CallToolResult>,
): Handler {
  return (args) => {
    const parsed = schema.safeParse(args ?? {});
    if (parsed.success) return run(parsed.data);
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    return toolError({
      error: "InputError",
      message: `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`,
      issues,
    });
  };
}

const SearchInput = z.object({
  query: z
    .string()
    .max(500)
    .describe(
      "What you are looking for, e.g. 'CAM cap non-cumulative' or 'loan sizing DSCR'.",
    ),
});
const FetchInput = z.object({
  id: z
    .string()
    .max(200)
    .describe(
      "Document id from search, e.g. tool:calc_cam_reconciliation, or a registry source snapshot's FactLot document ID (fl:document:sha256-…) when a registry is loaded.",
    ),
});

const DOCUMENT_ID = /^fl:document:sha256-[a-f0-9]{64}$/;

/** `fetch` of a registry source snapshot: its source, URL, dates, licence and size. */
function fetchSnapshot(id: string): CallToolResult {
  let snap: Record<string, unknown> | null;
  try {
    snap = registrySnapshot(id);
  } catch (err) {
    if (!(err instanceof RegistryUnavailableError)) throw err;
    return toolError({
      error: "RegistryUnavailable",
      message: `"${id}" is a FactLot document ID; fetch returns the source snapshot behind it only when this server has a FactLot Registry loaded, and this one has none. ${err.message}`,
      issues: [],
    });
  }
  if (!snap)
    return toolError({
      error: "NotFound",
      message: `no source snapshot "${id}" in this registry: fetch finds the source files the registry cites (the document_id of a registry fact). A document ID from id_document is a hash of your own file, which FactLot does not store`,
      issues: [],
    });
  const title = `${String(snap.publisher)}: ${String(snap.title)}${snap.filename ? ` (${String(snap.filename)})` : ""}`;
  const metadata: Record<string, string> = {
    kind: "source_snapshot",
    source_id: String(snap.source_id),
    publisher: String(snap.publisher),
    retrieved_at: String(snap.retrieved_at),
    as_of: String(snap.as_of),
    license: String(snap.license),
    ai_use: String(snap.ai_use),
    redistribution: String(snap.redistribution),
  };
  if (snap.filename) metadata.filename = String(snap.filename);
  if (snap.bytes !== null && snap.bytes !== undefined)
    metadata.bytes = String(snap.bytes);
  if (snap.attribution) metadata.attribution = String(snap.attribution);
  const text = [
    `Source snapshot ${id}: the exact file the FactLot Registry read, identified by the SHA-256 of its bytes.`,
    `Publisher: ${metadata.publisher}. Dataset: ${String(snap.title)}. Source URL: ${String(snap.url)}.`,
    `File: ${metadata.filename ?? "(not recorded)"}, ${metadata.bytes ?? "unknown"} bytes, retrieved ${metadata.retrieved_at}; the data is as of ${metadata.as_of}.`,
    `License: ${metadata.license}. AI use: ${metadata.ai_use}. Redistribution: ${metadata.redistribution}.${metadata.attribution ? ` Attribution: ${metadata.attribution}.` : ""}`,
  ].join("\n");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          id,
          title,
          url: String(snap.url),
          text,
          metadata,
        }),
      },
    ],
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

export interface CreateServerOptions {
  /**
   * Register registry_* tools. Default: only when a registry is available: a registry file
   * (FACTLOT_REGISTRY_DB) or the registry service the hosted API attaches.
   */
  registry?: boolean;
  /**
   * Register the tools that read files on this machine (doc_read_pdf, fact_package_sign). Only the
   * local stdio server sets this; a remote server never reads its own files for a caller.
   */
  localFiles?: boolean;
}

export function createServer(opts: CreateServerOptions = {}): McpServer {
  const withRegistry = opts.registry ?? registryAvailable();
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  // Every call goes through these, with the arguments as sent (see the tools/call handler below).
  const handlers = new Map<string, Handler>();

  for (const tool of tools) {
    if (tool.requires === "registry" && !withRegistry) continue;
    // runToolAsync, so tools that verify signatures with WebCrypto (fact_package_verify) run too.
    const handler = async (args: unknown): Promise<CallToolResult> => {
      let outcome: Awaited<ReturnType<typeof runToolAsync>>;
      try {
        outcome = await runToolAsync(tool.name, args);
      } catch {
        // A bug, not bad input: report it without the message, which can carry internals.
        return toolError({
          error: "InternalError",
          message: "unexpected error",
          issues: [],
        });
      }
      return outcome.ok ? json(outcome.result) : toolError(outcome.error);
    };
    handlers.set(tool.name, handler);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { ...READ_ONLY, title: tool.title },
      },
      handler,
    );
  }

  // Tools that read files on this machine: the local stdio server only.
  if (opts.localFiles)
    for (const spec of LOCAL_TOOL_SPECS) {
      const handler = validated(
        spec.input as z.ZodType,
        spec.run as (args: unknown) => Promise<CallToolResult>,
      );
      handlers.set(spec.name, handler);
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: spec.input.shape,
          annotations: { ...READ_ONLY, title: spec.title },
        },
        handler,
      );
    }

  // ChatGPT deep research / company knowledge contract: results as a JSON string in one text item.
  const search = validated(SearchInput, ({ query }) => {
    const results = searchCorpus(query).map((d) => ({
      id: d.id,
      title: d.title,
      url: d.url,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            results.length ? { results } : { results, note: NO_MATCH_NOTE },
          ),
        },
      ],
    };
  });
  handlers.set("search", search);
  server.registerTool(
    "search",
    {
      title: "Search FactLot knowledge",
      description:
        "Search FactLot's knowledge base (tools, inputs, CRE predicates, ID and fact specifications). Returns matching document ids, titles, and URLs; call fetch for full text. A query on a subject the knowledge base does not cover returns no results and a note.",
      inputSchema: SearchInput.shape,
      annotations: { ...READ_ONLY, title: "Search FactLot knowledge" },
    },
    search,
  );

  const fetchTool = validated(FetchInput, ({ id }) => {
    if (DOCUMENT_ID.test(id)) return fetchSnapshot(id);
    const doc = fetchDoc(id);
    if (!doc)
      return toolError({
        error: "NotFound",
        message: `no document "${id}": use an id from search (tool:…, predicates:…, spec:…, guide:…), or a registry source snapshot's fl:document:sha256-… ID`,
        issues: [],
      });
    return { content: [{ type: "text", text: JSON.stringify(doc) }] };
  });
  handlers.set("fetch", fetchTool);
  server.registerTool(
    "fetch",
    {
      title: "Fetch a FactLot knowledge document",
      description:
        "Fetch the full text of a FactLot knowledge document by the id returned from search. With a registry loaded, a registry fact's source document_id (fl:document:sha256-…) returns that source snapshot: publisher, dataset, URL, retrieval date, as-of date, licence, AI-use and redistribution rights, file name and size.",
      inputSchema: FetchInput.shape,
      annotations: {
        ...READ_ONLY,
        title: "Fetch a FactLot knowledge document",
      },
    },
    fetchTool,
  );

  const schemaGet = validated(z.object({}), () => json(jsonSchemas()));
  handlers.set("schema_get", schemaGet);
  server.registerTool(
    "schema_get",
    {
      title: "FactLot JSON Schemas",
      description:
        "Return the FactLot data model (Fact, Provenance, SourceRef, Rights, Relationship) as JSON Schema.",
      inputSchema: {},
      annotations: { ...READ_ONLY, title: "FactLot JSON Schemas" },
    },
    schemaGet,
  );

  // tools/call: McpServer validates arguments against the zod schema before a handler runs and
  // reports a failure as plain text ("MCP error -32602: Input validation error: ..."). FactLot
  // validates every call itself (runTool, as REST does), so this handler takes over tools/call and
  // passes the arguments through unchanged: an input error comes back as the REST error object
  // {error, message, issues} with isError, like every other error. McpServer still answers
  // tools/list from the registrations above.
  server.server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers.get(name);
    if (!handler)
      return toolError({
        error: "UnknownTool",
        message: `no FactLot tool named "${name}"`,
        issues: [],
      });
    return handler(args ?? {});
  });

  return server;
}

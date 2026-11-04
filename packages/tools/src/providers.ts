/**
 * Native tool definitions for each major AI platform, all derived from one catalog.
 *
 * Schemas are hints for the model; FactLot validates every call on the server side
 * (`runTool`). So where a platform accepts only a subset of JSON Schema (Gemini,
 * OpenAPI 3.0), we loosen the schema rather than drop a tool — correctness still holds.
 */
import { CATALOG_VERSION, inputJsonSchema, tools } from "./catalog.ts";
import type { ToolSpec } from "./catalog.ts";

type Json = Record<string, unknown>;

function list(filter?: (t: ToolSpec) => boolean): readonly ToolSpec[] {
  return filter ? tools.filter(filter) : tools;
}

/** Claude Messages API `tools` (also Claude on Bedrock/Vertex/Foundry via the Anthropic SDKs). */
export function anthropicTools(filter?: (t: ToolSpec) => boolean): Json[] {
  return list(filter).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputJsonSchema(t),
  }));
}

/** OpenAI Chat Completions `tools` — also Mistral, xAI, DeepSeek, Groq, Together, and other OpenAI-compatible APIs. */
export function openaiChatTools(filter?: (t: ToolSpec) => boolean): Json[] {
  return list(filter).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: inputJsonSchema(t),
    },
  }));
}

/** OpenAI Responses API `tools` (flat function shape). */
export function openaiResponsesTools(
  filter?: (t: ToolSpec) => boolean,
): Json[] {
  return list(filter).map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: inputJsonSchema(t),
    strict: false,
  }));
}

/** Amazon Bedrock Converse API `toolConfig` (works for every tool-capable Bedrock model). */
export function bedrockConverseToolConfig(
  filter?: (t: ToolSpec) => boolean,
): Json {
  return {
    tools: list(filter).map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: inputJsonSchema(t) },
      },
    })),
  };
}

/** Google Gemini `tools` entry: `{ functionDeclarations: [...] }` with a conservative schema subset. */
export function geminiTools(filter?: (t: ToolSpec) => boolean): Json {
  return {
    functionDeclarations: list(filter).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiSchema(inputJsonSchema(t)),
    })),
  };
}

// --- schema transforms -------------------------------------------------------------------

function mapSchema(s: unknown, fn: (node: Json) => Json): unknown {
  if (Array.isArray(s)) return s.map((x) => mapSchema(x, fn));
  if (!s || typeof s !== "object") return s;
  const node: Json = {};
  for (const [k, v] of Object.entries(s as Json)) {
    if (k === "properties" && v && typeof v === "object") {
      node[k] = Object.fromEntries(
        Object.entries(v as Json).map(([pk, pv]) => [pk, mapSchema(pv, fn)]),
      );
    } else if (
      k === "items" ||
      k === "anyOf" ||
      k === "oneOf" ||
      k === "allOf" ||
      k === "additionalProperties"
    ) {
      node[k] = mapSchema(v, fn);
    } else {
      node[k] = v;
    }
  }
  return fn(node);
}

/** JSON Schema 2020-12 → OpenAPI 3.0 Schema Object. */
export function toOpenApi30Schema(schema: unknown): Json {
  return mapSchema(schema, (n) => {
    const out: Json = { ...n };
    delete out.$schema;
    // Not in the OpenAPI 3.0 Schema Object; JSON object keys are strings anyway.
    delete out.propertyNames;
    if (typeof out.exclusiveMinimum === "number") {
      out.minimum = out.exclusiveMinimum;
      out.exclusiveMinimum = true;
    }
    if (typeof out.exclusiveMaximum === "number") {
      out.maximum = out.exclusiveMaximum;
      out.exclusiveMaximum = true;
    }
    if ("const" in out) {
      out.enum = [out.const];
      delete out.const;
    }
    if (Array.isArray(out.type)) {
      const types = (out.type as string[]).filter((x) => x !== "null");
      if (types.length !== (out.type as string[]).length) out.nullable = true;
      if (types.length === 1) {
        out.type = types[0];
      } else {
        delete out.type;
        out.anyOf = types.map((type) => ({ type }));
      }
    }
    if (
      out.additionalProperties &&
      typeof out.additionalProperties === "object" &&
      Object.keys(out.additionalProperties).length === 0
    ) {
      out.additionalProperties = true;
    }
    return out;
  }) as Json;
}

const GEMINI_KEYS = new Set([
  "type",
  "format",
  "description",
  "nullable",
  "enum",
  "properties",
  "required",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
]);
const GEMINI_FORMATS = new Set([
  "enum",
  "date-time",
  "int32",
  "int64",
  "float",
  "double",
]);

/** OpenAPI-3.0-style subset accepted by Gemini function declarations. */
export function toGeminiSchema(schema: unknown): Json {
  const oa = toOpenApi30Schema(schema);
  return mapSchema(oa, (n) => {
    const out: Json = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === "oneOf") out.anyOf = v;
      else if (GEMINI_KEYS.has(k)) out[k] = v;
    }
    if (typeof out.format === "string" && !GEMINI_FORMATS.has(out.format)) {
      if (out.format === "date") {
        out.description = [out.description, "Format: YYYY-MM-DD."]
          .filter(Boolean)
          .join(" ");
      }
      delete out.format;
    }
    // Gemini keeps only inclusive bounds and drops defaults, so say what was lost in words:
    // otherwise a rate "< 1" reads as "maximum 1" and the model never learns a default.
    const notes: string[] = [];
    if (n.exclusiveMinimum === true && typeof n.minimum === "number")
      notes.push(`Must be greater than ${n.minimum}.`);
    if (n.exclusiveMaximum === true && typeof n.maximum === "number")
      notes.push(`Must be less than ${n.maximum}.`);
    if (n.default !== undefined)
      notes.push(`Default: ${JSON.stringify(n.default)}.`);
    if (notes.length)
      out.description = [out.description, ...notes].filter(Boolean).join(" ");
    if (out.type === "object" && !out.properties) {
      // Free-form objects (e.g. fact_validate.fact) need at least a type in Gemini.
      out.description = [out.description, "Free-form JSON object."]
        .filter(Boolean)
        .join(" ");
    }
    return out;
  }) as Json;
}

// --- OpenAPI -----------------------------------------------------------------------------

export interface OpenApiOptions {
  /** Public base URL of a FactLot server, e.g. https://api.factlot.com */
  serverUrl?: string;
  /**
   * Tools to include. Default: every tool except registry_* ones, which work only on a server
   * with a registry loaded (a server with one passes its own filter).
   */
  filter?: (t: ToolSpec) => boolean;
  /**
   * "gpt_actions": only the tools in GPT_ACTIONS_TOOLS (at most 30 operations, the Custom GPT
   * Actions limit), still subject to `filter`. "all": every tool `filter` keeps.
   * Default: "gpt_actions" for openApi30, "all" for openApi31.
   */
  operations?: "gpt_actions" | "all";
}

/** Custom GPT Actions accept at most this many operations in one OpenAPI document. */
export const GPT_ACTIONS_MAX_OPERATIONS = 30;

/**
 * The curated Custom GPT Actions subset, which the OpenAPI 3.0 document lists by default: the
 * most-used tools (live review usage, 2026-11) and the valuation calculators, with registry
 * lookups that appear only on a server with a registry. Every other tool stays in the OpenAPI
 * 3.1 document and over MCP. Keep at most GPT_ACTIONS_MAX_OPERATIONS names (a test enforces it,
 * and that connectors/chatgpt/README.md lists them); adding one means dropping one.
 */
export const GPT_ACTIONS_TOOLS: readonly string[] = [
  "calc_rent_schedule",
  "calc_net_effective_rent",
  "calc_compare_proposals",
  "calc_percentage_rent",
  "calc_cam_reconciliation",
  "calc_debt_sizing",
  "calc_lease_remeasurement_asc842",
  "calc_walt",
  "calc_npv",
  "calc_irr",
  "calc_renew_vs_relocate",
  "calc_hotel_metrics",
  "calc_dcf_pro_forma",
  "calc_direct_cap",
  "calc_amortization_schedule",
  "calc_equity_waterfall",
  "calc_exchange_1031",
  "calc_multifamily_rent_roll",
  "calc_cam_reconciliation_batch",
  "rules_tx_property_tax_protest_deadline",
  "id_parcel",
  "id_space",
  "id_document",
  "fact_validate",
  "doc_verify_facts",
  "doc_abstract_lease",
  "registry_search_address",
  "registry_get",
  "registry_search_entities",
  "registry_resolve_parcel",
];

const withoutRegistry = (t: ToolSpec): boolean => t.requires !== "registry";

const ERROR_SCHEMA: Json = {
  type: "object",
  properties: {
    error: {
      type: "string",
      description: "CalcInputError, FactLotIdError, InputError, or UnknownTool",
    },
    message: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, message: { type: "string" } },
      },
    },
  },
  required: ["error", "message"],
};

function openApi(
  version: "3.1.0" | "3.0.3",
  opts: OpenApiOptions,
  defaultOperations: "gpt_actions" | "all",
): Json {
  const convert = version === "3.0.3" ? toOpenApi30Schema : (s: Json) => s;
  const subset = (opts.operations ?? defaultOperations) === "gpt_actions";
  const filter = opts.filter ?? withoutRegistry;
  const included = list(
    (t) => filter(t) && (!subset || GPT_ACTIONS_TOOLS.includes(t.name)),
  );
  const paths: Json = {};
  for (const t of included) {
    paths[t.path] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        "x-openai-isConsequential": false,
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: convert(inputJsonSchema(t)) },
          },
        },
        responses: {
          "200": {
            description: t.formula
              ? "Result: { value, formula, steps, warnings, provenance }."
              : "Result object.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": {
            description:
              "Invalid input; read `issues`, fix the arguments, and retry.",
            content: { "application/json": { schema: convert(ERROR_SCHEMA) } },
          },
        },
      },
    };
  }
  const base = opts.serverUrl?.replace(/\/+$/, "") ?? "";
  const description = [
    "The open fact layer for commercial real estate AI agents: deterministic CRE calculators with audit trails, canonical FactLot IDs, and cited-fact validation. Call these operations instead of doing lease, CAM, rent, loan, or return math yourself.",
    ...(subset
      ? [
          `This document is the curated Custom GPT Actions subset: ${included.length} of the ${list(filter).length} operations (Actions accept at most ${GPT_ACTIONS_MAX_OPERATIONS}). Every tool is in the OpenAPI 3.1 document (${base}/openapi.json) and over MCP (${base}/mcp); ${base}/openapi-3.0.json?operations=all is the complete OpenAPI 3.0 document.`,
        ]
      : []),
  ].join(" ");
  return {
    openapi: version,
    info: {
      title: "FactLot",
      version: CATALOG_VERSION,
      description,
    },
    servers: [{ url: opts.serverUrl ?? "https://YOUR-FACTLOT-SERVER" }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Only if the server sets FACTLOT_API_KEY.",
        },
      },
    },
  };
}

/** OpenAPI 3.1, every tool — API gateways, HTTP clients, and anything without an operation limit. */
export function openApi31(opts: OpenApiOptions = {}): Json {
  return openApi("3.1.0", opts, "all");
}

/**
 * OpenAPI 3.0. By default the curated GPT Actions subset (GPT_ACTIONS_TOOLS, at most 30
 * operations) for Custom GPT Actions; pass `operations: "all"` for every tool, e.g. for Amazon
 * Bedrock Agents action groups, Microsoft API plugins, or Vertex AI extensions.
 */
export function openApi30(opts: OpenApiOptions = {}): Json {
  return openApi("3.0.3", opts, "gpt_actions");
}

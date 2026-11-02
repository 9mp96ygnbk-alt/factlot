/**
 * @factlot/mcp — FactLot as tools for any MCP-capable agent.
 *
 * Exposes the deterministic calculators, the FactLot ID functions, and fact
 * validation. Everything runs locally: no network, no API key, no data leaves
 * the machine. (Hosted FactLot services, such as registry lookups, will be
 * separate opt-in tools.)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CalcInputError, calculators } from "@factlot/calc";
import {
  FactLotIdError,
  documentId,
  entityId,
  parcelId,
  parse,
  shortId,
  spaceId,
} from "@factlot/id";
import { Fact, jsonSchemas } from "@factlot/schema";
import { z } from "zod";

export const SERVER_NAME = "factlot";
export const SERVER_VERSION = "0.1.0";

function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function fail(err: unknown): CallToolResult {
  if (err instanceof CalcInputError || err instanceof FactLotIdError) {
    const issues = err instanceof CalcInputError ? err.issues : [];
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: err.name, message: err.message, issues },
            null,
            2,
          ),
        },
      ],
    };
  }
  throw err;
}

function guarded(fn: () => unknown): CallToolResult {
  try {
    return ok(fn());
  } catch (err) {
    return fail(err);
  }
}

const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "FactLot tools for commercial real estate. Use calc_* tools for ALL lease, CAM, rent, loan, and return math instead of computing in-context; cite the returned formula id and steps. Use id_* tools to produce canonical FactLot IDs for parcels, legal entities, spaces, and documents so records join across systems. Use fact_validate before emitting facts.",
    },
  );

  for (const [name, calc] of Object.entries(calculators)) {
    server.registerTool(
      `calc_${name}`,
      {
        title: calc.title,
        description: `${calc.description} Deterministic; returns value, steps (audit trail), warnings, and formula {id, version}.`,
        inputSchema: calc.input,
        annotations: READ_ONLY,
      },
      (args: unknown) =>
        guarded(() => {
          const result = (
            calc.run as (input: unknown) => ReturnType<typeof calc.run>
          )(args);
          return {
            ...result,
            provenance: {
              method: "computed",
              formula: `${result.formula.id}@${result.formula.version}`,
              producer: { name: "@factlot/calc", version: SERVER_VERSION },
              sources: [],
            },
          };
        }),
    );
  }

  server.registerTool(
    "id_parcel",
    {
      title: "FactLot parcel ID",
      description:
        "Deterministic FactLot ID for a parcel from state FIPS, county FIPS, and the assessor's parcel number (APN). Same parcel always yields the same ID, offline.",
      inputSchema: {
        state_fips: z.string().describe('2-digit state FIPS, e.g. "06"'),
        county_fips: z.string().describe('3-digit county FIPS, e.g. "037"'),
        apn: z.string().describe("APN as printed by the county"),
      },
      annotations: READ_ONLY,
    },
    ({ state_fips, county_fips, apn }) =>
      guarded(() =>
        parcelId({ stateFips: state_fips, countyFips: county_fips, apn }),
      ),
  );

  server.registerTool(
    "id_entity",
    {
      title: "FactLot legal-entity ID",
      description:
        'Deterministic FactLot ID for a legal entity (LLC, LP, corp, trust) from its registry jurisdiction (e.g. "us-de") and file number, or jurisdiction "lei" with a 20-character LEI.',
      inputSchema: {
        jurisdiction: z.string(),
        registry_number: z.string(),
      },
      annotations: READ_ONLY,
    },
    ({ jurisdiction, registry_number }) =>
      guarded(() =>
        entityId({ jurisdiction, registryNumber: registry_number }),
      ),
  );

  server.registerTool(
    "id_space",
    {
      title: "FactLot space (suite) ID",
      description:
        'FactLot ID for a suite/unit within a building, given the building\'s FactLot URN. Suite designators are normalized ("Suite 400", "STE 400", "#400" match).',
      inputSchema: { building_urn: z.string(), suite: z.string() },
      annotations: READ_ONLY,
    },
    ({ building_urn, suite }) => guarded(() => spaceId(building_urn, suite)),
  );

  server.registerTool(
    "id_document",
    {
      title: "FactLot document ID",
      description:
        "Content-addressed FactLot ID (SHA-256) for a document. Pass base64 of the exact file bytes so every party computes the same ID.",
      inputSchema: { content_base64: z.string().min(1) },
      annotations: READ_ONLY,
    },
    ({ content_base64 }) =>
      guarded(() => documentId(Buffer.from(content_base64, "base64"))),
  );

  server.registerTool(
    "id_parse",
    {
      title: "Parse a FactLot ID",
      description:
        "Validate a FactLot URN and return its kind, components, and short ID.",
      inputSchema: { urn: z.string() },
      annotations: READ_ONLY,
    },
    ({ urn }) => guarded(() => ({ ...parse(urn), urn, short: shortId(urn) })),
  );

  server.registerTool(
    "fact_validate",
    {
      title: "Validate a FactLot fact",
      description:
        "Check that a fact object conforms to the FactLot schema (subject ID, dotted predicate, as_of date, provenance with citations, optional rights). Returns { valid, issues }.",
      inputSchema: { fact: z.record(z.string(), z.unknown()) },
      annotations: READ_ONLY,
    },
    ({ fact }) => {
      const r = Fact.safeParse(fact);
      return ok({
        valid: r.success,
        issues: r.success
          ? []
          : r.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
      });
    },
  );

  server.registerTool(
    "schema_get",
    {
      title: "FactLot JSON Schemas",
      description:
        "Return the FactLot data model (Fact, Provenance, SourceRef, Rights, Relationship) as JSON Schema.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => ok(jsonSchemas()),
  );

  return server;
}

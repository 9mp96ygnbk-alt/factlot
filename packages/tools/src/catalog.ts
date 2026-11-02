/**
 * The FactLot tool catalog: one list of tools, with identical names, inputs, and
 * outputs on every surface (MCP, REST, OpenAPI, and each AI provider's function calling).
 */
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
import { Fact } from "@factlot/schema";
import { z } from "zod";

export const CATALOG_VERSION = "0.1.0";

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  /** Runs the tool on already-shaped input; throws CalcInputError/FactLotIdError on domain errors. */
  run: (input: never) => unknown;
  /** REST path under the API root, e.g. "/v1/calc/rent_schedule". */
  path: string;
  /** Formula identity for calculators. */
  formula?: { id: string; version: number };
}

export interface ToolError {
  error: "CalcInputError" | "FactLotIdError" | "InputError" | "UnknownTool";
  message: string;
  issues: { path: string; message: string }[];
}

export type ToolOutcome =
  { ok: true; result: unknown } | { ok: false; error: ToolError };

const PRODUCER = { name: "@factlot/tools", version: CATALOG_VERSION };

const calcTools: ToolSpec[] = Object.entries(calculators).map(([name, c]) => ({
  name: `calc_${name}`,
  title: c.title,
  description: `${c.description} Deterministic: use this instead of doing the math yourself; cite formula ${c.id}@${c.version} and the returned steps, and surface any warnings.`,
  input: c.input,
  path: `/v1/calc/${name}`,
  formula: { id: c.id, version: c.version },
  run: (input: never) => {
    const result = (
      c.run as (i: unknown) => { formula: { id: string; version: number } }
    )(input);
    return {
      ...result,
      provenance: {
        method: "computed",
        formula: `${result.formula.id}@${result.formula.version}`,
        producer: PRODUCER,
        sources: [],
      },
    };
  },
}));

const ParcelInput = z.object({
  state_fips: z
    .string()
    .describe('2-digit state FIPS code, e.g. "06" for California.'),
  county_fips: z
    .string()
    .describe('3-digit county FIPS code, e.g. "037" for Los Angeles County.'),
  apn: z
    .string()
    .describe(
      "Assessor's parcel number exactly as the county prints it; formatting is normalized.",
    ),
});
const EntityInput = z.object({
  jurisdiction: z
    .string()
    .describe(
      'Registry jurisdiction, e.g. "us-de" for Delaware, or "lei" for a Legal Entity Identifier.',
    ),
  registry_number: z
    .string()
    .describe("File number issued by that registry, or the 20-character LEI."),
});
const SpaceInput = z.object({
  building_urn: z
    .string()
    .describe(
      "FactLot building URN, e.g. fl:building:01jbx3k8q2v7m9c4t6w8y0a2b4.",
    ),
  suite: z
    .string()
    .describe(
      'Suite or unit as written ("Suite 400", "STE 400", "#400", "3rd Floor" all normalize).',
    ),
});
const DocumentInput = z
  .object({
    content_base64: z
      .string()
      .optional()
      .describe(
        "Base64 of the exact file bytes (preferred: every party gets the same ID).",
      ),
    text: z
      .string()
      .optional()
      .describe(
        "Document text, UTF-8 encoded before hashing. Use only when bytes are unavailable.",
      ),
  })
  .refine((v) => (v.content_base64 === undefined) !== (v.text === undefined), {
    message: "provide exactly one of content_base64 or text",
  });
const ParseInput = z.object({
  urn: z
    .string()
    .describe("A FactLot URN to validate, e.g. fl:parcel:us-06037:5432001012."),
});
const FactValidateInput = z.object({
  fact: z
    .record(z.string(), z.unknown())
    .describe(
      "A FactLot fact: subject, predicate, value, as_of, provenance (with sources), optional rights.",
    ),
});

const idTools: ToolSpec[] = [
  {
    name: "id_parcel",
    title: "FactLot parcel ID",
    description:
      "Deterministic FactLot ID for a parcel from state FIPS, county FIPS, and the assessor's parcel number (APN). The same parcel always yields the same ID, offline. Use it as the join key across systems.",
    input: ParcelInput,
    path: "/v1/id/parcel",
    run: (i: never) => {
      const v = i as z.output<typeof ParcelInput>;
      return parcelId({
        stateFips: v.state_fips,
        countyFips: v.county_fips,
        apn: v.apn,
      });
    },
  },
  {
    name: "id_entity",
    title: "FactLot legal-entity ID",
    description:
      "Deterministic FactLot ID for a legal entity (LLC, LP, corporation, trust) from its registry jurisdiction and file number, or from its LEI.",
    input: EntityInput,
    path: "/v1/id/entity",
    run: (i: never) => {
      const v = i as z.output<typeof EntityInput>;
      return entityId({
        jurisdiction: v.jurisdiction,
        registryNumber: v.registry_number,
      });
    },
  },
  {
    name: "id_space",
    title: "FactLot space (suite) ID",
    description:
      "FactLot ID for a suite or unit within a building, given the building's FactLot URN. Suite designators are normalized.",
    input: SpaceInput,
    path: "/v1/id/space",
    run: (i: never) => {
      const v = i as z.output<typeof SpaceInput>;
      return spaceId(v.building_urn, v.suite);
    },
  },
  {
    name: "id_document",
    title: "FactLot document ID",
    description:
      "Content-addressed FactLot ID (SHA-256) for a document such as a lease, amendment, or estoppel.",
    input: DocumentInput,
    path: "/v1/id/document",
    run: (i: never) => {
      const v = i as z.output<typeof DocumentInput>;
      return documentId(
        v.content_base64 !== undefined
          ? Buffer.from(v.content_base64, "base64")
          : (v.text ?? ""),
      );
    },
  },
  {
    name: "id_parse",
    title: "Parse a FactLot ID",
    description:
      "Validate a FactLot URN and return its kind, components, and short ID.",
    input: ParseInput,
    path: "/v1/id/parse",
    run: (i: never) => {
      const { urn } = i as z.output<typeof ParseInput>;
      return { ...parse(urn), urn, short: shortId(urn) };
    },
  },
  {
    name: "fact_validate",
    title: "Validate a FactLot fact",
    description:
      "Check that a fact conforms to the FactLot model (subject ID, dotted predicate, as_of date, provenance with citations, optional AI-use rights). Returns { valid, issues }. Call before storing or sharing extracted facts.",
    input: FactValidateInput,
    path: "/v1/facts/validate",
    run: (i: never) => {
      const r = Fact.safeParse((i as z.output<typeof FactValidateInput>).fact);
      return {
        valid: r.success,
        issues: r.success
          ? []
          : r.error.issues.map((x) => ({
              path: x.path.join("."),
              message: x.message,
            })),
      };
    },
  },
];

/** Every FactLot tool, in a stable order. */
export const tools: readonly ToolSpec[] = [...calcTools, ...idTools];

export function getTool(name: string): ToolSpec | undefined {
  return tools.find((t) => t.name === name);
}

/** Validate input and run a tool. Never throws for bad input: returns errors as data agents can act on. */
export function runTool(name: string, args: unknown): ToolOutcome {
  const tool = getTool(name);
  if (!tool) {
    return {
      ok: false,
      error: {
        error: "UnknownTool",
        message: `no FactLot tool named "${name}"`,
        issues: [],
      },
    };
  }
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    const kind = name.startsWith("calc_") ? "CalcInputError" : "InputError";
    return {
      ok: false,
      error: {
        error: kind,
        message: `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`,
        issues,
      },
    };
  }
  try {
    return {
      ok: true,
      result: (tool.run as (i: unknown) => unknown)(parsed.data),
    };
  } catch (err) {
    if (err instanceof CalcInputError) {
      return {
        ok: false,
        error: {
          error: "CalcInputError",
          message: err.message,
          issues: err.issues,
        },
      };
    }
    if (err instanceof FactLotIdError) {
      return {
        ok: false,
        error: { error: "FactLotIdError", message: err.message, issues: [] },
      };
    }
    throw err;
  }
}

/** JSON Schema (draft 2020-12) of a tool's input, without the `$schema` key. */
export function inputJsonSchema(tool: ToolSpec): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/**
 * The registry tools answered from a pack. Each returns the ToolOutcome runTool (packages/tools/src/catalog.ts)
 * returns for the same input against one registry file holding every region of the pack. Input arrives already
 * validated and defaulted by the catalog's schema.
 */
import { FactLotIdError, parse } from "@factlot/id";

import {
  TEXAS_FIPS,
  TX_EQUITY_NOTICE,
  TX_EQUITY_RULE,
  TX_EQUITY_WHICH_PARCEL,
  addressMiss,
  externalMiss,
  parcelUrnForRule,
  texasOnly,
  txEquityWithheld,
} from "../../../packages/tools/src/registry.ts";

import { equityFromPack } from "./equity.ts";
import { MAX_LIMIT, getResult } from "./format.ts";
import {
  hostedEntitiesMiss,
  hostedEntityMiss,
  hostedParcelMiss,
  hostedRecordMiss,
} from "./hosted.ts";
import { searchAddress, searchEntities } from "./search.ts";
import type { Pack } from "./store.ts";

export interface ToolError {
  error:
    | "FactLotIdError"
    | "InputError"
    | "UnknownTool"
    | "RegistryUnavailable"
    | "NotFound";
  message: string;
  issues: { path: string; message: string }[];
  coverage?: unknown;
}

export type ToolOutcome =
  { ok: true; result: unknown } | { ok: false; error: ToolError };

export const REGISTRY_TOOLS = [
  "registry_get",
  "registry_resolve_parcel",
  "registry_resolve_external",
  "registry_search_address",
  "registry_search_entities",
  "registry_owned_by",
  "registry_coverage",
  "registry_tx_equity_candidates",
  "registry_tx_equity_candidates_batch",
] as const;

/** The parcel rule the pack's file for a county was built with; a county the pack lacks gets the current rule. */
const CURRENT_PARCEL_RULE = "2";

class InputIssue extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super(
      `invalid input: ${issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("; ")}`,
    );
    this.issues = issues;
  }
}

class Missing extends Error {
  readonly coverage: unknown;
  constructor(message: string, coverage: unknown) {
    super(message);
    this.coverage = coverage;
  }
}

class Unavailable extends Error {}

type Input = Record<string, unknown>;

const str = (i: Input, k: string): string => {
  const v = i[k];
  if (typeof v !== "string")
    throw new InputIssue([{ path: k, message: "expected string" }]);
  return v;
};
const optStr = (i: Input, k: string): string | undefined =>
  i[k] === undefined ? undefined : str(i, k);
const limitOf = (i: Input): number => {
  const v = i.limit ?? 20;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX_LIMIT)
    throw new InputIssue([
      { path: "limit", message: `expected an integer from 1 to ${MAX_LIMIT}` },
    ]);
  return v;
};

async function parcelUrn(
  pack: Pack,
  stateFips: string,
  countyFips: string,
  apn: string,
): Promise<string> {
  const m = await pack.manifest();
  const region = `us-${stateFips}${countyFips}`;
  const rule = Object.hasOwn(m.counties, region)
    ? m.dbs[m.counties[region]!]!.parcel_rule
    : CURRENT_PARCEL_RULE;
  return parcelUrnForRule(rule, stateFips, countyFips, apn);
}

async function notFound(pack: Pack, urn: string): Promise<never> {
  const m = await pack.manifest();
  const coverage = hostedRecordMiss(m, m.coverage, urn);
  throw new Missing(
    `no registry record for ${urn}: ${String(coverage.message)}`,
    coverage,
  );
}

async function run(pack: Pack, tool: string, i: Input): Promise<unknown> {
  const m = await pack.manifest();
  const cov = m.coverage;
  switch (tool) {
    case "registry_get": {
      const urn = str(i, "urn");
      const asOf = optStr(i, "as_of");
      parse(urn);
      const entry = await pack.entry(urn);
      if (!entry) return notFound(pack, urn);
      return getResult(
        entry,
        m.dbs[entry.k]!.dates,
        i.include_history === true,
        asOf,
      );
    }
    case "registry_resolve_parcel": {
      const s = str(i, "state_fips");
      const c = str(i, "county_fips");
      const urn = await parcelUrn(pack, s, c, str(i, "apn"));
      return (await pack.entry(urn))
        ? { urn }
        : { urn: null, coverage: hostedParcelMiss(m, cov, s, c) };
    }
    case "registry_resolve_external": {
      const system = str(i, "system");
      const id = str(i, "external_id");
      const urn = await pack.crosswalk(system, id);
      return urn
        ? { urn }
        : { urn: null, coverage: externalMiss(cov, system, id) };
    }
    case "registry_search_address": {
      const query = str(i, "query");
      const results = await searchAddress(pack, query, limitOf(i));
      return results.length
        ? { results }
        : { results, coverage: addressMiss(cov, query) };
    }
    case "registry_search_entities": {
      const results = await searchEntities(pack, str(i, "query"), limitOf(i));
      return results.length
        ? { results }
        : { results, coverage: hostedEntitiesMiss(m, cov) };
    }
    case "registry_owned_by": {
      const urn = str(i, "entity_urn");
      const { kind, parts } = parse(urn);
      if (kind !== "entity")
        throw new FactLotIdError(
          `"${urn}" is a ${kind} URN; registry_owned_by needs an entity URN`,
        );
      const entry = await pack.entry(urn);
      if (entry?.o)
        return { results: entry.o.results, buildings: entry.o.buildings };
      return {
        results: [],
        buildings: [],
        coverage: hostedEntityMiss(m, cov, parts[0] ?? "", entry !== undefined),
      };
    }
    case "registry_coverage":
      return m.coverage_result;
    case "registry_tx_equity_candidates":
      return txEquity(pack, i);
    case "registry_tx_equity_candidates_batch":
      return txEquityBatch(pack, i);
  }
  throw new Error(`unhandled tool ${tool}`);
}

// The catalog's registry_tx_equity_candidates checks, in its order; then the candidates from the pack (equity.ts), or
// the SDK's NotFound for a parcel the pack does not hold.
async function txEquity(pack: Pack, i: Input): Promise<unknown> {
  const urnIn = optStr(i, "urn");
  const stateIn = optStr(i, "state_fips");
  const countyIn = optStr(i, "county_fips");
  const apnIn = optStr(i, "apn");
  const byApn =
    stateIn !== undefined || countyIn !== undefined || apnIn !== undefined;
  if (
    (urnIn !== undefined) === byApn ||
    (byApn && (countyIn === undefined || apnIn === undefined))
  )
    throw new InputIssue([{ path: "", message: TX_EQUITY_WHICH_PARCEL }]);
  let urn: string;
  if (urnIn !== undefined) {
    const { kind, parts } = parse(urnIn);
    if (kind !== "parcel")
      throw new FactLotIdError(
        `"${urnIn}" is a ${kind} URN; registry_tx_equity_candidates needs a parcel URN`,
      );
    const state = (parts[0] ?? "").slice(3, 5);
    if (state !== TEXAS_FIPS)
      throw new InputIssue([{ path: "urn", message: texasOnly(state) }]);
    const withheld = txEquityWithheld((parts[0] ?? "").slice(5, 8));
    if (withheld) throw new InputIssue([{ path: "urn", message: withheld }]);
    urn = urnIn;
  } else {
    const state = stateIn ?? TEXAS_FIPS;
    if (state !== TEXAS_FIPS)
      throw new InputIssue([{ path: "state_fips", message: texasOnly(state) }]);
    const withheld = txEquityWithheld(countyIn!);
    if (withheld)
      throw new InputIssue([{ path: "county_fips", message: withheld }]);
    urn = await parcelUrn(pack, state, countyIn!, apnIn!);
  }
  const entry = await pack.entry(urn);
  if (!entry) return notFound(pack, urn);
  const num = (k: string): number => {
    const v = i[k];
    if (typeof v !== "number")
      throw new InputIssue([{ path: k, message: "expected number" }]);
    return v;
  };
  return equityFromPack(pack, urn, entry, {
    area_band: num("area_band"),
    year_band: num("year_band"),
    min_matches: num("min_matches"),
    limit: num("limit"),
    ...(i.tax_year === undefined ? {} : { tax_year: num("tax_year") }),
  });
}

/** A tool error as runTool reports it, or undefined for an error that is not a tool outcome. */
function toolError(err: unknown): ToolError | undefined {
  if (err instanceof FactLotIdError)
    return { error: "FactLotIdError", message: err.message, issues: [] };
  if (err instanceof InputIssue)
    return { error: "InputError", message: err.message, issues: err.issues };
  if (err instanceof Missing)
    return {
      error: "NotFound",
      message: err.message,
      issues: [],
      coverage: err.coverage,
    };
  if (err instanceof Unavailable)
    return { error: "RegistryUnavailable", message: err.message, issues: [] };
  return undefined;
}

const TX_EQUITY_PARAMS = [
  "area_band",
  "year_band",
  "min_matches",
  "limit",
  "tax_year",
] as const;

// registry_tx_equity_candidates_batch (catalog.ts): each subject through the single-subject path, with its own
// checks and errors; the rule and notice once at the top.
async function txEquityBatch(pack: Pack, i: Input): Promise<unknown> {
  const subjects = i.subjects;
  if (!Array.isArray(subjects))
    throw new InputIssue([{ path: "subjects", message: "expected array" }]);
  const params: Input = {};
  for (const k of TX_EQUITY_PARAMS) if (i[k] !== undefined) params[k] = i[k];
  const results: Input[] = [];
  for (const raw of subjects as Input[]) {
    const { id, ...subject } = raw;
    let answer: Input;
    try {
      answer = (await txEquity(pack, { ...subject, ...params })) as Input;
    } catch (err) {
      const error = toolError(err);
      // No registry is no answer for any subject: the whole call fails, as the single tool does.
      if (!error || error.error === "RegistryUnavailable") throw err;
      results.push({ id, error });
      continue;
    }
    const { notice: _notice, selection, ...rest } = answer;
    const { rule: _rule, ...perSubject } = selection as Input;
    void _notice;
    void _rule;
    results.push({ id, ...rest, selection: perSubject });
  }
  const errors = results.filter((r) => "error" in r).length;
  return {
    results,
    summary: {
      subjects: results.length,
      answered: results.length - errors,
      errors,
    },
    rule: TX_EQUITY_RULE,
    notice: TX_EQUITY_NOTICE,
  };
}

/** One registry tool call, as a ToolOutcome. Errors that are not tool outcomes are thrown. */
export async function runRegistryTool(
  pack: Pack,
  tool: string,
  input: unknown,
): Promise<ToolOutcome> {
  if (!(REGISTRY_TOOLS as readonly string[]).includes(tool))
    return {
      ok: false,
      error: {
        error: "UnknownTool",
        message: `no FactLot tool named "${tool}"`,
        issues: [],
      },
    };
  const i = (
    input && typeof input === "object" && !Array.isArray(input) ? input : {}
  ) as Input;
  try {
    return { ok: true, result: await run(pack, tool, i) };
  } catch (err) {
    const error = toolError(err);
    if (error) return { ok: false, error };
    throw err;
  }
}

/**
 * What the hosted registry serves differently from a registry file: counties it withholds and entity registries
 * it serves only in part. The pack builder records both in the manifest; these pure functions turn a miss or the
 * coverage answer that the SDK would give for the served data into the hosted one. With nothing withheld and no
 * registry trimmed they return the SDK's answer unchanged.
 */
import { countyName } from "../../../packages/tools/src/county_names.ts";
import type { CountyFields } from "../../../packages/tools/src/fields.ts";
import {
  addressMiss,
  type AddressStreetHint,
  type AddressWhere,
  entitiesMiss,
  entityMiss,
  parcelMiss,
  recordMiss,
  type RegistryCoverage,
} from "../../../packages/tools/src/registry.ts";

type Row = Record<string, unknown>;

/** An entity registry the hosted registry serves in part: the entities that own a hosted parcel. */
export interface EntityScope {
  served: number;
  total: number;
}

/** A county whose parcels come only from sources that cover part of it (a city assessor in a larger county). */
export interface PartialCounty {
  /** The part that is loaded ("the City of Boston"). */
  area: string;
  /** What else is in the county and is not loaded. */
  rest: string;
}

export interface HostedScope {
  /** 5-digit county FIPS → why the hosted registry serves none of its parcels. */
  withheld?: Record<string, string>;
  /** Entity registry jurisdiction → how many of its entities the hosted registry serves. */
  entity_scope?: Record<string, EntityScope>;
  /** 5-digit county FIPS → the part of the county its parcels cover, for a county loaded only in part. */
  partial_counties?: Record<string, PartialCounty>;
  /** 5-digit county FIPS → which fact groups and roll years the county holds (fields.ts). */
  fields?: Record<string, CountyFields>;
}

/**
 * Parcel sources that cover only part of their county, by source ID (a per-tax-year or companion source
 * "<id>-<suffix>" counts as the same source). A county whose every parcel source is listed here for that county is
 * "loaded in part": its coverage and misses say which part, so a parcel elsewhere in the county is not taken to be
 * outside the registry's scope. Add a source here when its adapter covers less than the county its FIPS names.
 */
export const PARTIAL_COUNTY_SOURCES: Record<
  string,
  PartialCounty & { county: string }
> = {
  "ma-boston-assessing": {
    county: "25025",
    area: "the City of Boston",
    rest: "Chelsea, Revere and Winthrop, the other municipalities of Suffolk County, assess separately and are not loaded",
  },
};

function partialSource(
  sourceId: string,
): (PartialCounty & { county: string }) | undefined {
  for (const [id, p] of Object.entries(PARTIAL_COUNTY_SOURCES))
    if (sourceId === id || sourceId.startsWith(`${id}-`)) return p;
  return undefined;
}

/** The counties of a coverage summary that are loaded only in part (see PARTIAL_COUNTY_SOURCES). */
export function partialCounties(
  cov: RegistryCoverage,
): Record<string, PartialCounty> {
  const out: Record<string, PartialCounty> = {};
  for (const c of cov.counties) {
    const fips = `${c.state_fips}${c.county_fips}`;
    if (!c.sources.length) continue;
    const parts = c.sources.map((s) => partialSource(s.source_id));
    if (parts.some((p) => !p || p.county !== fips)) continue;
    const areas = [...new Set(parts.map((p) => p!.area))];
    const rests = [...new Set(parts.map((p) => p!.rest))];
    out[fips] = { area: areas.join(" and "), rest: rests.join("; ") };
  }
  return out;
}

function partialOf(
  scope: HostedScope,
  fips: string,
): PartialCounty | undefined {
  return scope.partial_counties && Object.hasOwn(scope.partial_counties, fips)
    ? scope.partial_counties[fips]
    : undefined;
}

/** ". Of Suffolk County, MA, only the City of Boston is loaded: …": what a county loaded in part lacks. */
function partialTail(
  cov: RegistryCoverage,
  fips: string,
  p: PartialCounty,
): string {
  const label = countyText(cov, fips).replace(/ \([^)]*\)$/, "");
  return `. Of ${label}, only ${p.area} is loaded: ${p.rest}`;
}

/** A loaded-county miss message, said of the part of the county that is loaded. */
function partialMessage(
  cov: RegistryCoverage,
  fips: string,
  p: PartialCounty,
  message: string,
): string {
  const said = message.replace(
    /^(.*?) is loaded in this registry \(/,
    (_m, head: string) =>
      `${head} is loaded in this registry for ${p.area} only (`,
  );
  return said === message ? message : `${said}${partialTail(cov, fips, p)}`;
}

/** "Tarrant County, TX (48439)". */
function countyText(cov: RegistryCoverage, fips: string): string {
  const state = parcelMiss(cov, fips.slice(0, 2), fips.slice(2)).state;
  const name = countyName(fips);
  return name
    ? `${name}, ${String(state ?? `state ${fips.slice(0, 2)}`)} (${fips})`
    : `county ${fips} (${String(state ?? `state ${fips.slice(0, 2)}`)})`;
}

/** Why the hosted registry serves no parcel of a county, or undefined. */
export function withheldMessage(
  scope: HostedScope,
  cov: RegistryCoverage,
  fips: string,
): string | undefined {
  if (!scope.withheld || !Object.hasOwn(scope.withheld, fips)) return undefined;
  return `${countyText(cov, fips)} is not served by the hosted registry while the publisher's terms for AI use are unclear: ${scope.withheld[fips]}`;
}

function entityScopeText(jurisdiction: string, s: EntityScope): string {
  return `the hosted registry serves the entities of registry ${jurisdiction} that own a parcel it serves (${s.served} of ${s.total}); a registry file holds them all`;
}

export function hostedParcelMiss(
  scope: HostedScope,
  cov: RegistryCoverage,
  stateFips: string,
  countyFips: string,
): Row {
  const out = parcelMiss(cov, stateFips, countyFips);
  const fips = `${stateFips}${countyFips}`;
  const withheld = withheldMessage(scope, cov, fips);
  if (withheld) out.message = withheld;
  const p = partialOf(scope, fips);
  if (p && out.county_loaded === true) {
    out.county_area = p.area;
    out.message = partialMessage(cov, fips, p, String(out.message));
  }
  return out;
}

/**
 * registry_search_address's miss for the hosted registry: a query naming a loaded state with a county loaded in part
 * ("500 Broadway, Chelsea, MA") also says which part of that county is loaded.
 */
export function hostedAddressMiss(
  scope: HostedScope,
  cov: RegistryCoverage,
  query: string,
  where: AddressWhere = {},
  hint: AddressStreetHint | null = null,
): Row {
  return hostedAddressMissOf(scope, cov, addressMiss(cov, query, where, hint));
}

/** hostedAddressMiss from the SDK's miss (addressMiss) for the same query. */
export function hostedAddressMissOf(
  scope: HostedScope,
  cov: RegistryCoverage,
  miss: Row,
): Row {
  const out = { ...miss };
  // A withheld county among the place's counties is said not to be served, whether or not the query named a state
  // ("4200 S Hulen St, 76109").
  out.message = `${String(out.message)}${withheldTail(scope, cov, out.place_counties)}`;
  if (out.state_loaded !== true) return out;
  for (const c of cov.counties) {
    const fips = `${c.state_fips}${c.county_fips}`;
    const p = partialOf(scope, fips);
    if (
      p &&
      c.state === out.state &&
      String(out.message).startsWith("no parcel matched in ")
    )
      out.message = `${String(out.message)}${partialTail(cov, fips, p)}`;
  }
  return out;
}

/** Why the withheld counties among a place's counties are not served, as sentences to append ("" for none). */
function withheldTail(
  scope: HostedScope,
  cov: RegistryCoverage,
  counties: unknown,
): string {
  if (!Array.isArray(counties)) return "";
  return counties
    .map((c) => withheldMessage(scope, cov, String(c)))
    .filter((m): m is string => m !== undefined)
    .map((m) => `. ${m}`)
    .join("");
}

/** registry_search_address's answer with results for the hosted registry: a note naming a withheld county says why. */
export function hostedAddressFoundOf(
  scope: HostedScope,
  cov: RegistryCoverage,
  found: Row,
): Row {
  if (typeof found.note !== "string") return found;
  return {
    ...found,
    note: `${found.note}${withheldTail(scope, cov, found.place_counties)}`,
  };
}

export function hostedEntityMiss(
  scope: HostedScope,
  cov: RegistryCoverage,
  jurisdiction: string,
  known: boolean,
): Row {
  const out = entityMiss(cov, jurisdiction, known);
  const s =
    scope.entity_scope && Object.hasOwn(scope.entity_scope, jurisdiction)
      ? scope.entity_scope[jurisdiction]
      : undefined;
  if (!known && s)
    out.message = `no entity with this number among those the hosted registry serves: entity lookups cover entities that own a hosted parcel; ${entityScopeText(jurisdiction, s)}`;
  return out;
}

export function hostedEntitiesMiss(
  scope: HostedScope,
  cov: RegistryCoverage,
): Row {
  const out = entitiesMiss(cov);
  const trimmed = Object.entries(scope.entity_scope ?? {});
  if (trimmed.length)
    out.message = `${String(out.message)}. Hosted entity search covers entities that own a hosted parcel: ${trimmed.map(([j, s]) => entityScopeText(j, s)).join("; ")}`;
  return out;
}

/** registry_get's miss (recordMiss) for the hosted registry; throws FactLotIdError for a malformed URN. */
export function hostedRecordMiss(
  scope: HostedScope,
  cov: RegistryCoverage,
  urn: string,
): Row {
  const out = recordMiss(cov, urn);
  const [, kind, region = ""] = urn.split(":");
  if (kind === "entity") return hostedEntityMiss(scope, cov, region, false);
  if ((kind === "parcel" || kind === "building") && region.startsWith("us-")) {
    const fips = region.slice(3, 8);
    const withheld = withheldMessage(scope, cov, fips);
    if (withheld) out.message = withheld;
    const p = partialOf(scope, fips);
    if (p && out.county_loaded === true) {
      out.county_area = p.area;
      out.message = partialMessage(cov, fips, p, String(out.message));
    }
  }
  return out;
}

/** How to get each county's field availability: one sentence in every hosted registry_coverage answer of a pack that has it. */
export const FIELDS_NOTE =
  "Fields differ by county: with fields: true each county carries fields.shares (the share of its parcels with each fact group it holds; a group not listed is held for none) and fields.roll_years (the tax years held, with their value types, the newest file's as-of date and preliminary: true where the roll is preliminary); the same table is at https://factlot.com/coverage/#fields.";

/**
 * registry_coverage for the hosted registry: the SDK's answer (with or without `fields`), with what it withholds or
 * serves in part, and FIELDS_NOTE when the pack holds field availability.
 */
export function hostedCoverageResult(
  scope: HostedScope,
  cov: RegistryCoverage,
  result: unknown,
): unknown {
  const withheld = Object.keys(scope.withheld ?? {}).sort();
  const trimmed = Object.keys(scope.entity_scope ?? {}).sort();
  const partial = Object.keys(scope.partial_counties ?? {}).sort();
  const hasFields = Object.keys(scope.fields ?? {}).length > 0;
  if (!withheld.length && !trimmed.length && !partial.length && !hasFields)
    return result;
  const r = result as Row;
  return {
    ...r,
    // A county loaded in part says which part, where the county is listed.
    ...(partial.length && Array.isArray(r.counties)
      ? {
          counties: (r.counties as Row[]).map((c) => {
            const p = partialOf(
              scope,
              `${String(c.state_fips)}${String(c.county_fips)}`,
            );
            return p ? { ...c, area: p.area } : c;
          }),
        }
      : {}),
    ...(hasFields ? { fields_note: FIELDS_NOTE } : {}),
    hosted: {
      ...(partial.length
        ? {
            partial_counties: partial.map((fips) => ({
              region: `us-${fips}`,
              name: countyName(fips) ?? null,
              area: scope.partial_counties![fips]!.area,
              message: `${countyText(cov, fips)} is loaded for ${scope.partial_counties![fips]!.area} only: ${scope.partial_counties![fips]!.rest}`,
            })),
          }
        : {}),
      withheld_counties: withheld.map((fips) => ({
        region: `us-${fips}`,
        name: countyName(fips) ?? null,
        message: withheldMessage(scope, cov, fips),
      })),
      entity_registries: trimmed.map((j) => ({
        jurisdiction: j,
        ...scope.entity_scope![j]!,
        message: entityScopeText(j, scope.entity_scope![j]!),
      })),
    },
  };
}

interface Outcome {
  ok: boolean;
  result?: unknown;
  error?: { error: string; message: string; coverage?: unknown };
}

/**
 * runTool's outcome on the served data (a registry file without what the pack withholds), made hosted: the misses
 * and coverage above. For parity checks (worker tests, check_pack).
 */
export function hostedOutcome<T extends Outcome>(
  scope: HostedScope,
  cov: RegistryCoverage,
  tool: string,
  args: Row,
  outcome: T,
): T {
  const out = JSON.parse(JSON.stringify(outcome)) as T;
  if (!out.ok) {
    if (out.error?.error === "NotFound" && out.error.coverage !== undefined) {
      // The URN looked up (an equity call may name its parcel by APN).
      const urn =
        /^no registry record for (\S+): /.exec(out.error.message)?.[1] ??
        String(args.urn ?? "");
      const coverage = hostedRecordMiss(scope, cov, urn);
      out.error.coverage = coverage;
      out.error.message = `no registry record for ${urn}: ${String(coverage.message)}`;
    }
    return out;
  }
  const r = out.result as Row;
  if (tool === "registry_tx_equity_candidates_batch") {
    // Each subject's error is the single tool's.
    for (const entry of r.results as Row[])
      if (entry.error)
        entry.error = hostedOutcome(
          scope,
          cov,
          "registry_tx_equity_candidates",
          {},
          {
            ok: false,
            error: entry.error as Outcome["error"],
          },
        ).error;
  } else if (tool === "registry_coverage")
    out.result = hostedCoverageResult(scope, cov, r);
  else if (tool === "registry_resolve_parcel" && r.urn === null)
    r.coverage = hostedParcelMiss(
      scope,
      cov,
      String(args.state_fips ?? "48"),
      String(args.county_fips),
    );
  else if (tool === "registry_search_address" && r.coverage !== undefined)
    r.coverage = hostedAddressMissOf(scope, cov, r.coverage as Row);
  else if (tool === "registry_search_address")
    out.result = hostedAddressFoundOf(scope, cov, r);
  else if (tool === "registry_search_entities" && r.coverage !== undefined)
    r.coverage = hostedEntitiesMiss(scope, cov);
  else if (tool === "registry_owned_by" && r.coverage !== undefined) {
    const c = r.coverage as Row;
    r.coverage = hostedEntityMiss(
      scope,
      cov,
      String(c.jurisdiction),
      c.entity_known === true,
    );
  }
  return out;
}

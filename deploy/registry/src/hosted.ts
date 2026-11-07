/**
 * What the hosted registry serves differently from a registry file: counties it withholds and entity registries
 * it serves only in part. The pack builder records both in the manifest; these pure functions turn a miss or the
 * coverage answer that the SDK would give for the served data into the hosted one. With nothing withheld and no
 * registry trimmed they return the SDK's answer unchanged.
 */
import { countyName } from "../../../packages/tools/src/county_names.ts";
import {
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

export interface HostedScope {
  /** 5-digit county FIPS → why the hosted registry serves none of its parcels. */
  withheld?: Record<string, string>;
  /** Entity registry jurisdiction → how many of its entities the hosted registry serves. */
  entity_scope?: Record<string, EntityScope>;
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
  const withheld = withheldMessage(scope, cov, `${stateFips}${countyFips}`);
  if (withheld) out.message = withheld;
  return out;
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
    const withheld = withheldMessage(scope, cov, region.slice(3, 8));
    if (withheld) out.message = withheld;
  }
  return out;
}

/** registry_coverage for the hosted registry: the SDK's answer, with what it withholds or serves in part. */
export function hostedCoverageResult(
  scope: HostedScope,
  cov: RegistryCoverage,
  result: unknown,
): unknown {
  const withheld = Object.keys(scope.withheld ?? {}).sort();
  const trimmed = Object.keys(scope.entity_scope ?? {}).sort();
  if (!withheld.length && !trimmed.length) return result;
  return {
    ...(result as Row),
    hosted: {
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

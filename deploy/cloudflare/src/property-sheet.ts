/**
 * The registry lookup behind a property_sheet report. The sheet is built from registry_get on the
 * parcel, run as the caller's own call: the router sends it back through itself as an MCP
 * tools/call with the caller's credentials and address, so the call is metered, refunded and
 * gated exactly like any registry_get of theirs (one lookup; a free caller's answer keeps the
 * current roll year only). Nothing here reads the registry on the caller's behalf, except the
 * linked entity's name, status and registry number, read as the public property pages read them
 * (unmetered), and only when the owner of record may be printed.
 *
 * A paid caller's call adds include_history, so the sheet can name the files behind the earlier
 * roll years; history is cut to the current facts for a free caller anyway, so a free caller's
 * call does not ask for it.
 */
import { hostedWithheldCounties } from "@factlot/tools";
import type { RegistryLookup, SheetPlan } from "@factlot/reports";

import { ownerNamesAPerson } from "./property-pages.ts";
import { registryRunner } from "./registry.ts";
import type { Fetcher } from "./types.ts";

type Json = Record<string, unknown>;

export type SheetLookupOutcome =
  | { ok: true; lookup: RegistryLookup }
  | { ok: false; status: number; body: Json };

export interface SheetLookupDeps {
  plan: SheetPlan;
  /** Send one MCP request as the caller (the router, re-entered with their credentials). */
  callMcp: (body: string) => Promise<Response>;
  /** The registry service binding, for the linked entity's record. */
  registry?: Fetcher;
}

const WITHHELD = hostedWithheldCounties();

/** Why a parcel's county is withheld from the hosted registry, or undefined. */
export function withheldCounty(urn: string): string | undefined {
  const fips = /^fl:parcel:us-(\d{5}):/.exec(urn)?.[1];
  return fips && Object.hasOwn(WITHHELD, fips) ? WITHHELD[fips] : undefined;
}

/** The HTTP status a registry tool error answers with when the sheet passes it on. */
function statusOf(code: unknown): number {
  switch (code) {
    case "RegistryQuotaExceeded":
    case "RateLimited":
      return 429;
    case "NotFound":
      return 404;
    case "PlanRequired":
      return 403;
    case "RegistryUnavailable":
    case "ServiceUnavailable":
      return 503;
    default:
      return 400;
  }
}

const UNAVAILABLE: SheetLookupOutcome = {
  ok: false,
  status: 503,
  body: {
    error: "ServiceUnavailable",
    code: "ServiceUnavailable",
    message:
      "the registry lookup for this sheet did not answer, so nothing was charged; retry in a few seconds.",
    retry_after_seconds: 5,
    next: "retry after 5 seconds",
  },
};

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * An MCP POST to /mcp on the same host carrying only what identifies the caller: their
 * Authorization header and Cloudflare's client address. The router answers it as theirs.
 */
export function asCaller(request: Request, url: URL, body: string): Request {
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  for (const h of ["authorization", "cf-connecting-ip", "user-agent"]) {
    const v = request.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  return new Request(`${url.origin}/mcp`, { method: "POST", headers, body });
}

/** registry_get on the parcel as the caller, then the linked entity when the owner may be shown. */
export async function lookupForSheet(
  urn: string,
  deps: SheetLookupDeps,
): Promise<SheetLookupOutcome> {
  const reason = withheldCounty(urn);
  if (reason)
    return {
      ok: false,
      status: 404,
      body: {
        error: "NotFound",
        code: "CountyWithheld",
        message: `this parcel's county is not served by the hosted registry: ${reason}. Nothing was charged.`,
        next: "see https://factlot.com/coverage/ for the counties served",
        issues: [],
      },
    };
  let res: Response;
  try {
    res = await deps.callMcp(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "registry_get",
          arguments:
            deps.plan === "free" ? { urn } : { urn, include_history: true },
        },
      }),
    );
  } catch {
    return UNAVAILABLE;
  }
  const msg = parse(await res.text()) as
    | {
        result?: {
          isError?: boolean;
          structuredContent?: unknown;
          content?: { type?: string; text?: string }[];
        };
        error?: { message?: string; data?: Json };
      }
    | undefined;
  if (res.status !== 200 || !msg || typeof msg !== "object") {
    if (msg?.error) {
      const body: Json = {
        ...(msg.error.data ?? {}),
        message: msg.error.message,
      };
      return {
        ok: false,
        status: res.status >= 400 ? res.status : statusOf(body.code),
        body,
      };
    }
    return res.status >= 500 || res.status === 200
      ? UNAVAILABLE
      : {
          ok: false,
          status: res.status,
          body: {
            error: "LookupFailed",
            code: "LookupFailed",
            message: `the registry lookup answered ${res.status}`,
          },
        };
  }
  const result = msg.result;
  const text = result?.content?.find((c) => c?.type === "text")?.text;
  const answer =
    result?.structuredContent ??
    (typeof text === "string" ? parse(text) : undefined);
  if (!result || typeof answer !== "object" || answer === null)
    return UNAVAILABLE;
  if (result.isError) {
    const body = answer as Json;
    const code = body.code ?? body.error;
    if (code === "RegistryUnavailable") return UNAVAILABLE;
    return { ok: false, status: statusOf(code), body };
  }
  const record = answer as Json;
  if (record.urn !== urn) return UNAVAILABLE;

  // The owner and the linked entity, by the property pages' rule.
  const facts = (Array.isArray(record.facts) ? record.facts : []) as Json[];
  const owner = facts.find(
    (f) => f?.predicate === "ownership.owner_of_record",
  )?.value;
  const personStyle = typeof owner === "string" && ownerNamesAPerson(owner);
  let entity: unknown;
  const link = (
    (Array.isArray(record.relationships) ? record.relationships : []) as Json[]
  ).find(
    (r) =>
      r?.type === "owns" &&
      r.to_urn === urn &&
      typeof r.from_urn === "string" &&
      r.from_urn.startsWith("fl:entity:"),
  );
  if (!personStyle && typeof owner === "string" && link && deps.registry) {
    try {
      const got = await registryRunner(deps.registry)("registry_get", {
        urn: link.from_urn,
      });
      if (got.ok) entity = keepEntityFacts(got.result);
    } catch {
      entity = undefined; // the sheet then names the entity by its FactLot ID only
    }
  }
  return {
    ok: true,
    lookup: {
      record,
      plan: deps.plan,
      ...(personStyle ? { owner_person_style: true } : {}),
      ...(entity !== undefined ? { entity } : {}),
    },
  };
}

/** The entity facts a sheet may print: its name, status and registry number. Nothing else is kept. */
const ENTITY_FACTS = new Set([
  "entity.legal_name",
  "entity.status",
  "entity.registry_number",
]);

export function keepEntityFacts(rec: unknown): unknown {
  if (typeof rec !== "object" || rec === null) return undefined;
  const r = rec as Json;
  return {
    urn: r.urn,
    kind: r.kind,
    facts: ((Array.isArray(r.facts) ? r.facts : []) as Json[]).filter((f) =>
      ENTITY_FACTS.has(String(f?.predicate)),
    ),
  };
}

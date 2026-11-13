/**
 * The registry lookup behind a property_sheet report. The sheet is built from registry_get on the
 * parcel, run as the caller's own call: the router sends it back through itself as an MCP
 * tools/call with the caller's credentials and address, so the call is metered, refunded and
 * gated exactly like any registry_get of theirs (one lookup; a free caller's answer keeps the
 * current roll year only). The report is reserved before this runs (reports.ts); when the sheet
 * then cannot be built or stored, the lookup is given back through the router's own give-back.
 *
 * The linked entity is the one read the caller is not charged for, as the public property pages
 * read it, and under the pages' rule: only when the owner of record may be printed, the entity's
 * name does not read like a person's, and every source behind its name may be republished
 * (recorded redistribution permitted, or the source listed in PROPERTY_PAGES_EXTRA_SOURCES), as
 * the registry's /pages/sources says. Only its name, status and registry number are kept.
 *
 * A paid caller's call adds include_history, so the sheet can name the files behind the earlier
 * roll years; history is cut to the current facts for a free caller anyway, so a free caller's
 * call does not ask for it.
 */
import type { RegistryLookup, SheetPlan } from "@factlot/reports";
import { hostedWithheldCounties, ownerNamesAPerson } from "@factlot/tools";

import {
  entityPageRefs,
  parseSourceList,
  refsAllowed,
  type PageRecord,
  type SourceRef,
} from "../../registry/src/page-rules.ts";

import { innerRequest } from "./internal.ts";
import { sourceIds } from "./property-pages.ts";
import { registryRunner } from "./registry.ts";
import type { Fetcher } from "./types.ts";

type Json = Record<string, unknown>;

/** The registry quota headers of the caller's lookup, passed on with the sheet's answer. */
export const LOOKUP_QUOTA_HEADERS = [
  "x-factlot-registry-quota-limit",
  "x-factlot-registry-quota-remaining",
  "x-factlot-registry-quota-reset",
];

export type SheetLookupOutcome =
  | {
      ok: true;
      lookup: RegistryLookup;
      headers: Record<string, string>;
      /** Give the caller's charged lookup back; true when it was. */
      refundLookup: () => Promise<boolean>;
    }
  | {
      ok: false;
      status: number;
      body: Json;
      headers: Record<string, string>;
    };

export interface SheetLookupDeps {
  plan: SheetPlan;
  /** Send one MCP request as the caller (the router, re-entered with their credentials). */
  callMcp: (body: string) => Promise<Response>;
  /** The router's give-back of one of this caller's lookups in the window ending at `resetsAt`. */
  giveBack?: (resetsAt: string) => Promise<boolean>;
  /** The registry service binding, for the linked entity's record. */
  registry?: Fetcher;
  /** PROPERTY_PAGES_EXTRA_SOURCES: source ids whose pages (and so entity lines) are allowed. */
  extraSources?: string;
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

const UNAVAILABLE_BODY: Json = {
  error: "ServiceUnavailable",
  code: "ServiceUnavailable",
  message:
    "the registry lookup for this sheet did not answer, so no lookup and no report were counted; retry in a few seconds.",
  retry_after_seconds: 5,
  next: "retry after 5 seconds",
};

/** The body for an answer that was counted as a lookup but is not one the sheet can read. */
function unreadable(givenBack: boolean): Json {
  return {
    error: "LookupUnreadable",
    code: "LookupUnreadable",
    message: givenBack
      ? "the registry answered with something that is not this parcel's record, so no sheet was made; the report and the lookup were given back."
      : "the registry answered with something that is not this parcel's record, so no sheet was made; the report was given back, but the lookup could not be and stays counted.",
    retry_after_seconds: 5,
    next: `retry once; if it fails again, email contact@factlot.com`,
  };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * An MCP POST to /mcp on the same host carrying only what identifies the caller: their
 * Authorization header and Cloudflare's client address. The router answers it as theirs. It is
 * built with innerRequest, which gives it the Host header a Request built in a Worker lacks: the
 * MCP transport in the inner handler (the MCP SDK's StreamableHTTPServerTransport, through
 * @hono/node-server's getRequestListener) answers an empty 400 to a request without one.
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
  return innerRequest(`${url.origin}/mcp`, { method: "POST", headers, body });
}

/** registry_get on the parcel as the caller, then the linked entity when the pages' rule allows it. */
export async function lookupForSheet(
  urn: string,
  deps: SheetLookupDeps,
): Promise<SheetLookupOutcome> {
  const reason = withheldCounty(urn);
  if (reason)
    return {
      ok: false,
      status: 404,
      headers: {},
      body: {
        error: "NotFound",
        code: "CountyWithheld",
        message: `this parcel's county is not served by the hosted registry: ${reason}. Nothing was charged.`,
        next: "see https://factlot.com/coverage/ for the counties served",
        issues: [],
      },
    };
  const unavailable: SheetLookupOutcome = {
    ok: false,
    status: 503,
    headers: {},
    body: UNAVAILABLE_BODY,
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
    return unavailable;
  }
  const headers: Record<string, string> = {};
  for (const h of LOOKUP_QUOTA_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  // The router charges a 200 answer that is not a tool error (mcpCharges): only then is there a
  // lookup to give back, in the window the quota headers name.
  let refunded = false;
  const refundLookup = async (): Promise<boolean> => {
    const resetsAt = headers["x-factlot-registry-quota-reset"];
    if (refunded) return true;
    if (!deps.giveBack || !resetsAt) return false;
    refunded = await deps.giveBack(resetsAt).catch(() => false);
    if (refunded) {
      const left = Number(headers["x-factlot-registry-quota-remaining"]);
      const limit = Number(headers["x-factlot-registry-quota-limit"]);
      if (Number.isFinite(left) && Number.isFinite(limit))
        headers["x-factlot-registry-quota-remaining"] = String(
          Math.min(limit, left + 1),
        );
    }
    return refunded;
  };
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
  if (res.status !== 200) {
    if (msg?.error) {
      const body: Json = {
        ...(msg.error.data ?? {}),
        message: msg.error.message,
      };
      return { ok: false, status: res.status, headers, body };
    }
    return res.status >= 500
      ? { ...unavailable, headers }
      : {
          ok: false,
          status: res.status,
          headers,
          body: {
            error: "LookupFailed",
            code: "LookupFailed",
            message: `the registry lookup answered ${res.status}; no lookup and no report were counted`,
          },
        };
  }
  if (!msg || typeof msg !== "object" || msg.error)
    // A 200 the router could not read is counted as an answer: give it back.
    return {
      ok: false,
      status: 502,
      headers,
      body: unreadable(await refundLookup()),
    };
  const result = msg.result;
  const text = result?.content?.find((c) => c?.type === "text")?.text;
  const answer =
    result?.structuredContent ??
    (typeof text === "string" ? parse(text) : undefined);
  if (result?.isError) {
    // A tool error is never charged.
    const body = (
      typeof answer === "object" && answer !== null ? answer : {}
    ) as Json;
    const code = body.code ?? body.error;
    if (code === "RegistryUnavailable") return { ...unavailable, headers };
    return { ok: false, status: statusOf(code), headers, body };
  }
  const record = answer as Json | undefined;
  if (!result || !record || typeof record !== "object" || record.urn !== urn)
    return {
      ok: false,
      status: 502,
      headers,
      body: unreadable(await refundLookup()),
    };

  // The owner and the linked entity, by the property pages' rule.
  const facts = (Array.isArray(record.facts) ? record.facts : []) as Json[];
  const owner = facts.find(
    (f) => f?.predicate === "ownership.owner_of_record",
  )?.value;
  const link = (
    (Array.isArray(record.relationships) ? record.relationships : []) as Json[]
  ).find(
    (r) =>
      r?.type === "owns" &&
      r.to_urn === urn &&
      typeof r.from_urn === "string" &&
      r.from_urn.startsWith("fl:entity:"),
  );
  let entity: unknown;
  if (
    typeof owner === "string" &&
    !ownerNamesAPerson(owner) &&
    link &&
    deps.registry
  )
    entity = await allowedEntity(
      deps.registry,
      String(link.from_urn),
      deps.extraSources,
    );
  return {
    ok: true,
    headers,
    refundLookup,
    lookup: {
      record,
      plan: deps.plan,
      ...(entity !== undefined ? { entity } : {}),
    },
  };
}

/**
 * The linked entity's record (name, status and registry number only) when the property pages would
 * show it: a name that does not read like a person's, and every source behind the name may be
 * republished. Anything else, a failed read included, gives undefined: the sheet then prints the
 * owner of record and says the entity's details are not printed.
 */
export async function allowedEntity(
  registry: Fetcher,
  entityUrn: string,
  extraSources: string | undefined,
): Promise<unknown> {
  try {
    const got = await registryRunner(registry)("registry_get", {
      urn: entityUrn,
    });
    if (!got.ok) return undefined;
    const rec = got.result as PageRecord;
    if (rec?.urn !== entityUrn) return undefined;
    const name = (rec.facts ?? []).find(
      (f) => f?.predicate === "entity.legal_name",
    )?.value;
    if (typeof name !== "string" || ownerNamesAPerson(name)) return undefined;
    // The pages check the name's sources; the sheet also prints status and registry number, so
    // their sources must pass the same rule.
    const kept = keepEntityFacts(rec) as { facts: PageRecord["facts"] };
    const refs: SourceRef[] = [
      ...entityPageRefs(rec),
      ...(kept.facts ?? [])
        .filter((f) => f.predicate !== "entity.legal_name")
        .flatMap((f) =>
          (f.provenance?.sources?.length
            ? f.provenance.sources
            : [{ document_id: "" }]
          ).map((s) => ({
            document_id: s.document_id,
            subject: entityUrn,
            as_of: f.as_of ?? "",
            rights: f.rights ?? null,
          })),
        ),
    ];
    const ids = await sourceIds(registry, refs);
    const allowed = refsAllowed(
      refs,
      (r: SourceRef) => ids[r.document_id] ?? null,
      parseSourceList(extraSources),
    );
    return allowed ? kept : undefined;
  } catch {
    return undefined;
  }
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

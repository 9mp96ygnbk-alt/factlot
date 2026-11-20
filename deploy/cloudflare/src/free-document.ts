/**
 * The first full document free (owner decision, 2026-11-19).
 *
 * The expense audit, the estoppel certificate and the rent roll certificate are included in Pro and
 * Team (with the monthly allowance, no charge per document). A free, email-verified account (an
 * fl_free_ key; not a guest key, not a shared free-tier OAuth connection, not anonymous) gets ONE
 * full document in total across the three tools; after that it gets the summary.
 *
 * Where it is kept: one Durable Object per account (`meter:freedoc:<account id>`, the LIMITER
 * class, endpoint /freedoc in limiter.ts). The account id is the hash of the address's salted email
 * hash (exchange-account.ts), so replacing the key (rotation) keeps the account and the record.
 * The record has no expiry; deleting the address (freekey.ts) forgets it with the rest.
 *
 * How it is given, safely under concurrency:
 *   1. before a request that contains a document-tool call, the router reserves the free document
 *      (the Durable Object does it atomically: a second request sees "busy" and gets the summary);
 *   2. the tool computes its whole answer (an input error throws first and consumes nothing) and
 *      asks the host's `use`; the first ask takes the reservation;
 *   3. after the tool, the router commits the reservation (the answer is returned only when the
 *      commit succeeded; otherwise the request is run again as a summary) or releases it.
 * A reservation lapses after RESERVATION_MS, so a lost request never locks the account.
 *
 * The report: the free document covers the tool result AND its report for 24 hours, for the same
 * document: the document id is the hash of the tool's whole answer, and report_create's id for the
 * same arguments is the same. The same document asked for again inside the 24 hours is whole again
 * and not counted again. Report quotas (reports_per_month) apply as for any report.
 */
import { hashKey } from "./keys.ts";
import {
  FREE_DOCUMENT_COVER_HOURS,
  FREE_DOCUMENT_TOOLS,
  type FreeDocumentHost,
  type FreeDocumentUse,
} from "@factlot/tools";
import type { Env, FreeDocumentRecord } from "./types.ts";

export const RESERVATION_MS = 90_000;
const COVER_MS = FREE_DOCUMENT_COVER_HOURS * 60 * 60 * 1000;

/** REST path of each document tool. */
const REST_PATHS = new Map<string, string>([
  ["/v1/audit/expense-statement", "audit_expense_statement"],
  ["/v1/estoppel/prepare", "estoppel_prepare"],
  ["/v1/rent-roll/certify", "rent_roll_certify"],
]);

/** Whether a request (REST path, or an MCP body) calls one of the document tools. */
export function callsDocumentTool(path: string, body?: string): boolean {
  if (REST_PATHS.has(path)) return true;
  if (path !== "/mcp" || body === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const names = new Set<string>(FREE_DOCUMENT_TOOLS);
  return (Array.isArray(parsed) ? parsed : [parsed]).some((m) => {
    const x = m as { method?: unknown; params?: { name?: unknown } } | null;
    return (
      x?.method === "tools/call" &&
      typeof x.params?.name === "string" &&
      names.has(x.params.name)
    );
  });
}

/** The meter subject of an account's record: from the address's salted email hash. */
export async function freeDocumentSubject(emailHash: string): Promise<string> {
  return `freedoc:acct_free_${(await hashKey(`exchange:${emailHash}`)).slice(0, 32)}`;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Whether `record` covers this document now. */
export function covers(
  record: FreeDocumentRecord | undefined,
  tool: string,
  documentId: string,
  nowMs: number,
): boolean {
  return (
    record !== undefined &&
    record.tool === tool &&
    record.document_id === documentId &&
    nowMs < Date.parse(record.at) + COVER_MS
  );
}

export interface FreeDocumentRun {
  host: FreeDocumentHost;
  /** After the tool ran: commit what it used, or give the reservation back. */
  finish(ok: boolean): Promise<{ committed: boolean; consumed: boolean }>;
}

/**
 * Reserve the free document for one request of an entitled account and return the host the tool
 * asks. Fails closed: a meter that cannot be reached means no free document (the summary).
 */
export async function startFreeDocument(
  env: Env,
  subject: string,
  now: () => number,
): Promise<FreeDocumentRun | undefined> {
  const meter = env.METER.freeDocument;
  if (!meter) return undefined;
  let state: Awaited<ReturnType<typeof meter.reserve>>;
  try {
    state = await meter.reserve(subject, RESERVATION_MS);
  } catch {
    console.error(JSON.stringify({ msg: "free document reserve failed" }));
    return undefined;
  }
  const prior = state.state === "used" ? state.used : undefined;
  const reservation = state.state === "available" ? state.id : undefined;
  let consumed: { tool: string; document_id: string } | undefined;
  const host: FreeDocumentHost = {
    use(tool, documentId): FreeDocumentUse {
      if (covers(prior, tool, documentId, now()))
        return {
          granted: true,
          again: true,
          used_at: prior!.at,
          covers_until: iso(Date.parse(prior!.at) + COVER_MS),
        };
      if (
        consumed &&
        consumed.tool === tool &&
        consumed.document_id === documentId
      )
        return {
          granted: true,
          again: true,
          used_at: iso(now()),
          covers_until: iso(now() + COVER_MS),
        };
      if (reservation && !consumed) {
        consumed = { tool, document_id: documentId };
        return { granted: true, covers_until: iso(now() + COVER_MS) };
      }
      if (prior)
        return { granted: false, used_at: prior.at, used_tool: prior.tool };
      if (consumed)
        return {
          granted: false,
          used_at: iso(now()),
          used_tool: consumed.tool,
        };
      return { granted: false, busy: true };
    },
  };
  return {
    host,
    async finish(ok) {
      if (!reservation) return { committed: false, consumed: false };
      if (consumed && ok) {
        try {
          const committed = await meter.commit(
            subject,
            reservation,
            consumed.tool,
            consumed.document_id,
          );
          return { committed, consumed: true };
        } catch {
          console.error(JSON.stringify({ msg: "free document commit failed" }));
          return { committed: false, consumed: true };
        }
      }
      try {
        await meter.release(subject, reservation);
      } catch {
        // The reservation lapses by itself.
      }
      return { committed: false, consumed: consumed !== undefined };
    },
  };
}

/** For report_create: does this account's free document cover this document? */
export async function freeDocumentCovers(
  env: Env,
  subject: string,
  tool: string,
  documentId: string,
  nowMs: number,
): Promise<boolean> {
  try {
    const s = await env.METER.freeDocument?.status(subject);
    return covers(s?.used, tool, documentId, nowMs);
  } catch {
    return false;
  }
}

/**
 * What account_status and account_usage say about the document tools. They are paid-only tools
 * (PAID_ONLY account_tools), so the caller has a Pro or Team plan (or a guest key): the documents
 * are included and the free document is not what applies to it. A free key cannot call them; its
 * own answers from the document tools say whether the free document is available or used.
 */
export const DOCUMENTS_BLOCK = {
  tools: [...FREE_DOCUMENT_TOOLS],
  reports: ["expense_audit", "estoppel_certificate", "rent_roll_certificate"],
  included_in_plan: true,
  per_document_charge: false,
  note: "The expense audit, the estoppel certificate and the rent roll certificate are included in Pro and Team with the monthly allowance (reports count against reports_per_month); there is no charge per document.",
  free_document: {
    applies: false,
    note: "The one free full document is for free, email-verified accounts (fl_free_ keys); a plan with these documents included does not use it.",
  },
} as const;

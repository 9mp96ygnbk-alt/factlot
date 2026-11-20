/**
 * The first full document free: the hosted rule for the three document tools
 * (audit_expense_statement, estoppel_prepare, rent_roll_certify).
 *
 * On the hosted API a caller without a Pro or Team key gets the summary of these tools. One
 * exception: each free, email-verified account gets ONE full document in total across the three.
 * The host (the Worker) decides who is entitled and keeps the durable record; this file is the
 * part that runs inside a tool. The host hands in a `freeDocument` object with runWithExchangeCaller;
 * a tool that has computed its whole answer asks it, with the tool's name and the document's id,
 * whether this answer is the account's free one:
 *
 *   - the first full answer of the account: granted, and the host records it once the answer is
 *     returned (an input error never gets this far, so it never counts);
 *   - the same document again (same id) within 24 hours: granted again, and not counted again;
 *   - anything else: the summary, with a line saying the free document was used and where to go.
 *
 * The document id is the SHA-256 of the canonical JSON of the tool's whole answer. The tools are
 * deterministic (no clock, no model), so the same arguments always give the same id, and the report
 * built from those arguments (report_create) has the same id: the free document covers the tool
 * result and its report.
 *
 * Locally, and for any host that sets nothing, nothing here runs and the answer is whole.
 */
import { createHash } from "node:crypto";

import type { Json } from "./documents.ts";
import { currentExchangeCaller } from "./exchange.ts";
import { canonicalJson } from "./packages.ts";

export const FREE_DOCUMENT_PLAN_URL = "https://factlot.com/pricing/";

/** The tools that return a document (the three the free document is counted across). */
export const FREE_DOCUMENT_TOOLS = [
  "audit_expense_statement",
  "estoppel_prepare",
  "rent_roll_certify",
] as const;

/** How long the free document covers the same document asked for again, and its report. */
export const FREE_DOCUMENT_COVER_HOURS = 24;

/** What the host says about one ask. */
export interface FreeDocumentUse {
  /** True: return the whole answer. */
  granted: boolean;
  /** Granted for a document the account already used its free document on (not counted again). */
  again?: boolean;
  /** When the free document was used (ISO), when known. */
  used_at?: string;
  /** The tool the free document was used on, when it was not this one. */
  used_tool?: string;
  /** Not granted only because another request of the account holds the free document right now. */
  busy?: boolean;
  /** Until when (ISO) the free document covers its document and report. */
  covers_until?: string;
}

/** Set by the host through runWithExchangeCaller({ freeDocument }). Synchronous: tools are. */
export interface FreeDocumentHost {
  use(tool: string, documentId: string): FreeDocumentUse;
}

/** The id of a document: SHA-256 of the canonical JSON of the tool's whole answer. */
export function documentId(full: Json): string {
  return createHash("sha256").update(canonicalJson(full), "utf8").digest("hex");
}

/** The line that goes with a whole answer given as the free document. */
export function freeDocumentNote(use: FreeDocumentUse): Json {
  if (use.again)
    return {
      free_document: true,
      counted_again: false,
      covers_until: use.covers_until ?? null,
      note: `This is the whole answer to the document this account used its one free full document on${use.used_at ? ` (${use.used_at})` : ""}; asking for it again is not counted again, and its report (report_create) is covered until ${use.covers_until ?? "24 hours after it was first used"}. A different document needs a Pro or Team plan: ${FREE_DOCUMENT_PLAN_URL}`,
    };
  return {
    free_document: true,
    counted_again: false,
    covers_until: use.covers_until ?? null,
    note: `This was this account's one free full document (across the expense audit, the estoppel certificate and the rent roll certificate). The whole answer is returned, and its report (report_create, the same arguments) is covered until ${use.covers_until ?? "24 hours from now"}. Later documents return the summary only; the whole answer needs a Pro or Team plan (included, with the monthly allowance, at no charge per document): ${FREE_DOCUMENT_PLAN_URL}`,
  };
}

/** The line that goes with a summary when the account is entitled to a free document and has used it. */
function freeDocumentUsedNote(use: FreeDocumentUse): Json {
  return {
    free_document: false,
    free_document_used_at: use.used_at ?? null,
    note: use.busy
      ? `This account's one free full document is being used by another request right now; ask again in a minute to see whether it is still available. Pro and Team plans include every document: ${FREE_DOCUMENT_PLAN_URL}`
      : `This account's one free full document was already used${use.used_at ? ` (${use.used_at})` : ""}${use.used_tool ? ` on ${use.used_tool}` : ""}. The summary is returned; the whole answer needs a Pro or Team plan: ${FREE_DOCUMENT_PLAN_URL}`,
  };
}

/**
 * The plan rule of one document tool. `limited` is the host's word that this caller gets the
 * summary (gating on, no Pro or Team key). A limited caller the host has made entitled to a free
 * document gets the whole answer when it is the account's one; otherwise the summary.
 */
export function gateDocument(
  tool: (typeof FREE_DOCUMENT_TOOLS)[number],
  full: Json,
  summary: (full: Json) => Json,
  limited: boolean,
): Json {
  if (!limited) return full;
  const host = currentExchangeCaller()?.freeDocument;
  if (!host) return summary(full);
  const use = host.use(tool, documentId(full));
  if (use.granted)
    return {
      ...(full as object),
      free_document: freeDocumentNote(use),
    } as Json;
  return {
    ...(summary(full) as object),
    free_document: freeDocumentUsedNote(use),
  } as Json;
}

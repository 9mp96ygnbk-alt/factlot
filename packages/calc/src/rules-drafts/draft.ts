/**
 * Draft rules packs: shared metadata and result shape.
 *
 * A draft pack encodes law that no named maintainer has yet checked against the official text.
 * Drafts are kept apart from the verified `rulePacks` (which become tools): they are reachable
 * only through `runDraftRule`, which requires the caller to acknowledge the draft status, and
 * every result says `status: "draft"` and carries DRAFT_WARNING as its first warning.
 */
import { Trace } from "../core.ts";
import type { CalcResult } from "../core.ts";
import type { RuleMeta } from "../rules.ts";

/** First warning on every draft result. */
export const DRAFT_WARNING =
  "DRAFT — not verified against the official text; do not rely on it.";

export interface DraftCitation {
  /** Section cited, e.g. "NYC Admin. Code §28-320.3.1". */
  law: string;
  /** Official government URL the text was read from. */
  url: string;
  /** Date the drafter retrieved the official text (YYYY-MM-DD). */
  retrieved: string;
  /** Which elements of the rule this citation supports. */
  covers: string;
}

export interface DraftRuleMeta extends RuleMeta {
  citations: DraftCitation[];
  verification: {
    status: "draft";
    notes: string;
  };
  /** What the pack does not model; also surfaced as warnings where relevant. */
  not_covered: string[];
}

export type DraftValue<T> = T & { status: "draft"; rule: DraftRuleMeta };

export function draftResult<T extends object>(
  t: Trace,
  meta: DraftRuleMeta,
  value: T,
): CalcResult<DraftValue<T>> {
  t.warnings.unshift(
    `${DRAFT_WARNING} Rule ${meta.id}@${meta.version} has not been checked by a named maintainer against ${meta.citations.map((c) => c.law).join("; ")}.`,
  );
  return t.result(meta.id, meta.version, {
    ...value,
    status: "draft" as const,
    rule: structuredClone(meta),
  });
}

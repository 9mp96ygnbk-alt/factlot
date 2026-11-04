/**
 * doc_check_use_conflict: compare a proposed use with a center's verified exclusive-use and
 * prohibited-use facts, by use category (vocabularies.ts) and shared words. Deterministic and
 * textual: every hit is a potential conflict for a person to review, never a legal conclusion.
 * python/src/factlot/uses.py is the same code; spec/vectors/documents.json pins both.
 */
import { z } from "zod";

import { DOC_LIMITS, ToolInputError, validateFact } from "./documents.ts";
import { suggest } from "./limits.ts";
import { isPlainObject } from "./quotes.ts";
import { USE_CATEGORIES, USE_STOPWORDS } from "./vocabularies.ts";
import { KeywordIndex, words } from "./words.ts";

type Json = Record<string, unknown>;

export const CONFLICT_LABEL = "potential conflict — needs human review";
export const USE_CONFLICT_NOTE =
  "Potential conflicts only. FactLot compares the proposed use with each restriction by use category (the published vocabulary, spec/schemas/vocabularies/use-categories.json) and by shared words. It does not interpret the lease, decide whether a carve-out applies, or give a legal conclusion: every item needs review by a person, and an empty list does not mean there is no conflict.";

export const UseConflictInput = z.object({
  facts: z
    .array(
      z
        .record(z.string(), z.unknown())
        .describe(
          "A FactLot fact, as doc_verify_facts or doc_abstract_lease returned it.",
        ),
    )
    .min(1)
    .max(DOC_LIMITS.factsPerCall)
    .describe(
      "Verified lease.exclusive_use and lease.prohibited_uses facts for the center, from doc_verify_facts or doc_abstract_lease (each must pass fact_validate). Facts another fact supersedes are ignored; other predicates are skipped.",
    ),
  proposed_use: z
    .object({
      text: z
        .string()
        .min(1)
        .max(2_000)
        .describe(
          'The proposed use as described, e.g. "coffee shop selling espresso drinks and pastries".',
        ),
      category: z
        .string()
        .max(100)
        .optional()
        .describe(
          "Optional use category id from FactLot's vocabulary (spec/schemas/vocabularies/use-categories.json), e.g. coffee.",
        ),
      naics: z
        .string()
        .regex(/^[0-9]{2,6}$/, "expected a 2- to 6-digit NAICS code")
        .optional()
        .describe(
          "Optional 2022 NAICS code, 2 to 6 digits; a shorter code matches every category under it (7225 matches restaurants and coffee shops).",
        ),
    })
    .describe("The use to check."),
});

const INDEX = new KeywordIndex(
  USE_CATEGORIES.map((c) => ({ key: c.id, keywords: c.keywords })),
);
const STOP = new Set(USE_STOPWORDS.flatMap((w) => words(w)));
const LABELS = new Map(USE_CATEGORIES.map((c) => [c.id, c.label]));
const ORDER = new Map(USE_CATEGORIES.map((c, i) => [c.id, i]));

/** Categories whose keywords appear in the text, in vocabulary order, with the keywords found. */
function categoriesOf(text: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const m of INDEX.find(words(text))) {
    const list = found.get(m.key) ?? [];
    if (!list.includes(m.keyword)) list.push(m.keyword);
    found.set(m.key, list);
  }
  return new Map(
    [...found].sort((a, b) => ORDER.get(a[0])! - ORDER.get(b[0])!),
  );
}

/** Words that can carry a use: not a stopword, three letters or more, not a bare number. */
function significant(text: string): string[] {
  const out: string[] = [];
  for (const w of words(text))
    if (
      w.length >= 3 &&
      !/^[0-9]+$/.test(w) &&
      !STOP.has(w) &&
      !out.includes(w)
    )
      out.push(w);
  return out;
}

interface Proposed {
  categories: Set<string>;
  words: string[];
}

/** How a restriction matches the proposed use, or undefined when it does not. */
function match(
  proposed: Proposed,
  restriction: string,
): { categories: string[]; shared: string[] } | undefined {
  const categories = [...categoriesOf(restriction).keys()].filter((c) =>
    proposed.categories.has(c),
  );
  const own = significant(restriction);
  const shared = own.filter((w) => proposed.words.includes(w));
  const hit =
    categories.length > 0 ||
    shared.length >= 2 ||
    (shared.length >= 1 && shared.length === own.length);
  return hit ? { categories, shared } : undefined;
}

function citation(fact: Json): Json {
  const prov = fact.provenance as Json;
  const src = ((prov.sources as Json[])[0] ?? {}) as Json;
  const out: Json = {};
  for (const k of ["document_id", "title", "page", "section", "quote", "ocr"])
    if (src[k] !== undefined) out[k] = src[k];
  return out;
}

export function checkUseConflict(
  input: z.output<typeof UseConflictInput>,
): Json {
  const issues: { path: string; message: string }[] = [];
  input.facts.forEach((f, i) => {
    for (const x of validateFact(f).issues)
      issues.push({
        path: `facts.${i}${x.path ? `.${x.path}` : ""}`,
        message: x.message,
      });
  });
  const { text, category, naics } = input.proposed_use;
  if (category !== undefined && !LABELS.has(category)) {
    const near = suggest(category, [...LABELS.keys()]);
    issues.push({
      path: "proposed_use.category",
      message: `unknown use category${near ? ` (did you mean "${near}"?)` : ""}; see spec/schemas/vocabularies/use-categories.json`,
    });
  }
  if (issues.length) throw new ToolInputError(issues.slice(0, 20));

  // The proposed use's categories: the one given, those under the NAICS code, and keyword hits.
  const basis = new Map<string, string[]>();
  const add = (id: string, why: string): void => {
    const list = basis.get(id) ?? [];
    if (!list.includes(why)) list.push(why);
    basis.set(id, list);
  };
  if (category !== undefined) add(category, "category given");
  if (naics !== undefined)
    for (const c of USE_CATEGORIES)
      for (const code of c.naics ?? [])
        if (code.startsWith(naics) || naics.startsWith(code))
          add(c.id, `NAICS ${code}`);
  for (const [id, keywords] of categoriesOf(text))
    for (const k of keywords) add(id, `keyword "${k}"`);
  const proposedCategories = [...basis.keys()].sort(
    (a, b) => ORDER.get(a)! - ORDER.get(b)!,
  );
  const proposed: Proposed = {
    categories: new Set(proposedCategories),
    words: significant(text),
  };

  const superseded = new Set<unknown>();
  for (const f of input.facts)
    for (const id of (f.supersedes as unknown[] | undefined) ?? [])
      superseded.add(id);
  const conflicts: Json[] = [];
  const checked = { exclusive_use: 0, prohibited_uses: 0, ignored: 0 };
  const named = (ids: string[]): Json[] =>
    ids.map((id) => ({ id, label: LABELS.get(id) }));
  input.facts.forEach((f, i) => {
    if (f.id !== undefined && superseded.has(f.id)) {
      checked.ignored++;
      return;
    }
    const base = (restriction: string, use: string): Json => ({
      status: "potential_conflict",
      label: CONFLICT_LABEL,
      restriction,
      fact: i,
      ...(f.id !== undefined ? { fact_id: f.id } : {}),
      subject: f.subject,
      restricted_use: use,
    });
    if (f.predicate === "lease.exclusive_use") {
      checked.exclusive_use++;
      const v = f.value;
      const use = isPlainObject(v)
        ? (v.protected_use as string)
        : (v as string);
      const carveOuts =
        isPlainObject(v) && Array.isArray(v.carve_outs)
          ? (v.carve_outs as string[])
          : [];
      const m = match(proposed, use);
      if (!m) return;
      const mayApply = carveOuts.filter((c) => match(proposed, c));
      conflicts.push({
        ...base("exclusive_use", use),
        matched_categories: named(m.categories),
        shared_words: m.shared,
        ...(carveOuts.length ? { carve_outs: carveOuts } : {}),
        ...(mayApply.length ? { carve_outs_that_may_apply: mayApply } : {}),
        citation: citation(f),
      });
      return;
    }
    if (f.predicate === "lease.prohibited_uses") {
      for (const use of f.value as string[]) {
        checked.prohibited_uses++;
        const m = match(proposed, use);
        if (!m) continue;
        conflicts.push({
          ...base("prohibited_use", use),
          matched_categories: named(m.categories),
          shared_words: m.shared,
          citation: citation(f),
        });
      }
      return;
    }
    checked.ignored++;
  });
  return {
    proposed_use: {
      text,
      categories: proposedCategories.map((id) => ({
        id,
        label: LABELS.get(id),
        basis: basis.get(id),
      })),
      words: proposed.words,
    },
    potential_conflicts: conflicts,
    checked,
    summary: { potential_conflicts: conflicts.length },
    note: USE_CONFLICT_NOTE,
  };
}

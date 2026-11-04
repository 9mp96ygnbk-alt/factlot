/**
 * A small, built-in knowledge base for MCP `search` / `fetch` tools.
 *
 * ChatGPT deep research and company knowledge only use connectors that expose
 * read-only `search` and `fetch` tools; other agents use them to discover which
 * FactLot tool or predicate to use. The corpus is generated from the code itself
 * (tool catalog, predicate vocabulary, ID kinds), so it can never drift from it.
 */
import { SHORT_PREFIX } from "@factlot/id";
import { Predicates } from "@factlot/schema";
import { inputJsonSchema, tools } from "@factlot/tools";

const REPO = "https://github.com/9mp96ygnbk-alt/factlot/blob/main";

export interface KnowledgeDoc {
  id: string;
  title: string;
  url: string;
  text: string;
  metadata: Record<string, string>;
}

function describeFields(
  schema: Record<string, unknown>,
  prefix = "",
): string[] {
  const props = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    const name = `${prefix}${k}`;
    lines.push(
      `- ${name}${required.has(k) ? " (required)" : ""}: ${String(v.description ?? "")}`.trimEnd(),
    );
    if (v.properties) lines.push(...describeFields(v, `${name}.`));
    const items = v.items as Record<string, unknown> | undefined;
    if (items?.properties) lines.push(...describeFields(items, `${name}[].`));
  }
  return lines;
}

function buildCorpus(): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [
    {
      id: "guide:golden-rules",
      title: "How AI agents should use FactLot",
      url: `${REPO}/docs/agents.md`,
      text: [
        "1. Do not do commercial real estate math in context. Call a calc_* tool for rent schedules, abatement, net effective rent, proposal comparison, CAM reconciliation, percentage rent, loan sizing, ASC 842 lease remeasurement, loan prepayment and defeasance, WALT, NPV, IRR, lease-versus-own, renew-versus-relocate, and hotel operating metrics.",
        "2. Cite the method: report the formula id (e.g. calc.debt_sizing@3) and point to the returned steps.",
        "3. Surface every returned warning to a human.",
        "4. Use FactLot IDs (id_parcel, id_entity, id_building, id_space, id_document) as join keys across systems; they are deterministic and computed offline.",
        "5. Emit facts with provenance (document, page, section, quote) and check them with fact_validate. Uncited facts are rejected.",
        "6. Reading documents: you extract, FactLot verifies. Send the page text and, for each value, a verbatim quote and page to doc_verify_facts (doc_abstract_lease for a lease with amendments). FactLot runs no model: it checks the value's shape, that the quote is on the page, and that the quote states the value's numbers, dates and names, and returns cited facts, items for review and rejections with reasons.",
        "CAM caps: 'cumulative, compounding' → compounding_from_base; 'cumulative, non-compounding' → simple_from_base; 'non-cumulative' (each year over the prior year) → year_over_year.",
        "Free rent → abated_months (1-based). NNN proposals → put estimated expenses in additional_costs_psf_annual.",
      ].join("\n"),
      metadata: { kind: "guide" },
    },
    {
      id: "spec:factlot-id",
      title: "FactLot ID specification (v0.3)",
      url: `${REPO}/docs/id-spec.md`,
      text: [
        "FactLot IDs are canonical identifiers for commercial real estate. Deterministic where a natural key exists; registry-minted otherwise.",
        "Parcel: fl:parcel:us-<state FIPS><county FIPS>:<normalized APN>. The APN is lowercased and each run of separators becomes one hyphen, so APNs that differ only in where a separator falls (12-34, 1-234) stay distinct; in counties with a documented fixed-width format (NYC BBL, Los Angeles AIN, Cook County PIN, DC SSL) the fields are zero-padded and run together (BBL 3-1234-56 = 3012340056).",
        "Entity: fl:entity:<jurisdiction>:<file number> or fl:entity:lei:<LEI>; an LEI must pass its ISO 17442 check digits.",
        "Building: fl:building:us-<state FIPS><county FIPS>:<5-digit ZIP>:<street key> from the street address (units, suites and floors ignored; Northwest = NW), so every condominium unit of a building shares it; a minted 26-character token for a building with no street address.",
        "Document: fl:document:sha256-<hex of the file bytes>. Lease, loan: minted 26-character time-sortable tokens. Space: fl:space:<building>:<normalized suite> (Suite 100 = Ste 100 = #100; 1-20 and 120 differ).",
        `Short IDs: <prefix>_<24 chars of SHA-256(urn) in Crockford base32>. Prefixes: ${Object.entries(
          SHORT_PREFIX,
        )
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}.`,
      ].join("\n"),
      metadata: { kind: "spec" },
    },
    {
      id: "spec:fact-model",
      title: "FactLot fact model: provenance and AI-use rights",
      url: `${REPO}/docs/fact-model.md`,
      text: [
        "A fact is one atomic, citable claim: subject (FactLot URN), predicate (dotted lower_snake), value, unit, as_of date, provenance, and optional rights.",
        "provenance.method is one of human_verified, public_record, computed, extracted, reported, inferred. Every fact except a computed one must cite at least one source (document_id, page, section, quote); a computed fact names its formula. Unknown fields are rejected.",
        "rights.ai_use (permitted | prohibited | unknown) and rights.redistribution (permitted | attribution_required | prohibited | unknown) tell an agent whether it may read the fact and put it in a deliverable.",
        "Amendments supersede rather than overwrite: list replaced fact IDs in supersedes.",
      ].join("\n"),
      metadata: { kind: "spec" },
    },
  ];
  for (const t of tools) {
    docs.push({
      id: `tool:${t.name}`,
      title: `${t.title} (${t.name})`,
      url: `${REPO}/spec/schemas/tools.json`,
      text: [
        t.description,
        "",
        "Inputs:",
        ...describeFields(inputJsonSchema(t)),
      ].join("\n"),
      metadata: {
        kind: "tool",
        tool: t.name,
        rest_path: t.path,
        ...(t.formula
          ? { formula: `${t.formula.id}@${t.formula.version}` }
          : {}),
      },
    });
  }
  for (const [ns, names] of Object.entries(Predicates)) {
    docs.push({
      id: `predicates:${ns}`,
      title: `FactLot ${ns} predicates`,
      url: `${REPO}/packages/schema/src/index.ts`,
      text: `Standard predicates for ${ns} facts (namespaces are open; add asset-class-specific ones as needed):\n${names.join("\n")}`,
      metadata: { kind: "predicates", namespace: ns },
    });
  }
  return docs;
}

export const corpus: readonly KnowledgeDoc[] = buildCorpus();

function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

// Words that say nothing about which document fits ("how do I ... for a lease").
const STOPWORDS = new Set(
  (
    "a an and are as at be by can do does for from get how i if in into is it its me my of on or our " +
    "should that the their this to use using was we what when where which who why will with you your"
  ).split(" "),
);

/** A query term matches a word it equals, or one it begins when the term has 3 or more characters. */
function matches(term: string, word: string): boolean {
  return term.length >= 3 ? word.startsWith(term) : word === term;
}

/**
 * Share of a query's meaningful terms a document must contain to be returned. Below it the corpus
 * has nothing on the subject, and `search` answers with no results rather than the nearest tools.
 */
export const MIN_TERM_COVERAGE = 0.5;

/**
 * Rank documents by query-term matches (title weighted 3×). Deterministic; ties keep corpus order.
 * A document is returned only when it contains at least half of the query's terms (stopwords
 * dropped), so a query on a subject FactLot does not cover returns nothing.
 */
export function searchCorpus(query: string, limit = 8): KnowledgeDoc[] {
  const terms = [...new Set(tokens(query))].filter((t) => !STOPWORDS.has(t));
  if (terms.length === 0)
    return tokens(query).length ? [] : corpus.slice(0, limit);
  const scored = corpus.map((doc, i) => {
    const title = tokens(doc.title + " " + doc.id);
    const body = tokens(doc.text);
    let score = 0;
    let found = 0;
    for (const term of terms) {
      const t = title.filter((w) => matches(term, w)).length;
      const b = body.filter((w) => matches(term, w)).length;
      score += 3 * t + b;
      if (t + b > 0) found += 1;
    }
    return { doc, score, found, i };
  });
  return scored
    .filter((s) => s.score > 0 && s.found / terms.length >= MIN_TERM_COVERAGE)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.doc);
}

/** What `search` says when nothing matches. */
export const NO_MATCH_NOTE =
  "No FactLot knowledge document matches this query. FactLot covers commercial real estate calculators (rent, CAM, NER, loan sizing, NPV/IRR, ASC 842, prepayment, WALT, hotel metrics), FactLot IDs, cited facts, document verification and the public-record registry; try the calculation, ID or predicate you need, e.g. 'CAM cap', 'loan sizing DSCR', 'parcel ID'.";

export function fetchDoc(id: string): KnowledgeDoc | undefined {
  return corpus.find((d) => d.id === id);
}

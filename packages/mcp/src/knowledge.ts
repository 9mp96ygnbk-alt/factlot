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
        "4. Use FactLot IDs (id_parcel, id_entity, id_space, id_document) as join keys across systems; they are deterministic and computed offline.",
        "5. Emit facts with provenance (document, page, section, quote) and check them with fact_validate. Uncited facts are rejected.",
        "CAM caps: 'cumulative, compounding' → compounding_from_base; 'cumulative, non-compounding' → simple_from_base; 'non-cumulative' (each year over the prior year) → year_over_year.",
        "Free rent → abated_months (1-based). NNN proposals → put estimated expenses in additional_costs_psf_annual.",
      ].join("\n"),
      metadata: { kind: "guide" },
    },
    {
      id: "spec:factlot-id",
      title: "FactLot ID specification (v0.1)",
      url: `${REPO}/docs/id-spec.md`,
      text: [
        "FactLot IDs are canonical identifiers for commercial real estate. Deterministic where a natural key exists; registry-minted otherwise.",
        "Parcel: fl:parcel:us-<state FIPS><county FIPS>:<normalized APN>. Entity: fl:entity:<jurisdiction>:<file number> or fl:entity:lei:<LEI>.",
        "Document: fl:document:sha256-<hex of the file bytes>. Building, lease, loan: minted 26-character time-sortable tokens. Space: fl:space:<building token>:<normalized suite>.",
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
        "provenance.method is one of human_verified, public_record, computed, extracted, reported, inferred. Every non-computed, non-inferred fact must cite at least one source (document_id, page, section, quote).",
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

/** Rank documents by query-term matches (title weighted 3×). Deterministic; ties keep corpus order. */
export function searchCorpus(query: string, limit = 8): KnowledgeDoc[] {
  const terms = [...new Set(tokens(query))];
  if (terms.length === 0) return corpus.slice(0, limit);
  const scored = corpus.map((doc, i) => {
    const title = tokens(doc.title + " " + doc.id);
    const body = tokens(doc.text);
    let score = 0;
    for (const term of terms) {
      score += 3 * title.filter((w) => w.startsWith(term)).length;
      score += body.filter((w) => w.startsWith(term)).length;
    }
    return { doc, score, i };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.doc);
}

export function fetchDoc(id: string): KnowledgeDoc | undefined {
  return corpus.find((d) => d.id === id);
}

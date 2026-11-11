// Writes site/_data/texas-examples.json: one worked example per county page, produced by running
// the real registry tools (never the calculator) against a built registry file (opened read-only by configureRegistry). Only
// parcel.* facts are kept; owner names and mailing addresses never enter the file, and this script
// fails if the subject's owner strings appear in it.
//
//   node --experimental-strip-types --conditions=factlot-source \
//     scripts/site/gen-texas-examples.ts /path/to/tx.db
import { writeFileSync } from "node:fs";

import { configureRegistry, runTool } from "../../packages/tools/src/index.ts";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("usage: gen-texas-examples.ts /path/to/tx.db");
configureRegistry(dbPath);

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (name: string, input: Obj): Obj => {
  const r = runTool(name, input) as Obj;
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r).slice(0, 400)}`);
  return r.result;
};

const SUBJECTS = [
  { county: "harris", urn: "fl:parcel:us-48201:0011440000001" },
  // An office building (building class "OFFICE BUILDING", F10) held by an organisation, with a
  // neighborhood code, 117,078 SF of improvements and 20 same-neighborhood candidates.
  { county: "dallas", urn: "fl:parcel:us-48113:42196540010020000" },
];

const examples = SUBJECTS.map(({ county, urn }) => {
  const got = call("registry_get", { urn });
  const owners = got.facts
    .filter((f: Obj) => f.predicate.startsWith("ownership."))
    .map((f: Obj) => String(f.value));
  const parcelFacts = got.facts.filter((f: Obj) =>
    f.predicate.startsWith("parcel."),
  );
  const documents: Obj = {};
  const facts = parcelFacts.map((f: Obj) => {
    const s = f.provenance.sources[0];
    documents[s.document_id] = {
      title: s.title,
      uri: s.uri,
      retrieved_at: s.retrieved_at,
      license: f.rights.license,
      attribution: f.rights.attribution,
      ai_use: f.rights.ai_use,
      redistribution: f.rights.redistribution,
    };
    return {
      fact_id: f.id,
      predicate: f.predicate,
      value: f.value,
      unit: f.unit ?? null,
      as_of: f.as_of,
      document_id: s.document_id,
      locator: s.section,
    };
  });

  const cand = call("registry_tx_equity_candidates", { urn });
  const tierOf = new Map<string, string>();
  for (const t of cand.selection.tiers)
    for (const id of t.ids) tierOf.set(id, t.tier);
  const candidates = cand.candidates.slice(0, 10).map((c: Obj) => ({
    id: c.id,
    situs_address: c.situs_address,
    tier: tierOf.get(c.id),
    value: c.value,
    improvement_area_sf: c.improvement_area_sf,
    value_per_sf: Math.round((c.value / c.improvement_area_sf) * 100) / 100,
    year_built: c.year_built ?? null,
    neighborhood_code: c.neighborhood_code ?? null,
    fact_id: c.citation.fact_id,
  }));

  // The input an agent would pass to calc_tx_unequal_appraisal after a person reviews it. The
  // tool is deliberately not run: comparables and adjustments are the person's choice.
  const calcArgs = {
    tax_year: cand.calc_args.tax_year,
    subject: cand.calc_args.subject,
    comparables: cand.calc_args.comparables.slice(0, 10),
  };

  const out = {
    county,
    urn,
    label: got.label,
    status: got.status,
    parcel_facts: facts,
    documents,
    candidates_call: { urn },
    selection_rule: cand.selection_rule,
    selection_tiers: cand.selection.tiers.map((t: Obj) => ({
      tier: t.tier,
      key: t.key,
      applied: t.applied,
      matched: t.matched,
      returned: t.returned,
    })),
    candidates_total_returned: cand.selection_rule.returned,
    candidates_notice: cand.notice,
    candidates,
    calc_args: calcArgs,
  };
  const text = JSON.stringify({ ...out, candidates_notice: "" });
  for (const o of owners)
    if (o && text.includes(o))
      throw new Error(`${county}: an owner string leaked into the example`);
  if (/ownership\./.test(text) || /owner_of_record|mailing/.test(text))
    throw new Error(`${county}: ownership key in the example`);
  return out;
});

writeFileSync(
  new URL("../../site/_data/texas-examples.json", import.meta.url),
  `${JSON.stringify({ generated_with: "scripts/site/gen-texas-examples.ts", examples }, null, 2)}\n`,
);
console.log(
  examples.map((e) => `${e.county} ${e.candidates.length}`).join(", "),
);

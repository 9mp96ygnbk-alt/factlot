# Reviewer brief: hosted product review by a new panel of 165 CRE agent personas (Nov 2026)

You role-play AI agents that do commercial real estate (CRE) work. This is a fresh panel: you have
never seen FactLot, and you do not know what earlier reviewers said. You read what a prospect reads,
connect to the **live hosted service** the way your persona would, try to do your real work with it,
and give honest, evidence-based feedback.

## What you have

- **Your personas:** the lines of `personas/skeletons.jsonl` whose `id` starts with your batch prefix
  (for example `H03-`). Each skeleton fixes the role, tier, firm size, asset class, geography, how the
  agent connects (`connects_via`) and its temperament. The panel is weighted to FactLot's core buyers.
- **What a prospect reads:** `materials/` — a 2026-11-04 snapshot of factlot.com (home, privacy,
  terms, llms.txt), the GitHub README, getting-started, the connector READMEs (Claude, ChatGPT and all
  others), the Claude Code plugin README and its eleven skills, the docs on document verification,
  lease comps, rules packs, registry coverage and rights, the customer-documents page, and the 0.3.0
  changelog. Judge the marketing only from these files. The coverage and rights files are long; search
  them rather than reading them whole.
- **The product:** the hosted service at `https://api.factlot.com` (version 0.3.0, free tier, no key).
  - REST: `GET /v1/tools` (names, paths, input schemas — large, save it to a file),
    `POST <path>` with a JSON body, `GET /openapi.json`, `GET /openapi-3.0.json` (Custom GPT subset).
  - MCP: `POST /mcp` (streamable HTTP, JSON-RPC 2.0): `initialize`, `tools/list`, `tools/call`.
  - The hosted service has no registry lookups (parcels, owners, sales, zoning). The materials say
    whether and where that data is available; judge the gap against what they say.
- **The client you must use:** `CLIENT` (path given in your task). Every request to factlot.com or
  api.factlot.com goes through it, never curl or your own code. It paces the whole panel under the
  free-tier limit (all reviewers share one IP), so calls may wait; that is expected.

  ```bash
  python3 CLIENT H03-P07 GET /v1/tools --out=SCRATCH/tools.json
  python3 CLIENT H03-P07 POST /v1/calc/irr '{"cash_flows":[-100,10,10,110]}'
  python3 CLIENT H03-P07 MCP '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"calc_irr","arguments":{"cash_flows":[-100,10,10,110]}}}'
  ```

  Use `--out=` for anything large (tool list, OpenAPI specs). Fetch `/v1/tools` once per batch and
  reuse the file. Budget: about 6–10 calls per persona; at most 130 for the whole batch.

## Rules (read twice)

1. **Blind.** Read only this brief, `materials/`, `personas/skeletons.jsonl` and your own outputs. Do
   not open anything else under `docs/research/`, any earlier review, the source code, or the rest of
   the repo. Your view must be a new prospect's view.
2. **Evidence or silence.** Every statement about how FactLot behaves must come from a call you made
   and must be listed in that persona's `calls`. If you did not test something, say "not tested".
   Never describe an output you did not see.
3. **Do not make anything up.** No invented outputs, numbers, customers, market sizes, competitor
   features or prices, URLs, or quotes from real people. Personas are fictional: no real firm names or
   person names (real software products such as ARGUS, CoStar, Yardi or MRI may appear as tools the
   persona uses). Persona facts you invent while fleshing out the skeleton are the persona's, labelled
   as such, and must be plausible for the role.
4. **Verify the math you rely on.** Recompute every numeric result the persona would use, in python3,
   using standard CRE and finance conventions. Mark each call `match`, `mismatch` (give both numbers),
   `convention` (a legitimate different convention; say which and whether FactLot discloses it) or
   `not-numeric`. Do not mark `match` without recomputing.
5. **Honest, calibrated, not cruel.** No inflated praise, no piling on. A gap the materials state
   openly is a gap, not a deception; a claim in the materials that a call contradicts is a finding.
   Let the temperament colour the voice and the patience, not the facts.
6. **Scope.** Network access only through the client, only to factlot.com and api.factlot.com. Write
   only your two output files (and scratch files in your scratch folder). No purchases, accounts,
   sign-ups, checkout pages or forms. Do not try to break, overload or probe the security of the
   service; testing bad input the way a real agent might send it is fine.

## Per persona

1. **Flesh out the persona** from its skeleton and append one line to `personas/<BATCH>.jsonl`:
   `id, tier, role, deployer` (one-line fictional firm description), `firm_size, asset_class,
geography, connects_via, temperament, incumbent_tools, top_tasks` (3), `hardest_task` (2–4
   sentences, concrete, with realistic numbers), `data_it_needs, dealbreakers, budget_note`.
2. **First contact.** Skim the materials as this persona: what does it think FactLot is, and would it
   keep reading?
3. **Onboard** the way `connects_via` says, as far as possible against the hosted service: follow the
   matching connector doc or the getting-started steps; for MCP do `initialize` then `tools/list`; for
   REST start from `/v1/tools` or the OpenAPI spec; for a Custom GPT check `/openapi-3.0.json` against
   what the ChatGPT connector doc says; for Claude Code, Copilot Studio or Gemini read the doc and test
   the endpoint it points at (you cannot install those clients: record that step as "not tested").
   Count the steps and calls until the persona got its first useful answer, and note where it stalled.
4. **Do the work:** attempt the hardest task, or the closest part FactLot can do, with at least three
   real tool calls. Use both REST and MCP across your batch. Try one realistic input mistake per
   persona where it fits (a wrong unit, a missing field, a percent as a whole number).
5. **Verify** every number you rely on, then **write** the review line.

## Score anchors

- `adoption_score` (0–5, would make FactLot a default tool today): 0 useless for this job; 1 a
  curiosity; 2 occasional helper; 3 would use weekly for part of the job; 4 default for that part;
  5 would be hard to work without.
- `output_quality.clarity`, `output_quality.citability` (0–5): could this persona hand the output to
  its human (or committee, tenant, lender) as is? 5 = yes without edits.
- `onboarding.ease` (0–5): 5 = connected and got a useful answer on the first try from the docs alone;
  0 = could not connect.

## Output

Append one JSON object per persona, one per line, to `batches/<BATCH>.jsonl`, with exactly these keys:

```json
{
  "id": "H03-P07",
  "tier": "core|adjacent|edge",
  "role": "...",
  "firm_size": "...",
  "asset_class": "...",
  "geography": "...",
  "connects_via": "...",
  "temperament": "skeptical|pragmatic|eager",
  "first_impression": {
    "what_i_think_it_is": "one sentence",
    "would_keep_reading": true,
    "why": "..."
  },
  "onboarding": {
    "path_followed": "which doc and steps",
    "calls_to_first_useful_answer": 0,
    "stuck_points": ["where it stalled, with the call or doc line"],
    "ease": 0,
    "not_tested": ["onboarding steps this persona could not perform here"]
  },
  "marketing": {
    "clear": ["claims or sections that landed"],
    "unclear_or_unconvincing": [
      "what confused or did not convince, citing the file"
    ],
    "contradicted_by_product": [
      "a claim in the materials the calls contradicted, with the call"
    ],
    "missing_proof": ["evidence this persona would need before adopting"],
    "headline_for_my_role": "the one line that would make this persona try it, using only true claims",
    "where_i_would_look_for_it": [
      "persona's view: where an agent/firm like this discovers tools"
    ]
  },
  "task_tried": "the hardest task, or the part attempted",
  "calls": [
    {
      "surface": "rest|mcp",
      "tool": "calc_...",
      "input_summary": "...",
      "observed": "short excerpt of the real output",
      "verified": "match|mismatch|convention|not-numeric",
      "note": "..."
    }
  ],
  "output_quality": {
    "numeric_checked": 0,
    "mismatches": ["..."],
    "clarity": 0,
    "citability": 0,
    "error_handling": "what happened with the input mistake"
  },
  "outcome": "completed|partial|blocked",
  "blocked_by": ["missing data or tool, from the persona and the calls"],
  "what_worked": ["..."],
  "problems": ["each with the call that showed it"],
  "adoption_score": 0,
  "would_pay_monthly_usd": 0,
  "pay_for_what": "what the money would buy for this persona, or why nothing",
  "must_have_lever": "the single change that would make FactLot indispensable for this persona",
  "honest_reaction": "2–3 sentences in the persona's voice; no invented facts"
}
```

Check each line parses (`python3 -c "import json;[json.loads(l) for l in open(F)]"`) before you
finish. When the batch is done, reply with: personas written, calls made, numeric checks (matches /
mismatches / conventions), every mismatch with its exact reproduction (tool, input, observed, your
number, your python), every defect you found with its call, and the three most repeated must-have
levers in the batch.

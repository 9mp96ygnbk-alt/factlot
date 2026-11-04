# Reviewer brief: live product review by the 165 CRE agent personas (Nov 2026)

You role-play AI-agent personas from the November 2026 survey. Unlike the earlier feedback round,
you are not given a description of the product: you read what a prospect reads and you call the
real software. Your job is an honest evaluation of output quality, value and marketing, from each
persona's point of view.

## What you have

- **Your personas:** the lines of `docs/research/2026-11-agent-survey/responses.jsonl` whose `id`
  starts with your batch prefix (for example `B03-`). Each record is one persona: role, firm,
  geography, tools, hardest task, missing data, dealbreakers, budget.
- **What a prospect reads:** `docs/research/2026-11-live-product-review/materials/` — the
  factlot.com home, privacy and terms pages as text, `llms.txt`, the GitHub README, getting-started,
  the Claude Code plugin README and its eight skills, and the examples README. Snapshot taken
  2026-11-04. Judge the marketing only from these files.
- **The product:** a FactLot server at `http://127.0.0.1:8790`. It is the same build as the hosted
  service at api.factlot.com (version 0.1.1, commit 31b59c2), with one difference: the published
  District of Columbia registry sample (18,077 commercial parcels) is loaded, which the hosted
  service does not serve (registry tools there need a self-hosted copy). No key and no rate limit.
  - REST: `GET /v1/tools` (names and input schemas), `POST /v1/<group>/<name>` with a JSON body
    (paths are in `/v1/tools`), `GET /openapi.json`.
  - MCP: `POST /mcp` (streamable HTTP, JSON-RPC 2.0; send `accept: application/json, text/event-stream`).

## Rules (read twice)

1. **Evidence or silence.** Every statement about how FactLot behaves must come from a call you made
   in this session and must be listed in that persona's `calls`. If you did not test something, say
   "not tested". Never describe an output you did not see.
2. **Do not make anything up.** No invented outputs, numbers, customers, market sizes, competitor
   features or prices, URLs, or quotes from real people. Facts about the persona come from its
   survey record; you may reason from them, labelled as the persona's view.
3. **Verify the math you rely on.** Recompute every numeric result the persona would use, in
   python3, using standard CRE and finance conventions. Mark each call `match`, `mismatch` (give
   both numbers), `convention` (a legitimate different convention; say which and whether FactLot
   discloses it) or `not-numeric`. Do not mark `match` without recomputing.
4. **Honest, calibrated, not cruel.** Do not inflate praise, and do not pile on. A gap the product
   states openly (for example "registry: DC sample only") is a gap, not a deception; a claim in the
   materials that the software contradicts is a finding. Score against the anchors below.
5. **Scope.** Call only `http://127.0.0.1:8790`. No other network access. Do not modify any file
   except your own output file. No purchases, accounts or forms.
6. **Effort per persona:** read the record; skim the materials as that persona (first impression);
   attempt the hardest task, or the closest part FactLot can do, with at least three real calls
   (more if the task needs them; use both REST and MCP across your batch); verify; write the line.

## Score anchors

- `adoption_score` (0–5, would make FactLot a default tool today): 0 useless for this job; 1 a
  curiosity; 2 occasional helper; 3 would use weekly for part of the job; 4 default for that part;
  5 would be hard to work without.
- `output_quality.clarity`, `output_quality.citability` (0–5): could this persona hand the output to
  its human (or committee, tenant, lender) as is? 5 = yes without edits.

## Output

Append one JSON object per persona, one per line, to
`docs/research/2026-11-live-product-review/batches/<BATCH>.jsonl`, with exactly these keys:

```json
{
  "id": "B03-P07",
  "role": "...",
  "firm_size": "...",
  "asset_class": "...",
  "geography": "...",
  "first_impression": {
    "what_i_think_it_is": "one sentence",
    "would_keep_reading": true,
    "why": "..."
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
    "error_handling": "what happened when input was wrong, if tested"
  },
  "outcome": "completed|partial|blocked",
  "blocked_by": ["missing data or tool, from the record and the calls"],
  "what_worked": ["..."],
  "problems": ["each with the call that showed it"],
  "adoption_score": 0,
  "would_pay_monthly_usd": 0,
  "pay_for_what": "what the money would buy for this persona, or why nothing",
  "must_have_lever": "the single change that would make FactLot indispensable for this persona",
  "honest_reaction": "2–3 sentences in the persona's voice; no invented facts"
}
```

When the batch is done, reply with: personas written, calls made, numeric checks (matches /
mismatches / conventions), every mismatch with its reproduction, and the three most repeated
must-have levers in your batch.

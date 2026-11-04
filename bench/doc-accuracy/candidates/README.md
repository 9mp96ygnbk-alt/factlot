# Candidates: how they were produced

One extraction, `candidates/L01.json` … `L20.json`, produced by `candidates/extract.py`.

- **Tool:** the grok CLI (`/home/box/.local/bin/grok`, headless `--prompt-file` mode, structured
  output via `--json-schema`).
- **Model:** `grok-4.7` (`-m grok-4.7`), default reasoning effort.
- **One pass per lease.** One CLI run per document (`--max-turns 1`), run one at a time. Each file
  is the parsed output of that single run. No re-runs, no merging, no hand edits, nothing added or
  stripped afterward.
- **Prompt:** the shipped FactLot extractor prompt, unchanged, taken at run time from
  `python/src/factlot/ingest/extract.py`:
  - system prompt (`--system-prompt-override`): `_INSTRUCTIONS` followed by the `PREDICATES`
    list, one `- predicate: shape` line each (the same string `ClaudeExtractor` sends);
  - output schema (`--json-schema`): `_OUTPUT_SCHEMA` (`facts[]` of `predicate`, `value_json`,
    `quote`, `page`, `section`);
  - user message: `Document: <id> <exhibit> filed by <company> (<lease|amendment>)` followed by
    every page from `run.py`'s splitter as `[Page N]\n<text>`, N being the 1-based split-page index.
- **Conversion:** each fact becomes `{predicate, value, quote, page, section}`: `value` is
  `json.loads(value_json)` (the raw string when that fails), `section` is kept only when the model
  emitted a non-empty one. No `confidence` is emitted, so none is stored.
- **Parsing fallback (script change after L05).** On L06 the CLI returned `structuredOutput: null`
  with `model output was not valid JSON: trailing characters`: the model had written 14
  `{"facts": [...]}` objects back to back (13 empty, then the real one). `extract.py` was then
  changed to decode every object in the output text in order and concatenate their facts when
  the CLI's own parse fails, and L06.json was built from L06's saved CLI output with
  `--reparse L06` (no second model call). The same change raised the per-run timeout from 1,800 s
  to 3,600 s. The prompt, schema, model, flags and sandbox did not change. L01–L05 were produced
  with the earlier version (the CLI parsed them itself, so the fallback never applies to them);
  re-parsing their saved outputs with the current version gives byte-identical candidates.
  A lease where the fallback was used is listed under "Per-lease notes" below.
- **Inputs checked:** before each run the cached file's sha256 and the split pages' `text_sha256`
  were checked against `manifest.json`. No network request was made for lease text.
- **Blind to labels.** The extractor never received labels, the skip list, verifier output, or
  scores. grok ran from an empty scratch directory (`/tmp/grokx`) under a kernel-enforced sandbox
  profile (`extends = "strict"`, network restricted, `deny` on `/workspace/factlot-bench` and
  `/workspace/factlot-bench-cache`) with its file, shell, edit, web, and subagent tools removed
  (`--disallowed-tools`, `--disable-web-search`, `--no-subagents`), so the prompt was its only
  input. The session that wrote these files and ran the script did not open `labels/`, did not
  run `check-labels`, `verify`, or `score`, and read only the allowed parts of `PLAN.md`
  (candidate format, extraction, page splitting), `run.py`, `docs/ingest.md`, and
  `docs/document-verification.md`.
- Raw CLI output is kept outside git (`candidates/.logs/`, ignored).

## Script versions

`extract.py` changed once during the run, in commit `69c9ff9` (parsing fallback and timeout
above). Prompt, schema, model, CLI flags and sandbox were the same for every lease.

- Version 1 (commit `3871a78`): L01–L05. The CLI parsed all five itself, so the fallback would not
  have applied; re-parsing their saved outputs with version 2 gives identical files.
- Version 2 (commit `69c9ff9`): L06 (built from its version-1 run's saved output with `--reparse`,
  no second model call) and L07–L20 (extracted with version 2).

## Per-lease results

One CLI run each. "Fallback" means the CLI's own JSON parse failed because the output had several
`{"facts": [...]}` objects back to back, and `extract.py` decoded and concatenated them.

| Lease | Candidates | Parsed by |
| --- | --- | --- |
| L01 | 8 | CLI |
| L02 | 12 | CLI |
| L03 | 9 | CLI |
| L04 | 8 | CLI |
| L05 | 5 | CLI |
| L06 | 10 | fallback (14 objects) |
| L07 | 6 | fallback (6 objects) |
| L08 | 10 | CLI |
| L09 | 8 | CLI |
| L10 | 10 | CLI |
| L11 | 0 | CLI (model returned `{"facts": []}`) |
| L12 | 7 | fallback (3 objects) |
| L13 | 0 | fallback (3 objects, all empty) |
| L14 | 12 | fallback (8 objects) |
| L15 | 8 | fallback (5 objects) |
| L16 | 13 | CLI |
| L17 | 6 | fallback (9 objects) |
| L18 | 14 | fallback (4 objects) |
| L19 | 5 | fallback (5 objects) |
| L20 | 7 | CLI |

Total: 158 candidates. L11 and L13 have none. The model returned no facts in its single
pass, and they were not re-run, since a re-run would be a second extraction. Their labels
therefore all count as extractor misses. Every cited page is within the document's page
range. Commit `06d32bd`, titled for L07, also contains L08.json: L08 finished before that commit
was made.

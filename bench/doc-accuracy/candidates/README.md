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

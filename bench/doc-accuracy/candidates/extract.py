#!/usr/bin/env python3
"""Produce candidates/Lxx.json with the grok CLI, one pass per lease, blind to labels.

The prompt is the shipped extractor's (python/src/factlot/ingest/extract.py: _INSTRUCTIONS,
PREDICATES, _OUTPUT_SCHEMA); pages come from run.py's splitter. grok runs from an empty
scratch directory under a kernel sandbox that denies the repository and the cache, with its
built-in tools removed, so the only input it sees is the prompt below.

Usage: python3 candidates/extract.py L01 [L02 ...]
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent.parent.parent / "python" / "src"))
import run  # noqa: E402
from factlot.ingest import extract as fx  # noqa: E402

GROK = "/home/box/.local/bin/grok"
MODEL = "grok-4.7"
SCRATCH = Path("/tmp/grokx")  # empty dir; holds only .grok/sandbox.toml and the prompt file
SANDBOX = """[profiles.factlot_extract]
extends = "strict"
restrict_network = true
deny = ["/workspace/factlot-bench", "/workspace/factlot-bench-cache"]
"""
DISALLOWED = ("run_terminal_cmd,run_terminal_command,read_file,grep,list_dir,search_replace,write,Agent,"
              "web_search,web_fetch,monitor,workflow,search_tool,use_tool,spawn_subagent,"
              "kill_command_or_subagent,get_command_or_subagent_output,todo_write,scheduler_create,"
              "scheduler_delete,scheduler_list,enter_plan_mode,exit_plan_mode,ask_user_question,"
              "send_feedback,image_gen,image_edit,image_to_video,reference_to_video")


def system_prompt() -> str:
    return fx._INSTRUCTIONS + "\n".join(f"- {p}: {shape}" for p, shape in fx.PREDICATES.items())


def user_prompt(d: dict, pages: list[str]) -> str:
    body = "\n\n".join(f"[Page {i}]\n{t}" for i, t in enumerate(pages, 1))
    role = "amendment" if d["doc_kind"] == "amendment" else "lease"
    return f"Document: {d['id']} {d['exhibit']} filed by {d['company']} ({role})\n\n{body}"


def extract_one(d: dict) -> dict:
    raw = (run.CACHE / "docs" / f"{d['id']}{run._ext(d['url'])}").read_bytes()
    if hashlib.sha256(raw).hexdigest() != d["sha256"]:
        raise SystemExit(f"{d['id']}: sha256 mismatch")
    pages = run.split_pages(raw, run._ext(d["url"]))
    if run.text_sha256(pages) != d["text_sha256"]:
        raise SystemExit(f"{d['id']}: text_sha256 mismatch")
    (SCRATCH / ".grok").mkdir(parents=True, exist_ok=True)
    (SCRATCH / ".grok" / "sandbox.toml").write_text(SANDBOX)
    pf = SCRATCH / "prompt.txt"
    pf.write_text(user_prompt(d, pages))
    cmd = [GROK, "-m", MODEL, "--cwd", str(SCRATCH), "--sandbox", "factlot_extract",
           "--disallowed-tools", DISALLOWED, "--disable-web-search", "--no-subagents", "--max-turns", "1",
           "--system-prompt-override", system_prompt(), "--json-schema", json.dumps(fx._OUTPUT_SCHEMA),
           "--prompt-file", str(pf)]
    p = subprocess.run(cmd, cwd=SCRATCH, capture_output=True, text=True, timeout=1800)
    pf.unlink()
    log = HERE / ".logs"
    log.mkdir(exist_ok=True)
    (log / f"{d['id']}.out.json").write_text(p.stdout)
    out = json.loads(p.stdout)
    so = out.get("structuredOutput")
    if not so:
        raise SystemExit(f"{d['id']}: no structured output ({out.get('structuredOutputError')}, stop {out.get('stopReason')})")
    cands = []
    for f in so["facts"]:
        try:
            value = json.loads(f["value_json"])
        except json.JSONDecodeError:
            value = f["value_json"]
        c = {"predicate": f["predicate"], "value": value, "quote": f["quote"], "page": int(f["page"])}
        if f.get("section"):
            c["section"] = f["section"]
        cands.append(c)
    return {"doc": d["id"], "candidates": cands}


def main() -> None:
    docs = {d["id"]: d for d in run.load_manifest()["documents"]}
    for doc_id in sys.argv[1:]:
        res = extract_one(docs[doc_id])
        (HERE / f"{doc_id}.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n")
        print(f"{doc_id}: {len(res['candidates'])} candidates", flush=True)


if __name__ == "__main__":
    main()

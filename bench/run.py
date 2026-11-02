"""Run FactLot Bench: every task with and without FactLot tools, then score.

    pip install anthropic
    python bench/run.py --model <claude-model-id> [--modes baseline,factlot] [--tasks id1,id2] [--out results.json]

Credentials come from the environment (ANTHROPIC_API_KEY, or an `ant auth login` profile).
The model is always chosen by the caller; nothing is hardcoded here.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "python" / "src"))
sys.path.insert(0, str(HERE))

import factlot  # noqa: E402
from score import score_task  # noqa: E402

SYSTEM = (
    "You are an AI agent doing commercial real estate analysis. Work carefully and answer exactly "
    "what is asked."
)
MODES = {"baseline": False, "factlot": True}


def load_tasks(ids: list[str] | None = None) -> list[dict[str, Any]]:
    tasks = json.loads((HERE / "tasks.json").read_text("utf-8"))["tasks"]
    return [t for t in tasks if not ids or t["id"] in ids]


def run_task(client: Any, model: str, task: dict[str, Any], use_tools: bool, *, effort: str | None = None,
             max_turns: int = 12) -> dict[str, Any]:
    """Run one task with a manual tool-use loop. Returns the score plus usage and a transcript summary."""
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": f"{task['prompt']}\n\n{task['answer_instruction']}"}
    ]
    params: dict[str, Any] = {"model": model, "max_tokens": 16000, "system": SYSTEM, "messages": messages}
    if use_tools:
        params["tools"] = factlot.anthropic_tools()
    if effort:
        params["output_config"] = {"effort": effort}

    usage = {"input_tokens": 0, "output_tokens": 0}
    tool_calls: list[str] = []
    stop_reason = None
    response = None
    started = time.monotonic()
    for _ in range(max_turns):
        response = client.messages.create(**params)
        usage["input_tokens"] += getattr(response.usage, "input_tokens", 0) or 0
        usage["output_tokens"] += getattr(response.usage, "output_tokens", 0) or 0
        stop_reason = response.stop_reason
        messages.append({"role": "assistant", "content": response.content})
        if stop_reason == "pause_turn":
            continue
        uses = [b for b in response.content if b.type == "tool_use"]
        if stop_reason != "tool_use" or not uses:
            break
        results = []
        for u in uses:
            tool_calls.append(u.name)
            results.append({
                "type": "tool_result",
                "tool_use_id": u.id,
                "content": json.dumps(factlot.run_tool(u.name, u.input)),
            })
        messages.append({"role": "user", "content": results})

    final_text = "\n".join(b.text for b in (response.content if response else []) if b.type == "text")
    scored = score_task(task, final_text)
    if stop_reason == "refusal":
        scored["error"] = "refusal"
    return {
        **scored,
        "stop_reason": stop_reason,
        "tool_calls": tool_calls,
        "usage": usage,
        "seconds": round(time.monotonic() - started, 2),
        "final_text": final_text[-2000:],
    }


def summarize(results: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for mode in sorted({r["mode"] for r in results}):
        rs = [r for r in results if r["mode"] == mode]
        out[mode] = {
            "tasks": len(rs),
            "correct": sum(r["correct"] for r in rs),
            "accuracy": round(sum(r["correct"] for r in rs) / len(rs), 4) if rs else 0,
            "output_tokens": sum(r["usage"]["output_tokens"] for r in rs),
            "input_tokens": sum(r["usage"]["input_tokens"] for r in rs),
            "tool_calls": sum(len(r["tool_calls"]) for r in rs),
        }
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default=os.environ.get("FACTLOT_BENCH_MODEL"), help="Claude model ID (or FACTLOT_BENCH_MODEL)")
    ap.add_argument("--modes", default="baseline,factlot")
    ap.add_argument("--tasks", default="", help="comma-separated task ids (default: all)")
    ap.add_argument("--repeats", type=int, default=1)
    ap.add_argument("--effort", default=None, help="optional output_config.effort")
    ap.add_argument("--out", default="bench-results.json")
    args = ap.parse_args(argv)
    if not args.model:
        ap.error("--model (or FACTLOT_BENCH_MODEL) is required")

    import anthropic  # imported here so scoring and tests need no dependency

    client = anthropic.Anthropic()
    tasks = load_tasks([t for t in args.tasks.split(",") if t])
    results = []
    for mode in args.modes.split(","):
        for task in tasks:
            for rep in range(args.repeats):
                r = run_task(client, args.model, task, MODES[mode], effort=args.effort)
                results.append({"mode": mode, "repeat": rep, "category": task["category"], **r})
                print(f"{mode:9} {task['id']:22} {'PASS' if r['correct'] else 'FAIL'}  tools={len(r['tool_calls'])}")
    summary = summarize(results)
    Path(args.out).write_text(json.dumps({"model": args.model, "summary": summary, "results": results}, indent=2))
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

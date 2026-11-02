"""Score FactLot Bench answers.

Agents must end their reply with a line of JSON: {"answer": {...}}. A task scores 1 only if
every answer field is correct (numbers within the task's tolerance, strings exactly).
"""

from __future__ import annotations

import json
import math
import re
from typing import Any

_JSON_LINE = re.compile(r"\{.*\}")


def extract_answer(text: str) -> dict[str, Any] | None:
    """Return the ``answer`` object from the last JSON line in ``text``, or None."""
    for line in reversed(text.strip().splitlines()):
        m = _JSON_LINE.search(line.strip().strip("`"))
        if not m:
            continue
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("answer"), dict):
            return obj["answer"]
    return None


def _to_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "").replace("$", "").strip())
        except ValueError:
            return None
    return None


def field_correct(spec: dict[str, Any], got: Any) -> bool:
    kind = spec["type"]
    if kind == "number":
        n = _to_number(got)
        return n is not None and math.isclose(n, spec["value"], rel_tol=0, abs_tol=spec["tolerance"])
    if kind == "number_list":
        if not isinstance(got, list) or len(got) != len(spec["value"]):
            return False
        nums = [_to_number(x) for x in got]
        return all(
            n is not None and math.isclose(n, e, rel_tol=0, abs_tol=spec["tolerance"])
            for n, e in zip(sorted(x for x in nums if x is not None), spec["value"])
        ) and None not in nums
    if kind == "string":
        return isinstance(got, str) and got.strip().lower() == str(spec["value"]).lower()
    raise ValueError(f"unknown answer type {kind}")


def score_task(task: dict[str, Any], final_text: str) -> dict[str, Any]:
    answer = extract_answer(final_text)
    if answer is None:
        return {"id": task["id"], "correct": False, "fields": {}, "error": "no JSON answer line"}
    fields = {k: field_correct(spec, answer.get(k)) for k, spec in task["answer"].items()}
    return {"id": task["id"], "correct": all(fields.values()), "fields": fields}

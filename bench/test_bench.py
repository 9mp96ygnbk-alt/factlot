"""Offline tests for FactLot Bench (no API calls)."""

import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "python" / "src"))
sys.path.insert(0, str(HERE))

import factlot  # noqa: E402
from run import load_tasks, run_task, summarize  # noqa: E402
from score import extract_answer, field_correct, score_task  # noqa: E402


def at(obj, path):
    for k in path.split("."):
        obj = obj[int(k)] if isinstance(obj, list) else obj[k]
    return obj


class Tasks(unittest.TestCase):
    def test_ground_truth_is_reachable_with_factlot_tools(self):
        """Every answer field is produced exactly by the FactLot reference tool calls."""
        tasks = load_tasks()
        self.assertGreaterEqual(len(tasks), 10)
        for t in tasks:
            covered = set()
            for ref in t["reference"]:
                result = factlot.run_tool(ref["tool"], ref["input"])
                self.assertNotIn("error", result, t["id"])
                for key, path in ref["paths"].items():
                    with self.subTest(task=t["id"], field=key):
                        self.assertTrue(field_correct(t["answer"][key], at(result, path)), (key, at(result, path)))
                    covered.add(key)
            self.assertEqual(covered, set(t["answer"]), t["id"])

    def test_ids_unique_and_instructions_present(self):
        tasks = load_tasks()
        self.assertEqual(len({t["id"] for t in tasks}), len(tasks))
        for t in tasks:
            self.assertIn('{"answer"', t["answer_instruction"])


class Scoring(unittest.TestCase):
    def test_extract_answer_from_last_json_line(self):
        text = 'Work...\n{"answer": {"x": 1}}\nmore\n`{"answer": {"x": 2}}`'
        self.assertEqual(extract_answer(text), {"x": 2})
        self.assertIsNone(extract_answer("no json here"))

    def test_field_types(self):
        self.assertTrue(field_correct({"type": "number", "value": 10, "tolerance": 0.01}, "$10.00"))
        self.assertFalse(field_correct({"type": "number", "value": 10, "tolerance": 0.01}, 10.02))
        self.assertTrue(field_correct({"type": "string", "value": "LTV"}, " ltv "))
        spec = {"type": "number_list", "value": [0.1, 0.2], "tolerance": 1e-6}
        self.assertTrue(field_correct(spec, [0.2, 0.1]))
        self.assertFalse(field_correct(spec, [0.1]))

    def test_score_task_requires_every_field(self):
        task = {"id": "t", "answer": {"a": {"type": "number", "value": 1, "tolerance": 0}, "b": {"type": "string", "value": "x"}}}
        self.assertTrue(score_task(task, '{"answer": {"a": 1, "b": "x"}}')["correct"])
        self.assertFalse(score_task(task, '{"answer": {"a": 1}}')["correct"])


def block(**kw):
    return SimpleNamespace(**kw)


class FakeClient:
    """Calls one FactLot tool, then answers from its result — exercises the runner loop."""

    def __init__(self):
        self.calls = []
        self.messages = self

    def create(self, **params):
        self.calls.append(params)
        usage = SimpleNamespace(input_tokens=10, output_tokens=5)
        if len(self.calls) == 1:
            assert "tools" in params
            return SimpleNamespace(stop_reason="tool_use", usage=usage, content=[
                block(type="text", text="Calling the calculator."),
                block(type="tool_use", id="tu_1", name="calc_percentage_rent", input={
                    "gross_sales": 5_000_000, "sales_exclusions": 200_000, "rate": 0.06,
                    "base_rent_annual": 240_000, "percentage_rent_paid": 50_000}),
            ])
        result = json.loads(params["messages"][-1]["content"][0]["content"])
        v = result["value"]
        text = f'Done.\n{{"answer": {{"percentage_rent": {v["percentage_rent"]}, "balance_due": {v["balance_due"]}}}}}'
        return SimpleNamespace(stop_reason="end_turn", usage=usage, content=[block(type="text", text=text)])


class Runner(unittest.TestCase):
    def test_tool_loop_and_scoring(self):
        task = next(t for t in load_tasks() if t["id"] == "percentage-rent")
        client = FakeClient()
        r = run_task(client, "test-model", task, use_tools=True)
        self.assertTrue(r["correct"], r)
        self.assertEqual(r["tool_calls"], ["calc_percentage_rent"])
        self.assertEqual(r["usage"], {"input_tokens": 20, "output_tokens": 10})
        self.assertEqual(len(client.calls), 2)
        s = summarize([{**r, "mode": "factlot"}])
        self.assertEqual(s["factlot"]["accuracy"], 1.0)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Render the tables in docs/benchmarks/doc-verification.md from results/scores.json.

Every figure in those tables comes from this script's output; nothing is typed by hand.
Usage: python3 bench/doc-accuracy/report.py > /tmp/tables.md
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent


def fmt(m: dict[str, Any]) -> str:
    if not m["n"]:
        return f"{m['k']}/0 | n/a | n/a"
    lo, hi = m["wilson95"]
    return f"{m['k']}/{m['n']} | {100 * m['rate']:.1f}% | {100 * lo:.1f}–{100 * hi:.1f}%"


def main() -> None:
    s = json.loads((HERE / "results" / "scores.json").read_text())
    p, sens = s["primary"], s["sensitivity_party_name_descriptor_stripped"]
    meta = s["_meta"]
    print("## Run metadata\n")
    for k in ("repo_head", "worktree_dirty", "factlot_version", "factlot_src_commit", "as_of", "labels_frozen_at", "python"):
        print(f"- {k}: `{meta[k]}`")
    print(f"- verify command: `{meta['verify_meta']['command']}`")
    for k, v in meta["planted_meta"].items():
        print(f"- plant ({k}) command: `{v['command']}`" + (f", seed `{v['seed']}`" if "seed" in v else ""))
    print(f"- score command: `{meta['command']}`")
    print(f"- documents with no candidates: {', '.join(meta['documents_with_no_candidates']) or 'none'}")
    print(f"- documents with a verifier error: {', '.join(meta['documents_with_verifier_error']) or 'none'}\n")

    print("## Headline (frozen labels, strict matching as in PLAN.md)\n")
    print("| Metric | k/n | Rate | Wilson 95% |\n| --- | --- | --- | --- |")
    rows = [("Precision of verified", "precision_of_verified"),
            ("Precision of verified, unlabeled verified counted wrong", "precision_of_verified_unlabeled_as_wrong"),
            ("Catch rate (wrong values not verified)", "catch_rate"),
            ("False-rejection rate (correct values not verified)", "false_rejection_rate"),
            ("  of which sent to review", "false_rejection_needs_review"),
            ("  of which rejected", "false_rejection_rejected"),
            ("Coverage (labels with a verified correct candidate)", "coverage"),
            ("Coverage, excluding L11 and L13", "coverage_without_empty_documents")]
    for name, key in rows:
        print(f"| {name} | {fmt(p[key])} |")
    for variant, e in p["planted"].items():
        print(f"| Planted [{variant}] catch, original verified | {fmt(e['catch_rate'])} |")
        print(f"| Planted [{variant}] catch, all copies | {fmt(e['catch_rate_all'])} |")

    print("\n## Post-hoc sensitivity: party-name descriptor stripped\n")
    print("| Metric | k/n | Rate | Wilson 95% |\n| --- | --- | --- | --- |")
    for name, key in rows:
        print(f"| {name} | {fmt(sens[key])} |")

    print("\n## Candidate counts\n")
    print(f"- candidates: {p['candidates']}; by kind: {json.dumps(p['by_kind'])}")
    print(f"- outcome counts: {json.dumps(p['counts'])}")
    print(f"- unlabeled candidates by outcome: {json.dumps(p['unlabeled'])}")
    print(f"- summary-predicate candidates by outcome: {json.dumps(p['summary_predicates'])}")
    print(f"- coverage detail: {json.dumps(p['coverage_detail'])}")
    print(f"- sensitivity counts: {json.dumps(sens['counts'])}; coverage detail {json.dumps(sens['coverage_detail'])}")

    print("\n## Per predicate (strict)\n")
    print("| Predicate | Labels | Covered | Correct V / R / X | Wrong V / R / X | Unlabeled V / R / X | Precision | Catch | False rejection |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for pred, e in p["per_predicate"].items():
        c, u = e["counts"], e["unlabeled"]

        def short(m: dict[str, Any]) -> str:
            if not m["n"]:
                return "–"
            lo, hi = m["wilson95"]
            return f"{m['k']}/{m['n']} ({100 * lo:.0f}–{100 * hi:.0f}%)"

        print(f"| `{pred}` | {e['labels']} | {e['coverage']['k']} | {c['correct_verified']} / {c['correct_needs_review']} / {c['correct_rejected']}"
              f" | {c['wrong_verified']} / {c['wrong_needs_review']} / {c['wrong_rejected']}"
              f" | {u['verified']} / {u['needs_review']} / {u['rejected']}"
              f" | {short(e['precision_of_verified'])} | {short(e['catch_rate'])} | {short(e['false_rejection_rate'])} |")

    print("\n## Planted errors by type\n")
    for variant, e in p["planted"].items():
        print(f"### {variant}\n")
        print(f"Outcomes when the original was verified: {json.dumps(e['outcomes_when_original_verified'])}\n")
        print("| Breakdown | Group | Caught / planted (original verified) | Rate | Wilson 95% | Caught / planted (all) |")
        print("| --- | --- | --- | --- | --- | --- |")
        for dim in ("by_error_type", "by_leaf_kind", "by_planted_value_in_quote", "by_predicate"):
            for g, x in e.get(dim, {}).items():
                a = x["catch_rate_all"]
                cr = fmt(x["catch_rate"]).split(" | ")
                print(f"| {dim[3:]} | {g} | {cr[0]} | {cr[1]} | {cr[2]} | {a['k']}/{a['n']} |")
        print()

    ls, data = p["label_stats"], p["data"]
    print("## Labels and data\n")
    print(f"- labels: {ls['labels']}; summary labels: {ls['summary_labels']}; distinct non-summary labels scored for coverage: {p['coverage']['n']}")
    print(f"- verifier on the labels themselves: {json.dumps(ls['self_check'])}; needs_review by predicate: {json.dumps(ls['self_check_needs_review_by_predicate'])}")
    print(f"- security-deposit labels whose quote concerns a letter of credit: {len(ls['security_deposit_letter_of_credit'])} ({', '.join(ls['security_deposit_letter_of_credit'])})")
    print(f"- data: {json.dumps({k: v for k, v in data.items() if k != 'candidates_per_document'})}")
    print(f"- candidates per document: {json.dumps(data['candidates_per_document'])}")


if __name__ == "__main__":
    main()

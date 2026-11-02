"""Run lease ingestion from the command line.

    pip install anthropic pypdf
    python -m factlot.ingest --model <claude-model-id> --lease lease.pdf \
        --amendment first-amendment.pdf@2030-01-15 [--gold gold.json] [--out facts.json]

Prints a summary, writes all facts (with citations) as JSON, and scores against hand-labelled
gold values when --gold is given ({"lease.expiration_date": "2036-02-28", ...}).
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

from ..ids import mint
from .extract import ClaudeExtractor
from .pipeline import evaluate, ingest_lease
from .documents import load_document


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.ingest", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="Claude model ID (chosen by you)")
    ap.add_argument("--lease", required=True, help="original lease (.pdf or .txt with form-feed page breaks)")
    ap.add_argument("--amendment", action="append", default=[], help="amendment file@YYYY-MM-DD (repeatable)")
    ap.add_argument("--lease-urn", help="FactLot lease URN (default: mint one)")
    ap.add_argument("--effort", help="optional output_config.effort")
    ap.add_argument("--gold", help="JSON of expected current values, for scoring")
    ap.add_argument("--out", default="lease-facts.json")
    args = ap.parse_args(argv)

    docs = [load_document(args.lease)]
    for i, spec in enumerate(args.amendment, start=1):
        path, _, eff = spec.partition("@")
        docs.append(load_document(path, role="amendment", effective_date=eff or None, sequence=i))
    urn = args.lease_urn or mint("lease").urn
    result = ingest_lease(urn, docs, ClaudeExtractor(args.model, effort=args.effort), as_of=date.today().isoformat())
    report = {"lease_urn": urn, "summary": result.summary(), "current": result.current, "facts": result.facts,
              "rejected": [{"predicate": v.candidate.predicate, "quote": v.candidate.quote, "reason": v.reason}
                           for v in result.rejected]}
    if args.gold:
        report["evaluation"] = evaluate(result, json.loads(Path(args.gold).read_text()))
    Path(args.out).write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("lease_urn", "summary")} | ({"evaluation": report["evaluation"]}
                                                                         if "evaluation" in report else {}), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

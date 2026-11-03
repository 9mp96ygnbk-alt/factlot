"""Run lease ingestion from the command line.

    pip install anthropic pypdf
    python -m factlot.ingest --model <claude-model-id> --lease lease.pdf \
        --amendment first-amendment.pdf@2030-01-15 [--gold gold.json] [--out facts.json] \
        [--ocr tesseract]

Prints a summary, writes all facts (with citations) as JSON, and scores against hand-labelled
gold values when --gold is given ({"lease.expiration_date": "2036-02-28", ...}).

--ocr names a backend for pages without a text layer (scans). "tesseract" shells out to the
tesseract command, which must be installed separately. Without --ocr such pages are skipped
and reported.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from ..ids import mint
from .documents import load_document, unreadable_pages_message
from .extract import ClaudeExtractor
from .ocr import OCR_BACKENDS, ocr_backend
from .pipeline import evaluate, ingest_lease


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.ingest", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="Claude model ID (chosen by you)")
    ap.add_argument("--lease", required=True,
                    help="original lease (.pdf, .txt with form-feed page breaks, or a page image)")
    ap.add_argument("--amendment", action="append", default=[], help="amendment file@YYYY-MM-DD (repeatable)")
    ap.add_argument("--lease-urn", help="FactLot lease URN (default: mint one)")
    ap.add_argument("--effort", help="optional output_config.effort")
    ap.add_argument("--ocr", choices=sorted(OCR_BACKENDS),
                    help="OCR backend for pages with no text layer (default: skip them and say so)")
    ap.add_argument("--gold", help="JSON of expected current values, for scoring")
    ap.add_argument("--out", default="lease-facts.json")
    args = ap.parse_args(argv)

    ocr = None
    if args.ocr:
        try:
            ocr = ocr_backend(args.ocr)
        except RuntimeError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2

    docs = [load_document(args.lease, ocr=ocr)]
    for i, spec in enumerate(args.amendment, start=1):
        path, _, eff = spec.partition("@")
        docs.append(load_document(path, role="amendment", effective_date=eff or None, sequence=i, ocr=ocr))
    for doc in docs:
        message = unreadable_pages_message(doc)
        if message:
            print(f"warning: {message}", file=sys.stderr)
    urn = args.lease_urn or mint("lease").urn
    result = ingest_lease(urn, docs, ClaudeExtractor(args.model, effort=args.effort), as_of=date.today().isoformat())
    report = {"lease_urn": urn, "summary": result.summary(), "current": result.current, "facts": result.facts,
              "rejected": [{"predicate": v.candidate.predicate, "quote": v.candidate.quote, "reason": v.reason}
                           for v in result.rejected],
              "unreadable_pages": {d.title: d.metadata["pages_without_text"] for d in docs
                                   if "pages_without_text" in d.metadata}}
    if args.gold:
        report["evaluation"] = evaluate(result, json.loads(Path(args.gold).read_text()))
    Path(args.out).write_text(json.dumps(report, indent=2))
    print(json.dumps({k: report[k] for k in ("lease_urn", "summary")} | ({"evaluation": report["evaluation"]}
                                                                         if "evaluation" in report else {}), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

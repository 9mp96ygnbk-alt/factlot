"""Run lease ingestion from the command line.

    pip install anthropic pypdf
    python -m factlot.ingest --model <claude-model-id> --lease lease.pdf \
        --amendment first-amendment.pdf@2030-01-15 [--gold gold.json] [--out facts.json] \
        [--ocr tesseract] [--confidence-threshold 0.8]

Prints a summary, writes all facts (with citations) and the review queue as JSON, and scores
against hand-labelled gold values when --gold is given ({"lease.expiration_date": "2036-02-28", ...}).

--ocr names a backend for pages without a text layer (scans). "tesseract" shells out to the
tesseract command, which must be installed separately. Without --ocr such pages are skipped
and reported.

The review queue lives in the output file and survives between runs. Candidates whose quote is on
the page but whose value is not written in it, or whose extractor confidence is below the
threshold, wait there for a decision. No model call is made for these:

    python -m factlot.ingest --review [--out facts.json]            # list pending items
    python -m factlot.ingest --accept rv_… --by "A. Reviewer"       # the item becomes a fact
    python -m factlot.ingest --reject rv_… --by "A. Reviewer"       # never queued again

Re-running extraction with the same --out file keeps every decision: accepted items are facts
again, rejected (predicate, quote) pairs are not re-queued, pending ones keep their IDs.
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
from .pipeline import REVIEW_CONFIDENCE_THRESHOLD, IngestResult, decide, evaluate, ingest_lease, review_queue
from .retention import DEFAULT_RETENTION_DAYS


def _load_result(path: Path) -> IngestResult | None:
    if not path.exists():
        return None
    return IngestResult.from_report(json.loads(path.read_text()))


def _write_result(path: Path, result: IngestResult, extra: dict | None = None, *, redact: bool = False) -> dict:
    report = result.to_report(redact=redact) | (extra or {})
    path.write_text(json.dumps(report, indent=2))
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.ingest", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", help="Claude model ID (chosen by you); required to extract")
    ap.add_argument("--lease", help="original lease (.pdf, .txt with form-feed page breaks, or a page image)")
    ap.add_argument("--amendment", action="append", default=[], help="amendment file@YYYY-MM-DD (repeatable)")
    ap.add_argument("--lease-urn", help="FactLot lease URN (default: mint one, or reuse the output file's)")
    ap.add_argument("--effort", help="optional output_config.effort")
    ap.add_argument("--ocr", choices=sorted(OCR_BACKENDS),
                    help="OCR backend for pages with no text layer (default: skip them and say so)")
    ap.add_argument("--confidence-threshold", type=float, default=REVIEW_CONFIDENCE_THRESHOLD,
                    help="extractor confidence below this is queued for review (default %(default)s)")
    ap.add_argument("--gold", help="JSON of expected current values, for scoring")
    ap.add_argument("--out", default="lease-facts.json", help="facts and review queue (read back on later runs)")
    policy = ap.add_argument_group("customer documents (docs/customer-documents.md)")
    policy.add_argument("--redact", action="store_true",
                        help="persist document text only as the quotes that are evidence for a fact or a "
                             "review item (hosted ingest always does)")
    policy.add_argument("--retain-days", type=int, default=DEFAULT_RETENTION_DAYS, metavar="N",
                        help="days after the run on which a hosted copy of the source documents is deleted "
                             "(default %(default)s; 0 = as soon as the report is written); written to the "
                             "report's retention.retain_until")
    queue = ap.add_argument_group("review queue (no model call; reads and updates --out)")
    queue.add_argument("--review", action="store_true", help="list the items waiting for a decision")
    queue.add_argument("--accept", metavar="ID", help="accept a queued item: it becomes a fact")
    queue.add_argument("--reject", metavar="ID", help="reject a queued item: never queued again")
    queue.add_argument("--by", metavar="NAME", help="who is deciding (required with --accept/--reject)")
    args = ap.parse_args(argv)
    out = Path(args.out)

    if args.review or args.accept or args.reject:
        if args.lease or args.model:
            ap.error("--review/--accept/--reject work on an existing --out file; do not pass --lease or --model")
        if args.accept and args.reject:
            ap.error("pass one of --accept or --reject")
        result = _load_result(out)
        if result is None:
            print(f"error: {out} does not exist; run an extraction first", file=sys.stderr)
            return 2
        if args.review:
            pending = review_queue(result)
            if not pending:
                print(f"no items pending review in {out}")
            for item in pending:
                print(item.describe())
                print()
            print(json.dumps({"summary": result.summary()}, indent=2))
            return 0
        if not args.by or not args.by.strip():
            ap.error("--by NAME is required with --accept/--reject")
        try:
            item = decide(result, args.accept or args.reject, bool(args.accept), args.by)
        except ValueError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        _write_result(out, result, redact=args.redact)
        print(item.describe())
        if item.status == "accepted":
            fact = next(f for f in result.facts if f["predicate"] == item.candidate.predicate
                        and f["provenance"]["sources"][0]["quote"] == item.candidate.quote)
            print(f"  fact:    {fact['id']}" + (" (current)" if result.current.get(item.candidate.predicate) is fact
                                                else " (superseded by a later instrument)"))
        print(json.dumps({"summary": result.summary()}, indent=2))
        return 0

    if not args.model or not args.lease:
        ap.error("--model and --lease are required to extract (or use --review/--accept/--reject)")
    if args.retain_days < 0:
        ap.error("--retain-days must be 0 or more")
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
    previous = _load_result(out)
    urn = args.lease_urn or (previous.lease_urn if previous and previous.lease_urn else mint("lease").urn)
    result = ingest_lease(urn, docs, ClaudeExtractor(args.model, effort=args.effort), as_of=date.today().isoformat(),
                          review=previous.review if previous else None, confidence_threshold=args.confidence_threshold,
                          retention_days=args.retain_days)
    extra = {"unreadable_pages": {d.title: d.metadata["pages_without_text"] for d in docs
                                  if "pages_without_text" in d.metadata}}
    if args.gold:
        extra["evaluation"] = evaluate(result, json.loads(Path(args.gold).read_text()))
    report = _write_result(out, result, extra, redact=args.redact)
    shown = {k: report[k] for k in ("lease_urn", "summary", "retention")}
    if args.redact:
        shown["redacted"] = True
    if "evaluation" in report:
        shown["evaluation"] = report["evaluation"]
    if report["summary"]["review_pending"]:
        shown["review"] = f"{report['summary']['review_pending']} item(s) wait for a decision: --review"
    print(json.dumps(shown, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

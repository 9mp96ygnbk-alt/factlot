"""python -m factlot.collector discover|snapshot --config registry/sources/texas.json [--source ID] --out DIR

discover  fetch each source's landing pages and write <out>/<source>/discovered.json (no downloads)
snapshot  archive each source's confirmed `files` (or, with --discovered, links found by discover)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core import PoliteFetcher, discover, load_sources, snapshot


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.collector", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["discover", "snapshot"])
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--source", action="append", help="limit to these source ids")
    ap.add_argument("--discovered", action="store_true", help="snapshot: also archive links found by discover")
    ap.add_argument("--include-unverified", action="store_true",
                    help="snapshot: also archive sources not yet verified (terms reviewed). Off by default (data policy §5).")
    args = ap.parse_args(argv)

    cfg, sources = load_sources(args.config)
    if args.source:
        sources = [s for s in sources if s.source_id in args.source]
    fetcher = PoliteFetcher(cfg)
    summary = {}
    for spec in sources:
        out = Path(args.out) / spec.source_id
        out.mkdir(parents=True, exist_ok=True)
        if args.command == "discover":
            report = discover(fetcher, spec)
            (out / "discovered.json").write_text(json.dumps(report, indent=2))
            summary[spec.source_id] = {"pages": [p["status"] for p in report["pages"]], "links": len(report["links"])}
        else:
            if not spec.verified and not args.include_unverified:
                summary[spec.source_id] = "skipped: source not verified (review terms, confirm files, set verified=true)"
                continue
            urls = list(spec.files)
            found = out / "discovered.json"
            if args.discovered and found.exists():
                urls += [link["url"] for link in json.loads(found.read_text())["links"] if link["robots_allowed"] == "true"]
            results = snapshot(fetcher, spec, list(dict.fromkeys(urls)), args.out)
            summary[spec.source_id] = [{"url": r["url"], "status": r["status"]} for r in results]
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

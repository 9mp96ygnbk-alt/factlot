"""Bring a registry file up to the current privacy and normalization rules, re-runnably.

``python -m factlot.registry.maintain registry.db --all`` runs, in order, steps that are each
idempotent and safe to repeat after any rule change or new ingest:

1. ``--purge-persons``: delete owner-of-record facts the current ``is_organization`` rule reads as
   natural persons, with their mailing addresses, links and review rows (``Registry.purge_person_owners``).
2. ``--rebuild-names``: re-key the entity name index and its token index when ``normalize_name``
   changed (``Registry.rebuild_name_index``), then re-key the review queue
   (``Registry.rebuild_review_keys``).
3. ``--link``: re-derive exact-name owner links under the current rules (``Registry.link_owners``).
4. ``--queue-fuzzy``: propose fuzzy candidates for the owners still unlinked
   (``Registry.queue_fuzzy_owner_matches``); slow on millions of entities, so not part of ``--all``.

Each step prints its result as JSON with its running time.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any, Callable

from .store import Registry


def run(db_path: str, *, purge_persons: bool = False, rebuild_names: bool = False, link: bool = False,
        queue_fuzzy: bool = False, log: Callable[[str, dict[str, Any]], None] | None = None) -> dict[str, Any]:
    reg = Registry(db_path)
    out: dict[str, Any] = {}

    def step(name: str, fn: Callable[[], dict[str, Any]]) -> None:
        t = time.time()
        result = fn()
        result["seconds"] = round(time.time() - t, 1)
        out[name] = result
        if log:
            log(name, result)

    try:
        if purge_persons:
            step("purge_person_owners", reg.purge_person_owners)
        if rebuild_names:
            step("rebuild_name_index", reg.rebuild_name_index)
            step("rebuild_review_keys", reg.rebuild_review_keys)
        if link:
            step("link_owners", reg.link_owners)
        if queue_fuzzy:
            step("queue_fuzzy_owner_matches", reg.queue_fuzzy_owner_matches)
        step("stats", reg.stats)
    finally:
        reg.close()
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.maintain", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", help="registry SQLite file to update in place")
    ap.add_argument("--all", action="store_true", help="--purge-persons --rebuild-names --link")
    ap.add_argument("--purge-persons", action="store_true")
    ap.add_argument("--rebuild-names", action="store_true")
    ap.add_argument("--link", action="store_true")
    ap.add_argument("--queue-fuzzy", action="store_true")
    args = ap.parse_args(argv)
    if not (args.all or args.purge_persons or args.rebuild_names or args.link or args.queue_fuzzy):
        ap.error("choose at least one step (or --all)")
    result = run(args.db, purge_persons=args.all or args.purge_persons, rebuild_names=args.all or args.rebuild_names,
                 link=args.all or args.link, queue_fuzzy=args.queue_fuzzy,
                 log=lambda name, r: print(f"{name}: {json.dumps(r)}", file=sys.stderr, flush=True))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

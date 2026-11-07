"""Bring a registry file up to the current privacy and normalization rules, re-runnably.

``python -m factlot.registry.maintain registry.db --all`` runs, in order, steps that are each
idempotent and safe to repeat after any rule change or new ingest:

1. ``--purge-persons``: delete owner-of-record facts the current ``is_organization`` rule reads as
   natural persons, with their mailing addresses, links and review rows, and remove contact names that
   are not organisations ("ATTN JANE DOE") from stored mailing addresses (``Registry.purge_person_owners``).
2. ``--clean-entity-names``: for each entity registry whose adapter defines ``clean_legal_name`` (an
   adapter fix that changed what the legal name is), rewrite the stored names in place
   (``Registry.rewrite_entity_names``).
3. ``--rebuild-names``: re-key the entity name index and its token index when ``normalize_name``
   changed (``Registry.rebuild_name_index``), then re-key the review queue
   (``Registry.rebuild_review_keys``).
4. ``--rebuild-addresses``: re-key the address search index when ``normalize_address`` changed
   (``Registry.rebuild_address_index``; address key version 2 reads "Northwest" as "NW" and drops
   unit and suite designators).
5. ``--link``: re-derive exact-name owner links under the current rules (``Registry.link_owners``).
6. ``--buildings``: group the parcels of one building, such as condominium units, under building
   subjects (``Registry.rollup_buildings``).
7. ``--coverage``: store what the file holds in ``meta.coverage`` (``Registry.refresh_coverage``), so
   registry tools can say whether a missed county or entity registry is loaded. Run it last.
8. ``--queue-fuzzy``: propose fuzzy candidates for the owners still unlinked
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


def _cleaners(reg: Registry) -> list[tuple[str, Callable[[str], str]]]:
    """(source_id, clean_legal_name) for every loaded entity source whose adapter defines a name cleaner."""
    from . import audit

    out = []
    loaded = {r[0] for r in reg.db.execute("SELECT DISTINCT source_id FROM snapshots")}
    for source_id in sorted(loaded):
        mod = audit.adapter_for(source_id)
        if mod is not None and hasattr(mod, "clean_legal_name"):
            out.append((source_id, mod.clean_legal_name))
    return out


def run(db_path: str, *, purge_persons: bool = False, clean_names: bool = False, rebuild_names: bool = False,
        link: bool = False, queue_fuzzy: bool = False, rebuild_addresses: bool = False, buildings: bool = False,
        coverage: bool = False, log: Callable[[str, dict[str, Any]], None] | None = None) -> dict[str, Any]:
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
        if clean_names:
            for source_id, clean in _cleaners(reg):
                step(f"rewrite_entity_names[{source_id}]", lambda sid=source_id, fn=clean: reg.rewrite_entity_names(sid, fn))
        if rebuild_names:
            step("rebuild_name_index", reg.rebuild_name_index)
            step("rebuild_review_keys", reg.rebuild_review_keys)
        if rebuild_addresses:
            step("rebuild_address_index", reg.rebuild_address_index)
        if link:
            step("link_owners", reg.link_owners)
        if buildings:
            step("rollup_buildings", reg.rollup_buildings)
        if queue_fuzzy:
            step("queue_fuzzy_owner_matches", reg.queue_fuzzy_owner_matches)
        if coverage:
            step("refresh_coverage", reg.refresh_coverage)
        step("stats", reg.stats)
    finally:
        reg.close()
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.maintain", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", help="registry SQLite file to update in place")
    ap.add_argument("--all", action="store_true", help="--purge-persons --clean-entity-names --rebuild-names "
                    "--rebuild-addresses --link --buildings --coverage")
    ap.add_argument("--purge-persons", action="store_true")
    ap.add_argument("--clean-entity-names", action="store_true")
    ap.add_argument("--rebuild-names", action="store_true")
    ap.add_argument("--rebuild-addresses", action="store_true")
    ap.add_argument("--link", action="store_true")
    ap.add_argument("--buildings", action="store_true")
    ap.add_argument("--coverage", action="store_true")
    ap.add_argument("--queue-fuzzy", action="store_true")
    args = ap.parse_args(argv)
    if not (args.all or args.purge_persons or args.clean_entity_names or args.rebuild_names or args.rebuild_addresses
            or args.link or args.buildings or args.coverage or args.queue_fuzzy):
        ap.error("choose at least one step (or --all)")
    result = run(args.db, purge_persons=args.all or args.purge_persons, clean_names=args.all or args.clean_entity_names,
                 rebuild_names=args.all or args.rebuild_names, rebuild_addresses=args.all or args.rebuild_addresses,
                 link=args.all or args.link, buildings=args.all or args.buildings, coverage=args.all or args.coverage,
                 queue_fuzzy=args.queue_fuzzy,
                 log=lambda name, r: print(f"{name}: {json.dumps(r)}", file=sys.stderr, flush=True))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

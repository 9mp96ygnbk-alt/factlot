"""Privacy scan of a registry file before it is served: what the hosted registry must never answer with.

``python -m factlot.registry.privacy_scan [--json] registry.db [more.db ...]`` reads each file (read-only) and
reports, per file:

- owner-of-record facts the person rule (``normalize.is_organization``) reads as natural persons;
- owner and entity mailing addresses whose owner or entity name reads as a person's or a family's
  (``normalize.personal_style_organization``: "JOHN SMITH LLC", "SMITH FAMILY LP"), which ingest no longer
  stores because they are most often a home.

Exit status 0 when every file is clean, 1 when any finding remains (``maintain --purge-persons`` removes both
kinds), 2 on a usage error. ``scripts/registry/pack.ts`` runs it on every file it packs and refuses a file with
findings. With ``--json`` the report is one JSON object: ``{"files": {...}, "problems": [...]}``.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from .normalize import is_organization, personal_style_organization

_MAILING = (
    ("ownership.owner_of_record", "ownership.owner_mailing_address"),
    ("entity.legal_name", "entity.mailing_address"),
)
SAMPLES = 5


def _name(value_json: str) -> str | None:
    try:
        v = json.loads(value_json)
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, str) else None


def scan(path: str | Path) -> dict[str, Any]:
    """Counts and a few sample subjects of each finding in one registry file."""
    db = sqlite3.connect(f"{Path(path).resolve().as_uri()}?mode=ro", uri=True)
    try:
        persons: list[str] = []
        n_persons = 0
        for subject, value_json in db.execute(
                "SELECT subject, value_json FROM facts WHERE predicate = 'ownership.owner_of_record'"):
            name = _name(value_json)
            if name is None or not is_organization(name):
                n_persons += 1
                if len(persons) < SAMPLES:
                    persons.append(subject)
        homes: list[str] = []
        n_homes = 0
        for name_predicate, mailing in _MAILING:
            for subject, value_json in db.execute(
                    "SELECT f.subject, f.value_json FROM facts f WHERE f.predicate = ? AND EXISTS "
                    "(SELECT 1 FROM facts m WHERE m.subject = f.subject AND m.document_id = f.document_id "
                    "AND m.predicate = ?)", (name_predicate, mailing)):
                name = _name(value_json)
                if name is not None and personal_style_organization(name):
                    n_homes += 1
                    if len(homes) < SAMPLES:
                        homes.append(subject)
    finally:
        db.close()
    return {
        "person_owner_facts": n_persons,
        "person_owner_samples": persons,
        "personal_style_mailing_addresses": n_homes,
        "personal_style_samples": homes,
    }


def problems(path: str | Path, report: dict[str, Any]) -> list[str]:
    out = []
    if report["person_owner_facts"]:
        out.append(f"{path}: {report['person_owner_facts']} owner-of-record facts read as natural persons "
                   f"(e.g. {', '.join(report['person_owner_samples'])})")
    if report["personal_style_mailing_addresses"]:
        out.append(f"{path}: {report['personal_style_mailing_addresses']} mailing addresses of owners or entities "
                   f"whose name reads as a person's or a family's (e.g. {', '.join(report['personal_style_samples'])})")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.privacy_scan", description=__doc__.split("\n")[0])
    ap.add_argument("db", nargs="+")
    ap.add_argument("--json", action="store_true", help="print one JSON object")
    args = ap.parse_args(argv)
    files: dict[str, Any] = {}
    found: list[str] = []
    for p in args.db:
        if not Path(p).is_file():
            print(f"no such file: {p}", file=sys.stderr)
            return 2
        files[p] = scan(p)
        found += problems(p, files[p])
    if args.json:
        print(json.dumps({"files": files, "problems": found}))
    else:
        for line in found or ["clean: no person owners and no personal-style mailing addresses"]:
            print(line)
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())

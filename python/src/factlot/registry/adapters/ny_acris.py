"""New York City Department of Finance: ACRIS recorded documents (deeds, mortgages, satisfactions) → ``ParcelFacts``.

ACRIS (Automated City Register Information System) is the City Register's index of recorded real property
documents. NYC Open Data publishes it as linked tables; this adapter reads three of them, exported by the
Socrata ``/resource/<id>.csv`` endpoint with a ``$select`` of the columns used below and a ``$where`` on the
document ID's year (a document ID begins with the year it was filed) -- one CSV set per year:

- Real Property **Master** (``bnx9-e6tj``): ``document_id``, ``crfn``, ``doc_type``, ``document_date``,
  ``document_amt``, ``recorded_datetime``, ``percent_trans``, ``good_through_date``; limited by the download to the
  deed, mortgage and satisfaction document types below.
- Real Property **Legals** (``8h5j-fqxa``): ``document_id``, ``borough``, ``block``, ``lot``, ``easement``,
  ``partial_lot``, ``air_rights``, ``subterranean_rights`` (one row per lot a document affects).
- Real Property **Parties** (``636b-3b5g``): ``document_id``, ``party_type``, ``name``; party types 1 and 2 only
  (no address columns are requested).

The registry already holds the commercial, industrial and multifamily lots from the DOF roll (``ny_nyc``); a
document becomes facts on each such lot it affects (borough-block-lot match; the rest are dropped by the
registry as out of scope). Rows that concern an easement (``easement`` = ``Y``) are not an interest in the lot
itself and are skipped.

Predicates (one fact per document and lot; all three are many-valued, newest first):

- ``transaction.deed``: ``DEED``, ``DEEDO``, ``DEED, RC``, ``IDED``, ``CONDEED`` and ``CORRD`` documents.
  ``{date (recorded), document_date, doc_type, doc_type_description, amount_usd, crfn, document_id, grantors,
  grantees, organizations_only, ...}``.
- ``debt.mortgage_recorded``: ``MTGE``, ``M&CON``, ``CMTG``, ``SMTG`` and ``MMTG``. Same keys with ``borrowers``
  and ``lenders``; ``amount_usd`` is the principal ACRIS records for the whole document.
- ``debt.mortgage_satisfaction_recorded``: ``SAT``, ``PSAT`` (partial) and ``WSAT`` (withheld). ``lenders`` is the
  mortgagee that satisfied. The Master and Legals tables do not say which mortgage a satisfaction ends, so the fact
  is an event on the lot, not a link to one mortgage.

**Only organisations are stored.** A party is kept only if ``normalize.is_organization`` says it is one; every
other party (any natural person, and any name the rule is not sure about) is dropped when the file is read and
appears nowhere: not in a fact, a count, an index or a log. A fact says ``organizations_only: true`` so a deed to an
individual (no grantee listed) is not mistaken for one with no grantee. ``lots_in_document`` is written when the
document affects more than one lot: the amount is for the document, published on every lot, and must not be
summed or divided per lot. ``partial_lot``, ``air_rights`` and ``subterranean_rights`` are written (true) when
the Legals row says so.

Usage: ``python -m factlot.registry.adapters.ny_acris registry.db --as-of 2026-09-30 --set master-2025.csv legals-2025.csv
parties-2025.csv --set ...`` (the registry must already hold the DOF roll: ``ny_nyc``).
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from ..normalize import is_organization
from ..store import IngestStats, ParcelFacts, Registry, Source
from .ny_pluto import COUNTY_FIPS, STATE_FIPS

SOURCE_ID = "ny-nyc-dof-acris"

SOURCE = Source(
    source_id=SOURCE_ID,
    publisher="New York City Department of Finance",
    title="ACRIS Real Property Master, Legals and Parties (deeds, mortgages, satisfactions)",
    url="https://data.cityofnewyork.us/City-Government/ACRIS-Real-Property-Master/bnx9-e6tj",
    state_fips=STATE_FIPS,
    county_fips=None,  # five counties; each record carries its own
    license="Published on NYC Open Data under the NYC Open Data Law (Admin. Code §23-502). NYC Open Data "
            "FAQ: 'Open Data belongs to all New Yorkers. There are no restrictions on the use of Open "
            "Data.' ACRIS is an index of recorded documents, not the documents themselves.",
    ai_use="unknown",  # not addressed by the publisher beyond 'no restrictions on the use'
    redistribution="permitted",  # no restrictions on use (FAQ)
    attribution="New York City Department of Finance, ACRIS",
    terms_reviewed="2026-11-04",
)

DEED, MORTGAGE, SATISFACTION = "transaction.deed", "debt.mortgage_recorded", "debt.mortgage_satisfaction_recorded"

# Document type → (predicate, ACRIS document control code description).
DOC_TYPES: dict[str, tuple[str, str]] = {
    "DEED": (DEED, "DEED"), "DEEDO": (DEED, "DEED, OTHER"), "DEED, RC": (DEED, "DEED WITH RESTRICTIVE COVENANT"),
    "IDED": (DEED, "IN REM DEED"), "CONDEED": (DEED, "CONFIRMATORY DEED"), "CORRD": (DEED, "CORRECTION DEED"),
    "MTGE": (MORTGAGE, "MORTGAGE"), "M&CON": (MORTGAGE, "MORTGAGE AND CONSOLIDATION"),
    "CMTG": (MORTGAGE, "COLLATERAL MORTGAGE"), "SMTG": (MORTGAGE, "SUNDRY MORTGAGE"),
    "MMTG": (MORTGAGE, "MASTER MORTGAGE"),
    "SAT": (SATISFACTION, "SATISFACTION OF MORTGAGE"), "PSAT": (SATISFACTION, "PARTIAL SATISFACTION"),
    "WSAT": (SATISFACTION, "WITHHELD SATISFACTION"),
}
# Party type 1 and 2 → the roles' key names, per predicate (ACRIS control codes: a deed's party 1 is the
# grantor/seller and party 2 the grantee/buyer; a mortgage's or satisfaction's party 1 is the borrower and
# party 2 the lender).
ROLES = {DEED: ("grantors", "grantees"), MORTGAGE: ("borrowers", "lenders"), SATISFACTION: ("borrowers", "lenders")}
MAX_PARTIES_PER_ROLE = 25

MASTER_COLUMNS = ("document_id", "crfn", "doc_type", "document_date", "document_amt", "recorded_datetime",
                  "percent_trans", "good_through_date")
LEGALS_COLUMNS = ("document_id", "borough", "block", "lot", "easement", "partial_lot", "air_rights",
                  "subterranean_rights")
PARTIES_COLUMNS = ("document_id", "party_type", "name")


@dataclass
class Counts:
    """What the reader saw, for the run report. Natural persons are only ever counted, never kept."""

    documents_in_scope_types: int = 0
    documents_with_a_lot: int = 0
    lot_rows_easement_skipped: int = 0
    parties_read: int = 0
    parties_dropped_not_organization: int = 0
    documents_without_organization_party: int = 0
    facts: dict[str, int] = field(default_factory=lambda: defaultdict(int))


def _rows(path: str | Path) -> Iterator[tuple[int, dict[str, str]]]:
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().lower() for h in next(reader, [])]
        for n, values in enumerate(reader, 2):
            yield n, dict(zip(header, values))


def _day(s: str | None) -> str | None:
    t = (s or "").strip()[:10]
    try:
        return date.fromisoformat(t).isoformat() if t else None
    except ValueError:
        return None


def _money(s: str | None) -> int | float | None:
    try:
        v = float((s or "").strip())
    except ValueError:
        return None
    if v < 0:
        return None
    return int(v) if v == int(v) else round(v, 2)


def _name(s: str | None) -> str:
    return " ".join((s or "").split())


def bbl_of(row: dict[str, str]) -> tuple[str, str] | None:
    """``('061', '1008350041')`` for a Legals row (borough, block, lot); ``None`` for a borough that does not exist."""
    try:
        boro, block, lot = (int(float((row.get(k) or "").strip())) for k in ("borough", "block", "lot"))
    except ValueError:
        return None
    if str(boro) not in COUNTY_FIPS or not (0 < block < 100000) or not (0 < lot < 10000):
        return None
    return COUNTY_FIPS[str(boro)], f"{boro}{block:05d}{lot:04d}"


def read_master(path: str | Path) -> dict[str, dict[str, object]]:
    """Document ID → master fields, for the document types this adapter handles and a usable recorded date."""
    out: dict[str, dict[str, object]] = {}
    for _n, r in _rows(path):
        doc_type = _name(r.get("doc_type")).upper()
        if doc_type not in DOC_TYPES or not (doc_id := _name(r.get("document_id"))):
            continue
        recorded = _day(r.get("recorded_datetime"))
        if recorded is None:
            continue
        out[doc_id] = {
            "doc_type": doc_type, "recorded": recorded, "document_date": _day(r.get("document_date")),
            "amount": _money(r.get("document_amt")), "crfn": _name(r.get("crfn")),
            "percent": _money(r.get("percent_trans")),
        }
    return out


def read_legals(path: str | Path, documents: set[str], counts: Counts
                ) -> dict[str, list[tuple[tuple[str, str], dict[str, bool]]]]:
    """Document ID → ``[((county, bbl), flags)]`` for the listed documents, in file order, one entry per lot."""
    out: dict[str, list[tuple[tuple[str, str], dict[str, bool]]]] = defaultdict(list)
    for _n, r in _rows(path):
        doc_id = _name(r.get("document_id"))
        if doc_id not in documents:
            continue
        if (r.get("easement") or "").strip().upper() == "Y":
            counts.lot_rows_easement_skipped += 1
            continue
        if (key := bbl_of(r)) is None:
            continue
        flags = {name: True for name, col, yes in (("partial_lot", "partial_lot", "P"), ("air_rights", "air_rights", "Y"),
                                                   ("subterranean_rights", "subterranean_rights", "Y"))
                 if (r.get(col) or "").strip().upper() == yes}
        if all(k != key for k, _f in out[doc_id]):
            out[doc_id].append((key, flags))
    return out


def read_parties(path: str | Path, documents: set[str], counts: Counts) -> dict[str, tuple[list[str], list[str]]]:
    """Document ID → (party-1 organisations, party-2 organisations) for the listed documents.

    Names are kept only when ``is_organization`` says so; every other party is dropped here (counted, not kept)."""
    out: dict[str, tuple[list[str], list[str]]] = {}
    for _n, r in _rows(path):
        doc_id = _name(r.get("document_id"))
        if doc_id not in documents:
            continue
        role = (r.get("party_type") or "").strip()
        if role not in ("1", "2"):
            continue
        counts.parties_read += 1
        name = _name(r.get("name"))
        if not name or not is_organization(name):
            counts.parties_dropped_not_organization += 1
            continue
        lists = out.setdefault(doc_id, ([], []))
        target = lists[int(role) - 1]
        if name not in target:
            target.append(name)
    return out


def document_value(doc_id: str, master: dict[str, object], parties: tuple[list[str], list[str]] | None,
                   lots: int, flags: dict[str, bool]) -> tuple[str, dict[str, object]]:
    """``(predicate, value)`` for one document on one lot."""
    predicate, description = DOC_TYPES[str(master["doc_type"])]
    value: dict[str, object] = {"date": master["recorded"]}
    if master.get("document_date"):
        value["document_date"] = master["document_date"]
    value["doc_type"] = master["doc_type"]
    value["doc_type_description"] = description
    amount = master.get("amount")
    if amount is not None and (amount > 0 or predicate != SATISFACTION):
        value["amount_usd"] = amount
    percent = master.get("percent")
    if predicate == DEED and isinstance(percent, (int, float)) and 0 < percent < 100:
        value["percent_transferred"] = percent
    if master.get("crfn"):
        value["crfn"] = master["crfn"]
    value["document_id"] = doc_id
    first, second = ROLES[predicate]
    for key, names in ((first, parties[0] if parties else []), (second, parties[1] if parties else [])):
        if names:
            value[key] = names[:MAX_PARTIES_PER_ROLE]
            if len(names) > MAX_PARTIES_PER_ROLE:
                value[key + "_truncated"] = True
    value["organizations_only"] = True
    if lots > 1:
        value["lots_in_document"] = lots
    value.update(flags)
    return predicate, value


def read_acris(master_path: str | Path, legals_path: str | Path, parties_path: str | Path, *,
               counts: Counts | None = None, label: str | None = None) -> Iterator[ParcelFacts]:
    """Yield one ``ParcelFacts`` per lot with at least one in-scope document, from one year's CSV set."""
    counts = counts if counts is not None else Counts()
    masters = read_master(master_path)
    counts.documents_in_scope_types += len(masters)
    legals = read_legals(legals_path, set(masters), counts)
    counts.documents_with_a_lot += len(legals)
    parties = read_parties(parties_path, set(legals), counts)
    counts.documents_without_organization_party += sum(1 for d in legals if d not in parties)
    label = label or Path(legals_path).name
    grouped: dict[tuple[str, str], list[tuple[str, str, dict[str, object]]]] = defaultdict(list)
    for doc_id, lot_list in legals.items():
        for key, flags in lot_list:
            predicate, value = document_value(doc_id, masters[doc_id], parties.get(doc_id), len(lot_list), flags)
            grouped[key].append((predicate, doc_id, value))
    for (county, bbl), docs in grouped.items():
        docs.sort(key=lambda d: (str(d[2]["date"]), d[1]))
        for predicate, _doc, _value in docs:
            counts.facts[predicate] += 1
        yield ParcelFacts(county, bbl, [(p, v, None) for p, _d, v in docs],
                          locator=f"ACRIS {label} BBL {bbl} document {docs[0][1]}" + (f" (+{len(docs) - 1} more)" if len(docs) > 1 else ""))


def build(sets: list[tuple[str, str, str]], db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          counts: Counts | None = None) -> IngestStats:
    """Ingest one or more (master, legals, parties) CSV sets into a registry that already holds the DOF roll.

    Every file of a set is registered as a snapshot of the source; the facts cite the Legals file, which carries
    the lot, and the document ID inside the fact value names the ACRIS record."""
    counts = counts if counts is not None else Counts()
    reg = Registry(db_path)
    total = IngestStats()
    try:
        reg.add_source(SOURCE)
        for master, legals, parties in sets:
            reg.add_snapshot(SOURCE_ID, master, as_of, retrieved_at)
            reg.add_snapshot(SOURCE_ID, parties, as_of, retrieved_at)
            snap = reg.add_snapshot(SOURCE_ID, legals, as_of, retrieved_at)
            s = reg.ingest_parcel_facts(read_acris(master, legals, parties, counts=counts), snap, state_fips=STATE_FIPS)
            for f in ("seen", "kept", "skipped_out_of_scope", "skipped_invalid", "facts_written"):
                setattr(total, f, getattr(total, f) + getattr(s, f))
            total.errors += s.errors
        return total
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.ny_acris", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("db", help="registry SQLite file that already holds the DOF roll")
    ap.add_argument("--set", dest="sets", nargs=3, action="append", required=True, metavar=("MASTER", "LEGALS", "PARTIES"),
                    help="one year's CSV files as archived by the collector (repeat for more years)")
    ap.add_argument("--as-of", required=True, help="the extract's good_through_date, YYYY-MM-DD")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    args = ap.parse_args(argv)
    counts = Counts()
    stats = build([tuple(s) for s in args.sets], args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, counts=counts)
    print(json.dumps({"ingest": asdict(stats), "reader": {**asdict(counts), "facts": dict(counts.facts)}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

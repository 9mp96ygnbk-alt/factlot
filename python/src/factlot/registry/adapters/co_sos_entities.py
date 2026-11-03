"""Colorado Department of State "Business Entities in Colorado" (Colorado Information Marketplace,
dataset 4ykn-tg5h) → ``EntityRecord``.

Layout (confirmed 2026-11-02 against the CSV export and the portal's column metadata): one CSV row
per registered entity, UTF-8 with a header row, columns

    entityid, entityname, principaladdress1, principaladdress2, principalcity, principalstate,
    principalzipcode, principalcountry, mailingaddress1, mailingaddress2, mailingcity, mailingstate,
    mailingzipcode, mailingcountry, entitystatus, jurisdictonofformation (sic), entitytype,
    agentfirstname, agentmiddlename, agentlastname, agentsuffix, agentorganizationname,
    agentprincipaladdress1 … agentmailingcountry, entityformdate

``entityid`` is the Department of State's unique entity number (the registry number here).
``entitystatus`` is one of the Department's status names ("Good Standing", "Delinquent",
"Voluntarily Dissolved", …), mapped to tokens by ``STATUS``. ``jurisdictonofformation`` is the
state or country of formation, written as a postal abbreviation or a full name ("DE",
"Delaware"); it becomes ``state_of_formation`` when it names a US state. ``entitytype`` is the
Department's abbreviation (``DLLC`` domestic LLC, ``FPC`` foreign profit corporation, …).
Registered agents are natural persons in most rows and are not read.

The principal address is the entity's address of record; the mailing address is used when the
principal address is blank.

``entityname`` carries a status history for entities that are not in good standing ("ACME INC,
Delinquent January 1, 2025", "ACME INC Reinstated 2004, Dissolved June 29, 2011"); ``legal_name`` strips
it, because the status column already says it and an owner of record never writes it.

Usage: ``python -m factlot.registry.adapters.co_sos_entities export.csv registry.db --as-of 2026-11-02``
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections.abc import Iterator
from dataclasses import asdict
from pathlib import Path

from ..store import EntityRecord, IngestStats, Registry, Source

JURISDICTION = "us-co"

SOURCE = Source(
    source_id="co-sos-entities",
    publisher="Colorado Department of State",
    title="Business Entities in Colorado (Colorado Information Marketplace dataset 4ykn-tg5h)",
    url="https://data.colorado.gov/Business/Business-Entities-in-Colorado/4ykn-tg5h",
    state_fips="08",
    license="Public domain (dataset license on data.colorado.gov); the portal's Terms of Service require the State of Colorado disclaimer where the data is used",
    ai_use="unknown",  # the publisher does not address AI use
    redistribution="attribution_required",
    attribution="Colorado Department of State (CDOS), via the Colorado Information Marketplace",
    terms_reviewed="2026-11-02",
)

# Entity status names used by the Department of State (every value seen in the dataset on 2026-11-02).
STATUS = {
    "GOOD STANDING": "good_standing",
    "EXISTS": "exists",
    "DELINQUENT": "delinquent",
    "NONCOMPLIANT": "noncompliant",
    "REGISTERED AGENT RESIGNED": "registered_agent_resigned",
    "EFFECTIVENESS PREVENTED": "effectiveness_prevented",
    "VOLUNTARILY DISSOLVED": "voluntarily_dissolved",
    "ADMINISTRATIVELY DISSOLVED": "administratively_dissolved",
    "JUDICIALLY DISSOLVED": "judicially_dissolved",
    "DISSOLVED (TERM EXPIRED)": "dissolved_term_expired",
    "WITHDRAWN": "withdrawn",
    "REVOKED": "revoked",
    "MERGED": "merged",
    "CONVERTED": "converted",
    "CONSOLIDATED": "consolidated",
}

_US_STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "DISTRICT OF COLUMBIA": "DC", "FLORIDA": "FL", "GEORGIA": "GA",
    "HAWAII": "HI", "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS",
    "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA",
    "MICHIGAN": "MI", "MINNESOTA": "MN", "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT",
    "NEBRASKA": "NE", "NEVADA": "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
    "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK",
    "OREGON": "OR", "PENNSYLVANIA": "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA",
    "WEST VIRGINIA": "WV", "WISCONSIN": "WI", "WYOMING": "WY", "PUERTO RICO": "PR",
}
_STATE_CODES = frozenset(_US_STATES.values())


def state_of_formation(jurisdiction: str | None) -> str | None:
    """Two-letter US state from the ``jurisdictonofformation`` column; ``None`` for countries,
    "United States", "FC" (foreign country) and anything else."""
    j = " ".join((jurisdiction or "").upper().split())
    if not j:
        return None
    if j in _STATE_CODES:
        return j
    return _US_STATES.get(j)


def status(name: str | None) -> str | None:
    n = " ".join((name or "").upper().split())
    if not n:
        return None
    return STATUS.get(n) or re.sub(r"[^a-z0-9]+", "_", n.lower()).strip("_")


# The Department appends a status history to the name of an entity that is no longer in good standing:
# "KELLOGG SALES COMPANY, Colorado Authority Terminated December 9, 2002", "ACME INC Reinstated 2004,
# Delinquent January 1, 2010", "DENVER GAS COMPANY, Dissolved November 30, 1874", sometimes after ">>".
# It is not part of the legal name (the status column carries it), so an owner of record written as the
# bare name ("ACME INC") never matched. Real run, 2026-11-02: 1,871,769 of 3,132,613 names carry one.
_MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
_ANNOTATION = re.compile(
    r"(?:\s*>>|\s*,|\s)\s*(?:Colorado Authority\s+)?"
    r"(?:Reinstated|Dissolved|Delinquent|Delinquency Cured|Terminated|Withdrawn|Relinquished|Noncompliant|Revoked|"
    r"Merged|Expired|Converted|Consolidated|Forfeited|Suspended|Surrendered|Resigned)\s+(?:" + _MONTHS
    + r"\s+\d{1,2},\s+\d{4}|\d{4})\b.*$", re.IGNORECASE)


def legal_name(entityname: str | None) -> str:
    """The entity's name without the Department's appended status history; unchanged when it has none."""
    name = " ".join((entityname or "").split())
    m = _ANNOTATION.search(name)
    return name[: m.start()].rstrip(" ,") if m and name[: m.start()].strip(" ,") else name


clean_legal_name = legal_name  # `python -m factlot.registry.maintain --clean-entity-names` re-applies it to a built file


def _address(r: dict[str, str], prefix: str) -> str | None:
    lines = [r.get(f"{prefix}address1", "").strip(), r.get(f"{prefix}address2", "").strip()]
    city = r.get(f"{prefix}city", "").strip()
    state_zip = " ".join(p for p in (r.get(f"{prefix}state", "").strip(), r.get(f"{prefix}zipcode", "").strip()) if p)
    lines.append(", ".join(p for p in (city, state_zip) if p))
    country = r.get(f"{prefix}country", "").strip()
    if country and country.upper() not in ("US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"):
        lines.append(country)
    return ", ".join(p for p in lines if p) or None


def read_entities(path: str | Path) -> Iterator[EntityRecord]:
    """Yield one ``EntityRecord`` per row. Rows without an entity id or a name are yielded without a
    ``registry_number`` (or with an empty name), which the registry counts as skipped."""
    csv.field_size_limit(1 << 30)
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip().lower() for h in next(reader)]
        for values in reader:
            r = dict(zip(header, values))
            entity_id = r.get("entityid", "").strip()
            if entity_id.endswith(".0"):
                entity_id = entity_id[:-2]
            yield EntityRecord(
                legal_name=legal_name(r.get("entityname")),
                registry_jurisdiction=JURISDICTION,
                registry_number=entity_id or None,
                taxpayer_number=None,
                state_of_formation=state_of_formation(r.get("jurisdictonofformation")),
                mailing_address=_address(r, "principal") or _address(r, "mailing"),
                status=status(r.get("entitystatus")),
                locator=f"export.csv entityid {entity_id}" if entity_id else None,
            )


def build(snapshot_path: str | Path, db_path: str | Path, *, as_of: str, retrieved_at: str | None = None,
          link: bool = True) -> tuple[IngestStats, dict[str, int]]:
    """Ingest one archived export into a registry file, then (by default) link parcel owners to entities."""
    reg = Registry(db_path)
    try:
        reg.add_source(SOURCE)
        snap = reg.add_snapshot(SOURCE.source_id, snapshot_path, as_of, retrieved_at)
        stats = reg.ingest_entities(read_entities(snapshot_path), snap)
        links = reg.link_owners() if link else {}
        return stats, links
    finally:
        reg.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.co_sos_entities", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("snapshot", help="path to the CSV export as archived by the collector")
    ap.add_argument("db", help="registry SQLite file to create or update")
    ap.add_argument("--as-of", required=True, help="dataset update date, YYYY-MM-DD (the portal's 'data last updated')")
    ap.add_argument("--retrieved-at", help="ISO timestamp from the collector manifest")
    ap.add_argument("--no-link", action="store_true", help="do not run owner linking afterwards")
    args = ap.parse_args(argv)
    stats, links = build(args.snapshot, args.db, as_of=args.as_of, retrieved_at=args.retrieved_at, link=not args.no_link)
    print(json.dumps({"entities": asdict(stats), "owner_links": links}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

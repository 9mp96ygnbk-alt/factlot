"""GSA Lease Inventory (monthly external file, ``.xlsx``) → cited lease comps keyed to a building ID.

The U.S. General Services Administration posts, after the 1st of each month, its inventory of leases
(``gsa.gov/real-estate/real-estate-services/leasing-overview``): one row per lease with the lease number,
address, county, effective and expiration dates, the date of the tenant's termination right, whether the lease
is fully serviced, lease RSF, parking, the share of the building, **current annual rent**, the split of the
space between office, warehouse and special use, renewal options left, and the **lessor's name**. GSA states
the file is posted for market research on future leasing opportunities and that certain details are redacted.
Layout confirmed on the October 2026 file (2026-11-04): one worksheet, a header row, then 7,515 rows (147 of
them blank); header ``Region, Lease Num, Location Code, City, County, Address, State, ZipCode, Latitude,
Longitude, Field Office Name, Cen Bus Unit Ind, Lease Effective, Lease Expiration, Termination Right Date,
Latest Action affecting Term, Fully Serviced, Lease Agreement RSF, Lease Structured Parking, Lease Surface
parking, Percent Building, Current Annual Rent, Percent Office, Percent Warehouse, Percent Special, Renewal
Option Term left, Renewal Options Left, Lessor name``; dates are Excel serial numbers; ZIP codes are ``12345`` or
``12345-6789`` (or ``12345-`` when GSA cut the extension).

**A government-tenant lease is not a market comp for every use.** The tenant is the federal government. GSA
leases are usually full service, follow GSA's own lease form and requirements (security, accessibility, build-out
standards, termination rights), and often cover a small share of a building. The rent in the file is the *current*
annual rent, not the starting rent, and the file carries no escalation schedule, free rent, tenant improvement
allowance or commission. Every comp fact this adapter writes says so in its ``notes``.

Subject model (docs/lease-comps.md):

* **lease** ``fl:lease:<26-character token>``. The ID spec has the registry mint lease IDs. This adapter mints them
  *reproducibly*: ten zeros (no timestamp) then 16 characters of SHA-256 over ``gsa-lease-number:<number>``, so two
  registries built from the same file agree, and records the crosswalk ``gsa-lease-number``. The lease is a
  subject of its own with the facts ``lease.comp`` (the :class:`LeaseComp` value of ``@factlot/schema``),
  ``lease.rentable_area_sf``, ``lease.commencement_date``, ``lease.expiration_date`` and, only for an
  organisation, ``lease.landlord``.
* **building** ``fl:building:us-<SSCCC>:<zip5>:<street>``, computed from the street address, ZIP code and the county
  FIPS found from the county name (``counties.py``). It is not a registry subject (the building roll-up owns those);
  a ``leases`` relationship runs from the lease to it, and the lease's ``lease.comp`` carries it as ``building``.
* **parcel**: where the registry holds a parcel whose current situs address gives the same building ID, a
  ``leases`` relationship (``inferred``, confidence 0.8 for one parcel at the address, 0.6 for several) runs
  from the lease to the parcel (:func:`link_parcels`; run it again after loading more parcels).

Natural persons: the lessor of record is stored only when ``is_organization`` says it is one; a person's name is
dropped, never stored (data policy §3). The tenant is the federal government and is not stored as a party.

Usage: ``python -m factlot.registry.adapters.gsa_leases October-2026-External.xlsx registry.db --as-of 2026-11-01``
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from ...comps import implied_term_months, lease_comp_value_issues
from ...ids import FactLotIdError, _base32, building_id
from ..counties import county_fips
from ..normalize import is_organization, normalize_address, situs_street_and_zip
from ..store import Registry, Snapshot, Source
from . import xlsx_reader

SOURCE_ID = "gsa-lease-inventory"
# A rent per RSF outside these bounds is not published as a comp: a $0.23 or $3,286 rate means the rent and the RSF
# describe different things (parking, storage, a ground lease), not that the building is that cheap or dear.
MIN_RENT_PSF = 2.0
MAX_RENT_PSF = 250.0

NOTES = (
    "GSA lease: the tenant is the federal government (GSA, for an agency). The rent is the lease's current annual "
    "rent in the GSA lease inventory dated {as_of} divided by the lease RSF, not the starting rent, and the file "
    "gives no escalations, free rent, tenant improvement allowance or commissions. GSA leases are often full "
    "service and follow GSA's own lease form and requirements (security, build-out standards, termination rights), "
    "so they are not market comps for every use: adjust before using one for a private tenant."
)
_COMP_TYPE = {"New": "new", "New/Replacing": "new", "Renewal": "renewal", "Succeeding": "renewal",
              "Extension": "extension", "Holdover": "holdover", "Superseding": "other"}


def source() -> Source:
    return Source(
        source_id=SOURCE_ID,
        publisher="U.S. General Services Administration, Public Buildings Service",
        title="Lease Inventory (monthly external file)",
        url="https://www.gsa.gov/real-estate/real-estate-services/leasing-overview",
        state_fips="00",  # every state and territory: the registry's statewide convention for a national source
        license="US federal government work, public domain. GSA website policies: 'Most material on our site is free "
                "of copyright and may be copied and distributed without permission'; works by federal employees 'are "
                "in the public domain in the U.S.'",
        ai_use="permitted",  # public domain: no restriction on any use (GSA does not address AI use)
        redistribution="permitted",
        attribution="U.S. General Services Administration (citation of the GSA site and a link back is requested)",
        terms_reviewed="2026-11-04",
    )


_HEADERS = {
    "Lease Num": "lease", "Location Code": "location", "City": "city", "County": "county", "Address": "address",
    "State": "state", "ZipCode": "zip", "Lease Effective": "effective", "Lease Expiration": "expiration",
    "Termination Right Date": "termination", "Latest Action affecting Term": "action", "Fully Serviced": "serviced",
    "Lease Agreement RSF": "rsf", "Current Annual Rent": "rent", "Percent Office": "office",
    "Percent Warehouse": "warehouse", "Percent Special": "special", "Renewal Options Left": "renewals",
    "Lessor name": "lessor",
}


def rows(path: str | Path):
    """``(row number, fields)`` for each data row of the inventory (rows with no lease number are skipped)."""
    names: dict[int, str] | None = None
    for n, row in enumerate(xlsx_reader.rows(path), 1):
        if names is None:
            found = {i: _HEADERS[str(h).strip()] for i, h in enumerate(row) if h is not None and str(h).strip() in _HEADERS}
            if {"lease", "address", "rent", "rsf", "effective", "expiration"} <= set(found.values()):
                names = found
            continue
        rec = {name: (row[i] if i < len(row) else None) for i, name in names.items()}
        if str(rec.get("lease") or "").strip():
            yield n, rec


def _text(v: Any) -> str:
    return " ".join(str(v).split()) if v is not None else ""


def _date(v: Any) -> date | None:
    if isinstance(v, (int, float)) and 1 <= v < 80000:
        return date(1899, 12, 30) + timedelta(days=int(v))
    return None


def _positive(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def lease_urn(lease_number: str) -> str:
    """The reproducible lease ID: ten zeros (no timestamp), then 16 base-32 characters of
    SHA-256(``gsa-lease-number:<number>``). Same layout as a minted token, so ``id_parse`` accepts it."""
    token = _base32(hashlib.sha256(f"gsa-lease-number:{lease_number}".encode()).digest(), 16)
    return f"fl:lease:{'0' * 10}{token}"


@dataclass
class Lease:
    """One lease row, cleaned. ``comp`` is the ``lease.comp`` value (``None`` when the rent cannot be published)."""

    number: str
    row: int
    location: str
    street: str
    city: str
    state: str
    zip5: str | None
    county_name: str
    area_sf: float
    commencement: date
    expiration: date
    lessor: str | None
    building: str | None = None
    state_fips: str | None = None
    county_fips: str | None = None
    comp: dict[str, Any] | None = None
    comp_skipped: str | None = None

    @property
    def label(self) -> str:
        return f"{self.street}, {self.city}, {self.state} {self.zip5 or ''}".strip() + f" (GSA lease {self.number})"

    @property
    def situs(self) -> str:
        return f"{self.street}, {self.city}, {self.state} {self.zip5 or ''}".strip()


def parse_lease(n: int, r: dict[str, Any], as_of: str) -> tuple[Lease | None, str | None]:
    """``(lease, None)``, or ``(None, reason)`` when the row cannot be a lease record."""
    number = _text(r.get("lease"))
    street, state = _text(r.get("address")), _text(r.get("state")).upper()
    if not street or len(state) != 2:
        return None, "no_address_or_state"
    area = _positive(r.get("rsf"))
    start, end = _date(r.get("effective")), _date(r.get("expiration"))
    if area is None:
        return None, "no_rsf"
    if start is None or end is None or end <= start:
        return None, "bad_dates"
    zip_raw = _text(r.get("zip"))
    zip5 = zip_raw[:5] if len(zip_raw) >= 5 and zip_raw[:5].isdigit() else None
    lessor = _text(r.get("lessor")) or None
    lease = Lease(number=number, row=n, location=_text(r.get("location")), street=street, city=_text(r.get("city")),
                  state=state, zip5=zip5, county_name=_text(r.get("county")), area_sf=area, commencement=start,
                  expiration=end, lessor=lessor)
    found = county_fips(state, lease.county_name)
    if found and zip5:
        lease.state_fips, lease.county_fips = found
        try:
            lease.building = building_id(found[0], found[1], zip5, street).urn
        except FactLotIdError:
            lease.building = None
    rent = _positive(r.get("rent"))
    if rent is None:
        lease.comp_skipped = "no_rent"
        return lease, None
    psf = rent / area
    if not MIN_RENT_PSF <= psf <= MAX_RENT_PSF:
        lease.comp_skipped = "rent_psf_outside_bounds"
        return lease, None
    lease.comp = comp_value(lease, r, psf, as_of)
    problems = lease_comp_value_issues(lease.comp)
    if problems:  # an adapter bug, not bad data: fail loudly in tests
        raise ValueError(f"{number}: lease.comp does not fit the schema: {problems}")
    return lease, None


def comp_value(lease: Lease, r: dict[str, Any], psf: float, as_of: str) -> dict[str, Any]:
    v: dict[str, Any] = {"comp_type": _COMP_TYPE.get(_text(r.get("action")), "other")}
    mix = {k: float(r[k]) for k in ("office", "warehouse", "special") if isinstance(r.get(k), (int, float)) and r[k] > 0}
    if mix:
        top = max(mix, key=lambda k: mix[k])
        v["property_type"] = {"office": "office", "warehouse": "industrial", "special": "other"}[top]
    v["tenant_type"] = "government_federal"
    v["area_sf"] = round(lease.area_sf, 2)
    v["area_basis"] = "rentable"
    v["commencement_date"] = lease.commencement.isoformat()
    v["expiration_date"] = lease.expiration.isoformat()
    v["term_months"] = implied_term_months(v["commencement_date"], v["expiration_date"])
    early = _date(r.get("termination"))
    if early is not None and lease.commencement <= early < lease.expiration:
        v["early_termination_date"] = early.isoformat()
    v["current_rent_psf_yr"] = round(psf, 2)
    serviced = _text(r.get("serviced")).upper()
    if serviced in ("Y", "N"):
        v["expense_basis"] = "full_service" if serviced == "Y" else "not_full_service"
    renewals = r.get("renewals")
    if isinstance(renewals, (int, float)) and not isinstance(renewals, bool) and renewals >= 0 and float(renewals).is_integer():
        v["renewal_options"] = {"count": int(renewals)}
    if lease.building:
        v["building"] = lease.building
    v["state"] = lease.state
    v["confirming_party"] = "public_record"
    v["verification"] = "public_record"
    v["notes"] = NOTES.format(as_of=as_of)
    return v


@dataclass
class GsaStats:
    seen: int = 0
    leases: int = 0
    comps: int = 0
    skipped_rows: dict[str, int] = field(default_factory=dict)
    comps_not_published: dict[str, int] = field(default_factory=dict)
    lessors_stored: int = 0
    lessors_dropped_not_organization: int = 0
    lessors_blank: int = 0
    building_ids: int = 0
    building_id_missing: dict[str, int] = field(default_factory=dict)
    facts_written: int = 0
    retired: int = 0
    by_state: dict[str, int] = field(default_factory=dict)
    parcels_linked: dict[str, int] = field(default_factory=dict)


def _why_no_building(lease: Lease) -> str:
    if lease.zip5 is None:
        return "no_zip"
    if lease.county_fips is None:
        return "county_not_matched"
    return "street_has_no_house_number"


def ingest(reg: Registry, path: str | Path, as_of: str, *, retrieved_at: str | None = None,
           full_roll: bool = True) -> GsaStats:
    """Load one inventory file: a lease subject per row with its cited facts, crosswalk, address index entry and
    building relationship. Idempotent; with ``full_roll`` a lease an earlier snapshot listed that this one does not
    is retired (its facts become history)."""
    src = source()
    reg.add_source(src)
    snap = reg.add_snapshot(src.source_id, path, as_of, retrieved_at)
    stats = GsaStats()
    reg._tracking = True
    try:
        for n, raw in rows(path):
            stats.seen += 1
            lease, why = parse_lease(n, raw, as_of)
            if lease is None:
                stats.skipped_rows[why or "other"] = stats.skipped_rows.get(why or "other", 0) + 1
                continue
            _write_lease(reg, lease, snap, stats)
        if full_roll:
            stats.retired = reg._retire_absent(snap)
        reg.db.commit()
    finally:
        reg._tracking = False
    return stats


def _write_lease(reg: Registry, lease: Lease, snap: Snapshot, stats: GsaStats) -> None:
    urn = lease_urn(lease.number)
    old = {r[0] for r in reg.db.execute("SELECT fact_id FROM facts WHERE subject = ? AND document_id = ?",
                                        (urn, snap.document_id))}
    reg._written = set()
    loc = f"row {lease.row} lease {lease.number} location {lease.location}"
    reg._subject(urn, "lease", lease.label)
    reg._cover(urn, snap)
    n = 0
    n += reg._fact(urn, "lease.rentable_area_sf", round(lease.area_sf, 2), snap, unit="sf", locator=loc)
    n += reg._fact(urn, "lease.commencement_date", lease.commencement.isoformat(), snap, locator=loc)
    n += reg._fact(urn, "lease.expiration_date", lease.expiration.isoformat(), snap, locator=loc)
    if lease.lessor is None:
        stats.lessors_blank += 1
    elif is_organization(lease.lessor):
        n += reg._fact(urn, "lease.landlord", lease.lessor, snap, locator=loc)
        stats.lessors_stored += 1
    else:
        stats.lessors_dropped_not_organization += 1
    if lease.comp is not None:
        n += reg._fact(urn, "lease.comp", lease.comp, snap, unit=None, locator=loc)
        stats.comps += 1
    elif lease.comp_skipped:
        stats.comps_not_published[lease.comp_skipped] = stats.comps_not_published.get(lease.comp_skipped, 0) + 1
    reg.db.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?)", ("gsa-lease-number", lease.number, urn))
    reg.db.execute("INSERT OR IGNORE INTO address_index VALUES (?,?)", (normalize_address(lease.situs), urn))
    if lease.building:
        reg.db.execute("INSERT OR REPLACE INTO relationships VALUES (?,?,?,?,?,?,?,?)",
                       (urn, "leases", lease.building, snap.as_of, "public_record", None, snap.document_id,
                        "the lease's street address, ZIP code and county (GSA lease inventory) give this building ID"))
        stats.building_ids += 1
    else:
        why = _why_no_building(lease)
        stats.building_id_missing[why] = stats.building_id_missing.get(why, 0) + 1
    for fact_id in old - reg._written:
        reg.db.execute("DELETE FROM facts WHERE fact_id = ?", (fact_id,))
    stats.leases += 1
    stats.facts_written += n
    stats.by_state[lease.state] = stats.by_state.get(lease.state, 0) + 1


def link_parcels(reg: Registry, parcel_dbs: tuple[str | Path, ...] = ()) -> dict[str, int]:
    """Link each lease's building to the parcels a registry holds at that address.

    A parcel matches when its current ``parcel.situs_address`` gives the same building ID (street line and ZIP
    code, unit and suite dropped). One parcel at the address: a ``leases`` link from the lease to the parcel,
    ``inferred``, confidence 0.8; several (condominium units, a campus): each at 0.6. Parcels are read from this
    registry file, or from the registry files in ``parcel_dbs`` (only read, for a lease file kept apart from
    the parcel registries). Idempotent: earlier parcel links of this source are rebuilt. Returns counts."""
    db = reg.db
    snap = db.execute("SELECT document_id, as_of FROM snapshots WHERE source_id = ? ORDER BY as_of DESC, retrieved_at DESC LIMIT 1",
                      (SOURCE_ID,)).fetchone()
    if snap is None:
        return {"leases_with_building_id": 0, "leases_linked": 0, "links": 0}
    db.execute("DELETE FROM relationships WHERE type = 'leases' AND to_urn LIKE 'fl:parcel:%' AND document_id IN "
               "(SELECT document_id FROM snapshots WHERE source_id = ?)", (SOURCE_ID,))
    wanted: dict[str, list[str]] = {}
    for lease, building in db.execute("SELECT from_urn, to_urn FROM relationships WHERE type = 'leases' "
                                      "AND to_urn LIKE 'fl:building:us-%' AND document_id IN "
                                      "(SELECT document_id FROM snapshots WHERE source_id = ?)", (SOURCE_ID,)):
        wanted.setdefault(building, []).append(lease)
    regions = sorted({b.split(":")[2] for b in wanted})
    by_building: dict[str, set[str]] = {}
    schemas = ["main"]
    for i, path in enumerate(parcel_dbs):
        if not Path(path).exists():  # ATTACH would create an empty file
            raise FileNotFoundError(f"no registry file at {path}")
        db.execute(f"ATTACH DATABASE ? AS parcels{i}", (str(Path(path).resolve()),))
        schemas.append(f"parcels{i}")
    if parcel_dbs:
        schemas = schemas[1:]
    try:
        for schema in schemas:
            for region in regions:
                lo, hi = f"fl:parcel:{region}:", f"fl:parcel:{region};"
                for subject, value_json in db.execute(
                        f"SELECT subject, value_json FROM {schema}.current_facts WHERE predicate = 'parcel.situs_address' "
                        "AND subject >= ? AND subject < ?", (lo, hi)):
                    situs = json.loads(value_json)
                    found = situs_street_and_zip(situs) if isinstance(situs, str) and situs else None
                    if found is None or len(found[1]) < 5:
                        continue
                    try:
                        b = building_id(region[3:5], region[5:8], found[1], found[0]).urn
                    except FactLotIdError:
                        continue
                    if b in wanted:
                        by_building.setdefault(b, set()).add(subject)
    finally:
        for schema in schemas:
            if schema != "main":
                db.commit()
                db.execute(f"DETACH DATABASE {schema}")
    linked_leases = links = 0
    for building, parcels in by_building.items():
        confidence = 0.8 if len(parcels) == 1 else 0.6
        for lease in wanted[building]:
            linked_leases += 1
            for parcel in sorted(parcels):
                db.execute("INSERT OR REPLACE INTO relationships VALUES (?,?,?,?,?,?,?,?)",
                           (lease, "leases", parcel, snap["as_of"], "inferred", confidence, snap["document_id"],
                            "the parcel's current situs address and the lease's address give the same building ID "
                            f"({building})" + ("" if confidence == 0.8 else "; several parcels share the address")))
                links += 1
    db.commit()
    return {"leases_with_building_id": sum(len(v) for v in wanted.values()), "leases_linked": linked_leases,
            "links": links}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.gsa_leases", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs=2, metavar="FILE", help="the inventory .xlsx, then the registry file to write")
    ap.add_argument("--as-of", required=True, help="date of the inventory (the first of its month), YYYY-MM-DD")
    ap.add_argument("--retrieved-at")
    ap.add_argument("--no-link", action="store_true", help="skip linking leases to parcels")
    ap.add_argument("--parcels", action="append", default=[], metavar="REGISTRY.db",
                    help="link to the parcels in this registry file (read-only; repeat for several). Default: the "
                         "output registry itself")
    args = ap.parse_args(argv)
    path, db = args.files
    reg = Registry(db)
    try:
        stats = ingest(reg, path, args.as_of, retrieved_at=args.retrieved_at)
        out = asdict(stats)
        out["by_state"] = dict(sorted(stats.by_state.items()))
        if not args.no_link:
            out["parcels_linked"] = link_parcels(reg, tuple(args.parcels))
        print(json.dumps(out, indent=2))
    finally:
        reg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

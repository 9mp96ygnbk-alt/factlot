"""SEC EDGAR Form ABS-EE, Exhibit 102 (CMBS asset data, Regulation AB II Schedule AL) → ``debt.cmbs_loan`` facts.

Every registered commercial mortgage securities (CMBS) trust files, with each monthly report, an
Exhibit 102 XML file with one ``<assets>`` element per mortgage loan in the trust and one nested
``<property>`` per property securing it (namespace ``http://www.sec.gov/edgar/document/absee/cmbs/assetdata``;
element names and code tables: SEC "EDGAR ABS XML Technical Specification" v3.1, March 2025, section 4.3, and
17 CFR 229.1125, Item 1125 Schedule AL). The filings are public documents on ``www.sec.gov``; this adapter reads
a file already downloaded by the collector or by the run script (it never fetches).

What a record holds, and what it does not:

* The file names **no borrower** and no sponsor (Schedule AL has no such field): the only organisations it names are
  the originators, the primary servicer and the properties' largest tenants. Tenant names are kept only when
  ``is_organization`` reads them as an organisation, or when the name is a tenant at ten or more street addresses in five
  or more 3-digit ZIP code areas of the same run (``recurring_tenants``: a chain such as "Dollar General", never a person); every other tenant
  name is dropped and counted, so no natural person's name is stored.
* The balances, rate and maturity are the trust's loan as reported for the period. A multi-property loan repeats
  its loan-level figures on each property's fact (``properties_in_loan`` says how many) and nothing is allocated:
  do not add them up across a loan's properties. A whole loan split into pari passu notes held by several trusts has one
  fact per trust, so a building can hold several ``debt.cmbs_loan`` facts; the notes are not summed either.
* **Watchlist status is not in the file** (the CREFC watchlist belongs to the Investor Reporting Package, not to
  Schedule AL), so none is claimed. Servicing is shown by the payment status code, the most recent special servicer
  transfer date, the master servicer return date and the workout strategy code.

A property becomes a fact on its **building ID** (``fl:building:us-<SSCCC>:<zip5>:<street>``): the filing gives
state, ZIP code and a county name but no county FIPS, so the county is placed by ``CountyLocator`` from the U.S.
Census Bureau's 2020 ZIP Code Tabulation Area to county relationship file and county list (public domain, both
cited in the review record), with the filing's county name as a cross-check or fallback. A property that cannot be
placed (no street number, no ZIP code, a ZIP code in two counties with no county name to choose) is counted by reason and
gets no fact. Usage:

    python -m factlot.registry.adapters.sec_cmbs --zcta tab20_zcta520_county20_natl.txt --counties national_county2020.txt \\
        --trust "BANK5 2024-5YR6" --cik 2017898 --accession 0001888524-26-017917 exh_102.xml registry.db
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from ...ids import FactLotIdError, address_tokens, building_id
from ..coverage import state_postal
from ..normalize import is_organization, normalize_name, situs_street_and_zip
from ..store import BuildingFacts, IngestStats, Registry, Source

PREDICATE = "debt.cmbs_loan"
NAMESPACE = "http://www.sec.gov/edgar/document/absee/cmbs/assetdata"
STATE_FIPS_UNKNOWN = "00"

# Code tables: EDGAR ABS XML Technical Specification v3.1 (March 2025), section 4.3.
PROPERTY_TYPES = {
    "CH": "Cooperative housing", "HC": "HealthCare", "IN": "Industrial", "LO": "Lodging", "MF": "Multifamily",
    "MH": "Mobile Home Park", "MU": "Mixed Use", "OF": "Office", "RT": "Retail", "SE": "Securities",
    "SS": "Self Storage", "WH": "Warehouse", "ZZ": "Missing Information", "98": "Other",
}
# Property types kept. Everything else ("Other", "Securities" = a defeased loan whose collateral is now securities,
# "Missing Information") is counted and left out: the registry holds commercial, industrial and multifamily property only.
IN_SCOPE_TYPES = frozenset({"CH", "HC", "IN", "LO", "MF", "MH", "MU", "OF", "RT", "SS", "WH"})
PAYMENT_STATUS = {
    "0": "Current", "1": "30-59 days delinquent", "2": "60-89 days delinquent", "3": "90+ days delinquent",
    "4": "Performing matured balloon", "5": "Non performing matured balloon",
    "A": "Payment not received but still in grace period or not yet due",
    "B": "Late payment but less than 30 days delinquent",
}
WORKOUT_STRATEGY = {
    "1": "Modification", "2": "Foreclosure", "3": "Bankruptcy", "4": "Extension", "5": "Note sale", "6": "DPO",
    "7": "REO", "8": "Resolved", "9": "Pending return to master servicer", "10": "Deed-in-lieu of Foreclosure",
    "11": "Full Payoff", "12": "Reps and Warranties", "13": "TBD", "98": "Other",
}
MODIFICATION = {
    "1": "Maturity Date Extension", "2": "Amortization Change", "3": "Principal Write-off", "5": "Temporary Rate Reduction",
    "6": "Capitalization on Interest", "7": "Capitalization on Taxes", "8": "Combination", "10": "Forbearance", "98": "Other",
}
LIQUIDATION_PREPAYMENT = {
    "1": "Partial Liquidation(Curtailment)", "2": "Payoff Prior to Maturity", "3": "Disposition/Liquidation",
    "4": "Repurchase/Substitution", "5": "Full Payoff at Maturity", "6": "DPO",
    "7": "Liquidated-only for use for loans liquidated prior to 7/1/2006", "8": "Payoff w/ Penalty",
    "9": "Payoff w/ Yield Maintenance", "10": "Curtailment w/ Penalty", "11": "Curtailment w/ yield Maintenance",
}
LOAN_STRUCTURE = {
    "A1": "A Note; A/B Participation Structure", "A2": "A Note; A/B/C Participation Structure",
    "B1": "B Note; A/B Participation Structure", "B2": "B Note; A/B/C Participation Structure",
    "C2": "C Note; A/B/C Participation Structure", "MZ": "Mezzanine Financing",
    "PP": "Participated mortgage loan with pari passu debt outside trust", "WL": "Whole loan structure",
}
PAYMENT_TYPE = {
    "1": "Fully Amortizing", "2": "Amortizing Balloon", "3": "Interest Only/Balloon", "4": "Interest Only/Amortizing",
    "5": "Interest Only/Amortizing/Balloon", "6": "Principal Only", "7": "Hyper - Amortization", "98": "Other",
}
PROPERTY_STATUS = {
    "1": "In Foreclosure", "2": "REO", "3": "Defeased", "4": "Partial Release", "5": "Substituted",
    "6": "Same as at Securitization",
}
DEFEASANCE = {"F": "Full Defeasance", "IP": "Portion of Loan Previously Defeased", "N": "No Defeasance Occurred",
               "X": "Defeasance Not Allowable"}
VALUATION_SOURCE = {"BPO": "Broker price opinion", "MAI": "Certified MAI appraisal", "MS": "Master servicer estimate",
                    "Non-MAI": "Non-certified MAI appraisal", "SS": "Special servicer estimate", "98": "Other"}

SOURCE_BASIS = ("EDGAR ABS XML Technical Specification v3.1 (March 2025, sec.gov/files/absxml-31.zip), section 4.3 code "
                "tables; 17 CFR 229.1125 Schedule AL")


def source_for(cik: str | int, trust: str) -> Source:
    """One source per trust: a fact is current only while the latest snapshot of its source covers the building, so a
    trust's next monthly report replaces its earlier one without hiding the same building's loan in another trust."""
    cik10 = f"{int(cik):010d}"
    return Source(
        source_id=f"sec-edgar-cmbs-{int(cik)}",
        publisher="U.S. Securities and Exchange Commission (EDGAR), filed by the issuing entity",
        title=f"Form ABS-EE Exhibit 102 asset data, {trust}",
        url=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik10}&type=ABS-EE",
        state_fips=STATE_FIPS_UNKNOWN,
        county_fips=None,
        license="Public filing on www.sec.gov. SEC website policy: information presented on sec.gov is public information "
                "and may be copied or further distributed without the SEC's permission; filers' own contents are the "
                "registrant's disclosures (review record sec-edgar-cmbs-abs-ee).",
        ai_use="unknown",  # not addressed by the SEC
        redistribution="permitted",
        attribution="U.S. Securities and Exchange Commission, EDGAR; filing by " + trust,
        terms_reviewed="2026-11-04",
    )


# --- reading the XML ------------------------------------------------------------------------------


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _text(el: ET.Element | None) -> str | None:
    t = (el.text or "").strip() if el is not None else ""
    return t or None


def _dec(v: str | None) -> Decimal | None:
    if v is None:
        return None
    try:
        d = Decimal(v.replace(",", ""))
    except InvalidOperation:
        return None
    return d if d.is_finite() else None


def _num(d: Decimal | None, places: int = 2) -> int | float | None:
    """A JSON number: an integer when whole, otherwise rounded to ``places``."""
    if d is None:
        return None
    q = d.quantize(Decimal(1).scaleb(-places))
    return int(q) if q == q.to_integral_value() else float(q)


def _pct(d: Decimal | None) -> int | float | None:
    """A fraction (0.0279 or 1.0) as a percent number (2.79 or 100)."""
    return _num(d * 100, 4) if d is not None else None


def _int(v: str | None) -> int | None:
    d = _dec(v)
    return int(d) if d is not None and d == d.to_integral_value() and d >= 0 else None


def _date(v: str | None) -> str | None:
    """``MM-DD-YYYY`` (the schema's date format) → ISO."""
    if not v:
        return None
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", v.strip())
    if not m:
        return None
    try:
        return date(int(m[3]), int(m[1]), int(m[2])).isoformat()
    except ValueError:
        return None


def _bool(v: str | None) -> bool | None:
    return {"true": True, "false": False}.get((v or "").strip().lower())


def _coded(v: str | None, table: dict[str, str]) -> dict[str, str] | None:
    if not v:
        return None
    out = {"code": v}
    if v in table:
        out["description"] = table[v]
    return out


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None and v != "" and v != [] and v != {}}


@dataclass
class Loan:
    """One ``<assets>`` element: its own fields (``fields``) and its properties (each a dict of child texts).
    ``number`` is the position in the file (for locators). Empty elements are left out."""

    number: int
    fields: dict[str, str]
    properties: list[dict[str, str]]


def read_loans(path: str | Path) -> Iterator[Loan]:
    """Stream the loans of one Exhibit 102 file. Refuses a file with a DOCTYPE or entity declaration (untrusted XML)
    and a file that is not the CMBS asset data namespace."""
    with open(path, "rb") as f:
        head = f.read(4096)
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise ValueError("DOCTYPE/ENTITY declarations are not accepted")
    n = 0
    seen_root = False
    for _ev, el in ET.iterparse(path, events=("start", "end")):
        if not seen_root:
            seen_root = True
            if el.tag != "{" + NAMESPACE + "}assetData":
                raise ValueError(f"not a CMBS asset data file (root element {el.tag})")
        if _ev == "end" and _tag(el) == "assets":
            n += 1
            fields = {_tag(c): _text(c) or "" for c in el if len(c) == 0 and _text(c)}
            props = [{_tag(c): _text(c) or "" for c in p if len(c) == 0 and _text(c)} for p in el if _tag(p) == "property"]
            yield Loan(n, fields, props)
            el.clear()


# --- county placement -----------------------------------------------------------------------------


def county_key(name: str) -> str:
    """Comparable county name: accents and punctuation dropped, ``St.`` read as ``SAINT``, a trailing County, Parish,
    Borough, Census Area or Municipality removed; an independent city keeps ``CITY`` ("Baltimore city" ≠ "Baltimore")."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    s = re.sub(r"[^A-Z0-9 ]+", " ", s.replace("'", ""))
    s = re.sub(r"\bST\b", "SAINT", s)
    s = re.sub(r"\s+(?:COUNTY|PARISH|BOROUGH|CENSUS AREA|MUNICIPALITY|CITY AND BOROUGH)$", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


@dataclass
class Placement:
    state_fips: str
    county_fips: str  # the 3-digit part
    method: str


class CountyLocator:
    """Place a property's county from its state, ZIP code and the county name the filing gives.

    ``zcta`` maps a 5-digit ZIP code tabulation area to ``[(county GEOID, share of the area's land), ...]``;
    ``counties`` maps ``state postal code → {county_key: GEOID}``; ``state_fips`` maps postal code → 2-digit FIPS.
    Order of evidence: a ZIP code area lying in one county of the property's state (a county with under 1% of the
    area's land is a boundary sliver and ignored) decides; for an area in several counties the filing's county name
    chooses among them, else a county holding 95% or more of the land; with no usable ZIP code the county name alone.
    The method string says which, and ``conflicts`` counts the properties whose county name names another county than
    the ZIP code area does (the ZIP code area wins).
    """

    SLIVER = 0.01
    MAJORITY = 0.95

    def __init__(self, zcta: dict[str, list[tuple[str, float]]], counties: dict[str, dict[str, str]],
                 state_fips: dict[str, str]) -> None:
        self.zcta, self.counties, self.state_fips = zcta, counties, state_fips
        self.conflicts = 0

    @classmethod
    def from_files(cls, zcta_path: str | Path, counties_path: str | Path) -> "CountyLocator":
        state_fips: dict[str, str] = {}
        counties: dict[str, dict[str, str]] = defaultdict(dict)
        dup: set[tuple[str, str]] = set()
        with open(counties_path, encoding="utf-8") as f:
            header = f.readline().strip().split("|")
            ix = {h: i for i, h in enumerate(header)}
            for line in f:
                p = line.rstrip("\n").split("|")
                if len(p) < len(header):
                    continue
                st, sfp, cfp, name = p[ix["STATE"]], p[ix["STATEFP"]], p[ix["COUNTYFP"]], p[ix["COUNTYNAME"]]
                state_fips[st] = sfp
                key = county_key(name)
                if key in counties[st]:
                    dup.add((st, key))
                counties[st][key] = sfp + cfp
        for st, key in dup:  # two counties with one key: neither is usable by name
            counties[st].pop(key, None)
        raw: dict[str, list[tuple[str, float]]] = defaultdict(list)
        with open(zcta_path, encoding="utf-8-sig") as f:
            header = f.readline().strip().split("|")
            ix = {h: i for i, h in enumerate(header)}
            for line in f:
                p = line.rstrip("\n").split("|")
                if len(p) < len(header) or not p[ix["GEOID_ZCTA5_20"]] or not p[ix["GEOID_COUNTY_20"]]:
                    continue
                try:
                    land = float(p[ix["AREALAND_PART"]])
                except ValueError:
                    continue
                raw[p[ix["GEOID_ZCTA5_20"]]].append((p[ix["GEOID_COUNTY_20"]], land))
        zcta: dict[str, list[tuple[str, float]]] = {}
        for z, parts in raw.items():
            total = sum(a for _c, a in parts)
            if total <= 0:
                # an area with no land (water only): equal shares
                zcta[z] = [(c, 1 / len(parts)) for c, _a in parts]
            else:
                zcta[z] = [(c, a / total) for c, a in parts]
        return cls(zcta, dict(counties), state_fips)

    def locate(self, state: str | None, zip_code: str | None, county_name: str | None) -> tuple[Placement | None, str]:
        """``(placement, reason)``; the reason is ``"ok"`` or why the property could not be placed."""
        st = (state or "").strip().upper()
        sfp = self.state_fips.get(st)
        if not sfp:
            return None, "no_state"
        by_name = None
        if county_name and county_name.strip():
            by_name = self.counties.get(st, {}).get(county_key(county_name))
        z = normalize_zip(zip_code)
        cands = [(c, sh) for c, sh in self.zcta.get(z, []) if c.startswith(sfp) and sh >= self.SLIVER] if z else []
        if len(cands) == 1:
            fips = cands[0][0]
            if by_name and by_name != fips:
                self.conflicts += 1
                return Placement(sfp, fips[2:], "zip_code_area_county_name_differs"), "ok"
            return Placement(sfp, fips[2:], "zip_code_area+county_name" if by_name else "zip_code_area"), "ok"
        if len(cands) > 1:
            if by_name and by_name in {c for c, _s in cands}:
                return Placement(sfp, by_name[2:], "county_name_in_zip_code_area"), "ok"
            top = max(cands, key=lambda c: c[1])
            if top[1] >= self.MAJORITY:
                return Placement(sfp, top[0][2:], "zip_code_area_majority"), "ok"
            return None, "zip_code_in_several_counties"
        if by_name:
            return Placement(sfp, by_name[2:], "county_name"), "ok"
        return None, "no_zip_code_area_or_county" if z else "no_zip_code_and_no_county"


def normalize_zip(zip_code: str | None) -> str | None:
    """The 5-digit ZIP code: a 4-digit value had its leading zero dropped (``2141`` is ``02141``); ZIP+4 is cut to 5."""
    digits = re.sub(r"\D", "", zip_code or "")
    if len(digits) == 4:
        return "0" + digits
    if len(digits) in (5, 9):
        return digits[:5]
    if len(digits) == 8:  # ZIP+4 with the first zero dropped
        return ("0" + digits)[:5]
    return None


_NUMBER = r"\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?"
_NUMBER_LIST = re.compile(rf"^\s*({_NUMBER})\s*(?:,|&|;|\band\b)\s*\d")
_ORDINAL = re.compile(r"\d+(?:st|nd|rd|th)$", re.I)
_AKA = re.compile(r"(?i)\s+(?:a/?k/?a|also known as|and also)\b")


def street_line(address: str) -> tuple[str, bool]:
    """``(street line, reduced)``: the part of a filed address that names one street address.

    Filers list several house numbers in one field ("48371, 48377, 48383 & 48389 FREMONT BOULEVARD"). The building ID
    needs one address, so a field that opens with such a list is cut to its first number and the street name that
    follows ("48371 FREMONT BOULEVARD"), which is an address of the property; ``reduced`` says it was done. Anything
    after a semicolon or an "a/k/a" is dropped first. A field that does not open with a list is returned as filed."""
    original = address.strip()
    address = _AKA.split(address, maxsplit=1)[0]
    a = address.split(";")[0].strip()
    listed = address.replace(";", ",", 1)
    if not _NUMBER_LIST.match(listed):
        return a, a != original
    tokens = re.sub(r",(?=\S)", ", ", listed).split()
    first = tokens[0].rstrip(",")
    i = 1
    # skip the rest of the number list: numbers, ranges, commas and connectors
    while i < len(tokens) and (re.fullmatch(rf"{_NUMBER}[,]?|&|and|AND|,", tokens[i]) and not _ORDINAL.fullmatch(tokens[i].rstrip(","))):
        i += 1
    name = []
    while i < len(tokens):
        t = tokens[i]
        if name and (t.lower() in ("and", "&") or (t[0].isdigit() and not _ORDINAL.fullmatch(t.rstrip(",")))):
            break
        name.append(t.rstrip(","))
        if t.endswith(","):
            break
        i += 1
    return (f"{first} {' '.join(name)}".strip(), True) if name else (a, False)


# --- from a loan to facts ---------------------------------------------------------------------------


@dataclass
class RunStats:
    """What one file (or a whole run) contained and what became of it."""

    loans: int = 0
    loans_not_in_trust: int = 0  # still listed in the file, but with no balance or a zero one at the start and end of the period: left out
    loans_paid_off_in_period: int = 0  # balance went to zero during the period: kept, flagged
    properties: int = 0
    no_property_element: int = 0  # a loan with no <property> element
    placeholder_property: int = 0  # a <property> with no address and no state (or state NA): "Defeased", portfolio lines
    out_of_scope_type: Counter = field(default_factory=Counter)
    unplaced: Counter = field(default_factory=Counter)
    placed_by: Counter = field(default_factory=Counter)
    street_reduced: int = 0  # placed at one address of several the field gives ("4125, 4140 & 4144 Harbor Town Lane", "...; ...", "... a/k/a ...")
    buildings: int = 0
    facts: int = 0
    tenants_kept: int = 0
    tenants_kept_recurring: int = 0
    tenants_dropped: int = 0
    parcels_linked: int = 0
    buildings_with_parcels: int = 0
    buildings_with_several_parcels: int = 0  # two or more parcels at the address: the roll-up ties them to the building
    buildings_with_too_many_parcels: int = 0  # over 25 parcels reached through the ordinal reading: not linked
    ingest: IngestStats | None = None

    def as_dict(self) -> dict[str, Any]:
        """Plain JSON-ready counts (``dataclasses.asdict`` would rebuild the counters from their items)."""
        out = {k: (dict(v) if isinstance(v, Counter) else v) for k, v in self.__dict__.items() if k != "ingest"}
        out["ingest"] = asdict(self.ingest) if self.ingest else None
        return out

    def add(self, o: "RunStats") -> None:
        for f in ("loans", "loans_not_in_trust", "loans_paid_off_in_period", "properties", "no_property_element", "placeholder_property", "street_reduced", "buildings", "facts", "tenants_kept",
                  "tenants_kept_recurring", "tenants_dropped", "parcels_linked", "buildings_with_parcels",
                  "buildings_with_several_parcels", "buildings_with_too_many_parcels"):
            setattr(self, f, getattr(self, f) + getattr(o, f))
        for f in ("out_of_scope_type", "unplaced", "placed_by"):
            getattr(self, f).update(getattr(o, f))


TENANT_FIELDS = (("largestTenant", "squareFeetLargestTenantNumber", "leaseExpirationLargestTenantDate"),
                 ("secondLargestTenant", "squareFeetSecondLargestTenantNumber", "leaseExpirationSecondLargestTenantDate"),
                 ("thirdLargestTenant", "squareFeetThirdLargestTenantNumber", "leaseExpirationThirdLargestTenantDate"))


def tenant_key(name: str) -> str:
    """Key for the recurring-tenant count: the registry's name key (case, punctuation and suffixes dropped)."""
    return normalize_name(name)


# Not tenants at all: what filers write when there is none.
_NOT_A_TENANT = re.compile(r"(?i)^\W*(?:vacant|unknown|none|n/?a|tbd|dark|non[- ]rentable|no tenant|owner|various)\b")


def tenants_of(p: dict[str, str], stats: RunStats, recurring: frozenset[str]) -> list[dict[str, Any]]:
    out = []
    for name_f, sf_f, exp_f in TENANT_FIELDS:
        name = " ".join((p.get(name_f) or "").split())
        if not name:
            continue
        if _NOT_A_TENANT.match(name):
            stats.tenants_dropped += 1
            continue
        recurring_name = tenant_key(name) in recurring
        if not (is_organization(name) or recurring_name):
            stats.tenants_dropped += 1
            continue
        stats.tenants_kept += 1
        if recurring_name and not is_organization(name):
            stats.tenants_kept_recurring += 1
        out.append(_clean({"name": name, "square_feet": _int(p.get(sf_f)), "lease_expiration": _date(p.get(exp_f))}))
    return out


def standing(f: dict[str, str]) -> str:
    """Whether the file's row for a loan describes a loan in the trust at the end of the period.

    A file lists every loan the trust has had, so most rows of an older trust are loans that left it. ``"outstanding"``:
    a positive scheduled balance at period end. ``"in_period"``: the balance fell to zero during the period (paid off or
    liquidated: kept, flagged). ``"initial"``: a report with no period balances yet but a balance at securitization (the
    trust's first report). ``"before"``: zero at the start and end of the period. ``"no_balance"``: a bare row with no
    balance of any kind. The last two are left out."""
    end = _dec(f.get("reportPeriodEndScheduledLoanBalanceAmount"))
    if end is None:
        return "initial" if _dec(f.get("scheduledPrincipalBalanceSecuritizationAmount")) is not None else "no_balance"
    if end > 0:
        return "outstanding"
    begin = _dec(f.get("reportPeriodBeginningScheduleLoanBalanceAmount"))
    return "in_period" if begin is not None and begin > 0 else "before"


def loan_value(loan: Loan, p: dict[str, str], *, trust: str, cik: str, stats: RunStats,
               recurring: frozenset[str], placement: Placement) -> dict[str, Any]:
    f = loan.fields
    modified = _bool(f.get("modifiedIndicator"))
    transfer, returned = _date(f.get("mostRecentSpecialServicerTransferDate")), _date(f.get("mostRecentMasterServicerReturnDate"))
    prop = _clean({
        "name": p.get("propertyName"), "address": p.get("propertyAddress"), "city": p.get("propertyCity"),
        "state": p.get("propertyState"), "zip": p.get("propertyZip"), "county": p.get("propertyCounty"),
        "type": _coded(p.get("propertyTypeCode"), PROPERTY_TYPES),
        "net_rentable_sf": _int(p.get("netRentableSquareFeetNumber")),
        "units_beds_rooms": _int(p.get("unitsBedsRoomsNumber")),
        "year_built": _int(p.get("yearBuiltNumber")), "year_renovated": _int(p.get("yearLastRenovated")),
        "occupancy_pct": _pct(_dec(p.get("mostRecentPhysicalOccupancyPercentage"))),
        "occupancy_at_securitization_pct": _pct(_dec(p.get("physicalOccupancySecuritizationPercentage"))),
        "financials_period_start": _date(p.get("mostRecentFinancialsStartDate")),
        "financials_period_end": _date(p.get("mostRecentFinancialsEndDate")),
        "revenue_usd": _num(_dec(p.get("mostRecentRevenueAmount"))),
        "noi_usd": _num(_dec(p.get("mostRecentNetOperatingIncomeAmount"))),
        "ncf_usd": _num(_dec(p.get("mostRecentNetCashFlowAmount"))),
        "dscr_noi": _num(_dec(p.get("mostRecentDebtServiceCoverageNetOperatingIncomePercentage"))),
        "dscr_ncf": _num(_dec(p.get("mostRecentDebtServiceCoverageNetCashFlowpercentage"))),
        "noi_at_securitization_usd": _num(_dec(p.get("netOperatingIncomeSecuritizationAmount"))),
        "ncf_at_securitization_usd": _num(_dec(p.get("netCashFlowFlowSecuritizationAmount"))),
        "dscr_noi_at_securitization": _num(_dec(p.get("debtServiceCoverageNetOperatingIncomeSecuritizationPercentage"))),
        "dscr_ncf_at_securitization": _num(_dec(p.get("debtServiceCoverageNetCashFlowSecuritizationPercentage"))),
        "valuation_usd": _num(_dec(p.get("mostRecentValuationAmount"))),
        "valuation_date": _date(p.get("mostRecentValuationDate")),
        "valuation_source": _coded(p.get("mostRecentValuationSourceCode"), VALUATION_SOURCE),
        "valuation_at_securitization_usd": _num(_dec(p.get("valuationSecuritizationAmount"))),
        "valuation_at_securitization_date": _date(p.get("valuationSecuritizationDate")),
        "status": _coded(p.get("propertyStatusCode"), PROPERTY_STATUS),
        "defeasance": _coded(p.get("DefeasedStatusCode"), DEFEASANCE),
        "largest_tenants": tenants_of(p, stats, recurring),
    })
    value = _clean({
        "trust": trust, "trust_cik": f"{int(cik):010d}", "loan_id": f.get("assetNumber"),
        "reporting_period_start": _date(f.get("reportingPeriodBeginningDate")),
        "reporting_period_end": _date(f.get("reportingPeriodEndDate")),
        "originator": f.get("originatorName"),
        "origination_date": _date(f.get("originationDate")), "maturity_date": _date(f.get("maturityDate")),
        "original_balance_usd": _num(_dec(f.get("originalLoanAmount"))),
        "current_balance_usd": _num(_dec(f.get("reportPeriodEndScheduledLoanBalanceAmount"))),
        "actual_balance_usd": _num(_dec(f.get("reportPeriodEndActualBalanceAmount")))
        if f.get("reportPeriodEndActualBalanceAmount") != f.get("reportPeriodEndScheduledLoanBalanceAmount") else None,
        "balance_at_securitization_usd": _num(_dec(f.get("scheduledPrincipalBalanceSecuritizationAmount"))),
        "paid_off_in_period": True if standing(f) == "in_period" else None,
        "liquidation_prepayment": _coded(f.get("liquidationPrepaymentCode"), LIQUIDATION_PREPAYMENT),
        "liquidation_prepayment_date": _date(f.get("liquidationPrepaymentDate")),
        "interest_rate_pct": _pct(_dec(f.get("reportPeriodInterestRatePercentage"))),
        "original_term_months": _int(f.get("originalTermLoanNumber")),
        "amortization_months": _int(f.get("originalAmortizationTermNumber")),
        "interest_only": _bool(f.get("interestOnlyIndicator")),
        "payment_type": _coded(f.get("paymentTypeCode"), PAYMENT_TYPE),
        "loan_structure": _coded(f.get("loanStructureCode"), LOAN_STRUCTURE),
        "properties_in_loan": _int(f.get("NumberProperties")),
        "payment_status": _coded(f.get("paymentStatusLoanCode"), PAYMENT_STATUS),
        "paid_through_date": _date(f.get("paidThroughDate")),
        "primary_servicer": f.get("primaryServicerName"),
        "special_servicer_transfer_date": transfer, "master_servicer_return_date": returned,
        # Derived from the two dates only: transferred and not returned since (or no return reported).
        "specially_serviced": (returned is None or returned < transfer) if transfer else None,
        "workout_strategy": _coded(f.get("workoutStrategyCode"), WORKOUT_STRATEGY),
        "modified": modified,
        "last_modification_date": _date(f.get("lastModificationDate")),
        "modification": _coded(f.get("modificationCode"), MODIFICATION),
        "post_modification_maturity_date": _date(f.get("postModificationMaturityDate")),
        "post_modification_interest_rate_pct": _pct(_dec(f.get("postModificationInterestPercentage"))),
        "property": prop,
        "placement": {"state_fips": placement.state_fips, "county_fips": placement.county_fips, "method": placement.method},
    })
    return value


def label_for(placement: Placement, zip5: str, street_line: str) -> str:
    return f"{' '.join(address_tokens(street_line.split(',')[0]))}, {state_postal(placement.state_fips) or placement.state_fips} {zip5}"


def buildings_of(loans: Iterable[Loan], *, trust: str, cik: str, accession: str, filename: str, locator: CountyLocator,
                 recurring: frozenset[str], stats: RunStats,
                 unplaced_log: list[dict[str, Any]] | None = None) -> Iterator[BuildingFacts]:
    """One ``BuildingFacts`` per building with all the file's loan facts for it (a building named by two loans, or a
    portfolio loan with two properties at one address, gets all of them)."""
    grouped: dict[str, BuildingFacts] = {}
    for loan in loans:
        stats.loans += 1
        state = standing(loan.fields)
        if state in ("before", "no_balance"):
            stats.loans_not_in_trust += 1
            continue
        if state == "in_period":
            stats.loans_paid_off_in_period += 1
        if not loan.properties:
            stats.no_property_element += 1
            continue
        for k, p in enumerate(loan.properties, 1):
            stats.properties += 1
            state = p.get("propertyState")
            if not p.get("propertyAddress") and (state or "NA").upper() == "NA":
                stats.placeholder_property += 1
                continue
            ptype = p.get("propertyTypeCode") or ""
            if ptype not in IN_SCOPE_TYPES:
                stats.out_of_scope_type[PROPERTY_TYPES.get(ptype, ptype or "none")] += 1
                continue
            where = f"{accession} {filename} asset {loan.fields.get('assetNumber', loan.number)} property {k}"
            placement, reason = locator.locate(state, p.get("propertyZip"), p.get("propertyCounty"))
            street, reduced = street_line(p.get("propertyAddress") or "")
            zip5, urn = normalize_zip(p.get("propertyZip")), None
            if placement is not None and zip5 and street:
                try:
                    urn = building_id(placement.state_fips, placement.county_fips, zip5, street).urn
                except FactLotIdError:
                    reason = "street_without_house_number"
            elif placement is not None:
                reason = "no_street_address" if not street else "no_zip_code"
            if urn is None:
                reason = reason if reason != "ok" else "unplaced"
                stats.unplaced[reason] += 1
                if unplaced_log is not None:
                    unplaced_log.append({"trust": trust, "locator": where, "reason": reason,
                                         "name": p.get("propertyName"), "address": street, "city": p.get("propertyCity"),
                                         "state": state, "zip": p.get("propertyZip"), "county": p.get("propertyCounty")})
                continue
            assert placement is not None and zip5
            stats.placed_by[placement.method] += 1
            value = loan_value(loan, p, trust=trust, cik=cik, stats=stats, recurring=recurring, placement=placement)
            if reduced:
                value["placement"]["address_used"] = street
                stats.street_reduced += 1
            b = grouped.get(urn)
            if b is None:
                b = grouped[urn] = BuildingFacts(urn, label_for(placement, zip5, street), [], locator=where)
            b.facts.append((PREDICATE, value, None))
            stats.facts += 1
            if len(b.facts) > 1:
                b.locator = f"{b.locator.split(' (+')[0]} (+{len(b.facts) - 1} more)"
    stats.buildings = len(grouped)
    yield from grouped.values()


# --- linking to parcels -----------------------------------------------------------------------------

LINK_CONFIDENCE = 0.8
MAX_PARCELS_PER_LINK = 25
LINK_BASIS = ("the filed property address has the same street line, ZIP code and county as the parcel's current situs "
              "address (unit, suite and floor designators removed; a bare street number before a street type read as an "
              "ordinal, WEST 68 STREET as 68th Street): the building ID computed from either is the same")


_BARE_ORDINAL = re.compile(r"(?<=\s)(\d{1,3})(?=\s+(?:ST|STREET|AVE|AVENUE|PL|PLACE|RD|ROAD|DR|DRIVE|BLVD|BOULEVARD|LN|LANE|CT|COURT|TER|TERRACE)\b)", re.I)


def _suffix(n: int) -> str:
    return "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def ordinal_street(street: str) -> str:
    """A street line with a bare street number read as an ordinal: "23 WEST 68 STREET" → "23 WEST 68th STREET".

    New York City's Department of Finance writes numbered streets without the ordinal suffix that filings use. Only a
    number that is not the first word (the house number) and is followed by a street type is changed."""
    return _BARE_ORDINAL.sub(lambda m: m[1] + _suffix(int(m[1])), street) if " " in street.strip() else street


def link_parcels(reg: Registry, stats: RunStats | None = None) -> RunStats:
    """Link each building holding a current ``debt.cmbs_loan`` fact to the registry parcel(s) at its address.

    Reads every current ``parcel.situs_address`` once and computes the building ID the way the roll-up does (and, for a
    numbered street, with the bare number read as an ordinal). A building ID reached by exactly one parcel gets
    ``building --located_on--> parcel`` (``inferred``, confidence 0.8, basis above), citing the snapshot of the newest trust
    report that names it. Where two or more parcels give the same building ID by their own addresses, the roll-up
    (``rollup_buildings``) already ties them to that very building subject, so nothing is written and the building is
    counted in ``buildings_with_several_parcels``; several parcels reached only through the ordinal reading are linked
    here (up to 25). Idempotent: it rewrites every such link from the facts that are current now.
    """
    stats = stats or RunStats()
    db = reg.db
    db.execute("DELETE FROM relationships WHERE type = 'located_on' AND from_urn LIKE 'fl:building:%' AND document_id IN "
               "(SELECT document_id FROM snapshots WHERE source_id LIKE 'sec-edgar-cmbs-%')")
    newest: dict[str, tuple[str, str]] = {}
    for urn, doc, as_of in db.execute("SELECT subject, document_id, as_of FROM current_facts WHERE predicate = ? "
                                      "ORDER BY subject, as_of, document_id", (PREDICATE,)):
        newest[urn] = (as_of, doc)
    found: dict[str, list[tuple[str, bool]]] = defaultdict(list)  # building URN -> (parcel, ID computed as the roll-up does)
    for parcel, value_json in db.execute("SELECT subject, value_json FROM current_facts WHERE predicate = 'parcel.situs_address'"):
        situs = json.loads(value_json)
        parsed = situs_street_and_zip(situs) if isinstance(situs, str) else None
        if parsed is None or len(parsed[1]) < 5:
            continue
        region = parcel.split(":")[2]
        for street in dict.fromkeys((parsed[0], ordinal_street(parsed[0]))):
            try:
                urn = building_id(region[3:5], region[5:8], parsed[1], street).urn
            except FactLotIdError:
                continue
            if urn in newest:
                found[urn].append((parcel, street == parsed[0]))
                break
    for urn in sorted(found):
        parcels = sorted({p for p, _exact in found[urn]})
        # Parcels whose own address gives this very ID are tied to the building by the roll-up (when there are two or more);
        # parcels reached only by reading a bare street number as an ordinal are not, so they are linked here.
        if len(parcels) > 1 and any(exact for _p, exact in found[urn]):
            stats.buildings_with_several_parcels += 1
            continue
        if len(parcels) > MAX_PARCELS_PER_LINK:
            stats.buildings_with_too_many_parcels += 1
            continue
        as_of, doc = newest[urn]
        for parcel in parcels:
            db.execute("INSERT OR REPLACE INTO relationships VALUES (?,?,?,?,?,?,?,?)",
                       (urn, "located_on", parcel, as_of, "inferred", LINK_CONFIDENCE, doc, LINK_BASIS))
            stats.parcels_linked += 1
        stats.buildings_with_parcels += 1
    db.commit()
    return stats


# --- driver -------------------------------------------------------------------------------------------


def period_end(path: str | Path) -> str | None:
    """Latest ``reportingPeriodEndDate`` in the file (ISO), read from the first few loans."""
    best = None
    for loan in read_loans(path):
        d = _date(loan.fields.get("reportingPeriodEndDate"))
        if d and (best is None or d > best):
            best = d
        if loan.number >= 5:
            break
    return best


def build(xml_path: str | Path, db_path: str | Path, *, trust: str, cik: str | int, accession: str, locator: CountyLocator,
          as_of: str | None = None, recurring_tenants: frozenset[str] = frozenset(), link: bool = True,
          retrieved_at: str | None = None, unplaced_log: list[dict[str, Any]] | None = None) -> RunStats:
    """Ingest one trust's Exhibit 102 into a registry. ``as_of`` defaults to the reporting period end in the file."""
    stats = RunStats()
    cik10 = f"{int(cik):010d}"
    as_of = as_of or period_end(xml_path)
    if not as_of:
        raise ValueError("no reporting period end date in the file; pass as_of")
    source = source_for(cik, trust)
    reg = Registry(db_path)
    try:
        reg.add_source(source)
        snap = reg.add_snapshot(source.source_id, xml_path, as_of, retrieved_at)
        records = buildings_of(read_loans(xml_path), trust=trust, cik=cik10, accession=accession,
                               filename=Path(xml_path).name, locator=locator, recurring=recurring_tenants, stats=stats,
                               unplaced_log=unplaced_log)
        stats.ingest = reg.ingest_building_facts(records, snap, full_roll=True)
        if link:
            link_parcels(reg, stats)
        return stats
    finally:
        reg.close()


def recurring_tenants_of(paths: Iterable[str | Path], *, min_addresses: int = 10, min_zip3: int = 5) -> frozenset[str]:
    """Tenant name keys that are the largest, second or third tenant at ``min_addresses`` different street addresses in
    ``min_zip3`` different 3-digit ZIP code areas or more, across the given files: chains and brands, which no natural
    person is. (The same property reported by several trusts that hold notes of one loan counts once, and a portfolio
    in one metro area, however many of its properties name one tenant, falls short of the ZIP code spread.)"""
    addresses: dict[str, set[str]] = defaultdict(set)
    areas: dict[str, set[str]] = defaultdict(set)
    for path in paths:
        for loan in read_loans(path):
            for p in loan.properties:
                where = " ".join(f"{p.get('propertyAddress', '')} {p.get('propertyState', '')}".lower().split())
                zip5 = normalize_zip(p.get("propertyZip"))
                for name_f, _s, _e in TENANT_FIELDS:
                    name = " ".join((p.get(name_f) or "").split())
                    if name and where.strip() and not _NOT_A_TENANT.match(name):
                        k = tenant_key(name)
                        addresses[k].add(where)
                        if zip5:
                            areas[k].add(zip5[:3])
    return frozenset(k for k, a in addresses.items() if k and len(a) >= min_addresses and len(areas[k]) >= min_zip3)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.sec_cmbs", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", metavar="EXHIBIT102_XML REGISTRY_DB",
                    help="the Exhibit 102 file and the registry file; with --link-only, the registry file alone")
    ap.add_argument("--zcta", help="Census tab20_zcta520_county20_natl.txt")
    ap.add_argument("--counties", help="Census national_county2020.txt")
    ap.add_argument("--trust")
    ap.add_argument("--cik")
    ap.add_argument("--accession", help="0001888524-26-017917")
    ap.add_argument("--link-only", action="store_true", help="only (re)link buildings to parcels, e.g. after loading more rolls")
    ap.add_argument("--as-of", help="reporting period end, YYYY-MM-DD (default: read from the file)")
    ap.add_argument("--no-link", action="store_true", help="do not link buildings to registry parcels")
    args = ap.parse_args(argv)
    if args.link_only:
        reg = Registry(args.files[-1])
        try:
            print(json.dumps(link_parcels(reg).as_dict(), indent=2))
        finally:
            reg.close()
        return 0
    if len(args.files) != 2 or not all((args.zcta, args.counties, args.trust, args.cik, args.accession)):
        ap.error("needs EXHIBIT102_XML REGISTRY_DB --zcta --counties --trust --cik --accession")
    xml, db = args.files
    loc = CountyLocator.from_files(args.zcta, args.counties)
    stats = build(xml, db, trust=args.trust, cik=args.cik, accession=args.accession, locator=loc, as_of=args.as_of,
                  link=not args.no_link)
    print(json.dumps(stats.as_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

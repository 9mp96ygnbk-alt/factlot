"""Lease comps from leases that public companies file with the SEC (Exhibit 10 office, industrial and retail leases).

**Your agent extracts; FactLot verifies.** Nothing here reads a lease by itself. For each lease exhibit an agent
reads the text and writes a *spec*: the values it found (rentable area, commencement and expiration dates, annual
rent for each year, tenant improvement allowance, free rent, the expense basis, the parties' names), each with the
verbatim quote and page it came from. This module then runs ``doc_verify_facts`` over the exhibit's pages
(``docverify.verify_facts``, the same checks the MCP tool runs): the value must have the predicate's shape, the
quote must be on the cited page, and every number, date and name in the value must be written in the quote. Only
**verified** facts are kept; ``needs_review`` and ``rejected`` candidates are reported and dropped. From the
verified facts it builds one ``lease.comp`` (rent per SF from the verified annual rents and the verified area,
escalation derived from the verified rent steps, concessions as stated), validates it with ``lease_comp_validate``
(profile ``observed``) and derives its net effective rent with ``calc.net_effective_rent``.

What a comp from a filed lease is not: the filing is the executed lease (or its text as filed, often with
redactions), but the comp states no leasing commission (leases do not say what the landlord pays its broker), so
its NER is before commissions; the expense basis is the agent's reading of the quoted clause (the quote is checked
to be on the page, its meaning is not); a lease may be conditioned on a delivery date or later amended (only
leases whose commencement and expiration dates the text states are kept, and amendments are not read).

Pages. An SEC exhibit is HTML with no page numbers. ``html_pages`` cuts it at page-break markup (a horizontal rule or
a ``page-break-before: always`` style); a document with no markers is cut into chunks of about 3,500 characters at
line ends. The page numbers in every citation are these. Re-running ``html_pages`` on the exhibit with the cited
SHA-256 gives the same pages.

Privacy: the lease texts are never stored, only the verified values and their short quotes. A tenant or landlord
name is stored only when it passes ``is_organization`` (it is verified against its quote like any other value);
signature blocks, which carry natural persons' names and titles, are refused as quotes.

SEC fair access (https://www.sec.gov/os/accessing-edgar-data): the downloader that fetched the exhibits sent the
User-Agent in the environment variable ``FACTLOT_SEC_USER_AGENT`` (a name and a contact address; never written to
this repository) at no more than 2 requests per second from one stream, found exhibits through the EDGAR full-text
search JSON (``efts.sec.gov``) and fetched them from ``www.sec.gov/Archives``.

Usage:
  python -m factlot.registry.adapters.sec_lease_exhibits build PACKAGE_INPUT.json OUT_PACKAGE.json
      PACKAGE_INPUT: {"leases": [{"filing": {...}, "pages_file": "pages.json", "spec": {...}}]}
  python -m factlot.registry.adapters.sec_lease_exhibits load OUT_PACKAGE.json registry.db
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from ... import run_tool
from ...comps import implied_term_months, validate_lease_comp
from ...ids import FactLotIdError, _base32, short_id
from ..normalize import is_organization, normalize_address
from ..store import Registry, Snapshot, Source

SOURCE_ID = "sec-edgar-lease-exhibits"
PRODUCER = {"name": "factlot.registry.adapters.sec_lease_exhibits", "version": "1"}
# Rent predicates (generic: no dates inside the value, which the verifier cannot read in "10/01/26" form).
RENT_USD, RENT_PSF_YEAR, RENT_PSF_MONTH = "lease.rent_steps", "lease.rent_steps_psf_annual", "lease.rent_steps_psf_monthly"
RENT_MONTH_USD = "lease.rent_steps_monthly_usd"
_SIGNATURE = re.compile(r"\b(?:By|Its|Name|Title)\s*:\s|/s/|\bIN WITNESS WHEREOF\b", re.I)
_PARTY_PREDICATES = ("lease.landlord", "lease.tenant")
NOTES = (
    "Executed lease filed with the SEC ({exhibit}, {form}, filed {filed}); values extracted by an agent and verified "
    "against the filing's text by doc_verify_facts. Net effective rent is before leasing commissions (a lease does "
    "not state them){concessions}. The expense basis is the agent's reading of the quoted clause. A filed lease is "
    "one tenant's deal and may be amended later."
)


# --- HTML → pages ------------------------------------------------------------------------------------------------

_BLOCK = frozenset({"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "center", "pre"})
_CHUNK = 3500


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        style = (dict(attrs).get("style") or "").lower().replace(" ", "")
        if tag in ("script", "style"):
            self.skip += 1
            return
        if "page-break-before:always" in style or "break-before:page" in style:
            self.out.append("\f")
        if tag == "hr":
            self.out.append("\n\f\n")
            return
        if tag in ("td", "th"):
            self.out.append(" \t ")
        if tag in _BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag in _BLOCK:
            self.out.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.out.append(data)


def html_pages(raw: bytes) -> list[str]:
    """The pages of an HTML exhibit (see the module docstring)."""
    parser = _Text()
    parser.feed(raw.decode("utf-8", "replace"))
    text = "".join(parser.out).replace("\xa0", " ")
    pages = [re.sub(r"[ \t]+", " ", re.sub(r"\n\s*\n+", "\n", p)).strip() for p in text.split("\f")]
    pages = [p for p in pages if p]
    if len(pages) <= 3 and sum(map(len, pages)) > 20000:
        big, pages, cur = "\n".join(pages), [], ""
        for line in big.split("\n"):
            if len(cur) + len(line) > _CHUNK and cur:
                pages.append(cur)
                cur = ""
            cur += line + "\n"
        if cur:
            pages.append(cur)
    return pages


# --- IDs ---------------------------------------------------------------------------------------------------------

def lease_urn(accession: str, filename: str) -> str:
    """Reproducible lease ID: ten zeros, then 16 base-32 characters of SHA-256(``sec-lease-exhibit:<accession>:<file>``)."""
    token = _base32(hashlib.sha256(f"sec-lease-exhibit:{accession}:{filename}".encode()).digest(), 16)
    return f"fl:lease:{'0' * 10}{token}"


# --- verification ------------------------------------------------------------------------------------------------

def _num(x: Any) -> Any:
    """A whole number as an int, so 75556.0 is written 75556."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def _first(facts: list[dict[str, Any]], predicate: str) -> dict[str, Any] | None:
    return next((f for f in facts if f["predicate"] == predicate), None)


def _escalation(psf: list[float], step_months: int) -> tuple[dict[str, Any] | None, str | None]:
    """The escalation the verified yearly rents follow, or ``(None, why not)`` when no simple rule fits."""
    if len(psf) < 2 or all(abs(a - psf[0]) < 0.005 for a in psf):
        return {"type": "none"}, None
    ratios = [b / a for a, b in zip(psf, psf[1:])]
    diffs = [b - a for a, b in zip(psf, psf[1:])]
    mean, dmean = sum(ratios) / len(ratios), sum(diffs) / len(diffs)
    # How far the steps stray from each rule, relative to the bump it claims: the rule with the tighter fit wins
    # (a flat $0.50 on $25 looks like 2% and a 3% bump looks nearly flat in dollars).
    ratio_spread = (max(ratios) - min(ratios)) / max(abs(mean - 1), 1e-9)
    diff_spread = (max(diffs) - min(diffs)) / max(abs(dmean), 1e-9)
    if all(abs(r - mean) <= 0.0006 for r in ratios) and ratio_spread <= diff_spread:
        return {"type": "percent", "rate": round(mean - 1, 4), "every_months": step_months}, None
    if all(abs(d - dmean) <= 0.011 for d in diffs):
        return {"type": "fixed_psf", "amount": round(dmean, 4), "every_months": step_months}, None
    if all(abs(r - mean) <= 0.0006 for r in ratios):
        return {"type": "percent", "rate": round(mean - 1, 4), "every_months": step_months}, None
    return None, "rent steps follow no constant percentage or dollar bump"


def verify_lease(spec: dict[str, Any], pages: list[str], filing: dict[str, Any]) -> dict[str, Any]:
    """Run one spec through doc_verify_facts and build the comp. Returns the lease's package entry."""
    urn = lease_urn(filing["accession"], filing["filename"])
    notes: list[str] = []
    candidates = []
    for c in spec["facts"]:
        if _SIGNATURE.search(c["quote"]):
            notes.append(f"{c['predicate']}: quote refused (signature block or execution language)")
            continue
        if c["predicate"] in _PARTY_PREDICATES and not (isinstance(c["value"], str) and is_organization(c["value"])):
            notes.append(f"{c['predicate']}: {c['value']!r} dropped (not an organisation under is_organization)")
            continue
        candidates.append(c)
    res = run_tool("doc_verify_facts", {
        "document": {"pages": pages, "sha256": filing["sha256"], "title": filing.get("title") or filing["filename"]},
        "candidates": candidates, "as_of": filing["filed"], "subject": urn,
    }) if candidates else {"verified": [], "needs_review": [], "rejected": []}
    if "error" in res:
        raise ValueError(f"{filing['accession']}: doc_verify_facts: {res}")
    facts = [v["fact"] for v in res["verified"]]
    out: dict[str, Any] = {"urn": urn, "filing": filing, "verified": facts, "needs_review": res["needs_review"],
                           "rejected": res["rejected"], "notes": notes, "comp": None, "ner": None}
    area = _first(facts, "lease.rentable_area_sf")
    start, end = _first(facts, "lease.commencement_date"), _first(facts, "lease.expiration_date")
    rent_usd, rent_year, rent_month = _first(facts, RENT_USD), _first(facts, RENT_PSF_YEAR), _first(facts, RENT_PSF_MONTH)
    rent_month_usd = _first(facts, RENT_MONTH_USD)
    if not (area and start and end and (rent_usd or rent_year or rent_month or rent_month_usd)):
        notes.append("no comp: needs a verified area, commencement date, expiration date and rent steps")
        return out
    sf = float(area["value"])
    if rent_year:
        psf = [float(x["annual_psf"]) for x in rent_year["value"]]
    elif rent_month:
        psf = [float(x["monthly_psf"]) * 12 for x in rent_month["value"]]
    elif rent_month_usd:
        psf = [float(x["monthly_usd"]) * 12 / sf for x in rent_month_usd["value"]]
    else:
        psf = [float(x["annual_usd"]) / sf for x in rent_usd["value"]]  # type: ignore[index]
    step_months = int(spec.get("step_months", 12))
    esc, why = _escalation(psf, step_months)
    if esc is None:
        notes.append(f"no comp: {why}")
        return out
    value: dict[str, Any] = {"comp_type": spec.get("comp_type", "other")}
    for k in ("property_type", "tenant_type"):
        if spec.get(k):
            value[k] = spec[k]
    value.update({"area_sf": _num(sf), "area_basis": spec.get("area_basis", "rentable"), "commencement_date": start["value"],
                  "expiration_date": end["value"],
                  "term_months": implied_term_months(start["value"], end["value"]),
                  "starting_rent_psf_yr": _num(round(psf[0], 4)), "escalation": esc})
    free = _first(facts, "lease.free_rent")
    if free:
        value["free_rent_months"] = int(free["value"]["months"])
        value["free_rent_applies_to"] = free["value"].get("applies_to", "base_rent")
    ti = _first(facts, "lease.ti_allowance")
    if ti:
        v = ti["value"]
        value["ti_allowance_psf"] = _num(float(v["amount_psf"]) if "amount_psf" in v else round(float(v["amount_usd"]) / sf, 2))
    opex = _first(facts, "lease.opex_structure")
    if opex and spec.get("expense_basis"):
        value["expense_basis"] = spec["expense_basis"]
    if spec.get("opex_psf_yr") is not None:
        value["opex_psf_yr"] = spec["opex_psf_yr"]
    if filing.get("state"):
        value["state"] = filing["state"]
    if spec.get("submarket"):
        value["submarket"] = spec["submarket"]
    value["confirming_party"] = "public_record"
    value["verification"] = "document_verified"
    stated = [n for n, got in (("free rent", free), ("tenant improvement allowance", ti)) if got]
    value["notes"] = NOTES.format(exhibit=filing["exhibit_type"], form=filing["form"], filed=filing["filed"],
                                  concessions=(f"; {' and '.join(stated)} as stated" if stated else
                                               "; the lease states no free rent or allowance this extraction found"))
    comp_sources = [s for f in facts for s in f["provenance"]["sources"]]
    seen: set[tuple[Any, Any]] = set()
    sources = [s for s in comp_sources if (s.get("page"), s.get("quote")) not in seen and not seen.add((s.get("page"), s.get("quote")))]
    fact = {"subject": urn, "predicate": "lease.comp", "value": value, "as_of": filing["filed"],
            "provenance": {"method": "extracted", "sources": sources, "producer": PRODUCER},
            "rights": {"ai_use": "unknown", "redistribution": "attribution_required",
                       "license": "SEC.gov information is public and may be copied and distributed without the SEC's permission",
                       "attribution": f"U.S. Securities and Exchange Commission, EDGAR; {filing['filer']}"}}
    check = validate_lease_comp({"fact": fact, "profile": "observed"}, PRODUCER)
    if not check["valid"]:
        notes.append(f"no comp: lease_comp_validate: {check['issues']}")
        return out
    out["comp"] = fact
    out["ner"] = check["ner"]["fact"] if check["ner"] else None
    out["warnings"] = check["warnings"]
    return out


# --- registry -----------------------------------------------------------------------------------------------------

def source() -> Source:
    return Source(
        source_id=SOURCE_ID,
        publisher="U.S. Securities and Exchange Commission (EDGAR), exhibits filed by public companies",
        title="Lease exhibits (Exhibit 10) filed with Forms 8-K, 10-Q and 10-K: values verified against the filing text",
        url="https://www.sec.gov/edgar/search/",
        state_fips="00",
        license="SEC.gov: 'Information presented on sec.gov is considered public information and may be copied or further "
                "distributed by users of the web site without the SEC's permission' (https://www.sec.gov/about/privacy-information). "
                "Only extracted values and short quotations are stored, not the exhibits",
        ai_use="unknown",  # the SEC does not address AI use; the filers' copyright in their exhibits is not asserted either way
        redistribution="attribution_required",
        attribution="U.S. Securities and Exchange Commission, EDGAR, and the filer named on each fact's lease",
        terms_reviewed="2026-11-04",
    )


def _datetime(d: str) -> str:
    return d + "T00:00:00+00:00" if len(d) == 10 else d


def load(reg: Registry, package: dict[str, Any]) -> dict[str, int]:
    """Write a package's leases: the verified facts, the comp and its NER, a crosswalk to the accession and an
    address index entry. Idempotent."""
    reg.add_source(source())
    counts = {"leases": 0, "comps": 0, "facts": 0}
    reg._tracking = True
    try:
        for entry in package["leases"]:
            f = entry["filing"]
            snap = Snapshot(document_id=f"fl:document:sha256-{f['sha256']}", source_id=SOURCE_ID,
                            retrieved_at=_datetime(f.get("retrieved_at") or package.get("generated") or f["filed"]),
                            as_of=f["filed"], filename=f["filename"], bytes=f.get("bytes"))
            reg.db.execute("INSERT OR IGNORE INTO snapshots VALUES (?,?,?,?,?,?)",
                           (snap.document_id, snap.source_id, snap.retrieved_at, snap.as_of, snap.filename, snap.bytes))
            urn = entry["urn"]
            old = {r[0] for r in reg.db.execute("SELECT fact_id FROM facts WHERE subject = ? AND document_id = ?",
                                                (urn, snap.document_id))}
            reg._written = set()
            label = f"{f['filer']} lease" + (f", {f['city']}, {f['state']}" if f.get("city") and f.get("state") else "") + \
                    f" ({f['exhibit_type']}, {f['form']} filed {f['filed']})"
            reg._subject(urn, "lease", label)
            reg._cover(urn, snap)
            for fact in entry["verified"]:
                src = fact["provenance"]["sources"][0]
                loc = f"{f['url']} (accession {f['accession']}) page {src.get('page')}: \"{(src.get('quote') or '')[:300]}\""
                counts["facts"] += reg._fact(urn, fact["predicate"], fact["value"], snap, method="extracted", locator=loc)
            if entry.get("comp"):
                comp = entry["comp"]
                loc = f"{f['url']} (accession {f['accession']}): built from the verified facts above (pages " \
                      f"{', '.join(sorted({str(s.get('page')) for s in comp['provenance']['sources']}))})"
                counts["facts"] += reg._fact(urn, "lease.comp", comp["value"], snap, method="extracted", locator=loc)
                counts["comps"] += 1
                if entry.get("ner"):
                    ner = entry["ner"]
                    counts["facts"] += reg._fact(urn, "lease.net_effective_rent", ner["value"], snap, unit="USD/sf/yr",
                                                 method="computed", locator=f"{ner['provenance']['formula']} from lease.comp")
            reg.db.execute("INSERT OR REPLACE INTO crosswalk VALUES (?,?,?)",
                           ("sec-accession-exhibit", f"{f['accession']}/{f['filename']}", urn))
            if f.get("street") and f.get("city") and f.get("state"):
                reg.db.execute("INSERT OR IGNORE INTO address_index VALUES (?,?)",
                               (normalize_address(f"{f['street']}, {f['city']}, {f['state']}"), urn))
            for fact_id in old - reg._written:
                reg.db.execute("DELETE FROM facts WHERE fact_id = ?", (fact_id,))
            counts["leases"] += 1
        reg.db.commit()
    finally:
        reg._tracking = False
    return counts


def build(spec_input: dict[str, Any], base: Path) -> dict[str, Any]:
    leases = []
    for item in spec_input["leases"]:
        pages = json.loads((base / item["pages_file"]).read_text("utf-8"))
        leases.append(verify_lease(item["spec"], pages, item["filing"]))
    return {"generated": spec_input.get("generated"), "page_basis": "factlot.registry.adapters.sec_lease_exhibits.html_pages",
            "leases": leases}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m factlot.registry.adapters.sec_lease_exhibits", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["build", "load"])
    ap.add_argument("files", nargs=2)
    args = ap.parse_args(argv)
    if args.command == "build":
        src = Path(args.files[0])
        package = build(json.loads(src.read_text("utf-8")), src.parent)
        Path(args.files[1]).write_text(json.dumps(package, indent=1), "utf-8")
        print(json.dumps({"leases": len(package["leases"]), "comps": sum(1 for x in package["leases"] if x["comp"])}))
    else:
        reg = Registry(args.files[1])
        try:
            print(json.dumps(load(reg, json.loads(Path(args.files[0]).read_text("utf-8")))))
        finally:
            reg.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

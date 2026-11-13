"""Build a SYNTHETIC registry database for cross-language tests.

Every name, account, and value here is invented. This is not Texas data.
Usage: python build_fixture.py OUT.db
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
from factlot.registry import EntityRecord, ParcelFacts, ParcelRecord, Registry, Source  # noqa: E402
from factlot.registry.adapters import sec_cmbs, sec_exhibit21 as ex21  # noqa: E402
from factlot.registry.store import BuildingFacts, EntityParent  # noqa: E402

out = Path(sys.argv[1])
out.unlink(missing_ok=True)
tmp = Path(tempfile.mkdtemp())
reg = Registry(out)
reg.add_source(Source("test-roll", "Example County Appraisal District (synthetic)", "Appraisal roll",
                      "https://example.invalid/roll", "48", county_fips="999", license="Synthetic test data",
                      ai_use="permitted", redistribution="permitted", terms_reviewed="2026-11-02"))
reg.add_source(Source("test-entities", "Example Comptroller (synthetic)", "Entity list", "https://example.invalid/entities",
                      "48", license="Synthetic test data", ai_use="permitted", redistribution="attribution_required",
                      attribution="Example State"))


def snap(source, name, text, as_of):
    p = tmp / name
    p.write_text(text)
    return reg.add_snapshot(source, p, as_of=as_of, retrieved_at=f"{as_of}T12:00:00+00:00")


s25 = snap("test-roll", "roll-2025.txt", "synthetic roll 2025", "2025-07-25")
reg.ingest_parcels([
    ParcelRecord("999", "0001-000-0001", "F1", account="A1", situs_address="100 Main Street, Suite 400",
                 owner_name="Lonestar Office Holdings, L.L.C.", land_area_sf=40000, improvement_area_sf=120000,
                 year_built=1998, market_value=21000000, tax_year=2025),
    ParcelRecord("999", "0001-000-0002", "F2", account="A2", situs_address="5 Industrial Boulevard",
                 owner_name="Gulf Logistics LP", market_value=9500000, tax_year=2025),
    ParcelRecord("999", "0001-000-0004", "B", account="A4", situs_address="200 River Road", owner_name="John Example",
                 market_value=4000000, tax_year=2025),
], s25, state_fips="48", account_system="test-account", full_roll=True)
s26 = snap("test-roll", "roll-2026.txt", "synthetic roll 2026", "2026-07-25")
reg.ingest_parcels([
    ParcelRecord("999", "0001-000-0001", "F1", account="A1", situs_address="100 Main Street, Suite 400",
                 owner_name="Lonestar Office Holdings LLC", market_value=19750000.5, tax_year=2026),
    ParcelRecord("999", "0001-000-0004", "B", account="A4", situs_address="200 River Road", owner_name="John Example",
                 market_value=4100000, tax_year=2026),
    # Three condominium units and the common lot of one building (rolled up by its street address).
    # The common lot carries the building's year built; the unit records carry none (registry_get on a unit
    # warns that its values may be for the land only and names the common lot).
    ParcelRecord("999", "0002-000-1000", "F1", account="A10", situs_address="300 Harbor Drive, Example City TX 77999",
                 owner_name="Harbor Point Condominium Association", year_built=1984, market_value=1000, tax_year=2026),
    ParcelRecord("999", "0002-000-1001", "F1", account="A11", situs_address="300 Harbor Dr Unit 101, Example City TX 77999",
                 owner_name="Harbor Office Condos LLC", market_value=850000, tax_year=2026),
    ParcelRecord("999", "0002-000-1002", "F1", account="A12", situs_address="300 Harbor Dr Ste 102, Example City TX 77999-1234",
                 owner_name="Harbor Office Condos LLC", market_value=900000, tax_year=2026),
    ParcelRecord("999", "0002-000-1003", "F1", account="A13", situs_address="300 Harbor Drive #103, Example City TX 77999",
                 owner_name="Harbor Office Condos LLC", market_value=910000, tax_year=2026),
    ParcelRecord("999", "0003-000-0001", "F2", account="A20", situs_address="9 Northwest Industrial Way, Example City TX 77999",
                 owner_name="Gulf Logistics LP", market_value=3000000, tax_year=2026),
    # Area facts that fail the sanity checks (registry_get warns, and returns them as published).
    ParcelRecord("999", "0004-000-0001", "F1", account="A30", situs_address="12 Tower Court, Example City TX 77999",
                 owner_name="Tower Unit Holdings LLC", land_area_sf=150, improvement_area_sf=250000,
                 market_value=500000, tax_year=2026),
    ParcelRecord("999", "0004-000-0002", "F1", account="A31", situs_address="14 Tower Court, Example City TX 77999",
                 owner_name="Tower Unit Holdings LLC", land_area_sf=0, improvement_area_sf=-10,
                 market_value=400000, tax_year=2026),
    # A numbered street written with its ordinal here and bare in the second state below (address search's spellings).
    ParcelRecord("999", "0005-000-0001", "F1", account="A40", situs_address="8 W 9th Street, Example City TX 77999",
                 market_value=600000, tax_year=2026),
    # A lot whose address is a house-number range (address search finds a number inside it on the same side).
    ParcelRecord("999", "0006-000-0001", "F1", account="A50", situs_address="338-350 Fifth Avenue, Example City TX 77999",
                 improvement_area_sf=2000000, year_built=1931, market_value=900000000, tax_year=2026),
    # Two accounts at one address, one with no improvement on the roll: address search lists the improved one first.
    ParcelRecord("999", "0007-000-0001", "F1", account="A60", situs_address="500 Market Street, Example City TX 77999",
                 land_area_sf=20000, market_value=300000, tax_year=2026),
    ParcelRecord("999", "0007-000-0002", "F1", account="A61", situs_address="500 Market Street, Example City TX 77999",
                 improvement_area_sf=45000, year_built=2004, market_value=7000000, tax_year=2026),
], s26, state_fips="48", account_system="test-account", full_roll=True)
# A second state (Maryland, an invented county 998) whose street lines repeat the Texas ones, for the place an
# address search names after its street line: state, city and ZIP code.
reg.add_source(Source("test-roll-md", "Example Shore County Assessor (synthetic)", "Assessment roll",
                      "https://example.invalid/md-roll", "24", county_fips="998", license="Synthetic test data",
                      ai_use="permitted", redistribution="permitted", terms_reviewed="2026-11-02"))
md = snap("test-roll-md", "md-roll-2026.txt", "synthetic second-state roll 2026", "2026-07-01")
reg.ingest_parcels([
    ParcelRecord("998", "20-0001", "F1", account="M1", situs_address="100 Main Street, Shoreville MD 21999",
                 owner_name="Shoreline Example Partners LLC", market_value=2000000, tax_year=2026),
    ParcelRecord("998", "20-0002", "F1", account="M2", situs_address="300 Harbor Drive, Shoreville MD 21999",
                 market_value=1500000, tax_year=2026),
    ParcelRecord("998", "20-0003", "F1", account="M3", situs_address="12 Tower Court, Bayside MD 21998",
                 owner_name="Bayside Example Holdings LLC", market_value=700000, tax_year=2026),
    ParcelRecord("998", "20-0004", "F1", account="M4", situs_address="14 Tower Court, Shoreville MD 21999",
                 market_value=800000, tax_year=2026),
    ParcelRecord("998", "20-0005", "F1", account="M5", situs_address="8 W 9 Street, Shoreville MD 21999",
                 market_value=900000, tax_year=2026),
    # A ZIP code from another state's range, as some published labels carry.
    ParcelRecord("998", "20-0006", "F1", account="M6", situs_address="40 Helmsley Rd, Shoreville MD 19406",
                 market_value=950000, tax_year=2026),
], md, state_fips="24", account_system="test-md-account", full_roll=True)
# A third state (Connecticut, an invented county 998) whose label lost the leading zero of its ZIP code.
reg.add_source(Source("test-roll-ct", "Example Hills Town Assessor (synthetic)", "Assessment roll",
                      "https://example.invalid/ct-roll", "09", county_fips="998", license="Synthetic test data",
                      ai_use="permitted", redistribution="permitted", terms_reviewed="2026-11-02"))
ct = snap("test-roll-ct", "ct-roll-2026.txt", "synthetic third-state roll 2026", "2026-07-01")
reg.ingest_parcels([
    ParcelRecord("998", "30-0001", "F1", account="C1", situs_address="302 Platts Mill Rd, Example Hills CT 67021-9150",
                 market_value=1100000, tax_year=2026),
], ct, state_fips="09", account_system="test-ct-account", full_roll=True)
# Enrichment sources add facts to parcels the roll holds: zoning (one value per predicate) and sales
# (a predicate that holds many facts, returned newest first).
reg.add_source(Source("test-zoning", "Example City Planning (synthetic)", "Zoning", "https://example.invalid/zoning", "48",
                      county_fips="999", license="Synthetic test data", ai_use="permitted",
                      redistribution="attribution_required", attribution="Example City"))
reg.add_source(Source("test-sales", "Example City Finance (synthetic)", "Sales", "https://example.invalid/sales", "48",
                      county_fips="999", license="Synthetic test data", ai_use="unknown", redistribution="permitted"))
zon = snap("test-zoning", "zoning.csv", "synthetic zoning", "2026-08-24")
reg.ingest_parcel_facts([
    ParcelFacts("999", "0001-000-0001", [("zoning.district", "C5-3", None), ("zoning.other_districts", ["C6-4.5"], None),
                                         ("zoning.max_far_commercial", 15, None), ("parcel.num_floors", 40, None),
                                         ("parcel.area_by_use_sf", {"office": 450000, "retail": 50000}, "sf")],
                locator="line 2"),
    ParcelFacts("999", "0001-000-0004", [("zoning.district", "M1-1", None)], method="inferred", confidence=0.8,
                locator="line 3"),
    ParcelFacts("999", "0009-000-0009", [("zoning.district", "R1", None)]),  # not a parcel in the registry: skipped
], zon, state_fips="48", full_roll=True)
sales = snap("test-sales", "sales.xlsx", "synthetic sales", "2026-09-30")
reg.ingest_parcel_facts([
    ParcelFacts("999", "0001-000-0001", [
        ("transaction.sale", {"date": "2024-06-01", "price_usd": 0, "nominal_consideration": True}, None),
        ("transaction.sale", {"date": "2025-03-14", "price_usd": 12500000, "building_class": "O4"}, None),
        ("transaction.sale", {"date": "2025-03-14", "price_usd": 9000000}, None),
    ], locator="row 5 (+2 more)"),
], sales, state_fips="48")
# Recorded documents (deeds, mortgages, satisfactions) and building energy reports: more many-valued and single-valued
# predicates the readers in both languages must order and select alike. Synthetic; organisations only.
reg.add_source(Source("test-recorded", "Example City Register (synthetic)", "Recorded documents", "https://example.invalid/recorded", "48",
                      county_fips="999", license="Synthetic test data", ai_use="unknown", redistribution="permitted"))
recorded = snap("test-recorded", "recorded.csv", "synthetic recorded documents", "2026-09-30")
reg.ingest_parcel_facts([
    ParcelFacts("999", "0001-000-0001", [
        ("transaction.deed", {"date": "2025-03-14", "doc_type": "DEED", "amount_usd": 12500000, "grantees": ["LONESTAR OFFICE HOLDINGS LLC"],
                              "organizations_only": True}, None),
        ("transaction.deed", {"date": "2021-07-02", "doc_type": "DEED", "amount_usd": 0, "organizations_only": True}, None),
        ("debt.mortgage_recorded", {"date": "2025-03-20", "doc_type": "MTGE", "amount_usd": 8000000, "lenders": ["EXAMPLE TEST BANK, N.A."],
                                    "organizations_only": True}, None),
        ("debt.mortgage_recorded", {"date": "2025-03-20", "doc_type": "MTGE", "amount_usd": 500000, "organizations_only": True}, None),
        ("debt.mortgage_satisfaction_recorded", {"date": "2024-11-05", "doc_type": "SAT", "organizations_only": True}, None),
    ], locator="document 1"),
], recorded, state_fips="48")
reg.add_source(Source("test-energy", "Example City Buildings (synthetic)", "Energy benchmarking", "https://example.invalid/energy", "48",
                      county_fips="999", license="Synthetic test data", ai_use="permitted", redistribution="attribution_required",
                      attribution="Example City"))
energy = snap("test-energy", "energy.csv", "synthetic energy report", "2026-10-15")
reg.ingest_parcel_facts([
    ParcelFacts("999", "0001-000-0001", [("energy.reporting_year", 2024, None), ("energy.site_eui", 61.5, "kBtu/ft2"),
                                         ("energy.property_type", "Office", None)], locator="report 1"),
], energy, state_fips="48")
ent = snap("test-entities", "entities.csv", "synthetic entities", "2026-10-01")
reg.ingest_entities([
    EntityRecord("LONESTAR OFFICE HOLDINGS LLC", "us-tx", "0801111111", taxpayer_number="32000000001",
                 state_of_formation="TX", status="ACTIVE"),
    EntityRecord("Gulf Logistics, L.P.", "us-tx", "0804444444"),
    EntityRecord("Harbor Office Condos LLC", "us-tx", "0805555555", status="ACTIVE"),
    EntityRecord("Quiet Holdings LLC", "us-tx", "0806666666", status="ACTIVE"),
    EntityRecord("Bayou Equity Holdings LLC", "us-tx", "0807777777", status="ACTIVE"),
], ent)
# SEC filings (synthetic here): CMBS loan facts on building IDs, one fact per trust holding a note of the loan,
# and a registrant's Exhibit 21 line naming a registered entity as its subsidiary.
for cik, trust in ((1900001, "Example 2026-C1 Mortgage Trust"), (1900002, "Other 2026-C2 Mortgage Trust")):
    reg.add_source(sec_cmbs.source_for(cik, trust))
HARBOR = "fl:building:us-48999:77999:300-harbor-dr"
NW = "fl:building:us-48999:77999:9-nw-industrial-way"


def loan(trust, cik, period_end, balance, status):
    return {"trust": trust, "trust_cik": f"{cik:010d}", "loan_id": "7", "reporting_period_end": period_end,
            "current_balance_usd": balance, "original_balance_usd": 40000000, "interest_rate_pct": 5.25,
            "maturity_date": "2031-11-06", "payment_status": {"code": status[0], "description": status[1]},
            "property": {"name": "Harbor Point", "type": {"code": "OF", "description": "Office"}},
            "placement": {"state_fips": "48", "county_fips": "999", "method": "zip_code_area"}}


c1 = snap("sec-edgar-cmbs-1900001", "exh_102_c1.xml", "synthetic exhibit 102, trust 1", "2026-10-13")
c2 = snap("sec-edgar-cmbs-1900002", "exh_102_c2.xml", "synthetic exhibit 102, trust 2", "2026-11-12")
reg.ingest_building_facts([
    BuildingFacts(HARBOR, "300 HARBOR DR, TX 77999", [("debt.cmbs_loan", loan("Example 2026-C1 Mortgage Trust", 1900001, "2026-10-13", 39000000, ("0", "Current")), None)],
                  locator="0001900001-26-000001 exh_102_c1.xml asset 7 property 1"),
    BuildingFacts(NW, "9 NW INDUSTRIAL WAY, TX 77999", [("debt.cmbs_loan", loan("Example 2026-C1 Mortgage Trust", 1900001, "2026-10-13", 8000000, ("3", "90+ days delinquent")), None)],
                  locator="0001900001-26-000001 exh_102_c1.xml asset 8 property 1"),
], c1, full_roll=True)
reg.ingest_building_facts([
    BuildingFacts(HARBOR, "300 HARBOR DR, TX 77999", [("debt.cmbs_loan", loan("Other 2026-C2 Mortgage Trust", 1900002, "2026-11-12", 25000000, ("0", "Current")), None)],
                  locator="0001900002-26-000001 exh_102_c2.xml asset 2 property 1"),
], c2, full_roll=True)
sec_cmbs.link_parcels(reg)
reg.add_source(ex_src := ex21.source_for(900001, "Example Holdings Corp"))
ex21_snap = snap(ex_src.source_id, "ex21.htm", "synthetic exhibit 21", "2026-01-31")
reg.ingest_entity_parents([
    EntityParent("Example Holdings Corp", "0000900001", "DE", "fl:entity:us-tx:0801111111", 0.9, ex21.BASIS_REGISTRY_STATE,
                 {"parent": {"name": "Example Holdings Corp", "cik": "0000900001", "urn": "fl:entity:us-sec:0000900001"},
                  "listed_as": {"name": "Lonestar Office Holdings, L.L.C.", "jurisdiction": "Texas"}},
                 locator="0000900001-26-000004 ex21.htm line 12"),
], ex21_snap)
# A second synthetic appraisal district for registry_tx_equity_candidates and value history. Its rolls are one
# registry source per tax year, as the Texas adapters load them (Registry.ingest_roll): tax year 2025
# (test-cad-997-2025), 2026 (test-cad-997: a July roll and a corrected October roll that changes one value), and a
# 2027 preliminary roll (test-cad-997-2027) that changes values, codes, an area and a category, so a parcel holds
# current facts from three years at once. Building classes come from a separate buildings file per year
# (test-cad-997-buildings, test-cad-997-buildings-2027). Both value bases, neighborhood codes on some parcels, and
# owners of record the tool must never return.
CAD997 = Source("test-cad-997", "Example Central Appraisal District (synthetic)", "Appraisal roll",
                "https://example.invalid/cad-997", "48", county_fips="997", license="Synthetic test data",
                ai_use="unknown", redistribution="attribution_required", attribution="Example Central Appraisal District")
BAYOU, PARTNERS = "Bayou Equity Holdings LLC", "Example Office Partners LP"


def cad(apn, category, area, year, zip5, value, *, appraised=True, nbhd=None, owner=BAYOU, tax_year=2026,
        land=None, mailing="PO Box 9, Example City TX 77001", confidential=False):
    extra = [("parcel.neighborhood_code", nbhd, None)] if nbhd else []
    return ParcelRecord("997", apn, category, account=f"C{apn}", situs_address=f"{int(apn[-2:])} Alpha Plaza, Example City TX {zip5}",
                        owner_name=owner, owner_mailing_address=mailing if owner else None, owner_confidential=confidential,
                        land_area_sf=land, improvement_area_sf=area, year_built=year, market_value=value,
                        appraised_value=value if appraised and value is not None else None, tax_year=tax_year,
                        extra_facts=extra)


def roll_2026(subject_value):
    return [
        cad("1000001", "F1", 50000, 2005, "77001", subject_value, nbhd="N100", land=120000),  # the subject
        cad("1000002", "F1", 48000, 2000, "77002", 9100000, nbhd="N100"),
        cad("1000003", "F1", 55000, 2010, "77001", 11000000, appraised=False, nbhd="N100", owner=PARTNERS),
        cad("1000004", "F1", 40000, 1995, "77001", 7000000, owner=PARTNERS),
        cad("1000005", "F1", 60000, None, "77001", 12000000, nbhd="N200"),
        cad("1000006", "F1", 52000, 1980, "77001", 9900000),  # built outside the year band
        cad("1000007", "F1", 80000, 2005, "77001", 15000000),  # outside the area band
        cad("1000008", "F2", 50000, 2005, "77001", 6000000),  # another category
        cad("1000009", "F1", 45000, 2008, "77003", 8800000, nbhd="N300"),  # elsewhere in the county
        cad("1000011", "F1", 51000, 2006, "77001", None),  # no value
        cad("1000012", "F1", None, None, "77001", 3000000, land=90000),  # no improvement area
        cad("1000013", "F1", 47000, 2004, "77001", 9000000, tax_year=2025),  # a stale tax year
        # Owners the registry does not keep (data policy §3): a natural person, and an owner withheld under
        # Tax Code §25.025. The roll gives a name and mailing address for the first; neither is stored.
        cad("1000014", "F1", 49000, 2003, "77001", 9300000, owner="Jane Q Example",
            mailing="12 Quiet Lane, Example City TX 77001"),
        cad("1000015", "F1", 50500, 2004, "77001", 9400000, owner=None, confidential=True),
    ]


def roll_file(name, text, as_of, records):
    path = tmp / name
    path.write_text(text)
    reg.ingest_roll(CAD997, path, records, as_of=as_of, retrieved_at=f"{as_of}T12:00:00+00:00", state_fips="48",
                    account_system="test-cad-997-account", full_roll=True)


def buildings_file(year_suffix, name, as_of, classes):
    src = Source(f"test-cad-997-buildings{year_suffix}", "Example Central Appraisal District (synthetic)",
                 "Building file", "https://example.invalid/cad-997", "48", county_fips="997", license="Synthetic test data",
                 ai_use="unknown", redistribution="attribution_required", attribution="Example Central Appraisal District")
    reg.add_source(src)
    sn = snap(src.source_id, name, f"synthetic buildings {name}", as_of)
    reg.ingest_parcel_facts([ParcelFacts("997", apn, [("parcel.building_class", cls, None)], locator=f"building {apn}")
                             for apn, cls in classes], sn, state_fips="48", full_roll=True)


roll_file("cad-997-2025.txt", "synthetic district 997 roll 2025", "2025-07-25", [
    cad("1000001", "F1", 50000, 2005, "77001", 9000000, nbhd="N100", land=120000, tax_year=2025),
    cad("1000002", "F1", 48000, 2000, "77002", 8500000, nbhd="N100", tax_year=2025),
    cad("1000010", "F1", 50000, 2005, "77001", 9500000, tax_year=2025),  # on the 2025 roll only
])
roll_file("cad-997-2026.txt", "synthetic district 997 roll 2026", "2026-07-25", roll_2026(10000000))
roll_file("cad-997-2026-corrected.txt", "synthetic district 997 corrected roll 2026", "2026-10-15", roll_2026(9800000))
roll_file("cad-997-2027-preliminary.txt", "synthetic district 997 preliminary roll 2027", "2027-04-15", [
    cad("1000001", "F1", 50000, 2005, "77001", 10500000, nbhd="N100", land=120000, tax_year=2027),
    cad("1000002", "F1", 48000, 2000, "77002", 9500000, nbhd="N150", tax_year=2027),  # a new neighborhood
    cad("1000003", "F1", 70000, 2010, "77001", 12000000, appraised=False, nbhd="N100", owner=PARTNERS,
        tax_year=2027),  # enlarged: outside the 2027 area band
    cad("1000004", "F2", 40000, 1995, "77001", 7500000, owner=PARTNERS, tax_year=2027),  # reclassified
    cad("1000009", "F1", 45000, 2008, "77003", 9200000, nbhd="N300", tax_year=2027),
])
buildings_file("", "cad-997-buildings-2026.txt", "2026-07-25", [("1000001", "B"), ("1000002", "B"), ("1000005", "A")])
buildings_file("-2027", "cad-997-buildings-2027.txt", "2027-04-15", [("1000001", "C"), ("1000002", "A")])
reg.link_owners()
reg.rollup_buildings()
reg.refresh_coverage()
reg.close()
print(out)

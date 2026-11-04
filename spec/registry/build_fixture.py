"""Build a SYNTHETIC registry database for cross-language tests.

Every name, account, and value here is invented. This is not Texas data.
Usage: python build_fixture.py OUT.db
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python" / "src"))
from factlot.registry import EntityRecord, ParcelFacts, ParcelRecord, Registry, Source  # noqa: E402

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
    ParcelRecord("999", "0002-000-1000", "F1", account="A10", situs_address="300 Harbor Drive, Example City TX 77999",
                 owner_name="Harbor Point Condominium Association", market_value=1000, tax_year=2026),
    ParcelRecord("999", "0002-000-1001", "F1", account="A11", situs_address="300 Harbor Dr Unit 101, Example City TX 77999",
                 owner_name="Harbor Office Condos LLC", market_value=850000, tax_year=2026),
    ParcelRecord("999", "0002-000-1002", "F1", account="A12", situs_address="300 Harbor Dr Ste 102, Example City TX 77999-1234",
                 owner_name="Harbor Office Condos LLC", market_value=900000, tax_year=2026),
    ParcelRecord("999", "0002-000-1003", "F1", account="A13", situs_address="300 Harbor Drive #103, Example City TX 77999",
                 owner_name="Harbor Office Condos LLC", market_value=910000, tax_year=2026),
    ParcelRecord("999", "0003-000-0001", "F2", account="A20", situs_address="9 Northwest Industrial Way, Example City TX 77999",
                 owner_name="Gulf Logistics LP", market_value=3000000, tax_year=2026),
], s26, state_fips="48", account_system="test-account", full_roll=True)
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
ent = snap("test-entities", "entities.csv", "synthetic entities", "2026-10-01")
reg.ingest_entities([
    EntityRecord("LONESTAR OFFICE HOLDINGS LLC", "us-tx", "0801111111", taxpayer_number="32000000001",
                 state_of_formation="TX", status="ACTIVE"),
    EntityRecord("Gulf Logistics, L.P.", "us-tx", "0804444444"),
    EntityRecord("Harbor Office Condos LLC", "us-tx", "0805555555", status="ACTIVE"),
    EntityRecord("Quiet Holdings LLC", "us-tx", "0806666666", status="ACTIVE"),
], ent)
reg.link_owners()
reg.rollup_buildings()
reg.refresh_coverage()
reg.close()
print(out)

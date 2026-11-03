"""Montana State Library cadastral adapter and dBASE reader tests on a SYNTHETIC table that copies the real layout.

Every geocode, name, address and value here is invented; none is real Montana data. The synthetic ``.dbf`` has the real
field names and widths of the State Library's ``Montana_Parcels.dbf`` (shapefile 10-character names), and is written
into a zip like the real download.
"""

import json
import struct
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import dbf_reader, mt_msl

FIELDS = [("PARCELID", "C", 17), ("COUNTYCD", "N", 5), ("CountyName", "C", 32), ("GISAcres", "F", 19), ("TaxYear", "N", 10),
          ("PropertyID", "N", 10), ("AddressLin", "C", 104), ("AddressL_1", "C", 27), ("CityStateZ", "C", 55),
          ("PropType", "C", 60), ("TotalAcres", "F", 19), ("TotalValue", "N", 10), ("OwnerName", "C", 167),
          ("OwnerAddre", "C", 64), ("OwnerAdd_1", "C", 64), ("OwnerAdd_2", "C", 64), ("OwnerCity", "C", 40),
          ("OwnerState", "C", 2), ("OwnerZipCo", "C", 50)]


def make_dbf(rows: list[dict], deleted: set[int] = frozenset()) -> bytes:
    rlen = 1 + sum(w for _, _, w in FIELDS)
    hlen = 32 + 32 * len(FIELDS) + 1
    head = bytearray(32)
    head[0] = 3
    struct.pack_into("<IHH", head, 4, len(rows), hlen, rlen)
    desc = b""
    for name, kind, width in FIELDS:
        desc += name.encode().ljust(11, b"\0") + kind.encode() + b"\0\0\0\0" + bytes([width, 0]) + b"\0" * 14
    out = bytes(head) + desc + b"\x0d"
    for i, r in enumerate(rows):
        rec = b"*" if i in deleted else b" "
        for name, kind, width in FIELDS:
            v = r.get(name, "")
            text = str(v) if v is not None else ""
            rec += text.rjust(width).encode("cp1252") if kind in "NF" else text.ljust(width).encode("cp1252")
        out += rec
    return out + b"\x1a"


def row(**f):
    base = {"PARCELID": "99000000000000001", "COUNTYCD": 56, "CountyName": "Lincoln", "TaxYear": 2026, "PropertyID": 1001,
            "AddressLin": "1 EXAMPLE RD", "CityStateZ": "LIBBY, MT 59923", "PropType": "Apartment", "TotalAcres": "1.5",
            "TotalValue": 2500000, "OwnerName": "EXAMPLE APARTMENTS LLC", "OwnerAddre": "PO BOX 5", "OwnerCity": "KALISPELL",
            "OwnerState": "MT", "OwnerZipCo": "59901-7540"}
    base.update(f)
    return base


ROWS = [
    row(),
    row(PARCELID="99000000000000002", PropertyID=1002, PropType="Industrial Property", OwnerName="SAMPLE MILL INC", TotalAcres="",
        GISAcres="9.5", TotalValue=800000, AddressLin="", CityStateZ=""),
    # The same county geocode again; the same geocode in another county is another parcel.
    row(PropType="Apartment", OwnerName="DUPLICATE LLC"),
    row(CountyName="Flathead", COUNTYCD=7, PropType="Apartment", PropertyID=2001, OwnerName="OTHER COUNTY LLC"),
    # A person; a legacy code; classes that do not name themselves; a deleted record; an unknown county; no geocode.
    row(PARCELID="99000000000000003", PropertyID=1003, OwnerName="EXAMPLE JANE", PropType="Apartment"),
    row(PARCELID="99000000000000004", PropertyID=1004, PropType="CU - Commercial Urban", OwnerName="LEGACY RETAIL CORP"),
    row(PARCELID="99000000000000005", PropType="Improved Property"),
    row(PARCELID="99000000000000006", PropType="Vacant Land"),
    row(PARCELID="99000000000000007", PropType="Mobile/RV Parks"),
    row(PARCELID="99000000000000008", PropType="Apartment", OwnerName="DELETED LLC"),
    row(PARCELID="99000000000000009", PropType="Apartment", CountyName="Atlantis"),
    row(PARCELID="", PropType="Apartment"),
]


class MtMslTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = self.tmp / "MTParcels_SHP.zip"
        with zipfile.ZipFile(self.zip, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("Montana_Parcels/Montana_Parcels.cpg", "UTF-8")
            z.writestr("Montana_Parcels/Montana_Parcels.dbf", make_dbf(ROWS, deleted={9}))
            z.writestr("Montana_Parcels/Montana_Parcels.shp", b"not read")

    def test_dbf_reader(self):
        rows = list(dbf_reader.open_dbf(self.zip))
        self.assertEqual(len(rows), 11, "the deleted record is skipped")
        self.assertEqual(rows[0]["PARCELID"], "99000000000000001")
        self.assertEqual((rows[0]["COUNTYCD"], rows[0]["TotalAcres"], rows[0]["TotalValue"]), (56.0, 1.5, 2500000.0))
        self.assertIsNone(rows[1]["TotalAcres"], "a blank numeric field is None")
        loose = self.tmp / "loose.dbf"
        loose.write_bytes(make_dbf(ROWS[:2]))
        self.assertEqual(len(list(dbf_reader.open_dbf(loose))), 2)

    def test_county_table(self):
        self.assertEqual(len(mt_msl.COUNTY_FIPS), 56)
        self.assertEqual(mt_msl.county_fips("Lincoln"), "053")
        self.assertEqual(mt_msl.county_fips("Lewis and Clark"), "049")
        self.assertEqual(mt_msl.county_fips("Yellowstone"), "111")
        self.assertEqual(mt_msl.county_fips("silver bow"), "093")
        self.assertIsNone(mt_msl.county_fips("Atlantis"))

    def test_state_category(self):
        sc = mt_msl.state_category
        self.assertEqual((sc("Apartment"), sc("Industrial Property"), sc("CU - Commercial Urban"), sc("IR - Industrial Rural")),
                         ("B", "F2", "F1", "F2"))
        for label in ("Improved Property", "Vacant Land", "Exempt Property", "Tribal Property", "Townhouse", "Condominium",
                      "Mobile/RV Parks", "Golf Course", "Gravel Pit", "", None):
            self.assertIsNone(sc(label), label)

    def test_records(self):
        recs = {(r.county_fips, r.apn): r for r in mt_msl.read_roll(self.zip)}
        self.assertEqual(sorted(recs), [("029", "99000000000000001"), ("053", "99000000000000001"), ("053", "99000000000000002"),
                                        ("053", "99000000000000003"), ("053", "99000000000000004")])
        apts = recs[("053", "99000000000000001")]
        self.assertEqual((apts.state_category, apts.local_use_code, apts.account), ("B", "Apartment", "053-1001"))
        self.assertEqual(apts.owner_name, "EXAMPLE APARTMENTS LLC", "the first row of a duplicated geocode wins")
        self.assertEqual(apts.situs_address, "1 EXAMPLE RD, LIBBY, MT 59923")
        self.assertEqual(apts.owner_mailing_address, "PO BOX 5, KALISPELL, MT 59901-7540")
        self.assertEqual((apts.market_value, apts.tax_year, apts.land_area_sf), (2500000.0, 2026, round(1.5 * 43560, 2)))
        mill = recs[("053", "99000000000000002")]
        self.assertEqual((mill.state_category, mill.land_area_sf), ("F2", round(9.5 * 43560, 2)))
        self.assertIsNone(mill.situs_address)
        self.assertEqual(recs[("053", "99000000000000004")].state_category, "F1")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = mt_msl.build(self.zip, db, as_of="2026-10-06")
        self.assertEqual((stats.seen, stats.kept), (5, 5))
        reg = Registry.open_readonly(db)
        try:
            urn = reg.db.execute("SELECT urn FROM crosswalk WHERE system = 'mt_orion_property_id' AND external_id = '029-2001'").fetchone()[0]
            self.assertTrue(urn.startswith("fl:parcel:us-30029:"), urn)
            owners = sorted(json.loads(r[0]) for r in reg.db.execute(
                "SELECT value_json FROM current_facts WHERE predicate = 'ownership.owner_of_record'"))
            self.assertEqual(owners, ["EXAMPLE APARTMENTS LLC", "LEGACY RETAIL CORP", "OTHER COUNTY LLC", "SAMPLE MILL INC"],
                             "organisations only")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()

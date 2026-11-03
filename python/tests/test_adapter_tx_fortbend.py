"""Fort Bend CAD adapter tests on a SYNTHETIC fixture that copies the Orion export layout.

Every account id, name and value here is invented to exercise the mapping; none is real Fort Bend
County data. The fixture is a zip holding the property and owner exports with the real headers of
the redacted export (comma-delimited, quoted where needed, CRLF), inside a folder as FBCAD ships it.
"""

import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import tx_fortbend

PROPERTY_HEADER = ("RecordType,PropertyQuickRefID,PropertyNumber,PropertyTypeCode,SitusStreetAddress,SitusCity,SitusState,"
                   "SitusZip,LegalDesc,AbstractCode,Block,Tract,Acres,Entities,StateCodeLand,StateCodeImp,ProdUseCode,"
                   "ARBProtestFlag,CADFlag,ApplyTUPct,ChangeCode,Comment,TaxYear,SupplementNumber").split(",")
OWNER_HEADER = ("RecordType,PropertyQuickRefID,PartyQuickRefID,OwnerQuickRefID,OwnerPropertyNumber,OwnerName,OwnerAddress1,"
                "OwnerAddress2,OwnerAddress3,OwnerCity,OwnerState,OwnerPostalCode,OwnerCountry,AddressType,UndeliverableFlag,"
                "OwnershipPercentage,DBA,ImpHSValue,ImpNHSValue,LandHSValue,LandNHSValue,AgMktValue,AgUseValue,TimMktValue,"
                "TimUseValue,HSCapAdj,PersonalValue,MineralValue,AutoValue,NewImpHS,RenditionPenaltyPct,CurrentOwnerName,"
                "CurrentOwnerAddress1,CurrentOwnerAddress2,CurrentOwnerAddress3,CurrentOwnerCity,CurrentOwnerState,"
                "CurrentOwnerPostalCode,CurrentOwnerCountry,CurrentAddressType,CBLCapAdj,CurrentPartyQuickRefID,"
                "CurrentOwnerQuickRefID").split(",")


def prop(**f):
    r = {c: "" for c in PROPERTY_HEADER}
    r.update(RecordType="1", SitusState="TX", ChangeCode="M", TaxYear="2026", SupplementNumber="CERT")
    r.update(f)
    return r


def owner(**f):
    r = {c: "" for c in OWNER_HEADER}
    r.update(RecordType="2", OwnerState="TX", AddressType="S", OwnershipPercentage="100.000000", UndeliverableFlag="0")
    r.update(f)
    return r


PROPERTIES = [
    # A shopping centre (F1) with a letter-suffixed state code on the improvement.
    prop(PropertyQuickRefID="R100001", PropertyNumber="1000-00-000-0001-907", PropertyTypeCode="RC",
         SitusStreetAddress="100 Example BLVD", SitusCity="Sugar Land", SitusZip="77478", Acres="2.5", StateCodeLand="F1",
         StateCodeImp="F1H"),
    # Apartments (B1), owner with a three-line mailing address.
    prop(PropertyQuickRefID="R100002", PropertyNumber="1000-00-000-0002-907", PropertyTypeCode="RC",
         SitusStreetAddress="200 Sample DR", SitusCity="Stafford", SitusZip="77477", Acres="4", StateCodeLand="B1", StateCodeImp="B1"),
    # Industrial (F2) with two owners: the larger share is the owner of record, values add up.
    prop(PropertyQuickRefID="R100003", PropertyNumber="1000-00-000-0003-907", PropertyTypeCode="RC",
         SitusStreetAddress="300 Freight RD", SitusCity="Missouri City", SitusZip="77489", Acres="10", StateCodeLand="F2",
         StateCodeImp="F2"),
    # Vacant land coded F1 on the land segment only: the land code is the account's code.
    prop(PropertyQuickRefID="R100004", PropertyNumber="1000-00-000-0004-907", PropertyTypeCode="RL",
         SitusStreetAddress="", Acres=".811", StateCodeLand="F1", StateCodeImp=""),
    # A house (A1): out of scope.
    prop(PropertyQuickRefID="R100005", PropertyNumber="1000-00-000-0005-907", PropertyTypeCode="RR",
         SitusStreetAddress="500 Elm LN", SitusCity="Richmond", SitusZip="77406", StateCodeLand="A1", StateCodeImp="A1"),
    # Commercial personal property: not a parcel.
    prop(PropertyQuickRefID="P200001", PropertyNumber="", PropertyTypeCode="P", StateCodeImp="L1"),
    # An account deleted in a supplement.
    prop(PropertyQuickRefID="R100006", PropertyNumber="1000-00-000-0006-907", PropertyTypeCode="RC", StateCodeImp="F1",
         ChangeCode="D", SupplementNumber="SUPP 4"),
    # Commercial, owner row with the placeholder name; and one with no owner row at all.
    prop(PropertyQuickRefID="R100007", PropertyNumber="1000-00-000-0007-907", PropertyTypeCode="RC",
         SitusStreetAddress="700 Placeholder ST", SitusCity="Rosenberg", SitusZip="77471", StateCodeImp="F1"),
    prop(PropertyQuickRefID="R100008", PropertyNumber="1000-00-000-0008-907", PropertyTypeCode="RC",
         SitusStreetAddress="800 Ownerless ST", SitusCity="Rosenberg", SitusZip="77471", StateCodeImp="F1"),
    # A duplex (B2) owned by a natural person, with a confidential flag column as the unredacted layout has it.
    prop(PropertyQuickRefID="R100009", PropertyNumber="1000-00-000-0009-907", PropertyTypeCode="RC",
         SitusStreetAddress="900 Oak ST", SitusCity="Rosenberg", SitusZip="77471", StateCodeImp="B2"),
]
OWNERS = [
    owner(PropertyQuickRefID="R100001", OwnerName="Example Retail Holdings LLC", OwnerAddress1="1 Sample PLZ",
          OwnerAddress2="Suite 5", OwnerCity="Dallas", OwnerPostalCode="75201-0001", ImpNHSValue="3000000",
          LandNHSValue="1000000"),
    owner(PropertyQuickRefID="R100002", OwnerName="Example Apartments LP", OwnerAddress1="ATTN", OwnerAddress2="Tax Dept",
          OwnerAddress3="9 Park AVE", OwnerCity="New York", OwnerState="NY", OwnerPostalCode="10001", ImpNHSValue="8000000",
          LandNHSValue="2000000", AgMktValue="500000", AgUseValue="20000"),
    owner(PropertyQuickRefID="R100003", OwnerName="Small Minority Partner LLC", OwnershipPercentage="25.000000",
          ImpNHSValue="250000", LandNHSValue="250000"),
    owner(PropertyQuickRefID="R100003", OwnerName="Example Logistics Inc", OwnershipPercentage="75.000000",
          OwnerAddress1="2 Freight WAY", OwnerCity="Houston", OwnerPostalCode="77002", ImpNHSValue="750000",
          LandNHSValue="750000"),
    owner(PropertyQuickRefID="R100004", OwnerName="Example Land Company", OwnerAddress1="PO BOX 9", OwnerCity="Rosenberg",
          OwnerPostalCode="77471", LandNHSValue="90000"),
    owner(PropertyQuickRefID="R100005", OwnerName="Some Person", LandHSValue="1", ImpHSValue="1"),
    owner(PropertyQuickRefID="R100007", OwnerName="UNKNOWN", ImpNHSValue="100000", LandNHSValue="0"),
    owner(PropertyQuickRefID="R100009", OwnerName="Jane Example", OwnerAddress1="900 Oak ST", OwnerCity="Rosenberg",
          OwnerPostalCode="77471", ImpNHSValue="150000", LandNHSValue="50000"),
]


def write_csv(rows, header, quote_all=False):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=header, lineterminator="\r\n", quoting=csv.QUOTE_ALL if quote_all else csv.QUOTE_MINIMAL)
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def export_zip(tmp: Path, properties=PROPERTIES, owners=OWNERS) -> Path:
    p = tmp / "2026_07_07_1746-Orion-2026-Certified-Export-Redacted.zip"
    folder = "2026_07_07_1746 Orion 2026 Certified Export-Redacted/"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr(folder + "2026_07_07_1746_PropertyExport.txt", write_csv(properties, PROPERTY_HEADER))
        # The certified owner file is fully quoted and starts with a byte-order mark.
        z.writestr(folder + "2026_07_07_1746_OwnerExport.txt", "﻿" + write_csv(owners, OWNER_HEADER, quote_all=True))
        z.writestr(folder + "2026_07_07_1746_EntityExport.txt", "RecordType,OwnerQuickRefID\r\n4,R100001\r\n")
    return p


class FortBend(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = export_zip(self.tmp)

    def test_mapping(self):
        recs = {r.apn: r for r in tx_fortbend.read_roll(self.zip)}
        self.assertEqual(sorted(recs), ["R100001", "R100002", "R100003", "R100004", "R100007", "R100008", "R100009"],
                         "F1H, B1, F2, land F1, placeholder, ownerless and B2 kept; A1, personal property and the deletion dropped")
        centre = recs["R100001"]
        self.assertEqual(centre.county_fips, "157")
        self.assertEqual((centre.account, centre.state_category, centre.local_use_code, centre.tax_year),
                         ("R100001", "F1", "F1H", 2026))
        self.assertEqual(centre.situs_address, "100 Example BLVD, Sugar Land TX 77478")
        self.assertEqual(centre.owner_name, "Example Retail Holdings LLC")
        self.assertEqual(centre.owner_mailing_address, "1 Sample PLZ, Suite 5, Dallas, TX 75201-0001")
        self.assertEqual(centre.land_area_sf, 108900, "2.5 acres")
        self.assertEqual(centre.market_value, 4000000, "improvement plus land market components")
        self.assertIsNone(centre.appraised_value, "the export carries no capped value")
        self.assertEqual((centre.improvement_area_sf, centre.year_built), (None, None), "not in the export")
        self.assertEqual(centre.locator, "PropertyExport PropertyQuickRefID R100001")
        apartments = recs["R100002"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B1", "B1"))
        self.assertEqual(apartments.owner_mailing_address, "ATTN, Tax Dept, 9 Park AVE, New York, NY 10001")
        self.assertEqual(apartments.market_value, 10500000, "ag market value counts, ag use value does not")
        industrial = recs["R100003"]
        self.assertEqual((industrial.state_category, industrial.owner_name), ("F2", "Example Logistics Inc"),
                         "the larger holding is the owner of record")
        self.assertEqual(industrial.market_value, 2000000, "the owners' values add up")
        land = recs["R100004"]
        self.assertEqual((land.state_category, land.local_use_code), ("F1", "F1"), "no improvement: the land code")
        self.assertIsNone(land.situs_address)
        self.assertEqual(land.land_area_sf, round(0.811 * 43560, 2))
        self.assertIsNone(recs["R100007"].owner_name, "'UNKNOWN' is a placeholder, not an owner")
        self.assertIsNone(recs["R100007"].owner_mailing_address)
        ownerless = recs["R100008"]
        self.assertEqual((ownerless.owner_name, ownerless.market_value), (None, None))
        self.assertEqual(recs["R100009"].owner_name, "Jane Example", "persons are dropped later, by the registry")
        # The redacted export carries no confidentiality column, so no record is marked confidential from it.
        self.assertFalse(any(r.owner_confidential for r in recs.values()))

    def test_confidential_flag_when_present(self):
        header = OWNER_HEADER + ["ConfidentialFlag"]
        owners = [dict(o, ConfidentialFlag="0") for o in OWNERS]
        owners[0] = dict(owners[0], ConfidentialFlag="1")
        p = self.tmp / "unredacted"
        p.mkdir()
        (p / "x_PropertyExport.txt").write_text(write_csv(PROPERTIES, PROPERTY_HEADER), "utf-8")
        (p / "x_OwnerExport.txt").write_text(write_csv(owners, header), "utf-8")
        recs = {r.apn: r for r in tx_fortbend.read_roll(p)}
        hidden = recs["R100001"]
        self.assertTrue(hidden.owner_confidential)
        self.assertIsNone(hidden.owner_name)
        self.assertIsNone(hidden.owner_mailing_address)
        self.assertFalse(recs["R100002"].owner_confidential)

    def test_state_category(self):
        self.assertEqual(tx_fortbend.state_category("F1H"), "F1")
        self.assertEqual(tx_fortbend.state_category("F1X"), "F1")
        self.assertEqual(tx_fortbend.state_category("F2"), "F2")
        self.assertEqual(tx_fortbend.state_category("B2"), "B2")
        self.assertEqual(tx_fortbend.state_category("J7C"), "J7C")
        self.assertIsNone(tx_fortbend.state_category(""))

    def test_all_categories_and_directory(self):
        self.assertEqual(len(list(tx_fortbend.read_roll(self.zip, categories=None))), 8,
                         "every real property but the deleted one")
        self.assertEqual([r.apn for r in tx_fortbend.read_roll(self.zip, categories=["A1"])], ["R100005"])
        d = self.tmp / "unpacked"
        d.mkdir()
        with zipfile.ZipFile(self.zip) as z:
            z.extractall(d)
        self.assertEqual([r.apn for r in tx_fortbend.read_roll(d)], [r.apn for r in tx_fortbend.read_roll(self.zip)],
                         "an unpacked directory reads the same")

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = tx_fortbend.build(self.zip, db, as_of="2026-07-07")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (7, 7, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder and the ownerless are not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'tx-fortbend-cad'").fetchone()
            self.assertEqual(src["county_fips"], "157")
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'fbcad_quickref' AND external_id = 'R100001'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-48157:r100001", "parcel ids are lower-cased")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"F1"')
            local = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'",
                (urn,)).fetchone()[0]
            self.assertEqual(local, '"F1H"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 4, "retail, apartments, logistics and the land company")
        finally:
            reg.close()

    def test_supplement_does_not_retire(self):
        """A supplement lists only the changed accounts: loaded as a partial it retires nothing."""
        db = self.tmp / "registry.db"
        tx_fortbend.build(self.zip, db, as_of="2026-07-07")
        sup_dir = self.tmp / "sup"
        sup_dir.mkdir()
        sup = export_zip(sup_dir, properties=[dict(PROPERTIES[0], SupplementNumber="SUPP 1")], owners=OWNERS[:1])
        stats = tx_fortbend.build(sup, db, as_of="2026-07-23", full_roll=False)
        self.assertEqual((stats.seen, stats.retired), (1, 0))
        full = tx_fortbend.build(sup, db, as_of="2026-08-01", full_roll=True)
        self.assertEqual(full.retired, 6, "a full-roll load retires the six accounts it does not list")


if __name__ == "__main__":
    unittest.main()

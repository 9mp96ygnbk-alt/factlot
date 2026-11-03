"""North Carolina Secretary of State adapter tests on a SYNTHETIC fixture.

The fixture copies the table and column names of the publisher's layout document
(``Business_Registration_layout.pdf``); every id, name, and address here is invented. The real
export is sold by subscription and has not been seen, so the delimiter and file names are
assumptions recorded in the adapter docstring.
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import nc_sos_entities, tx_harris

# A one-parcel synthetic Harris roll (same layout as test_adapters) whose owner of record is a
# company in the fixture below, so owner linking across the two sources can be checked.
HARRIS_REAL_ACCT = (
    "acct\tyr\tmailto\tmail_addr_1\tmail_addr_2\tmail_city\tmail_state\tmail_zip\tmail_country\tsite_addr_1\t"
    "site_addr_2\tsite_addr_3\tstate_class\tyr_impr\tbld_ar\tland_ar\tacreage\ttot_appr_val\ttot_mkt_val\r\n"
    "0010010000001\t2026\tEXAMPLE TOWER LLC\t100 MAIN ST STE 1\t \tHOUSTON\tTX\t77002\t \t100 MAIN ST\tHOUSTON\t77002\t"
    "F1\t1985\t250000\t40000\t0.9183\t50000000\t52000000\r\n"
)
HARRIS_OWNERS = "acct\tln_num\tname\taka\tpct_own\r\n0010010000001\t1\tEXAMPLE TOWER LLC\t \t1.0000\r\n"


def harris_zip(tmp: Path) -> Path:
    p = tmp / "Real_acct_owner.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("real_acct.txt", HARRIS_REAL_ACCT)
        zf.writestr("owners.txt", HARRIS_OWNERS)
    return p

TABLES = {
    "CorpStatus.txt": [
        "Status\tStatusDesc\tOldStatus",
        "1\tCurrent-Active\tCA",
        "2\tAdmin. Dissolved\tAD",
        "3\tWithdrawn\tWD",
        "9\tMulti. Status\t",
    ],
    "NameTypes.txt": [
        "NTypeID\tNTypeName",
        "1\tLegal NC",
        "2\tHomestate",
        "3\tPrevious Legal NC",
    ],
    "Names.txt": [
        "ENameID\tEntityID\tEName\tNTypeID\tPrefix\tLastName\tMiddleName\tFirstName\tSuffix\tOldStatus",
        "1\t100\tEXAMPLE TOWER LLC\t1\t\t\t\t\t\t",
        "2\t100\tOLD EXAMPLE TOWER LLC\t3\t\t\t\t\t\t",
        "3\t200\tOUT OF STATE HOLDINGS INC\t1\t\t\t\t\t\t",
        "4\t200\tOUT OF STATE HOLDINGS, INC.\t2\t\t\t\t\t\t",
        "5\t300\tDISSOLVED EXAMPLE CORP\t1\t\t\t\t\t\t",
        "6\t400\tJ EXAMPLE\t1\t\tEXAMPLE\t\tJ\t\t",
        "7\t500\tNO PROFILE NAME LLC\t2\t\t\t\t\t\t",
        "8\t600\tQUOTED, \"NAME\" LP\t1\t\t\t\t\t\t",
    ],
    "Addresses.txt": [
        "AddressID\tEntityID\tATypeId\tAddr1\tAddr2\tAddr3\tCity\tState\tZip\tCountyName\tCountry",
        "10\t100\t1\t100 MAIN ST\tSTE 1\t\tCHARLOTTE\tNC\t28202\tMecklenburg\t",
        "11\t100\t2\tPO BOX 9\t\t\tCHARLOTTE\tNC\t28201\tMecklenburg\tUSA",
        "20\t200\t1\t1 PARK AVE\t\t\tNEW YORK\tNY\t10001\t\tUnited States",
        "21\t200\t2\t2 RUE EXEMPLE\t\t\tPARIS\t\t75001\t\tFrance",
        "30\t300\t2\t5 OLD RD\t\t\tRALEIGH\tNC\t27601\tWake\t",
    ],
    "Corporations.txt": [
        "PItemId\tEntityID\tOfficeAddressID\tOfficeMailingID\tAgentEntityID\tCorpType\tCorpNum\tStatus\tCitzenship\tDateFormed\t"
        "DisolveDate\tDuration\tCountyOfInc\tCountyFileNum\tStateOfInc\tCountryOfInc\tPurpose\tProfession\tManaged\tMembers\t"
        "Directors\tMemberManaged\tFiscalMonth\tAnnualRptDueDate\tOldStatus",
        "7000001\t100\t10\t11\t400\tLLC\t1234567\t1\tD\t2010-01-01 00:00:00\t\tPerpetual\t\t\tNC\t\t\t\t\t\t\t\t\t\t",
        "7000002\t200\t20\t21\t400\tFC\t2345678\t1\tF\t2015-06-01 00:00:00\t\tPerpetual\t\t\tDE\t\t\t\t\t\t\t\t\t\t",
        "7000003\t300\t\t30\t\tCORP\t3456789\t2\tD\t1999-03-03 00:00:00\t\t\t\t\tNC\t\t\t\t\t\t\t\t\t\t",
        "7000004\t500\t\t\t\tLLC\t4567890\t9\tD\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t",
        "\t600\t\t\t\tLP\t5678901\t3\tD\t\t\t\t\t\tnc\t\t\t\t\t\t\t\t\t\t",
    ],
}


def export_dir(tmp: Path) -> Path:
    d = tmp / "export"
    d.mkdir()
    for name, lines in TABLES.items():
        (d / name).write_text("\r\n".join([*lines, ""]), encoding="utf-8")
    return d


def export_zip(tmp: Path) -> Path:
    p = tmp / "nc_sos_core.zip"
    with zipfile.ZipFile(p, "w") as zf:
        for name, lines in TABLES.items():
            zf.writestr(f"Core/{name}", "\r\n".join([*lines, ""]))
    return p


class NcSosEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.dir = export_dir(self.tmp)

    def test_mapping(self):
        recs = list(nc_sos_entities.read_entities(self.dir))
        self.assertEqual(len(recs), 5, "one record per Corporations row; names without a profile are not entities")
        tower, foreign, dissolved, nameless, no_id = recs
        self.assertEqual((tower.legal_name, tower.registry_number, tower.registry_jurisdiction), ("EXAMPLE TOWER LLC", "7000001", "us-nc"))
        self.assertEqual(tower.mailing_address, "100 MAIN ST, STE 1, CHARLOTTE, NC 28202", "the principal office address is used")
        self.assertEqual((tower.state_of_formation, tower.status), ("NC", "active"))
        self.assertEqual(tower.locator, "Corporations PItemId 7000001")
        self.assertIsNone(tower.taxpayer_number)
        self.assertEqual(foreign.legal_name, "OUT OF STATE HOLDINGS INC", "NTypeID 1 (Legal NC) wins over the homestate name")
        self.assertEqual((foreign.state_of_formation, foreign.status), ("DE", "active"))
        self.assertEqual(foreign.mailing_address, "1 PARK AVE, NEW YORK, NY 10001", "United States is not appended")
        self.assertEqual(dissolved.mailing_address, "5 OLD RD, RALEIGH, NC 27601", "no principal office: the mailing address is used")
        self.assertEqual(dissolved.status, "administratively_dissolved")
        self.assertEqual(nameless.legal_name, "", "an entity with no Legal NC name yields an empty name (the registry skips it)")
        self.assertEqual(nameless.status, "multi_status", "an unknown status description is kept as a token")
        self.assertIsNone(nameless.mailing_address)
        self.assertIsNone(nameless.state_of_formation)
        self.assertIsNone(no_id.registry_number, "a blank PItemId is not a registry number")
        self.assertEqual(no_id.legal_name, 'QUOTED, "NAME" LP')
        self.assertEqual(no_id.state_of_formation, "NC", "state codes are upper-cased")
        self.assertIsNone(no_id.locator)

    def test_zip_reads_the_same_and_comma_delimited_too(self):
        a = [(r.registry_number, r.legal_name) for r in nc_sos_entities.read_entities(self.dir)]
        b = [(r.registry_number, r.legal_name) for r in nc_sos_entities.read_entities(export_zip(self.tmp))]
        self.assertEqual(a, b)
        comma = self.tmp / "comma"
        comma.mkdir()
        for name, lines in TABLES.items():
            rows = [",".join(f'"{v}"' if ("," in v or '"' in v) else v for v in line.split("\t")) for line in lines]
            rows = [r.replace('""', '"').replace('"QUOTED, "NAME" LP"', '"QUOTED, ""NAME"" LP"') for r in rows]
            (comma / name.replace(".txt", ".csv")).write_text("\n".join([*rows, ""]), encoding="utf-8")
        c = [(r.registry_number, r.legal_name) for r in nc_sos_entities.read_entities(comma)]
        self.assertEqual(a, c)

    def test_missing_table_yields_nothing(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        self.assertEqual(list(nc_sos_entities.read_entities(empty)), [])

    def test_status_normalisation(self):
        self.assertEqual(nc_sos_entities.normalize_status("Current-Active"), "active")
        self.assertEqual(nc_sos_entities.normalize_status("Admin. Dissolved"), "administratively_dissolved")
        self.assertEqual(nc_sos_entities.normalize_status("Reserved Name"), "reserved_name")
        self.assertIsNone(nc_sos_entities.normalize_status(""))

    def test_build_links_owners_to_entities(self):
        db = self.tmp / "registry.db"
        tx_harris.build(harris_zip(self.tmp), db, as_of="2026-11-01")
        stats, links = nc_sos_entities.build(export_zip(self.tmp), db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (5, 3, 2),
                         "the nameless entity and the one without a PItemId are skipped")
        # The synthetic parcel is in Texas and the entity is registered in North Carolina: an exact
        # name in another state is queued for a reviewer, not linked (registry README, stage 1).
        self.assertEqual((links.get("linked"), links.get("cross_state"), links.get("queued_for_review")), (0, 1, 1), links)
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'nc-sos-entities'").fetchone()
            self.assertEqual(src["state_fips"], "37")
            name = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:entity:us-nc:7000001' AND predicate = 'entity.legal_name'").fetchone()
            self.assertIn("EXAMPLE TOWER LLC", name[0])
            owned = reg.db.execute(
                "SELECT to_urn FROM relationships WHERE type = 'owns' AND from_urn = 'fl:entity:us-nc:7000001'").fetchall()
            self.assertEqual(owned, [])
            queued = reg.db.execute(
                "SELECT parcel_urn, status FROM owner_match_review WHERE entity_urn = 'fl:entity:us-nc:7000001'").fetchall()
            self.assertEqual([tuple(q) for q in queued], [("fl:parcel:us-48201:0010010000001", "pending")])
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()

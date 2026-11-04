"""Virginia SCC adapter tests on a SYNTHETIC fixture.

The headers copy the upstream CSV layout as documented by the openva/crump field maps (the real
file could not be downloaded, see docs/registry/sources/va-scc-entities.md); every entity id, name,
and address is invented.
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import va_fairfax, va_scc_entities
from factlot.registry.store import ParcelRecord, Source

CORE = ("EntityID,Name,Status,StatusReason,Status Date,Duration,IncorpDate,IncorpState,IndustryCode,Street1,Street2,"
        "City,State,Zip,PrinOffEffDate,RA-Name,RA-Street1,RA-Street2,RA-City,RA-State,RA-Zip,RA-EffDate,RA-Status,"
        "RA-Loc,StockInd,TotalShares,MergerInd,AssessInd")
CORP_ROWS = [
    CORE + ",Stock1",
    # upstream values keep fixed-width padding
    '"11000001  ","EXAMPLE TOWER CORP                      ","Active    ","          ","01/15/2010","PERPETUAL ",'
    '"01/15/2010","Virginia            ","00 - General        ","8000 EXAMPLE BLVD        ","SUITE 100      ",'
    '"TYSONS          ","Virginia  ","22102     ","01/15/2010","J AGENT             ","1 AGENT WAY       ","",'
    '"RICHMOND","Virginia","23219","01/15/2010","Active","Henrico County","S","1000.0","N","N","COMMON"',
    '"11000002  ","OUT OF STATE HOLDINGS INC","Inactive","Auto Terminated","03/01/2020","PERPETUAL","06/01/2015",'
    '"Delaware","00 - General","1 PARK AVE","","NEW YORK","New York","10001","06/01/2015","REGISTERED AGENTS INC",'
    '"2 AGENT ST","","RICHMOND","Virginia","23219","06/01/2015","Active","Richmond City","S","100","N","N","COMMON"',
    '"","NAMELESS ROW CORP","Active","","","","","Virginia","","","","","","","","","","","","","","","","","S","","N","N",""',
]
LLC_ROWS = [
    CORE + ",Is Series LLC,Is Protected Series,Series LLC ID",
    '"S9000001","SAMPLE GARDENS LLC","Active","","02/02/2002","PERPETUAL","02/02/2002","VA","53 - Real Estate",'
    '"100 SAMPLE ST","","ANNANDALE","Virginia","22003","02/02/2002","A AGENT","3 AGENT RD","","FAIRFAX","Virginia",'
    '"22030","02/02/2002","Active","Fairfax County","N","","N","N","No","No",""',
]
OFFICER_ROWS = ["EntityID,Name,Title,Street1,City,State,Zip", '"11000001","A PERSON","PRESIDENT","9 HOME LN","VIENNA","Virginia","22180"']


def scc_zip(tmp: Path) -> Path:
    p = tmp / "current.zip"
    with zipfile.ZipFile(p, "w") as zf:
        zf.writestr("Corp.csv", "\r\n".join([*CORP_ROWS, ""]))
        zf.writestr("LLC.csv", "\r\n".join([*LLC_ROWS, ""]))
        zf.writestr("Officer.csv", "\r\n".join([*OFFICER_ROWS, ""]))
    return p


class SCC(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.zip = scc_zip(self.tmp)

    def test_mapping(self):
        recs = list(va_scc_entities.read_entities(self.zip))
        self.assertEqual(len(recs), 4, "three corporations and one LLC; Officer.csv is never read")
        tower, foreign, nameless, llc = recs
        self.assertEqual((tower.legal_name, tower.registry_number, tower.registry_jurisdiction),
                         ("EXAMPLE TOWER CORP", "11000001", "us-va"), "padding stripped")
        self.assertEqual((tower.state_of_formation, tower.status, tower.taxpayer_number), ("VA", "active", None))
        self.assertEqual(tower.mailing_address, "8000 EXAMPLE BLVD, SUITE 100, TYSONS, VA 22102",
                         "the spelled-out state becomes its USPS code")
        self.assertEqual(tower.locator, "Corp.csv EntityID 11000001")
        self.assertEqual((foreign.state_of_formation, foreign.status), ("DE", "inactive"))
        self.assertEqual(foreign.mailing_address, "1 PARK AVE, NEW YORK, NY 10001")
        self.assertIsNone(nameless.registry_number, "a blank EntityID is yielded blank so the registry counts it as skipped")
        self.assertEqual(nameless.locator, "Corp.csv")
        self.assertEqual((llc.registry_number, llc.state_of_formation, llc.locator), ("S9000001", "VA", "LLC.csv EntityID S9000001"))

    def test_state_code(self):
        self.assertEqual(va_scc_entities.state_code("Virginia"), "VA")
        self.assertEqual(va_scc_entities.state_code(" district of columbia "), "DC")
        self.assertEqual(va_scc_entities.state_code("md"), "MD")
        self.assertIsNone(va_scc_entities.state_code("Ontario"), "a non-US jurisdiction is unknown, not guessed")
        self.assertIsNone(va_scc_entities.state_code(""))

    def test_unpacked_directory_reads_the_same(self):
        with zipfile.ZipFile(self.zip) as zf:
            zf.extractall(self.tmp / "unpacked")
        a = [r.registry_number for r in va_scc_entities.read_entities(self.zip)]
        b = [r.registry_number for r in va_scc_entities.read_entities(self.tmp / "unpacked")]
        self.assertEqual(a, b)

    def test_build_links_owners_to_entities(self):
        db = self.tmp / "registry.db"
        # A parcel with an organisation owner of record (Fairfax itself publishes none, so one is
        # written directly, under a synthetic source, to exercise the link).
        reg = Registry(db)
        try:
            src = Source(source_id="test-roll", publisher="synthetic", title="synthetic roll", url="file:///synthetic",
                         state_fips="51", county_fips="059", license="synthetic")
            reg.add_source(src)
            snap = reg.add_snapshot(src.source_id, self.zip, "2026-11-02")
            reg.ingest_parcels([ParcelRecord(county_fips="059", apn="0011 01 0001", state_category="F1", account="0011 01 0001",
                                             owner_name="Example Tower Corporation", situs_address="8000 EXAMPLE BLVD, TYSONS VA 22102")],
                               snap, state_fips="51", account_system=va_fairfax.ACCOUNT_SYSTEM)
        finally:
            reg.close()
        stats, links = va_scc_entities.build(self.zip, db, as_of="2026-11-02")
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (4, 3, 1))
        self.assertEqual(links.get("linked"), 1, links)
        reg = Registry.open_readonly(db)
        try:
            owned = reg.db.execute("SELECT from_urn, to_urn FROM relationships WHERE type = 'owns'").fetchall()
            self.assertEqual([tuple(r) for r in owned], [("fl:entity:us-va:11000001", "fl:parcel:us-51059:0011-01-0001")])
            src = reg.db.execute("SELECT state_fips FROM sources WHERE source_id = 'va-scc-entities'").fetchone()
            self.assertEqual(src[0], "51")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()

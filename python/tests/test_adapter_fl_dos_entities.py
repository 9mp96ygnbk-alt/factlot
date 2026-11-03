"""Synthetic fixture for the Florida Division of Corporations adapter: 1440-character fixed-length
records built from the publisher's layout, with invented entities. No row describes a real entity."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry.adapters import fl_dos_entities
from factlot.registry.store import Registry


def record(**fields: str) -> str:
    """Build one 1440-character record from named fields at the publisher's positions."""
    buf = [" "] * fl_dos_entities.RECORD_LENGTH
    layout = dict(fl_dos_entities.FIELDS, ra_name=(545, 42), ra_type=(587, 1), officer_1_title=(669, 4),
                  officer_1_type=(673, 1), officer_1_name=(674, 42))
    for key, value in fields.items():
        start, length = layout[key]
        assert len(value) <= length, key
        buf[start - 1:start - 1 + len(value)] = value
    return "".join(buf)


ROWS = [
    # active Florida LLC with a mailing address and a person officer
    record(document_number="L21000000001", name="EXAMPLE TOWER LLC", status="A", filing_type="FLAL",
           address_1="100 MAIN ST", address_2="STE 1", city="MIAMI", state="FL", zip="33131", country="US",
           mail_address_1="PO BOX 100", mail_city="MIAMI", mail_state="FL", mail_zip="33101", mail_country="US",
           file_date="20210104", fei_number="123456789", last_transaction_date="20260501", state_country="FL",
           ra_name="EXAMPLE AGENTS INC", ra_type="C", officer_1_title="MGR", officer_1_type="P", officer_1_name="J EXAMPLE"),
    # foreign (Delaware) profit corporation, no mailing address: principal address is used
    record(document_number="F19000000002", name="OUT OF STATE HOLDINGS INC", status="A", filing_type="FORP",
           address_1="1 PARK AVE", city="NEW YORK", state="NY", zip="10016", country="US",
           file_date="20190601", last_transaction_date="20250101", state_country="DE"),
    # inactive foreign entity formed abroad, principal address outside the US
    record(document_number="M20000000003", name="EXAMPLE OVERSEAS LTD", status="I", filing_type="FORL",
           address_1="5 KING ST", city="LONDON", zip="EC1A 1AA", country="UK",
           file_date="20200101", last_transaction_date="20240101", state_country="UK"),
    # no addresses, blank status
    record(document_number="N00000000004", name="EXAMPLE SOCIAL CLUB INC", filing_type="DOMNP", file_date="19580428"),
    # blank document number: not a registered entity record
    record(name="NO NUMBER CORP", status="A", filing_type="DOMP"),
]


class FlDosEntities(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.txt = self.tmp / "20261101c.txt"
        self.txt.write_text("\r\n".join([*ROWS, ""]), encoding="latin-1")

    def test_mapping(self):
        recs = list(fl_dos_entities.read_entities(self.txt))
        self.assertEqual(len(recs), 5)
        llc, foreign, overseas, club, blank = recs
        self.assertEqual((llc.legal_name, llc.registry_number, llc.registry_jurisdiction), ("EXAMPLE TOWER LLC", "L21000000001", "us-fl"))
        self.assertEqual((llc.state_of_formation, llc.status, llc.taxpayer_number), ("FL", "active", None))
        self.assertEqual(llc.mailing_address, "PO BOX 100, MIAMI, FL 33101", "the mailing address wins over the principal address")
        self.assertEqual(llc.locator, "20261101c.txt document L21000000001")
        self.assertEqual((foreign.state_of_formation, foreign.mailing_address), ("DE", "1 PARK AVE, NEW YORK, NY 10016"))
        self.assertEqual((overseas.status, overseas.state_of_formation), ("inactive", None))
        self.assertEqual(overseas.mailing_address, "5 KING ST, LONDON, EC1A 1AA, UK", "a non-US country is kept in the address")
        self.assertEqual((club.status, club.mailing_address, club.state_of_formation), (None, None, "FL"))
        self.assertIsNone(blank.registry_number)
        self.assertIsNone(blank.locator)

    def test_zip_and_directory_read_the_same(self):
        z = self.tmp / "cordata.zip"
        with zipfile.ZipFile(z, "w") as zf:
            zf.writestr("cordata1.txt", "\n".join(ROWS[:2]) + "\n")
            zf.writestr("cordata2.txt", "\n".join(ROWS[2:]) + "\n")
            zf.writestr("readme.pdf", b"not data")
        from_zip = list(fl_dos_entities.read_entities(z))
        self.assertEqual([r.registry_number for r in from_zip], [r.registry_number for r in fl_dos_entities.read_entities(self.txt)])
        self.assertEqual(from_zip[0].locator, "cordata1.txt document L21000000001")
        self.assertEqual(from_zip[2].locator, "cordata2.txt document M20000000003")
        folder = self.tmp / "unpacked"
        folder.mkdir()
        (folder / "cordata1.txt").write_text("\n".join(ROWS[:2]) + "\n", encoding="latin-1")
        (folder / "cordata2.txt").write_text("\n".join(ROWS[2:]) + "\n", encoding="latin-1")
        self.assertEqual([r.legal_name for r in fl_dos_entities.read_entities(folder)], [r.legal_name for r in from_zip])

    def test_short_record_is_padded(self):
        short = self.tmp / "short.txt"
        short.write_text(ROWS[1][:332] + "\n", encoding="latin-1")  # cut after the city, before the state
        (rec,) = fl_dos_entities.read_entities(short)
        self.assertEqual((rec.registry_number, rec.status, rec.mailing_address), ("F19000000002", "active", "1 PARK AVE, NEW YORK"))
        self.assertIsNone(rec.state_of_formation)

    def test_state_of_formation(self):
        self.assertEqual(fl_dos_entities.state_of_formation("DOMP", "DE"), "FL", "a Florida filing type is Florida-formed whatever the field says")
        self.assertEqual(fl_dos_entities.state_of_formation("FORLP", "tx"), "TX")
        self.assertIsNone(fl_dos_entities.state_of_formation("FORP", "ON"))
        self.assertIsNone(fl_dos_entities.state_of_formation("TRUST", ""))

    def test_build(self):
        db = self.tmp / "registry.db"
        stats, links = fl_dos_entities.build(self.txt, db, as_of="2026-11-01", link=False)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid), (5, 4, 1))
        self.assertEqual(links, {})
        reg = Registry.open_readonly(db)
        try:
            self.assertEqual(reg.db.execute("SELECT source_id FROM sources").fetchall()[0][0], "fl-dos-entities")
            status = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = 'fl:entity:us-fl:m20000000003' AND predicate = 'entity.status'").fetchone()
            self.assertIn("inactive", status[0])
            self.assertEqual(reg.db.execute("SELECT count(*) FROM crosswalk").fetchone()[0], 0, "FEI numbers are not loaded")
            for secret in ("J EXAMPLE", "EXAMPLE AGENTS", "123456789"):
                n = reg.db.execute("SELECT count(*) FROM current_facts WHERE value_json LIKE ?", (f"%{secret}%",)).fetchone()[0]
                self.assertEqual(n, 0, f"{secret!r}: officers, agents and FEI numbers are never stored")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()

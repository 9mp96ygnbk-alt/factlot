"""NYC Department of Finance ACRIS adapter tests on a SYNTHETIC fixture that copies the real layout.

Every document ID, CRFN, BBL, amount and party name here is invented to exercise the mapping; none is real
New York City data. The layouts are the NYC Open Data CSV (Socrata export) of ACRIS Real Property Master
(bnx9-e6tj), Legals (8h5j-fqxa) and Parties (636b-3b5g) with the adapter's ``$select``.
"""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from factlot.registry import ParcelRecord, Registry
from factlot.registry.adapters import ny_acris, ny_nyc


def csv_text(columns, rows):
    out = io.StringIO()
    w = csv.writer(out, quoting=csv.QUOTE_ALL)
    w.writerow(columns)
    for r in rows:
        w.writerow([r.get(c, "") for c in columns])
    return out.getvalue()


def master(doc_id, doc_type, recorded, amount, **kw):
    return dict(document_id=doc_id, crfn="2099" + doc_id[-9:], doc_type=doc_type, document_date=kw.get("document_date", recorded) + "T00:00:00.000",
                document_amt=f"{amount:.2f}", recorded_datetime=recorded + "T00:00:00.000", percent_trans=kw.get("percent", "100.000000"),
                good_through_date="2099-09-30T00:00:00.000")


def legal(doc_id, boro, block, lot, easement="N", partial="E", air="N", sub="N"):
    return dict(document_id=doc_id, borough=boro, block=block, lot=lot, easement=easement, partial_lot=partial,
                air_rights=air, subterranean_rights=sub)


def party(doc_id, kind, name):
    return dict(document_id=doc_id, party_type=kind, name=name)


# A sale of an office building (lot 1 of block 9, Manhattan) from an LLC to an LLC and a person; a mortgage on it from the
# buyer LLC to a bank, with a satisfaction by the bank; a deed of two lots; an easement row; a document of a type that is
# not handled; a deed to a family trust and a person only; a deed for a lot the registry does not hold.
MASTER = [
    master("2099010100001001", "DEED", "2099-01-07", 12500000, document_date="2098-12-04"),
    master("2099010100001002", "MTGE", "2099-01-07", 8000000, percent="0.000000"),
    master("2099060100002001", "SAT", "2099-06-30", 0, percent="0.000000"),
    master("2099030100003001", "DEED", "2099-03-01", 0, percent="50.000000"),
    master("2099030100004001", "DEEDO", "2099-03-02", 100),
    master("2099030100005001", "AGMT", "2099-03-03", 5),  # not a handled type
    master("2099030100006001", "DEED", "2099-03-04", 450000),  # people only
    master("2099030100007001", "DEED", "2099-03-05", 700000),  # a lot the registry does not hold
    master("2099030100008001", "PSAT", "2099-04-01", 0),
    dict(master("2099030100009001", "MTGE", "2099-04-02", 1), recorded_datetime=""),  # never recorded: no date
]
LEGALS = [
    legal("2099010100001001", "1", "9", "1"), legal("2099010100001002", "1", "9", "1"), legal("2099060100002001", "1", "9", "1"),
    legal("2099030100003001", "3", "123", "45", partial="P"), legal("2099030100003001", "3", "123", "46", air="Y"),
    legal("2099030100003001", "3", "123", "45"),  # the same lot listed twice: stored once
    legal("2099030100004001", "4", "567", "89", easement="Y"),  # an easement over the lot: not the lot itself
    legal("2099030100004001", "4", "567", "89"),
    legal("2099030100005001", "1", "9", "1"), legal("2099030100006001", "4", "567", "89"),
    legal("2099030100007001", "2", "1", "1"), legal("2099030100008001", "1", "9", "1"),
    legal("2099030100009001", "1", "9", "1"),
    legal("9999999999999999", "1", "9", "1"),  # a document the master does not list
]
PARTIES = [
    party("2099010100001001", "1", "EXAMPLE SELLER HOLDINGS LLC"), party("2099010100001001", "1", "SYNTHETIC, SELLER Q"),
    party("2099010100001001", "2", "EXAMPLE BUYER OFFICE LLC"), party("2099010100001001", "2", "FAKENAME, PERSON A"),
    party("2099010100001001", "2", "EXAMPLE BUYER OFFICE LLC"),  # listed twice
    party("2099010100001002", "1", "EXAMPLE BUYER OFFICE LLC"), party("2099010100001002", "2", "EXAMPLE TEST BANK, N.A."),
    party("2099060100002001", "1", "EXAMPLE BUYER OFFICE LLC"), party("2099060100002001", "2", "EXAMPLE TEST BANK, N.A."),
    party("2099030100003001", "1", "INVENTED GRANTOR CORP"), party("2099030100003001", "2", "INVENTED GRANTEE REALTY LLC"),
    party("2099030100003001", "3", "THIRD PARTY LLC"),  # party type 3 is not read
    party("2099030100004001", "1", "INVENTED GRANTOR CORP"), party("2099030100006001", "1", "JANE EXAMPLE"),
    party("2099030100006001", "2", "EXAMPLE FAMILY TRUST"), party("2099030100008001", "2", "EXAMPLE TEST BANK, N.A."),
]


class TestParsing(unittest.TestCase):
    def test_bbl(self):
        self.assertEqual(ny_acris.bbl_of({"borough": "1", "block": "835", "lot": "41"}), ("061", "1008350041"))
        self.assertEqual(ny_acris.bbl_of({"borough": "5", "block": "12345", "lot": "7501"}), ("085", "5123457501"))
        self.assertIsNone(ny_acris.bbl_of({"borough": "9", "block": "1", "lot": "1"}))
        self.assertIsNone(ny_acris.bbl_of({"borough": "1", "block": "", "lot": "1"}))
        self.assertIsNone(ny_acris.bbl_of({"borough": "1", "block": "100000", "lot": "1"}))

    def test_document_types_map_to_the_three_predicates(self):
        self.assertEqual({p for p, _d in ny_acris.DOC_TYPES.values()}, {ny_acris.DEED, ny_acris.MORTGAGE, ny_acris.SATISFACTION})
        self.assertEqual(ny_acris.DOC_TYPES["M&CON"][0], ny_acris.MORTGAGE)
        self.assertEqual(ny_acris.DOC_TYPES["WSAT"][0], ny_acris.SATISFACTION)

    def test_columns_never_include_addresses(self):
        self.assertEqual(set(ny_acris.PARTIES_COLUMNS), {"document_id", "party_type", "name"})


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.master = self.dir / "acris-master-2099.csv"
        self.legals = self.dir / "acris-legals-2099.csv"
        self.parties = self.dir / "acris-parties-2099.csv"
        self.master.write_text(csv_text(ny_acris.MASTER_COLUMNS, MASTER))
        self.legals.write_text(csv_text(ny_acris.LEGALS_COLUMNS, LEGALS))
        self.parties.write_text(csv_text(ny_acris.PARTIES_COLUMNS, PARTIES))

    def read(self):
        counts = ny_acris.Counts()
        out = {p.apn: p for p in ny_acris.read_acris(self.master, self.legals, self.parties, counts=counts)}
        return out, counts


class TestReader(Fixture):
    def test_a_sale_has_organisations_only(self):
        out, _ = self.read()
        deeds = [(p, v) for p, v, _u in out["1000090001"].facts if p == "transaction.deed"]
        self.assertEqual(len(deeds), 1)
        v = deeds[0][1]
        self.assertEqual(v["date"], "2099-01-07")
        self.assertEqual(v["document_date"], "2098-12-04")
        self.assertEqual((v["doc_type"], v["doc_type_description"]), ("DEED", "DEED"))
        self.assertEqual(v["amount_usd"], 12500000)
        self.assertEqual(v["grantors"], ["EXAMPLE SELLER HOLDINGS LLC"])
        self.assertEqual(v["grantees"], ["EXAMPLE BUYER OFFICE LLC"])  # once, though listed twice
        self.assertTrue(v["organizations_only"])
        self.assertEqual((v["document_id"], v["crfn"]), ("2099010100001001", "2099" + "2099010100001001"[-9:]))
        self.assertNotIn("percent_transferred", v)  # 100% is the default
        self.assertNotIn("lots_in_document", v)

    def test_no_natural_person_appears_anywhere(self):
        out, counts = self.read()
        blob = json.dumps([(p.apn, p.facts, p.locator) for p in out.values()])
        for person in ("SYNTHETIC", "SELLER Q", "FAKENAME", "PERSON A", "JANE EXAMPLE", "FAMILY TRUST"):
            self.assertNotIn(person, blob)
        # 4 people-or-uncertain names in the first deed (2 of them persons), the person and the trust in the last deed.
        self.assertEqual(counts.parties_dropped_not_organization, 4)
        self.assertEqual(json.dumps(asdict_counts(counts)).count("JANE"), 0)

    def test_a_mortgage_and_its_satisfaction(self):
        out, _ = self.read()
        by = {}
        for p, v, _u in out["1000090001"].facts:
            by.setdefault(p, []).append(v)
        m = by["debt.mortgage_recorded"][0]
        self.assertEqual((m["amount_usd"], m["borrowers"], m["lenders"]), (8000000, ["EXAMPLE BUYER OFFICE LLC"], ["EXAMPLE TEST BANK, N.A."]))
        self.assertNotIn("percent_transferred", m)
        s = {v["doc_type"]: v for v in by["debt.mortgage_satisfaction_recorded"]}
        self.assertEqual(s["SAT"]["lenders"], ["EXAMPLE TEST BANK, N.A."])
        self.assertNotIn("amount_usd", s["SAT"])  # a satisfaction's zero amount is noise
        self.assertEqual(s["PSAT"]["doc_type_description"], "PARTIAL SATISFACTION")

    def test_a_multi_lot_document_carries_the_lot_count_and_flags(self):
        out, _ = self.read()
        v45 = [v for p, v, _u in out["3001230045"].facts if p == "transaction.deed"]
        v46 = [v for p, v, _u in out["3001230046"].facts if p == "transaction.deed"]
        self.assertEqual((len(v45), len(v46)), (1, 1))
        self.assertEqual(v45[0]["lots_in_document"], 2)  # the lot listed twice counts once
        self.assertTrue(v45[0]["partial_lot"])
        self.assertNotIn("air_rights", v45[0])
        self.assertTrue(v46[0]["air_rights"])
        self.assertEqual(v45[0]["percent_transferred"], 50)
        self.assertEqual(v45[0]["amount_usd"], 0)  # a deed's amount is kept as published, including zero
        self.assertEqual(v45[0]["grantees"], ["INVENTED GRANTEE REALTY LLC"])  # party type 3 not read

    def test_easement_rows_unhandled_types_and_unrecorded_documents_are_skipped(self):
        out, counts = self.read()
        self.assertEqual(counts.lot_rows_easement_skipped, 1)
        # Lot 4005670089: the DEEDO row without the easement flag is kept; the easement row is not a second fact.
        deeds = [v for p, v, _u in out["4005670089"].facts if p == "transaction.deed"]
        self.assertEqual(sorted(v["doc_type"] for v in deeds), ["DEED", "DEEDO"])
        all_types = {v["doc_type"] for p in out.values() for _p, v, _u in p.facts}
        self.assertNotIn("AGMT", all_types)
        self.assertNotIn("2099030100009001", json.dumps([p.facts for p in out.values()]))  # no recorded date
        self.assertNotIn("9999999999999999", json.dumps([p.facts for p in out.values()]))

    def test_a_deed_to_people_says_organizations_only_and_lists_no_grantee(self):
        out, counts = self.read()
        v = next(v for p, v, _u in out["4005670089"].facts if p == "transaction.deed" and v["doc_type"] == "DEED")
        self.assertTrue(v["organizations_only"])
        self.assertNotIn("grantors", v)
        self.assertNotIn("grantees", v)
        self.assertGreaterEqual(counts.documents_without_organization_party, 1)

    def test_facts_follow_the_recorded_date_and_the_locator_names_a_document(self):
        out, _ = self.read()
        dates = [v["date"] for _p, v, _u in out["1000090001"].facts]
        self.assertEqual(dates, sorted(dates))
        self.assertIn("acris-legals-2099.csv BBL 1000090001 document 2099010100001001", out["1000090001"].locator)
        self.assertIn("more)", out["1000090001"].locator)

    def test_organisation_names_longer_than_the_cap_are_truncated_and_flagged(self):
        many = [party("2099010100001001", "2", f"INVENTED TENANT {i} LLC") for i in range(ny_acris.MAX_PARTIES_PER_ROLE + 3)]
        self.parties.write_text(csv_text(ny_acris.PARTIES_COLUMNS, many))
        out, _ = self.read()
        v = next(v for p, v, _u in out["1000090001"].facts if v["document_id"] == "2099010100001001")
        self.assertEqual(len(v["grantees"]), ny_acris.MAX_PARTIES_PER_ROLE)
        self.assertTrue(v["grantees_truncated"])


def asdict_counts(c):
    from dataclasses import asdict
    return {**asdict(c), "facts": dict(c.facts)}


class TestIngest(Fixture):
    def setUp(self):
        super().setUp()
        self.db = self.dir / "r.db"
        reg = Registry(self.db)
        reg.add_source(ny_nyc.SOURCE)
        roll = self.dir / "roll.txt"
        roll.write_text("synthetic roll")
        snap = reg.add_snapshot("ny-nyc-dof", roll, as_of="2026-05-15")
        reg.ingest_parcels([
            ParcelRecord("061", "1000090001", "F1", account="1000090001", situs_address="1 EXAMPLE STREET, NEW YORK NY 10004"),
            ParcelRecord("047", "3001230045", "B", account="3001230045"),
            ParcelRecord("047", "3001230046", "B", account="3001230046"),
            ParcelRecord("081", "4005670089", "F2", account="4005670089"),
        ], snap, state_fips="36", account_system="nyc_bbl", full_roll=True)
        reg.close()

    def facts(self, bbl):
        reg = Registry(self.db)
        try:
            return reg.get(reg.resolve_external("nyc_bbl", bbl))["facts"]
        finally:
            reg.close()

    def test_facts_are_cited_ranked_and_carry_rights(self):
        stats = ny_acris.build([(self.master, self.legals, self.parties)], self.db, as_of="2099-09-30", retrieved_at="2099-11-04T00:00:00+00:00")
        self.assertEqual(stats.skipped_out_of_scope, 1)  # the lot in borough 2 is not a registry parcel
        self.assertEqual(stats.skipped_invalid, 0)
        facts = [f for f in self.facts("1000090001") if f["predicate"] in ("transaction.deed", "debt.mortgage_recorded", "debt.mortgage_satisfaction_recorded")]
        self.assertEqual(len(facts), 4)  # deed, mortgage, SAT, PSAT
        # Newest first among the facts of one predicate.
        sat = [f for f in facts if f["predicate"] == "debt.mortgage_satisfaction_recorded"]
        self.assertEqual([f["value"]["date"] for f in sat], ["2099-06-30", "2099-04-01"])
        f = facts[0]
        self.assertEqual(f["provenance"]["method"], "public_record")
        self.assertTrue(f["provenance"]["sources"][0]["document_id"].startswith("fl:document:sha256-"))
        self.assertIn("ACRIS acris-legals-2099.csv BBL 1000090001", f["provenance"]["sources"][0]["section"])
        self.assertEqual(f["rights"]["redistribution"], "permitted")
        self.assertIn("ACRIS", f["rights"]["attribution"])
        self.assertEqual(f["as_of"], "2099-09-30")

    def test_all_three_files_of_a_set_are_snapshots_of_the_source(self):
        ny_acris.build([(self.master, self.legals, self.parties)], self.db, as_of="2099-09-30")
        reg = Registry(self.db)
        try:
            names = sorted(r[0] for r in reg.db.execute("SELECT filename FROM snapshots WHERE source_id = ?", (ny_acris.SOURCE_ID,)))
        finally:
            reg.close()
        self.assertEqual(names, ["acris-legals-2099.csv", "acris-master-2099.csv", "acris-parties-2099.csv"])

    def test_a_person_is_nowhere_in_the_registry_file(self):
        ny_acris.build([(self.master, self.legals, self.parties)], self.db, as_of="2099-09-30")
        raw = self.db.read_bytes()
        for person in (b"FAKENAME", b"SELLER Q", b"JANE EXAMPLE", b"EXAMPLE FAMILY TRUST"):
            self.assertNotIn(person, raw)
        reg = Registry(self.db)
        try:
            self.assertEqual(reg.stats()["entities"], 0)  # party names are not entities and are not indexed
            self.assertEqual(reg.db.execute("SELECT COUNT(*) FROM name_index").fetchone()[0], 0)
        finally:
            reg.close()

    def test_reingest_changes_nothing(self):
        ny_acris.build([(self.master, self.legals, self.parties)], self.db, as_of="2099-09-30")
        stats = ny_acris.build([(self.master, self.legals, self.parties)], self.db, as_of="2099-09-30")
        self.assertEqual(stats.facts_written, 0)

    def test_two_years_both_stay_current(self):
        # A second year's set cites another snapshot with the same as_of: the first year's facts stay current.
        m2 = self.dir / "acris-master-2098.csv"
        l2 = self.dir / "acris-legals-2098.csv"
        p2 = self.dir / "acris-parties-2098.csv"
        m2.write_text(csv_text(ny_acris.MASTER_COLUMNS, [master("2098010100001001", "DEED", "2098-01-07", 5)]))
        l2.write_text(csv_text(ny_acris.LEGALS_COLUMNS, [legal("2098010100001001", "1", "9", "1")]))
        p2.write_text(csv_text(ny_acris.PARTIES_COLUMNS, [party("2098010100001001", "2", "OTHER INVENTED OWNER LLC")]))
        ny_acris.build([(self.master, self.legals, self.parties), (m2, l2, p2)], self.db, as_of="2099-09-30")
        deeds = [f["value"]["date"] for f in self.facts("1000090001") if f["predicate"] == "transaction.deed"]
        self.assertEqual(deeds, ["2099-01-07", "2098-01-07"])


if __name__ == "__main__":
    unittest.main()

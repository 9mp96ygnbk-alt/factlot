"""The person rule's fiduciary roles, persons named after a company, and person-named mailing lines.

Every name here is invented. A party or owner that is a natural person, however it is wrapped (a co-successor trustee,
a temporary co-guardian, a co-executor, a person after a company's legal form, a "CO TRUST"), is never stored; a bank,
a trust company, a board of trustees and a company acting as trustee are. A mailing address whose leading line names a
person, or cannot be read, is not stored; a street that bears a person's name is a street.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import factlot
from factlot.registry import ParcelRecord, Registry, privacy_scan
from factlot.registry.normalize import (
    is_organization,
    mailing_address_withheld,
    mailing_lead_class,
    organization_part,
)
from factlot.registry.store import Source

PERSONS = [
    # "CO" before a qualified role is the role's, not "Company"
    "EXAMPLE QUIN CO-SUCCESSOR TRUSTEE",
    "PAT EXAMPLE, AS CO-SUCCESSOR TRUSTEE",
    "EXAMPLE, AS SUCCESSOR CO-TRUS, PAT LEE",
    "EXAMPLE, AS TEMPORARY CO-GUARDIAN, PAT",
    "EXAMPLE, TEMPOARY CO-GUARDIAN, PAT",
    "PAT EXAMPLE, CO-GUARDIAN",
    "EXAMPLE, CO INDEPENDENT EXECUTOR, PAT",
    "PAT EXAMPLE, AS CO-PRELIMINARY EXECUTOR",
    "EXAMPLE (CO-ADMIN), PAT Q ESQ.",
    "PAT EXAMPLE, CO-EXEC",
    "EXAMPLE, PAT CO TRUST",
    "PAT EXAMPLE CO TR",
    "PAT EXAMPLE AS SUCCESSOR CO-GENERAL PARTNER",
    "EXAMPLE QUIN, SUCCESSOR CO TRU, PAT",
    "PAT EXAMPLE, AS SUCCESSOR CO-TRUSTEER",
    # fiduciary roles written as roles
    "EXAMPLE PROPERTY GUARDIAN, QUIN",
    "QUIN ROE, AS GUARDIAN OF THE PROPERTY OF",
    "ADMINISTRATOR OF EXAMPLE COUNTY, PAT Q. ROE PUBLIC",
    "PAT EXAMPLE PERSONAL REPRESENTATIVE",
    "PAT EXAMPLE, AS CONSERVATOR",
    "EXECUTOR OF THE ESTATE OF PAT ROE",
    # probate forms
    "QUIN ROE EXAMPLE SOLE HEIR DIST PAT REIT",
    "EXAMPLE PAT ESTATE OF AND QUIN JR / 12 MILL ROAD LLC",
    "ACME PROPERTIES LP EXAMPLE, MARY H HEIRS",
    # a person named after the company's legal form
    "ACME LLC PARTNERS,LLC ROE QUIN STEVEN ET AL",
    "ACME INC ETAL ROE, CHRISTOPHER A",
    "ACME HOLDINGS LTD & QUIN ROE",
    "ACME LLC & PAT EXAMPLE",
    "ACME LLC C/O PAT Q EXAMPLE",
    "EXAMPLE TRUST COMPANY CUSTODIAN FBO PAT Q EXAMPLE IRA",
    "EXAMPLE RONALD TRUST ETALS/ EXAMPLE BANK NA TRUSTEE",
    # a legal form written first is a surname
    "CO, PAT Q",
    # a person after a contact, account or role marker, read on the raw name, given name listed or not (review B1)
    "ACME LLC C/O QUORVIN ZELLBY",
    "ACME, L.L.C. ATTN: QUORVIN ZELLBY",
    "ACME CORP%QUORVIN ZELLBY",
    "ACME INC. BY QUORVIN ZELLBY",
    "ACME LLC BY QUORVIN ZELLBY, SOLE MEMBER",
    "ACME LLC (QUORVIN P. ZELLBY, SOLE MANAGER)",
    "ACME LLC, QUORVIN ZELLBY AS MEMBER",
    "ACME LLC, BY QUORVIN ZELLBY, REFEREE",
    "ACME INC DBA BETA INC-ATTN: QUORVIN ZELLBY",
    # a person first, then a company (B2)
    "ZELLBY, QUORVIN P C/O ACME REALTY",
    "ZELLBY PAT/ACME LLC",
    "EXAMPLE BANK / PAT ZELLBY",
    "ZELLBY PAT P (L/U) & ACME REALTY",
    "ZELLBY PAT & EST MARY (INC)",
    # a person after a legal form or an organisation word (B3, B4)
    "ACME LP & ZELLBY QUORVIN & PAT EXAMPLE",
    "ACME LLC & ZEBEDIAH",
    "ACME LLC ZELLBY QUORVIN DARVEN",
    "ACME CO., QUORVIN ZELLBY",
    "12 EXAMPLE REALTY, QUORVIN ZELLBY",
    "EXAMPLE ASSOCIATES DARREN ZELLBY",
    "EXAMPLE FAMILY PARTNERSHIP/DARREN ZELLBY",
    # surname collisions (B5)
    "CHURCH PAT QUORVIN",
    "CITY PAT & MARY ZELLBY",
    # accounts and will trusts (B6)
    "ZELLBY QUORVIN P IRA SERV TR CO",
    "ACME INC AND QUORVIN ZELLBY IRA#1234",
    "EXAMPLE TRUST U/W/O QUORVIN ZELLBY",
    "EXAMPLE REALTY TRUST U/W OF QUORVIN ZELLBY",
    "EXAMPLE FIRM LLP 401K FBO II ZELLBY",
    "EXAMPLE TRUST COMPANY CUSTODIAN FBO PAT Q EXAMPLE IRA",
    "ZELLBY PAT DARREN INVESTMENTS TRUSTEE",
    # truncations and cut remnants (B7)
    "ACME LLC A/K/A QUORVIN DARVEN ZELLBY, CO-T",
    "PAT Q. EXAMPLE OF ACME,LLC RECEIVER",
    "EXAMPLE FOUNDATION AND REB QUORVIN DARVEN",
    "ASSOCIATES, PAT Q",
    "ZELLBY, CO-EXEC/CORP.",
]

ORGANIZATIONS = [
    "ACME CO",
    "SMITH & CO",
    "JONES CO",
    "EXAMPLE TRUST CO SUCCESSOR TRUSTEE",
    "EXAMPLE TRUST COMPANY, CO-EXECUTOR",
    "EXAMPLE TRUST COMPANY INTERNATIONAL,CO -EXECUTOR",
    "EXAMPLE TRUST COMPANY ADMIN",
    "UBS TRUST COMPANY, N.A., CO-TRUSTEE",
    "WELLS FARGO BANK NA AS TRUSTEE",
    "WELLS FARGO BANK, NA AS ANCILLARY EXECUTORS",
    "U S BANK NATIONAL ASSOCIATION AS TRUSTEE FOR EXAMPLE MORTGAGE TRUST 2006-1",
    "BANK OF AMERICA, EXECUTOR",
    "BOARD OF TRUSTEES OF EXAMPLE COLLEGE",
    "TRUSTEES OF COLUMBIA UNIVERSITY",
    "EXAMPLE TRUST COMPANY AS TRUSTEE",
    "EXAMPLE TRUSTEE LLC",
    "EXAMPLE MORTGAGE, LLC, AS ADMINISTRATOR",
    "PLAN ADMINISTRATOR OF EXAMPLE REALTY LLC",
    "PUBLIC ADMINISTRATOR OF EXAMPLE COUNTY",
    "THE PUBLIC ADMINISTRATOR OF THE COUNTY OF NEW YORK",
    "THE GUARDIAN LIFE INSURANCE COMPANY OF AMERICA",
    "GUARDIANS OF THE SICK INC",
    "GUARDIAN HOMES INC",
    "101 GUARDIAN LLC",
    "AUSTIN GUARDIAN STEEL SECURITY INC",
    "ALL EXAMPLE ADMINISTRATORS INC",
    "EXR PR EXAMPLE HILL LLC",
    "THE ESTATE OF EXAMPLE GROUP LLC",
    "ACME REAL ESTATE OF EXAMPLEVILLE LLC",
    "ACME INC OF SAN ANTONIO",
    "ACME LLC & BETA HOLDINGS LLC",
    "ACME WEST APARTMENTS LLC & ACME WEST",
    "ACME LLC - 300 EXAMPLE DR",
    "ACME REALTY LLC RS 303 MANUEL",
    "ACME HOLDINGS LTD & EXAMPLE HOUSING DEVELOPMENT",
    "SAINT PAUL'S EXAMPLE CHURCH TRUSTEES",
    "ACME LLC & CO",
    "SMITH & SONS LLC",
    "SMITH, EXAMPLE & QUIN, L.L.C.",
    "EXAMPLE PARK ASSOCIATES, L.C.",
    "U.S. EXAMPLE/QUIN FEE, LLC",
    "ACME LLC C/O BETA MANAGEMENT LLC",
    "EXAMPLE PROPERTIES LLC SERIES A",
    "EXAMPLE (USA) INC",
    "EXAMPLE BANK LTD., EXAMPLEVILLE BRANCH",
]


class FiduciaryRoles(unittest.TestCase):
    def test_persons_are_not_organisations(self):
        for name in PERSONS:
            self.assertFalse(is_organization(name), name)

    def test_organisations_stay(self):
        for name in ORGANIZATIONS:
            self.assertTrue(is_organization(name), name)

    def test_a_party_named_after_a_company_keeps_the_company_only(self):
        self.assertEqual(organization_part("ACME LLC C/O PAT Q EXAMPLE"), ("ACME LLC", "company with a personal trust"))
        self.assertEqual(organization_part("ACME REALTY CORP., PAT EXAMPLE (PRESIDENT)")[0], "ACME REALTY CORP.")
        self.assertEqual(organization_part("EXAMPLE QUIN CO-SUCCESSOR TRUSTEE"), (None, "trustee"))
        self.assertEqual(organization_part("QUIN ROE EXAMPLE SOLE HEIR"), (None, "estate"))


MAILING_WITHHELD = {
    "PAT EXAMPLE TRUSTEE, EXAMPLEVILLE, TX 77389-1546": "person",
    "PAT Q EXAMPLE, EXAMPLEVILLE, TX 77630": "person",
    "PAT R EXAMPLE JR, EXAMPLEVILLE, MA 02128": "person",
    "ATT: PAT EXAMPLE, EXAMPLEVILLE, NH": "person",
    "ATTN PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, TX": "person",
    "C/O PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, TX": "person",
    "CARE OF PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, TX": "person",
    "CO PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, TX": "person",
    "%PAT EXAMPLE, 7117 OAK PKWY, EXAMPLEVILLE, TEXAS 752315641": "person",
    "PAT Q. EXAMPLE 33 MILL DR, EXAMPLEVILLE, CT, 06360": "person",
    "ACME LLC ATTN PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, TX": "person",
    "PAT LANE, EXAMPLEVILLE, TX": "person",
    "PAT EXAMPLE RTE 5, EXAMPLEVILLE, CT": "person",
    # markers read before punctuation is cleaned away (review M1, M2)
    "PAT Q EXAMPLE C/O EXAMPLE LAW FIRM LLP, 1 MAIN ST, EXAMPLEVILLE, CT": "person",
    "ACME INC. %PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, CT": "person",
    "ACME LLC ATTEN: MR. PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, NY": "person",
    "ACME LLC/PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, NY": "person",
    "ACME LLC - PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, NY": "person",
    "% EXAMPLE REALTY ADVISORS PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, NY": "person",
    "C/O PAT EXAMPLE - CITY MANAGER, 1 MAIN ST, EXAMPLEVILLE, NY": "person",
    "ACME LLC; P Q EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, NY": "person",
    "EXAMPLE 4 #19-1, EXAMPLEVILLE": "unclear",
}
MAILING_KEPT = [
    "C/O ACME MANAGEMENT LLC, 100 MAIN ST, EXAMPLEVILLE, TX 75201",
    "ACME LLC, 100 MAIN ST, EXAMPLEVILLE, TX",
    "100 MAIN ST, EXAMPLEVILLE, TX",
    "JOHN F KENNEDY BLVD, JERSEY CITY, NJ 07306",
    "MARTIN LUTHER KING JR DR, EXAMPLEVILLE, GA",
    "SAN JACINTO ST, HOUSTON, TX",
    "HAMPTON STREET, EXAMPLEVILLE, NY 11963",
    "ONE EXAMPLE PLAZA 910 MAIN, EXAMPLEVILLE, TX 77002",
    "5473 EXAMPLE RD STE 100 PMB 952700, EXAMPLEVILLE, TX 75231",
    "TAX DEPT, PO BOX 1, EXAMPLEVILLE, OH",
    "ESQ., 919 THIRD AVENUE, NEW YORK, NY 10022",
    "C/O DUFF AND PHELPS LLC, EXAMPLEVILLE, TX",
    "EXAMPLEVILLE, GA 30096",
    "ROUTE 7, EXAMPLEVILLE, CT",
    "EXAMPLE PLAZA, HWY 6 STE 100, EXAMPLEVILLE, TX",
    "1 MAIN ST, ATTN PAT EXAMPLE, EXAMPLEVILLE, TX",  # after the street: the contact is scrubbed, the address kept
]


class MailingLeads(unittest.TestCase):
    def test_person_lines_are_withheld(self):
        for address, why in MAILING_WITHHELD.items():
            self.assertEqual(mailing_address_withheld(address, "ACME HOLDINGS LLC"), why, address)

    def test_street_organisation_and_routing_lines_are_kept(self):
        for address in MAILING_KEPT:
            self.assertIsNone(mailing_address_withheld(address, "ACME HOLDINGS LLC"), address)

    def test_scrub_reads_atten_and_a_glued_attn(self):
        from factlot.registry.normalize import scrub_mailing_address
        self.assertEqual(scrub_mailing_address("100 EXAMPLE STREETATTN: PAT EXAMPLE, EXAMPLEVILLE, TX"),
                         ("100 EXAMPLE STREET, EXAMPLEVILLE, TX", 1))
        self.assertEqual(scrub_mailing_address("1 MAIN ST, ATTEN PAT EXAMPLE, EXAMPLEVILLE, TX"),
                         ("1 MAIN ST, EXAMPLEVILLE, TX", 1))

    def test_an_unreadable_line_that_is_the_owners_name_is_kept(self):
        self.assertEqual(mailing_lead_class("ACME, 1 MAIN ST, EXAMPLEVILLE, TX")[0], "unclear")
        self.assertIsNone(mailing_address_withheld("ACME, 1 MAIN ST, EXAMPLEVILLE, TX", "ACME HOLDINGS LLC"))
        self.assertEqual(mailing_address_withheld("ACME, 1 MAIN ST, EXAMPLEVILLE, TX", None), "unclear")


SRC = Source("test-county-roll", "Example County Appraisal District (synthetic)", "Appraisal roll",
             "https://example.invalid/roll", "public record", "none")


class MailingPurge(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "registry.db"
        self.reg = Registry(self.path)
        self.reg.add_source(SRC)
        (self.tmp / "roll.txt").write_text("synthetic")
        self.snap = self.reg.add_snapshot("test-county-roll", self.tmp / "roll.txt", as_of="2025-07-25")

    def tearDown(self):
        self.reg.close()

    def _mailing(self, parcel):
        return [f["value"] for f in self.reg.facts(parcel, history=True)
                if f["predicate"] == "ownership.owner_mailing_address"]

    def test_ingest_refuses_and_purge_deletes_a_person_named_mailing_line(self):
        roll = [ParcelRecord("999", "0001-000-0001", "F1", account="A1", situs_address="1 Oak Street",
                             owner_name="ACME HOLDINGS LLC", owner_mailing_address="PAT Q EXAMPLE, EXAMPLEVILLE, TX 77630"),
                ParcelRecord("999", "0001-000-0002", "F1", account="A2", situs_address="2 Oak Street",
                             owner_name="ACME HOLDINGS LLC", owner_mailing_address="JOHN F KENNEDY BLVD, EXAMPLEVILLE, NJ")]
        self.reg.ingest_parcels(roll, self.snap, state_fips="48")
        first = factlot.parcel_id("48", "999", "0001-000-0001").urn
        second = factlot.parcel_id("48", "999", "0001-000-0002").urn
        self.assertEqual(self._mailing(first), [], "refused at ingest")
        self.assertEqual(self._mailing(second), ["JOHN F KENNEDY BLVD, EXAMPLEVILLE, NJ"])
        # A file written before the rule holds it; the scan reports it and the purge deletes it, once.
        self.reg.db.execute(
            "INSERT INTO facts SELECT fact_id || 'm', subject, 'ownership.owner_mailing_address', ?, unit, as_of, method, "
            "confidence, document_id, locator FROM facts WHERE subject = ? AND predicate = 'ownership.owner_of_record'",
            (json.dumps("C/O PAT EXAMPLE, 1 MAIN ST, EXAMPLEVILLE, TX"), first))
        self.reg.db.commit()
        self.assertEqual(privacy_scan.scan(self.path)["person_mailing_leads"], 1)
        self.assertEqual(privacy_scan.main([str(self.path)]), 1)
        self.assertEqual(self.reg.purge_person_owners()["person_mailing_leads"], 1)
        self.assertEqual(self._mailing(first), [])
        self.assertNotIn("PAT", json.dumps(self.reg.get(first)))
        self.assertEqual(self._mailing(second), ["JOHN F KENNEDY BLVD, EXAMPLEVILLE, NJ"], "a street keeps its address")
        self.assertEqual(self.reg.purge_person_owners()["person_mailing_leads"], 0, "idempotent")
        self.assertEqual(privacy_scan.scan(self.path)["person_mailing_leads"], 0)


if __name__ == "__main__":
    unittest.main()

"""Value–quote consistency check and OCR hook, on SYNTHETIC inputs.

Every quote and every value below is invented for the test. Expected outcomes are decided by
hand from the rule in docs/ingest.md (which written forms count), not by running the checker.
The OCR tests use a fake backend callable and a fake ``tesseract`` script; the test against a
real tesseract binary is skipped when it is not installed.
"""

import contextlib
import io
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import factlot
from factlot.ingest import (PREDICATES, Candidate, TesseractOcr, check_consistency, check_value, ingest_lease,
                            load_document, ocr_backend, unreadable_pages_message, verify)
from factlot.ingest.__main__ import main as cli_main
try:
    from test_ingest import FIX, LEASE_URN, ScriptedExtractor  # `unittest discover -s tests`
except ImportError:  # `python -m unittest tests.test_ingest_checks`
    from tests.test_ingest import FIX, LEASE_URN, ScriptedExtractor

# (predicate, value, quote, must pass) — synthetic value/quote pairs for each written form.
CONSISTENCY_CASES = [
    # numbers: 24.5 in its common written forms
    ("lease.security_deposit", 24.5, "Base Rent of $24.50 per square foot", True),
    ("lease.security_deposit", 24.5, "Base Rent of 24.5 dollars", True),
    ("lease.security_deposit", 24.5, "at $24.50/SF per annum", True),
    ("lease.security_deposit", 24.5, "Base Rent of $24.00 per square foot", False),
    ("lease.security_deposit", 24.5, "Base Rent of $124.50 per square foot", False),  # 24.50 inside another number
    ("lease.security_deposit", 1250000, "a deposit of $1,250,000.00", True),
    ("lease.security_deposit", 1250000, "a deposit of 1250000 dollars", True),
    ("lease.security_deposit", 1250000, "a deposit of $1,250,000.50", False),
    ("lease.rentable_area_sf", 12500, "containing 12,500 rentable square feet", True),
    ("lease.rentable_area_sf", 12500, "containing 12,600 rentable square feet", False),
    ("lease.free_rent", {"months": 3, "applies_to": "base_rent"}, "abated for the first three (3) months", True),
    ("lease.free_rent", {"months": 3, "applies_to": "base_rent"}, "abated for the first three months", True),  # word
    ("lease.free_rent", {"months": 3, "applies_to": "base_rent"}, "abated for the first two (2) months", False),
    ("lease.free_rent", {"months": 3, "applies_to": "gross_rent"}, "abated for three (3) months", True),  # enum unchecked
    ("lease.renewal_option", {"count": 2, "term_months": 60, "notice_months": 12, "rent": "95% of FMV"},
     "two (2) options of five (5) years each on twelve (12) months' notice at 95% of FMV", False),  # 60 absent
    ("lease.renewal_option", {"count": 2, "term_months": 60, "notice_months": 12, "rent": "whatever"},
     "two (2) options of sixty (60) months each on twelve (12) months' notice", True),  # rent is free text
    ("lease.renewal_option", {"count": 1, "term_months": 95, "notice_months": 9, "rent": "x"},
     "one option of ninety-five months on nine months notice", True),  # compound number word
    # percentages and ratios
    ("lease.pro_rata_share", 0.0325, "Tenant's Share is 3.25%", True),
    ("lease.pro_rata_share", 0.0325, "Tenant's Share is 3.25 percent", True),
    ("lease.pro_rata_share", 0.0325, "Tenant's Share is 0.0325", True),
    ("lease.pro_rata_share", 0.0325, "Tenant's Share is 3.25", False),  # no percent marker
    ("lease.pro_rata_share", 0.0325, "Tenant's Share is 3.5%", False),
    ("lease.pro_rata_share", 1, "Tenant's Share is 100%", True),
    ("lease.cam_cap", {"method": "year_over_year", "rate": 0.05}, "not increase by more than five percent (5%)", True),
    ("lease.cam_cap", {"method": "year_over_year", "rate": 0.05}, "not increase by more than five percent", True),
    ("lease.cam_cap", {"method": "year_over_year", "rate": 0.05}, "not increase by more than six percent (6%)", False),
    ("lease.cam_cap", {"method": "simple_from_base", "rate": 0.05}, "capped at 5% over the base year", True),
    # dates: 2027-03-01 in its common written forms
    ("lease.commencement_date", "2027-03-01", "shall commence on 2027-03-01", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on March 1, 2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on March 1 2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on Mar. 1, 2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on 3/1/2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on 03/01/2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on 1/3/2027", True),  # day-first reading allowed
    ("lease.commencement_date", "2027-03-01", "shall commence on 1 March 2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on the 1st day of March, 2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on the first day of March, 2027", True),
    ("lease.commencement_date", "2027-03-01", "shall commence on March 2, 2027", False),
    ("lease.commencement_date", "2027-03-01", "shall commence on March 1, 2028", False),
    ("lease.commencement_date", "2027-03-01", "shall commence on April 1, 2027", False),
    ("lease.commencement_date", "2027-03-01", "shall commence on the Commencement Date", False),
    ("lease.expiration_date", "2031-02-28", "expire on the twenty-eighth day of February, 2031", True),
    ("lease.expiration_date", "2031-02-28", "expire on the twenty-seventh day of February, 2031", False),
    ("lease.termination_option", {"effective_date": "2029-06-30", "notice_months": 9, "fee": "two months rent"},
     "terminate effective June 30, 2029 on nine (9) months notice, paying two months rent", True),
    ("lease.termination_option", {"effective_date": "2029-06-30", "notice_months": 9, "fee": "x"},
     "terminate effective June 30, 2030 on nine (9) months notice", False),
    ("lease.base_rent_schedule", [{"from": "2026-03-01", "to": "2027-02-28", "annual_rent_psf": 38.0},
                                  {"from": "2027-03-01", "to": "2028-02-29", "annual_rent_psf": 39.14}],
     "March 1, 2026 through February 28, 2027: $38.00; March 1, 2027 through February 29, 2028: $39.14", True),
    ("lease.base_rent_schedule", [{"from": "2026-03-01", "to": "2027-02-28", "annual_rent_psf": 38.0},
                                  {"from": "2027-03-01", "to": "2028-02-29", "annual_rent_psf": 39.14}],
     "March 1, 2026 through February 28, 2027: $38.00", False),  # second step unsupported
    ("lease.base_rent_schedule", [{"from": "2026-03-01", "to": "2027-02-28", "annual_rent_psf": 38.0}],
     "March 1, 2026 through February 28, 2027: $38.50", False),
    # strings: party names, case-insensitive
    ("lease.tenant", "Sample Analytics Inc.", 'and Sample Analytics Inc. ("Tenant")', True),
    ("lease.tenant", "Sample Analytics Inc.", 'and SAMPLE ANALYTICS INC. ("Tenant")', True),
    ("lease.tenant", "Sample Analytics Inc.", 'and Sample\nAnalytics Inc. ("Tenant")', True),  # line break
    ("lease.tenant", "Sample Analytics LLC", 'and Sample Analytics Inc. ("Tenant")', False),
    ("lease.landlord", "Example Tower Owner LLC", 'between Example Tower Owner LLC ("Landlord")', True),
    # summaries and enums are not checkable, so they never fail
    ("lease.rofr", "Tenant has a ROFR on Suite 500", "a right of first refusal on any space on the 5th floor", True),
    ("lease.assignment_sublease", "consent required", "shall not be unreasonably withheld", True),
    ("lease.exclusive_use", "medical", "no other tenant may operate a clinic", True),
    ("not.a.predicate", 42, "nothing here", True),
    # --- predicates added for C10 (all synthetic) ---
    # percentage rent: the rate is a ratio, the fixed breakpoint a number, the exclusions free text
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}},
     "six percent (6%) of Gross Sales in excess of the natural breakpoint", True),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}}, "6% of Gross Sales above", True),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}}, "0.06 of Gross Sales above", True),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}},
     "five percent (5%) of Gross Sales in excess of the natural breakpoint", False),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}}, "6 of Gross Sales above", False),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "fixed", "amount": 2000000}},
     "6% of Gross Sales exceeding $2,000,000 per Lease Year", True),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "fixed", "amount": 2000000}},
     "6% of Gross Sales exceeding Two Million Dollars ($2,000,000.00) per Lease Year", True),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "fixed", "amount": 2500000}},
     "6% of Gross Sales exceeding $2,000,000 per Lease Year", False),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "fixed", "amount": 2000000},
                               "sales_exclusions": "sales taxes and returns"},
     "6% of Gross Sales exceeding $2,000,000, excluding sales taxes, refunds and credits", True),  # free text
    # co-tenancy: only the cure period is checkable
    ("lease.co_tenancy", {"trigger": "fewer than 70% of the GLA is open", "remedy": "pay 50% of Base Rent",
                          "cure_period_months": 6},
     "if less than seventy percent (70%) of the gross leasable area is open for six (6) months", True),
    ("lease.co_tenancy", {"trigger": "x", "remedy": "y", "cure_period_months": 6},
     "a cure period of ninety (90) days", False),
    ("lease.co_tenancy", {"trigger": "x", "remedy": "y"}, "any remedy at all", True),  # nothing checkable
    # critical dates, in every accepted written form
    ("lease.renewal_notice_deadline", "2030-08-31", "exercised on or before August 31, 2030", True),
    ("lease.renewal_notice_deadline", "2030-08-31", "exercised on or before 8/31/2030", True),
    ("lease.renewal_notice_deadline", "2030-08-31", "exercised on or before 31 August 2030", True),
    ("lease.renewal_notice_deadline", "2030-08-31", "exercised no later than the thirty-first day of August, 2030", True),
    ("lease.renewal_notice_deadline", "2030-08-31", "exercised on or before August 30, 2030", False),
    ("lease.renewal_notice_deadline", "2030-08-31", "exercised on or before August 31, 2031", False),
    ("lease.renewal_notice_deadline", "2030-08-31", "twelve months before the Expiration Date", False),
    ("lease.termination_notice_deadline", "2029-09-30", "written notice given by September 30, 2029", True),
    ("lease.termination_notice_deadline", "2029-09-30", "written notice given by Sept. 30, 2029", True),
    ("lease.termination_notice_deadline", "2029-09-30", "written notice given by 2029-09-30", True),
    ("lease.termination_notice_deadline", "2029-09-30", "written notice given by October 30, 2029", False),
    ("lease.rent_commencement_date", "2026-06-01", "Rent shall commence on June 1, 2026", True),
    ("lease.rent_commencement_date", "2026-06-01", "Rent shall commence on the 1st day of June, 2026", True),
    ("lease.rent_commencement_date", "2026-06-01", "Rent shall commence on 1.6.2026", True),  # day-first reading
    ("lease.rent_commencement_date", "2026-06-01", "Rent shall commence on the Rent Commencement Date", False),
    ("lease.expansion_option_deadline", "2028-02-29", "exercised by February 29, 2028", True),
    ("lease.expansion_option_deadline", "2028-02-29", "exercised by 02/29/2028", True),
    ("lease.expansion_option_deadline", "2028-02-29", "exercised by Feb. 28, 2028", False),
    # base year: a year is a number written in the quote
    ("lease.operating_expense_base_year", 2026, "Base Year means calendar year 2026", True),
    ("lease.operating_expense_base_year", 2026, "Base Year means the calendar year ending December 31, 2026", True),
    ("lease.operating_expense_base_year", 2026, "Base Year means calendar year 2025", False),
    ("lease.operating_expense_base_year", 2026, "Base Year means the year of the Commencement Date", False),
    # parking: spaces and the monthly rate
    ("lease.parking", {"spaces": 40, "rate_monthly": 125},
     "forty (40) unreserved parking spaces at $125.00 per space per month", True),
    ("lease.parking", {"spaces": 40, "rate_monthly": 125}, "forty (40) spaces at $150.00 per space per month", False),
    ("lease.parking", {"spaces": 40}, "forty unreserved parking spaces at no charge", True),
    ("lease.parking", {"spaces": 40}, "fifty (50) unreserved parking spaces", False),
    # guaranty: the guarantor's name verbatim, the cap a number
    ("lease.guaranty", {"guarantor": "Sample Analytics Holdings LLC", "cap": 500000},
     'guaranteed by Sample Analytics Holdings LLC ("Guarantor"), capped at $500,000.00', True),
    ("lease.guaranty", {"guarantor": "Sample Analytics Holdings LLC"},
     'guaranteed by SAMPLE ANALYTICS HOLDINGS LLC ("Guarantor")', True),
    ("lease.guaranty", {"guarantor": "Sample Analytics Holdings LLC", "cap": 500000},
     'guaranteed by Sample Analytics Holdings LLC ("Guarantor"), capped at $250,000.00', False),
    ("lease.guaranty", {"guarantor": "Sample Holdings LLC"}, 'guaranteed by Sample Analytics Holdings LLC', False),
]

# (predicate, value, reason or None) — synthetic value shapes for the C10 predicates, decided by hand.
VALUE_CASES = [
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}}, None),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural", "amount": 1500000}}, None),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "fixed", "amount": 2000000},
                               "sales_exclusions": "sales taxes and returns"}, None),
    ("lease.percentage_rent", {"rate": 6, "breakpoint": {"type": "natural"}},
     "expected {rate, breakpoint} with rate in (0, 1]"),
    ("lease.percentage_rent", {"rate": 0.06}, "expected breakpoint {type: natural | fixed, amount?}"),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "artificial"}},
     "expected breakpoint {type: natural | fixed, amount?}"),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "fixed"}}, "a fixed breakpoint needs a positive amount"),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural", "amount": -1}},
     "breakpoint amount must be a positive number"),
    ("lease.percentage_rent", {"rate": 0.06, "breakpoint": {"type": "natural"}, "sales_exclusions": " "},
     "sales_exclusions must be a non-empty string"),
    ("lease.percentage_rent", "6% over breakpoint", "expected {rate, breakpoint} with rate in (0, 1]"),
    ("lease.co_tenancy", {"trigger": "fewer than 70% of the GLA is open", "remedy": "pay 50% of Base Rent"}, None),
    ("lease.co_tenancy", {"trigger": "x", "remedy": "y", "cure_period_months": 6}, None),
    ("lease.co_tenancy", {"trigger": "x"}, "expected {trigger, remedy} as non-empty strings"),
    ("lease.co_tenancy", {"trigger": "x", "remedy": ""}, "expected {trigger, remedy} as non-empty strings"),
    ("lease.co_tenancy", {"trigger": "x", "remedy": "y", "cure_period_months": 0},
     "cure_period_months must be a positive number"),
    ("lease.co_tenancy", {"trigger": "x", "remedy": "y", "cure_period_months": "six"},
     "cure_period_months must be a positive number"),
    ("lease.renewal_notice_deadline", "2030-08-31", None),
    ("lease.renewal_notice_deadline", "August 31, 2030", "expected YYYY-MM-DD date"),
    ("lease.termination_notice_deadline", "2029-09-30", None),
    ("lease.termination_notice_deadline", "2029-09-31", "expected YYYY-MM-DD date"),
    ("lease.rent_commencement_date", "2026-06-01", None),
    ("lease.rent_commencement_date", 20260601, "expected YYYY-MM-DD date"),
    ("lease.expansion_option_deadline", "2028-02-29", None),
    ("lease.expansion_option_deadline", "2027-02-29", "expected YYYY-MM-DD date"),
    ("lease.operating_expense_base_year", 2026, None),
    # 2026.0 is the same JSON number as 2026 (JavaScript cannot tell them apart), so both pass.
    ("lease.operating_expense_base_year", 2026.0, None),
    ("lease.operating_expense_base_year", 2026.5, "expected a four-digit integer year"),
    ("lease.operating_expense_base_year", "2026", "expected a four-digit integer year"),
    ("lease.operating_expense_base_year", True, "expected a four-digit integer year"),
    ("lease.operating_expense_base_year", 26, "expected a four-digit integer year"),
    ("lease.parking", {"spaces": 40}, None),
    ("lease.parking", {"spaces": 40, "rate_monthly": 0}, None),
    ("lease.parking", {"spaces": 40, "rate_monthly": 125.5}, None),
    ("lease.parking", {"spaces": 0}, "expected {spaces, rate_monthly?} with a positive number of spaces"),
    ("lease.parking", {"rate_monthly": 125}, "expected {spaces, rate_monthly?} with a positive number of spaces"),
    ("lease.parking", {"spaces": 40, "rate_monthly": -5}, "rate_monthly must be a non-negative number"),
    ("lease.guaranty", {"guarantor": "Sample Analytics Holdings LLC"}, None),
    ("lease.guaranty", {"guarantor": "Sample Analytics Holdings LLC", "cap": 500000}, None),
    ("lease.guaranty", {"guarantor": ""}, "expected {guarantor, cap?} with the guarantor's name"),
    ("lease.guaranty", {"cap": 500000}, "expected {guarantor, cap?} with the guarantor's name"),
    ("lease.guaranty", {"guarantor": "Sample Analytics Holdings LLC", "cap": 0}, "cap must be a positive number"),
    # a natural person's address is never a fact: anything that reads as an address is refused
    ("lease.guaranty", {"guarantor": "Jane Doe, 123 Main Street, Austin, Texas 78701"},
     "guarantor must be a name, not an address"),
    ("lease.guaranty", {"guarantor": "Jane Doe, 45 Oak Lane"}, "guarantor must be a name, not an address"),
    ("lease.guaranty", {"guarantor": "Jane Doe, Apt 4B, 9 Elm St."}, "guarantor must be a name, not an address"),
    ("lease.guaranty", {"guarantor": "Jane Doe 78701"}, "guarantor must be a name, not an address"),
    ("lease.guaranty", {"guarantor": "Jane Doe, P.O. Box 12"}, "guarantor must be a name, not an address"),
]


class ValueShapes(unittest.TestCase):
    def test_new_predicates_are_listed_for_the_extractor(self):
        for predicate in ("lease.percentage_rent", "lease.co_tenancy", "lease.renewal_notice_deadline",
                          "lease.termination_notice_deadline", "lease.rent_commencement_date",
                          "lease.expansion_option_deadline", "lease.operating_expense_base_year", "lease.parking",
                          "lease.guaranty"):
            self.assertIn(predicate, PREDICATES)
        self.assertEqual(len(PREDICATES), 25, "16 original predicates plus 9")

    def test_shapes(self):
        for predicate, value, reason in VALUE_CASES:
            with self.subTest(predicate=predicate, value=value):
                self.assertEqual(check_value(predicate, value), reason)

    def test_existing_predicates_unchanged(self):
        self.assertIsNone(check_value("lease.commencement_date", "2026-03-01"))
        self.assertEqual(check_value("lease.commencement_date", "March 1, 2026"), "expected YYYY-MM-DD date")
        self.assertIsNone(check_value("lease.pro_rata_share", 0.0825))
        self.assertEqual(check_value("lease.rofr", ""), "expected non-empty string")

    def test_cam_cap_rate_is_a_fraction(self):
        self.assertIsNone(check_value("lease.cam_cap", {"method": "compounding_from_base", "rate": 0.05}))
        for rate in (5, 0, -0.05):  # 5 means 5% written as a number: refused, like pro_rata_share
            self.assertEqual(check_value("lease.cam_cap", {"method": "year_over_year", "rate": rate}),
                             "rate must be a fraction in (0, 1], e.g. 0.05 for 5%")


class Consistency(unittest.TestCase):
    def test_forms(self):
        for predicate, value, quote, ok in CONSISTENCY_CASES:
            with self.subTest(predicate=predicate, value=value, quote=quote):
                reason = check_consistency(predicate, value, quote)
                if ok:
                    self.assertIsNone(reason)
                else:
                    self.assertIsNotNone(reason)
                    self.assertTrue(reason.startswith("value ") and reason.endswith(" not found in quote"), reason)

    def test_reason_names_the_value_and_field(self):
        self.assertEqual(check_consistency("lease.security_deposit", 24.5, "rent of $24.00"),
                         "value 24.5 not found in quote")
        self.assertEqual(check_consistency("lease.cam_cap", {"method": "year_over_year", "rate": 0.05}, "six percent"),
                         "value 0.05 (rate) not found in quote")
        self.assertEqual(check_consistency("lease.base_rent_schedule",
                                           [{"from": "2026-03-01", "to": "2027-02-28", "annual_rent_psf": 38.0}],
                                           "March 1, 2026 through February 28, 2028: $38.00"),
                         'value "2027-02-28" (to) not found in quote')
        # nested shapes report the path to the field
        self.assertEqual(check_consistency("lease.percentage_rent",
                                           {"rate": 0.06, "breakpoint": {"type": "fixed", "amount": 2500000}},
                                           "6% of Gross Sales exceeding $2,000,000"),
                         "value 2500000 (breakpoint.amount) not found in quote")
        self.assertEqual(check_consistency("lease.guaranty", {"guarantor": "Sample Holdings LLC"},
                                           "guaranteed by Sample Analytics Holdings LLC"),
                         'value "Sample Holdings LLC" (guarantor) not found in quote')

    def test_verify_runs_it_after_locating_the_quote(self):
        d = load_document(FIX / "synthetic_lease.txt")
        v = verify(d, Candidate("lease.security_deposit", 59000, "a security deposit of $95,000", 2))
        # the quote verified on page 2, so the verdict keeps the page and names the failing check
        self.assertEqual((v.accepted, v.page, v.reason, v.check),
                         (False, 2, "value 59000 not found in quote", "consistency"))
        # a hallucinated quote is reported as such, not as a mismatch
        v = verify(d, Candidate("lease.security_deposit", 59000, "a security deposit of $59,000", 2))
        self.assertEqual((v.reason, v.check), ("quote not found in the document", "quote"))
        self.assertEqual(verify(d, Candidate("lease.security_deposit", "95,000", "a security deposit of $95,000", 2)).check,
                         "value")
        # a corrected page is still corrected when the value is consistent
        v = verify(d, Candidate("lease.security_deposit", 95000, "a security deposit of $95,000", 3))
        self.assertEqual((v.accepted, v.page, v.page_corrected), (True, 2, True))


# --- OCR -------------------------------------------------------------------------------------

LEASE_PAGES = (FIX / "synthetic_lease.txt").read_text("utf-8").split("\f")


class FakePdfPage:
    """Stands in for a pypdf page: a text layer (possibly blank) and embedded images."""

    def __init__(self, index, text, images=()):
        self.index, self._text, self.images = index, text, list(images)

    def extract_text(self):
        return self._text


class FakePdfReader:
    pages_by_path: dict = {}

    def __init__(self, path):
        self.pages = FakePdfReader.pages_by_path[Path(path).name]


def fake_pypdf():
    return mock.patch.dict(sys.modules, {"pypdf": SimpleNamespace(PdfReader=FakePdfReader)})


def scanned_lease_pdf(tmp):
    """A synthetic three-page 'PDF': page 1 has a text layer, page 2 is a scan, page 3 is whitespace only."""
    path = Path(tmp) / "synthetic_lease.pdf"
    path.write_bytes(b"%PDF-synthetic placeholder; the fake reader ignores the bytes\n")
    FakePdfReader.pages_by_path[path.name] = [FakePdfPage(0, LEASE_PAGES[0]), FakePdfPage(1, ""),
                                              FakePdfPage(2, "  \n\t")]
    return path


def fake_backend(page):
    """OCR stand-in: 'recognises' the synthetic lease text for the page it is given."""
    assert isinstance(page, FakePdfPage), page
    return LEASE_PAGES[page.index]


class Ocr(unittest.TestCase):
    def test_pdf_pages_without_text_go_through_the_backend(self):
        with tempfile.TemporaryDirectory() as tmp, fake_pypdf():
            doc = load_document(scanned_lease_pdf(tmp), ocr=fake_backend)
        self.assertEqual([p.ocr for p in doc.pages], [False, True, True])
        self.assertEqual(doc.page(2).text, LEASE_PAGES[1])
        self.assertNotIn("pages_without_text", doc.metadata)
        self.assertIsNone(unreadable_pages_message(doc))

    def test_ocr_pages_are_marked_in_provenance(self):
        with tempfile.TemporaryDirectory() as tmp, fake_pypdf():
            doc = load_document(scanned_lease_pdf(tmp), ocr=fake_backend)
        result = ingest_lease(LEASE_URN, [doc], ScriptedExtractor(), as_of="2026-11-02")
        # same outcome as the text-layer lease: 12 accepted (17 candidates, 5 deliberately bad: 2 rejected,
        # 3 queued for review), 1 page corrected
        self.assertEqual(result.summary(), {"accepted": 12, "current": 12, "rejected": 2, "page_corrected": 1,
                                            "review_pending": 3, "review_accepted": 0, "review_rejected": 0})
        queued = {r.candidate.predicate: r for r in result.review}
        self.assertTrue(queued["lease.security_deposit"].ocr, "a queued item from an OCR page says so")
        self.assertFalse(queued["lease.expiration_date"].ocr, "page 1 has a text layer")
        by_pred = result.current
        self.assertNotIn("ocr", by_pred["lease.commencement_date"]["provenance"]["sources"][0], "page 1 has a text layer")
        for pred in ("lease.security_deposit", "lease.pro_rata_share", "lease.renewal_option"):
            src = by_pred[pred]["provenance"]["sources"][0]
            self.assertIs(src["ocr"], True, pred)
            self.assertIn(src["page"], (2, 3))
        for f in result.facts:
            self.assertEqual(f["provenance"]["method"], "extracted")
            self.assertEqual(factlot.validate_fact(f), {"valid": True, "issues": []})

    def test_without_a_backend_scanned_pages_are_skipped_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp, fake_pypdf():
            doc = load_document(scanned_lease_pdf(tmp))
        self.assertEqual([p.ocr for p in doc.pages], [False, False, False])
        self.assertEqual(doc.metadata["pages_without_text"], "2,3")
        message = unreadable_pages_message(doc)
        self.assertIn("pages 2,3 have no text layer", message)
        self.assertIn("--ocr tesseract", message)
        v = verify(doc, Candidate("lease.security_deposit", 95000, "a security deposit of $95,000", 2))
        self.assertEqual(v.reason, "quote not found in the document")

    def test_backend_returning_nothing_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp, fake_pypdf():
            doc = load_document(scanned_lease_pdf(tmp), ocr=lambda page: "")
        self.assertEqual(doc.metadata["pages_without_text"], "2,3")
        self.assertIn("returned no text from OCR", unreadable_pages_message(doc))

    def test_image_file_is_one_ocr_page(self):
        received = []

        def backend(page):
            received.append(page)
            return "SYNTHETIC OCR TEXT: a security deposit of $95,000"

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan-page.png"
            path.write_bytes(b"not a real image; the fake backend never reads it")
            doc = load_document(path, ocr=backend)
            self.assertEqual(received, [path])
            self.assertEqual((len(doc.pages), doc.pages[0].ocr), (1, True))
            v = verify(doc, Candidate("lease.security_deposit", 95000, "a security deposit of $95,000", 1))
            self.assertTrue(v.accepted)
            self.assertEqual(load_document(path).metadata["pages_without_text"], "1")

    def test_unknown_backend_name(self):
        with self.assertRaises(ValueError) as cm:
            ocr_backend("nope")
        self.assertIn("tesseract", str(cm.exception))


def fake_tesseract(tmp, body):
    """Install a synthetic `tesseract` script in tmp and return a PATH patch that finds only it."""
    script = Path(tmp) / "tesseract"
    script.write_text("#!/bin/sh\n" + body)
    script.chmod(0o755)
    return mock.patch.dict(os.environ, {"PATH": tmp})


@unittest.skipUnless(os.name == "posix", "uses a shell script as a stand-in binary")
class TesseractBackend(unittest.TestCase):
    def test_missing_binary_is_a_clear_error(self):
        with mock.patch.dict(os.environ, {"PATH": ""}):
            with self.assertRaises(RuntimeError) as cm:
                ocr_backend("tesseract")
        self.assertIn("tesseract command on PATH", str(cm.exception))

    def test_shells_out_for_images_and_pdf_pages(self):
        with tempfile.TemporaryDirectory() as tmp:
            with fake_tesseract(tmp, 'printf "SYNTHETIC OCR OUTPUT for %s args=%s\\n" "${1##*/}" "$*"\n'):
                backend = ocr_backend("tesseract")
                self.assertIsInstance(backend, TesseractOcr)
                out = backend(Path(tmp) / "page.png")
                self.assertIn("SYNTHETIC OCR OUTPUT for page.png", out)
                self.assertIn(" stdout", out)
                page = FakePdfPage(0, "", images=[SimpleNamespace(name="Im0.png", data=b"png-bytes"),
                                                  SimpleNamespace(name="Im1.jpg", data=b"jpg-bytes")])
                out = backend(page)
                self.assertIn("for image-0.png", out)
                self.assertIn("for image-1.jpg", out)
                self.assertEqual(backend(FakePdfPage(0, "", images=[])), "")
                self.assertIn("-l deu", TesseractOcr(lang="deu")(Path(tmp) / "page.png"))

    def test_failure_is_raised(self):
        with tempfile.TemporaryDirectory() as tmp:
            with fake_tesseract(tmp, 'echo "synthetic failure" >&2; exit 1\n'):
                with self.assertRaises(RuntimeError) as cm:
                    ocr_backend("tesseract")(Path(tmp) / "page.png")
        self.assertIn("synthetic failure", str(cm.exception))

    def test_cli_option_fails_before_extraction_when_binary_is_missing(self):
        err = io.StringIO()
        with mock.patch.dict(os.environ, {"PATH": ""}), contextlib.redirect_stderr(err):
            code = cli_main(["--model", "m", "--lease", "does-not-matter.txt", "--ocr", "tesseract"])
        self.assertEqual(code, 2)
        self.assertIn("tesseract command on PATH", err.getvalue())


def blank_png(width=8, height=8):
    """A tiny white PNG written with the standard library only."""
    raw = b"".join(b"\x00" + b"\xff" * (width * 3) for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@unittest.skipUnless(shutil.which("tesseract"), "tesseract is not installed")
class RealTesseract(unittest.TestCase):
    def test_runs_on_a_blank_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "blank.png"
            path.write_bytes(blank_png())
            self.assertIsInstance(ocr_backend("tesseract")(path), str)


if __name__ == "__main__":
    unittest.main()

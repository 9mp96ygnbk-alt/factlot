"""SEC lease exhibit comps: pages from HTML, agent specs verified by doc_verify_facts, the comp, and the registry load.

The lease below is SYNTHETIC (invented parties, address and figures), written as HTML with page breaks.
"""

import hashlib
import tempfile
import unittest
from pathlib import Path

from factlot.facts import validate_fact
from factlot.registry import Registry
from factlot.registry.adapters import sec_lease_exhibits as s

HTML = b"""<html><body>
<p>OFFICE LEASE between EXAMPLE TOWER OWNER LLC, a Delaware limited liability company, as Landlord, and SAMPLE WIDGETS, INC., a Nevada corporation, as Tenant.</p>
<p>Premises: approximately 10,000 rentable square feet at 100 Example Street, Austin, Texas.</p>
<hr/>
<p>Lease Commencement Date: January 1, 2027. Lease Expiration Date: December 31, 2031.</p>
<p>Base Rent: Lease Year 1 $400,000.00; Lease Year 2 $412,000.00; Lease Year 3 $424,360.00; Lease Year 4 $437,090.80; Lease Year 5 $450,203.52.</p>
<p>Tenant shall not pay Base Rent for the first three (3) months of the Term. Tenant Improvement Allowance: $45.00 per rentable square foot.</p>
<hr/>
<p>IN WITNESS WHEREOF, the parties have executed this Lease. By: ______ Name: Jane Roe Title: Manager</p>
</body></html>"""

FILING = {"filer": "SAMPLE WIDGETS, INC.", "cik": "1", "accession": "0000000000-26-000001", "form": "8-K", "filed": "2026-10-01",
          "exhibit_type": "EX-10.1", "filename": "ex10-1.htm", "url": "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/ex10-1.htm",
          "sha256": hashlib.sha256(HTML).hexdigest(), "bytes": len(HTML), "state": "TX", "city": "Austin", "street": "100 Example Street"}


def spec(**over):
    facts = [
        {"predicate": "lease.rentable_area_sf", "value": 10000, "quote": "approximately 10,000 rentable square feet", "page": 1},
        {"predicate": "lease.commencement_date", "value": "2027-01-01", "quote": "Lease Commencement Date: January 1, 2027", "page": 2},
        {"predicate": "lease.expiration_date", "value": "2031-12-31", "quote": "Lease Expiration Date: December 31, 2031", "page": 2},
        {"predicate": "lease.rent_steps", "value": [{"annual_usd": 400000}, {"annual_usd": 412000}, {"annual_usd": 424360},
                                                     {"annual_usd": 437090.8}, {"annual_usd": 450203.52}],
         "quote": "Lease Year 1 $400,000.00; Lease Year 2 $412,000.00; Lease Year 3 $424,360.00; Lease Year 4 $437,090.80; Lease Year 5 $450,203.52", "page": 2},
        {"predicate": "lease.free_rent", "value": {"months": 3, "applies_to": "base_rent"},
         "quote": "shall not pay Base Rent for the first three (3) months of the Term", "page": 2},
        {"predicate": "lease.ti_allowance", "value": {"amount_psf": 45}, "quote": "Tenant Improvement Allowance: $45.00 per rentable square foot", "page": 2},
        {"predicate": "lease.tenant", "value": "SAMPLE WIDGETS, INC.", "quote": "and SAMPLE WIDGETS, INC., a Nevada corporation, as Tenant", "page": 1},
        {"predicate": "lease.landlord", "value": "EXAMPLE TOWER OWNER LLC", "quote": "between EXAMPLE TOWER OWNER LLC, a Delaware limited liability company", "page": 1},
    ]
    return {"property_type": "office", "comp_type": "new", "tenant_type": "corporate", "expense_basis": "base_year", "facts": facts, **over}


class TestSecLeaseExhibits(unittest.TestCase):
    def test_pages_are_cut_at_page_breaks(self):
        pages = s.html_pages(HTML)
        self.assertEqual(len(pages), 3)
        self.assertIn("Lease Commencement Date: January 1, 2027", pages[1])
        long = b"<html><body>" + b"".join(b"<p>line %d of an exhibit with no page breaks at all</p>" % i for i in range(600)) + b"</body></html>"
        chunks = s.html_pages(long)
        self.assertGreater(len(chunks), 3)
        self.assertEqual(chunks, s.html_pages(long))  # the same exhibit always gives the same pages

    def test_a_verified_spec_becomes_a_comp_with_a_derived_ner(self):
        r = s.verify_lease(spec(), s.html_pages(HTML), FILING)
        self.assertEqual((r["needs_review"], r["rejected"]), ([], []))
        v = r["comp"]["value"]
        self.assertEqual((v["starting_rent_psf_yr"], v["term_months"], v["free_rent_months"], v["ti_allowance_psf"]), (40, 60, 3, 45))
        self.assertEqual(v["escalation"], {"type": "percent", "rate": 0.03, "every_months": 12})
        self.assertEqual((v["verification"], v["confirming_party"]), ("document_verified", "public_record"))
        self.assertEqual(r["ner"]["provenance"]["formula"], "calc.net_effective_rent@1")
        self.assertEqual(validate_fact(r["comp"]), {"valid": True, "issues": []})
        self.assertEqual(validate_fact(r["ner"]), {"valid": True, "issues": []})
        self.assertTrue(all(src.get("sha256") == FILING["sha256"] for src in r["comp"]["provenance"]["sources"]))

    def test_unverified_values_are_dropped_not_stored(self):
        bad = spec()
        bad["facts"][0] = {**bad["facts"][0], "value": 12000}  # the quote says 10,000
        bad["facts"][1] = {**bad["facts"][1], "page": 1, "quote": "Lease Commencement Date: January 2, 2027"}  # not on the page
        r = s.verify_lease(bad, s.html_pages(HTML), FILING)
        self.assertEqual({x["predicate"] for x in r["needs_review"]}, {"lease.rentable_area_sf"})
        self.assertEqual({x["predicate"] for x in r["rejected"]}, {"lease.commencement_date"})
        self.assertIsNone(r["comp"])
        self.assertNotIn("lease.rentable_area_sf", [f["predicate"] for f in r["verified"]])

    def test_signature_blocks_and_person_parties_are_refused(self):
        sp = spec()
        sp["facts"].append({"predicate": "lease.landlord", "value": "Jane Roe", "quote": "Name: Jane Roe Title: Manager", "page": 3})
        sp["facts"].append({"predicate": "lease.tenant", "value": "ACME LLC", "quote": "By: ______ Name: Jane Roe Title: Manager", "page": 3})
        r = s.verify_lease(sp, s.html_pages(HTML), FILING)
        self.assertEqual(len(r["notes"]), 2)
        text = str(r["verified"])
        self.assertNotIn("Jane Roe", text)
        self.assertNotIn("IN WITNESS", text)

    def test_irregular_rent_steps_build_no_comp(self):
        sp = spec()
        sp["facts"][3] = {**sp["facts"][3], "value": [{"annual_usd": 400000}, {"annual_usd": 412000}, {"annual_usd": 450203.52}]}
        r = s.verify_lease(sp, s.html_pages(HTML), FILING)
        self.assertIsNone(r["comp"])
        self.assertTrue(any("no constant percentage or dollar bump" in n for n in r["notes"]))
        self.assertIn("lease.rent_steps", [f["predicate"] for f in r["verified"]])  # the verified facts are still kept

    def test_load_writes_cited_facts_and_is_idempotent(self):
        entry = s.verify_lease(spec(), s.html_pages(HTML), FILING)
        package = {"generated": "2026-11-04", "leases": [entry]}
        with tempfile.TemporaryDirectory() as d:
            reg = Registry(Path(d) / "r.db")
            first = s.load(reg, package)
            self.assertEqual((first["leases"], first["comps"]), (1, 1))
            self.assertEqual(s.load(reg, package)["facts"], 0)
            facts = {f["predicate"]: f for f in reg.facts(entry["urn"])}
            self.assertIn("lease.net_effective_rent", facts)
            self.assertEqual(facts["lease.comp"]["value"]["starting_rent_psf_yr"], 40)
            for f in facts.values():
                self.assertEqual(validate_fact(f), {"valid": True, "issues": []}, f["predicate"])
                self.assertEqual(f["provenance"]["sources"][0]["document_id"], f"fl:document:sha256-{FILING['sha256']}")
            self.assertIn(FILING["url"], facts["lease.rentable_area_sf"]["provenance"]["sources"][0]["section"])
            self.assertEqual(reg.resolve_external("sec-accession-exhibit", "0000000000-26-000001/ex10-1.htm"), entry["urn"])
            reg.close()

    def test_escalation_picks_the_rule_that_fits(self):
        self.assertEqual(s._escalation([24.75, 25.25, 25.75, 26.25], 12)[0], {"type": "fixed_psf", "amount": 0.5, "every_months": 12})
        self.assertEqual(s._escalation([40, 41.2, 42.436, 43.709], 12)[0]["type"], "percent")
        self.assertEqual(s._escalation([30, 30, 30], 12)[0], {"type": "none"})
        self.assertIsNone(s._escalation([30, 31, 35], 12)[0])


if __name__ == "__main__":
    unittest.main()

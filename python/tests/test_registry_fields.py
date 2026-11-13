"""Value-history labels and roll rules (factlot.registry.fields; fields.ts in TypeScript, where fields.test.ts also
compares the two languages on a registry built there)."""

import unittest

from factlot.registry.fields import _share, display_filename, label_value_history, roll_of


def entry(year, doc, mv=1, av=None):
    cite = {"fact_id": f"f{year}", "document_id": doc, "locator": None, "as_of": "x"}
    return {"tax_year": year, "market_value": mv, "appraised_value": av, "as_of": "x",
            "citations": {"market_value": cite if mv is not None else None, "appraised_value": cite if av is not None else None}}


FILES = {
    "a": {"source_id": "tx-x-cad", "filename": "2026-CERTIFIED%20ROLL.zip", "as_of": "2026-07-20", "read_on": "2026-11-02"},
    "b": {"source_id": "tx-x-cad-2023", "filename": "Real_acct_owner.zip", "as_of": "2026-11-09", "read_on": "2026-11-12"},
    "c": {"source_id": "tx-y-cad", "filename": "current.zip", "as_of": "2026-11-02", "read_on": "2026-11-02"},
    "d": {"source_id": "tx-y-cad", "filename": "x_PRELIM.zip", "as_of": "", "read_on": ""},
}


class RollRules(unittest.TestCase):
    def test_certified_only_from_a_certified_name(self):
        for name in ("2025-CERTIFIED-EXPORT.zip", "DCAD2025_CERTIFIED_07242025.zip", "2025-GCO-CERTF-APPR-ROLL-SUPP0.zip"):
            self.assertEqual(roll_of("tx-a", name, 2025, "2025-08-01"), "certified", name)
        for name in ("UNCERTIFIED_2025.zip", "PreCert_Export.zip", "2025-Pre-Cert-Roll.zip", "NonCertified.zip",
                     "2025_Certified_Estimate.zip", "2024_Cert_Web_Export.zip", None):
            self.assertIsNone(roll_of("tx-a", name, 2025, "2025-08-01"), name)

    def test_preliminary_from_the_name_or_the_texas_year_rule_never_current(self):
        self.assertEqual(roll_of("tx-a", "x_Prelim.zip", 2026, "2026-05-01"), "preliminary")
        self.assertEqual(roll_of("tx-a", "roll.csv", 2027, "2026-11-07"), "preliminary")
        self.assertIsNone(roll_of("tx-a", "DCAD2026_CURRENT.zip", 2026, "2026-11-01"))
        self.assertIsNone(roll_of("ny-nyc-dof", "fy27.zip", 2027, "2026-05-15"))

    def test_an_unparseable_as_of_gives_no_label(self):
        self.assertIsNone(roll_of("tx-a", "x_PRELIM.zip", 2026, ""))
        self.assertIsNone(roll_of("tx-a", "2025-CERTIFIED.zip", 2025, "unknown"))
        e = label_value_history([entry(2026, "d")], FILES.get)[0]
        self.assertEqual((e["roll"], e["notes"]), (None, []))

    def test_file_names_shown_decoded(self):
        self.assertEqual(display_filename("2026%20Certified.zip"), "2026 Certified.zip")
        self.assertEqual(display_filename("100%.zip"), "100%.zip")
        self.assertEqual(display_filename("%FF.zip"), "%FF.zip")
        self.assertIsNone(display_filename(None))

    def test_share_rounds_half_up_and_whole_shares_are_integers(self):
        self.assertEqual(_share(1, 2000), 0.001)  # 0.5 per mille rounds up, as Math.round does
        self.assertIsInstance(_share(3, 3), int)
        self.assertIsInstance(_share(0, 3), int)


class Notes(unittest.TestCase):
    def test_notes_say_only_what_the_files_show_and_the_gap_sits_on_the_older_entry(self):
        out = label_value_history([entry(2026, "a", 10, 9), entry(2023, "b"), entry(2022, "c")], FILES.get)
        self.assertEqual([e["roll"] for e in out], ["certified", None, None])
        self.assertEqual(out[0]["file"]["filename"], "2026-CERTIFIED ROLL.zip")
        self.assertEqual(out[0]["value_types"], ["market", "appraised"])
        self.assertEqual(out[0]["notes"], [])
        self.assertEqual(out[1]["notes"], [
            "This 2023 value comes from a file dated 2026-11-09, after the 2023 roll year: it is the roll as the publisher "
            "held it on that date, which can differ from the roll as certified.",
            "The registry holds no value of this parcel for 2024 to 2025, between this 2023 entry and the 2026 entry."])
        self.assertEqual(out[2]["notes"], [
            "2026-11-02, this file's as-of date, is the day the registry read it.",
            "This 2022 value comes from a file dated 2026-11-02, after the 2022 roll year: it is the roll as the publisher "
            "held it on that date, which can differ from the roll as certified."])

    def test_an_entry_whose_file_is_unknown_has_no_file_label(self):
        e = label_value_history([entry(2026, "zz")], FILES.get)[0]
        self.assertEqual((e["file"], e["roll"], e["notes"], e["value_types"]), (None, None, [], ["market"]))


if __name__ == "__main__":
    unittest.main()

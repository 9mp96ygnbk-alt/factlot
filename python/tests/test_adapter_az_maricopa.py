"""Maricopa County Assessor adapter tests on a SYNTHETIC fixture that copies the real layout.

Every parcel number, name, and value here is invented to exercise the mapping; none is real
Arizona data. The fixture copies the real files' shape: pipe-delimited, CRLF, a header row with
the file's own column spellings (the Secured and Apartment Masters) or generic ``Column N`` labels
(the Commercial Master), members under ``Data/`` with a spec PDF under ``File Spec/``.
"""

import tempfile
import unittest
import zipfile
from pathlib import Path

from factlot.registry import Registry
from factlot.registry.adapters import az_maricopa

# The header line of Data/Secured_Master_BK*.txt as published (2026-10-26 file).
SECURED_HEADER = (
    "FolioKey|OwnerName|MailingAddress1|MailingAddress2|MailingCity|MailingState|MailingPostalCode|MailingCountry|"
    "SitusAddress|SitusUnitNumber|SitusCity|SitusPostalCode|PropertyType|DeedNumber|DeedDate|DeedType|LandValue|"
    "ImprovementValue|FCV|AssessedFCV|LPV|AssessedLPV|PUC|Lot|Parcel_Block|Parcel_Tract|LandClass|ImprvClass|"
    "RentalInd|LivingArea|TotalSqFt|ConstrYear|PoolSize|SalePrice|SaleDate|MCR_Key|MCR_Name|NumUnits|TaxAreaCode"
)
APARTMENT_HEADER = (
    "EconUnit|LeadParcel|Complexname|PUC|LandFCV|ImprvFCV|Utilities|Fireplace|OneBedroom|TwoBedroom|ThreeBedroom|"
    "Other|Studio|OneBedroomRate|TwoBedroomRate|ThreeBedroomRate|OtherRate|StudioRate|IncomeSrc|GFPerimeter|GFArea|"
    "TotalFloor|StoryCnt|Height|ConstrYear|SitusAddress|SitusUnitNumber|SitusCity|SitusPostalCode|Owner|InCarOf|"
    "Address1|Address2|City|State|Zip|SumLandsize|LandSize|NumUnits"
)
COMMERCIAL_WIDTH = 32 + 120 * 12
COMMERCIAL_HEADER = "|".join(f"Column {i}" for i in range(COMMERCIAL_WIDTH))


def secured_row(**fields: str) -> str:
    """One Secured Master row: the file's usual blanks and zeros where the fixture sets nothing."""
    r = {c: "" for c in az_maricopa.SECURED_COLUMNS}
    r.update(Owner_Mail_Country="USA", Property_Type="COMMERCIAL", Rental_Indicator="N", Living_Area="0",
             Pool_Size="0", Tax_Area_Code="481400", Land_Full_Cash_Value="0", Improvement_Full_Cash_Value="0")
    r.update(fields)
    return "|".join(r[c] for c in az_maricopa.SECURED_COLUMNS)


def commercial_row(**fields: str) -> str:
    r = {c: "" for c in az_maricopa.COMMERCIAL_COLUMNS}
    r.update(Work_Check_Digit="2", Occupancy_Number="494", Structure_Class="S", Review_Due_Code="A")
    r.update(fields)
    return "|".join(r[c] for c in az_maricopa.COMMERCIAL_COLUMNS) + "|" * (COMMERCIAL_WIDTH - 32)


def apartment_row(**fields: str) -> str:
    r = {c: "" for c in az_maricopa.APARTMENT_COLUMNS}
    r.update(fields)
    return "|".join(r[c] for c in az_maricopa.APARTMENT_COLUMNS)


SECURED_ROWS = [
    # An office condominium: PUC 1512, legal class 1.12, the unit already in the street line, a
    # nine-digit owner ZIP; no living area (commercial), so the Commercial Master supplies it.
    secured_row(Parcel_Number="17704892", Owner_Name="EXAMPLE 8683 LLC", Owner_Mail_Address_1="100 N EXAMPLE AVE STE 1",
                Owner_Mail_City="SCOTTSDALE", Owner_Mail_State="AZ", Owner_Mail_Zip_Code="852581234",
                Situs_Address="8683 E VIA DE NEGOCIO 110", Situs_Suite="110", Situs_City="SCOTTSDALE",
                Situs_Zip_Code="85258", Deed_Number="20240002350", Deed_Date="01032024", Deed_Type="WD",
                Land_Full_Cash_Value="736600", Improvement_Full_Cash_Value="1779400", Total_Full_Cash_Value="2516000",
                Total_Full_Cash_Value_Assessed="377400", Limited_Property_Value="1581765",
                Limited_Property_Value_Assessed="237265", Property_Use_Code="1512", Land_Class="100% 1.12",
                Improvement_Class="100% 1.12", Total_Square_Feet="25617", Construction_Year="1984"),
    # Vacant commercial land (PUC 0021): out of scope, like a Texas C1.
    secured_row(Parcel_Number="17704893", Owner_Name="VACANT LOT LLC", Owner_Mail_Address_1="1 LOT ST",
                Owner_Mail_City="PHOENIX", Owner_Mail_State="AZ", Owner_Mail_Zip_Code="85003", Situs_Address="",
                Situs_City="SCOTTSDALE", Property_Type="VACANT", Land_Full_Cash_Value="300000",
                Total_Full_Cash_Value="300000", Limited_Property_Value="250000", Property_Use_Code="0021",
                Land_Class="100% 2.R", Total_Square_Feet="11807"),
    # A 230-unit apartment complex (PUC 0377: 100 or more units, three stories or more), class 4.2
    # (rental residential), with a Canadian owner and a second mailing line; the Apartment Master
    # carries its floor area.
    secured_row(Parcel_Number="17704894", Owner_Name="EXAMPLE APARTMENTS LP", Owner_Mail_Address_1="1 PARK AVE",
                Owner_Mail_Address_2="FLOOR 2", Owner_Mail_City="VANCOUVER", Owner_Mail_State="BC",
                Owner_Mail_Zip_Code="V6B 1A1", Owner_Mail_Country="CAN", Situs_Address="900 E RIVER RD",
                Situs_City="TEMPE", Situs_Zip_Code="85281", Property_Type="RESIDENTIAL", Rental_Indicator="Y",
                Land_Full_Cash_Value="5000000", Improvement_Full_Cash_Value="26000000", Total_Full_Cash_Value="31000000",
                Limited_Property_Value="25000000", Property_Use_Code="0377", Land_Class="100% 4.2",
                Improvement_Class="100% 4.2", Total_Square_Feet="108900", Construction_Year="2005", Number_Of_Units="230"),
    # A duplex (PUC 0320): multiple residential, but not multifamily in the registry's sense.
    secured_row(Parcel_Number="17704895", Owner_Name="EXAMPLE DUPLEX LLC", Owner_Mail_Address_1="2 OAK ST",
                Owner_Mail_City="MESA", Owner_Mail_State="AZ", Owner_Mail_Zip_Code="85201", Situs_Address="200 OAK ST",
                Situs_City="MESA", Situs_Zip_Code="85201", Property_Type="RESIDENTIAL", Total_Full_Cash_Value="500000",
                Limited_Property_Value="400000", Property_Use_Code="0320", Living_Area="2400", Total_Square_Feet="7000",
                Construction_Year="1960", Number_Of_Units="2"),
    # A warehouse (PUC 3710) owned by a natural person, with a split letter, a street with a
    # post-direction, a blank situs ZIP, and no values or land figure yet (zeros and blanks).
    secured_row(Parcel_Number="17704896A", Owner_Name="J EXAMPLE", Owner_Mail_Address_1="5 OAK LN",
                Owner_Mail_City="GLENDALE", Owner_Mail_State="AZ", Owner_Mail_Zip_Code="85301",
                Situs_Address="5 INDUSTRIAL DR W", Situs_City="GLENDALE", Total_Full_Cash_Value="",
                Limited_Property_Value="0", Property_Use_Code="3710", Land_Class="100% 1.12", Total_Square_Feet="0",
                Construction_Year=""),
    # A partially complete hotel (PUC 2804) with a German owner and no situs street.
    secured_row(Parcel_Number="17704897", Owner_Name="EXAMPLE HOTELS GROUP GMBH", Owner_Mail_Address_1="BEISPIELSTRASSE 1",
                Owner_Mail_City="BERLIN", Owner_Mail_Zip_Code="10115", Owner_Mail_Country="DEU", Situs_City="SCOTTSDALE",
                Total_Full_Cash_Value="9000000", Limited_Property_Value="8000000", Property_Use_Code="2804",
                Total_Square_Feet="30000"),
    # A manufacturing plant (PUC 3020) with an unknown-owner placeholder; year from the Commercial Master.
    secured_row(Parcel_Number="17704898", Owner_Name="UNKNOWN", Situs_Address="77 PLANT WAY", Situs_City="CHANDLER",
                Situs_Zip_Code="85225", Total_Full_Cash_Value="1200000", Limited_Property_Value="1000000",
                Property_Use_Code="3020", Total_Square_Feet="100000"),
    # A church (PUC 9210): exempt, out of scope.
    secured_row(Parcel_Number="17704899", Owner_Name="EXAMPLE CHURCH", Situs_Address="1 CHAPEL LN", Situs_City="PHOENIX",
                Situs_Zip_Code="85004", Total_Full_Cash_Value="2000000", Limited_Property_Value="0",
                Property_Use_Code="9210", Total_Square_Feet="20000"),
]

COMMERCIAL_ROWS = [
    # The office condo has two improvements; the first is listed twice (two occupancies) and counts once.
    commercial_row(Parcel_Book="177", Parcel_Map="04", Parcel_Item="892", Parcel_Split_Letter="", Improvement_ID="000201",
                   Occupancy_Number="494", Total_Floor_Area="20000", Construction_Year="1984"),
    commercial_row(Parcel_Book="177", Parcel_Map="04", Parcel_Item="892", Parcel_Split_Letter="", Improvement_ID="000201",
                   Occupancy_Number="495", Total_Floor_Area="20000", Construction_Year="1984"),
    commercial_row(Parcel_Book="177", Parcel_Map="04", Parcel_Item="892", Parcel_Split_Letter="", Improvement_ID="000301",
                   Occupancy_Number="163", Total_Floor_Area="5000", Construction_Year="1999"),
    # The warehouse on the split parcel: no floor area or year recorded (zeros).
    commercial_row(Parcel_Book="177", Parcel_Map="04", Parcel_Item="896", Parcel_Split_Letter="A", Improvement_ID="000101",
                   Total_Floor_Area="0", Construction_Year="0"),
    # The plant: a year but no area.
    commercial_row(Parcel_Book="177", Parcel_Map="04", Parcel_Item="898", Parcel_Split_Letter="", Improvement_ID="000101",
                   Total_Floor_Area="", Construction_Year="1978"),
]

APARTMENT_ROWS = [
    apartment_row(Econ_Unit="999", Lead_Parcel="17704894", Complex_Name="EXAMPLE APARTMENTS", PUC="0377",
                  Total_Flr_Area="210000", Construction_Yr="2005", Num_Units="230"),
]


def fixture(tmp: Path) -> tuple[Path, Path, Path]:
    secured = tmp / "Secured_Master.zip"
    with zipfile.ZipFile(secured, "w") as zf:
        zf.writestr("Data/Secured_Master_BK100.txt", "\r\n".join([SECURED_HEADER, *SECURED_ROWS[:4], ""]))
        zf.writestr("Data/Secured_Master_BK200.txt", "\r\n".join([SECURED_HEADER, *SECURED_ROWS[4:], ""]))
        zf.writestr("File Spec/Secured Master.pdf", b"%PDF-1.4 synthetic placeholder")
    commercial = tmp / "Commercial_Master.zip"
    with zipfile.ZipFile(commercial, "w") as zf:
        zf.writestr("Data/Commercial_Master.txt", "\r\n".join([COMMERCIAL_HEADER, *COMMERCIAL_ROWS, ""]))
    apartments = tmp / "Apartment_Master.zip"
    with zipfile.ZipFile(apartments, "w") as zf:
        zf.writestr("Data/Apartment_Master.txt", "\r\n".join([APARTMENT_HEADER, *APARTMENT_ROWS, ""]))
    return secured, commercial, apartments


class Maricopa(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.secured, self.commercial, self.apartments = fixture(self.tmp)

    def test_category(self):
        self.assertEqual(az_maricopa.category("0353"), "B", "apartments, 5 to 24 units")
        self.assertEqual(az_maricopa.category("0366"), "B", "apartments, 25 to 99 units")
        self.assertEqual(az_maricopa.category("0377"), "B", "apartments, 100 or more units")
        self.assertIsNone(az_maricopa.category("0320"), "a duplex is not multifamily")
        self.assertIsNone(az_maricopa.category("0346"), "a fourplex is not multifamily")
        self.assertIsNone(az_maricopa.category("0310"), "a mixed complex says nothing about unit count")
        self.assertEqual(az_maricopa.category("0410"), "F1", "hotels")
        self.assertEqual(az_maricopa.category("1074"), "F1", "associated commercial parcel")
        self.assertEqual(az_maricopa.category("1512"), "F1", "office buildings")
        self.assertEqual(az_maricopa.category("2710"), "F1", "clubs and lodges")
        self.assertEqual(az_maricopa.category("8941"), "F1", "converted-use property is commercial")
        self.assertEqual(az_maricopa.category("3020"), "F2", "manufacturing")
        self.assertEqual(az_maricopa.category("3710"), "F2", "industrial warehouses")
        self.assertEqual(az_maricopa.category("2815"), "F1", "partially complete office building")
        self.assertEqual(az_maricopa.category("2837"), "F2", "partially complete warehouse")
        self.assertIsNone(az_maricopa.category("2803"), "partially complete multiple residential: unit count unknown")
        self.assertIsNone(az_maricopa.category("2801"))
        for code in ("0021", "0131", "0141", "0261", "0740", "0810", "4010", "8540", "9210", "9700", "", None):
            self.assertIsNone(az_maricopa.category(code), code)

    def test_format_apn(self):
        self.assertEqual(az_maricopa.format_apn("17704896A"), "177-04-896A")
        self.assertEqual(az_maricopa.format_apn("17704892"), "177-04-892")
        self.assertEqual(az_maricopa.format_apn("odd"), "ODD", "an unexpected shape passes through")

    def test_mapping(self):
        recs = {r.apn: r for r in az_maricopa.read_roll(self.secured, commercial_path=self.commercial,
                                                        apartment_path=self.apartments, tax_year=2027)}
        self.assertEqual(sorted(recs), ["177-04-892", "177-04-894", "177-04-896A", "177-04-897", "177-04-898"],
                         "office, apartments, warehouse, partial hotel, plant kept; vacant land, duplex, church dropped")
        office = recs["177-04-892"]
        self.assertEqual(office.county_fips, "013")
        self.assertEqual((office.state_category, office.local_use_code, office.tax_year), ("F1", "1512", 2027))
        self.assertEqual(office.account, "177-04-892")
        self.assertEqual(office.situs_address, "8683 E VIA DE NEGOCIO 110, SCOTTSDALE AZ 85258",
                         "the unit is already on the street line, so it is not appended again")
        self.assertEqual(office.owner_name, "EXAMPLE 8683 LLC")
        self.assertEqual(office.owner_mailing_address, "100 N EXAMPLE AVE STE 1, SCOTTSDALE, AZ 85258-1234")
        self.assertEqual((office.land_area_sf, office.improvement_area_sf, office.year_built), (25617, 25000, 1984),
                         "Total_Square_Feet is the land; floor area counts each improvement once")
        self.assertEqual((office.market_value, office.appraised_value), (2516000, 1581765),
                         "full cash value is the market value; the limited property value is the taxable basis")
        self.assertEqual(office.locator, "Secured_Master_BK100.txt Parcel_Number 17704892")
        apartments = recs["177-04-894"]
        self.assertEqual((apartments.state_category, apartments.local_use_code), ("B", "0377"))
        self.assertEqual(apartments.situs_address, "900 E RIVER RD, TEMPE AZ 85281")
        self.assertEqual(apartments.owner_mailing_address, "1 PARK AVE, FLOOR 2, VANCOUVER, BC V6B 1A1, CAN")
        self.assertEqual((apartments.land_area_sf, apartments.improvement_area_sf, apartments.year_built),
                         (108900, 210000, 2005), "floor area from the Apartment Master; the year from the Secured Master")
        warehouse = recs["177-04-896A"]
        self.assertEqual(warehouse.state_category, "F2")
        self.assertEqual(warehouse.situs_address, "5 INDUSTRIAL DR W, GLENDALE AZ", "no situs ZIP in the file")
        self.assertEqual(warehouse.owner_name, "J EXAMPLE", "the adapter passes persons through; the registry drops them")
        self.assertEqual((warehouse.land_area_sf, warehouse.improvement_area_sf, warehouse.year_built), (None, None, None),
                         "zeros are not figures")
        self.assertEqual((warehouse.market_value, warehouse.appraised_value), (None, 0),
                         "a blank value is unknown; a zero LPV is a figure the Assessor published")
        hotel = recs["177-04-897"]
        self.assertEqual(hotel.state_category, "F1")
        self.assertIsNone(hotel.situs_address, "no street line, no situs")
        self.assertEqual(hotel.owner_mailing_address, "BEISPIELSTRASSE 1, BERLIN, 10115, DEU")
        plant = recs["177-04-898"]
        self.assertIsNone(plant.owner_name, "UNKNOWN is a placeholder, not an owner")
        self.assertIsNone(plant.owner_mailing_address)
        self.assertEqual((plant.improvement_area_sf, plant.year_built), (None, 1978),
                         "the Commercial Master's year fills a blank Construction_Year")
        self.assertFalse(any(r.owner_confidential for r in recs.values()), "the file carries no withheld-owner marker")

    def test_without_the_detail_files(self):
        recs = {r.apn: r for r in az_maricopa.read_roll(self.secured)}
        self.assertEqual(len(recs), 5)
        self.assertEqual((recs["177-04-892"].improvement_area_sf, recs["177-04-892"].year_built), (None, 1984))
        self.assertIsNone(recs["177-04-892"].tax_year)

    def test_all_categories_and_unpacked_directory(self):
        every = list(az_maricopa.read_roll(self.secured, categories=None))
        self.assertEqual(len(every), 8, "every parcel; the header rows are not parcels")
        self.assertEqual([r.apn for r in every if r.state_category is None], ["177-04-893", "177-04-895", "177-04-899"])
        self.assertEqual(every[3].improvement_area_sf, 2400, "a residence's living area is its floor area")
        self.assertEqual([r.apn for r in az_maricopa.read_roll(self.secured, categories=["B"])], ["177-04-894"])
        with zipfile.ZipFile(self.secured) as zf:
            zf.extractall(self.tmp / "unpacked")
        self.assertEqual([r.apn for r in az_maricopa.read_roll(self.tmp / "unpacked")],
                         [r.apn for r in az_maricopa.read_roll(self.secured)])

    def test_build(self):
        db = self.tmp / "registry.db"
        stats = az_maricopa.build(self.secured, db, as_of="2026-10-26", commercial_path=self.commercial,
                                  apartment_path=self.apartments, tax_year=2027)
        self.assertEqual((stats.seen, stats.kept, stats.skipped_invalid, stats.retired), (5, 5, 0, 0))
        self.assertEqual(stats.owners_person_or_withheld, 1, "the natural person; the placeholder is not counted")
        reg = Registry.open_readonly(db)
        try:
            src = reg.db.execute("SELECT * FROM sources WHERE source_id = 'az-maricopa-assessor'").fetchone()
            self.assertEqual((src["state_fips"], src["county_fips"]), ("04", "013"))
            snap = reg.db.execute("SELECT * FROM snapshots").fetchone()
            self.assertTrue(snap["document_id"].startswith("fl:document:sha256-"))
            urn = reg.db.execute(
                "SELECT urn FROM crosswalk WHERE system = 'maricopa_apn' AND external_id = '177-04-896A'").fetchone()[0]
            self.assertEqual(urn, "fl:parcel:us-04013:177-04-896a")
            cat = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.state_property_category'",
                (urn,)).fetchone()[0]
            self.assertEqual(cat, '"F2"')
            puc = reg.db.execute(
                "SELECT value_json FROM current_facts WHERE subject = ? AND predicate = 'parcel.local_use_code'",
                (urn,)).fetchone()[0]
            self.assertEqual(puc, '"3710"')
            owners = reg.db.execute(
                "SELECT count(*) FROM current_facts WHERE predicate = 'ownership.owner_of_record'").fetchone()[0]
            self.assertEqual(owners, 3, "office, apartments, hotel; not the person or the placeholder")
        finally:
            reg.close()


if __name__ == "__main__":
    unittest.main()

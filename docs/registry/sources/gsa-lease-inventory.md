# gsa-lease-inventory: GSA Lease Inventory (and the IOLP)

Review record for the sources `gsa-lease-inventory` and `gsa-iolp` (data policy §5). Reviewed 2026-11-04.
Machine-readable copy: [`registry/sources/gsa/gsa-iolp.json`](../../../registry/sources/gsa/gsa-iolp.json) (collector
sources `gsa-lease-inventory` and `gsa-iolp`). Adapter: `python/src/factlot/registry/adapters/gsa_leases.py`
(county names: `registry/counties.py`); tests: `python/tests/test_adapter_gsa_leases.py`. How comps are shaped, keyed
and meant to be read: [../../lease-comps.md](../../lease-comps.md).

## Publisher and URLs

- Publisher: U.S. General Services Administration, Public Buildings Service. Landing page:
  <https://www.gsa.gov/real-estate/real-estate-services/leasing-overview> ("Lease inventory": the current month's
  external file, "posted after the 1st of each month", and FY16 to FY26 archives as ZIPs).
- File used: `https://www.gsa.gov/system/files/October-2026-External.xlsx` (1.6 MB, 7,515 data rows, archived by the
  collector 2026-11-04). The FY archives follow the pattern `.../system/files/FY25%20External%20Leases.zip`; they
  would give a rent history, and are not loaded.
- The Data.gov record "Lease Inventory Excel Spreadsheet" only links to the page above and states no licence.
- **IOLP** (Inventory of Owned and Leased Properties), `catalog.data.gov/dataset/inventory-of-owned-and-leased-properties-iolp`:
  weekly, CC0 1.0, two workbooks (`2026-10-30-iolp-leases.xlsx`, 7,078 rows; `2026-10-30-iolp-buildings.xlsx`, 7,746 rows).
  Lease rows carry location code, address, RSF, lease number and effective and expiration dates; **no rent and no lessor**.
  Archived and read, verified for collection, **not loaded**: the lease inventory above supersedes its lease fields.

## Terms, licence, robots

- GSA website policies (<https://www.gsa.gov/website-information/website-policies>, read 2026-11-04): "Most material
  on our site is free of copyright and may be copied and distributed without permission"; works by federal employees
  "are generally not protected by copyright and are in the public domain in the U.S."; "Citation of the GSA site and
  a link back is much appreciated." A US federal government work. AI use: not addressed, recorded `permitted` (public
  domain). Redistribution: permitted. Attribution: U.S. General Services Administration.
- The page says the inventory is for "market research for future leasing opportunities" and that "certain details
  have been redacted to protect sensitive information". Use for market research is what this is.
- **robots.txt** `www.gsa.gov`: disallows `/core/`, `/profiles/`, `/admin/`, `/search/` and the like, not `/system/files/`
  or the leasing page. `inventory.data.gov`: disallows `/dataset/rate/`, `/revision/`, `/api/`, Crawl-delay 10; the
  download paths are allowed. The identified collector honours the Crawl-delay of 10 seconds (the 2026-11-04 run used 12).
- `verified: true`.

## What the file contains, and what is kept

One worksheet; header `Region, Lease Num, Location Code, City, County, Address, State, ZipCode, Latitude, Longitude,
Field Office Name, Cen Bus Unit Ind, Lease Effective, Lease Expiration, Termination Right Date, Latest Action
affecting Term, Fully Serviced, Lease Agreement RSF, Lease Structured Parking, Lease Surface parking, Percent
Building, Current Annual Rent, Percent Office, Percent Warehouse, Percent Special, Renewal Option Term left,
Renewal Options Left, Lessor name`. Dates are Excel serials; ZIP codes are `12345`, `12345-6789` or `12345-`;
County is a name (Connecticut: its planning regions, which are the Census county equivalents since 2022) cut at
30 characters.

Real run (October 2026 file → scratch registry, 2.8 s): 7,368 lease rows; 7,031 leases written; 6,994 `lease.comp`
facts, 7,031 each of `lease.rentable_area_sf`, `lease.commencement_date`, `lease.expiration_date`, and 6,484
`lease.landlord`; 34,571 facts in all, all passing `fact_validate`. Skipped: 194 rows with no address or state, 143
with no RSF. No comp for 37 leases whose rent per RSF is outside $2 to $250. Lessors dropped by `is_organization`: 547
(natural persons and trusts, plus about 70 airports, towns and the Postal Service that the conservative rule also
reads as non-organisations). Building IDs for 6,794 leases. Counts by state and metro: [../../lease-comps.md](../../lease-comps.md).

## What is not claimed

- **The tenant is the federal government and the rent is the current annual rent.** The file gives no starting rent,
  escalations, free rent, TI or commissions. Every comp's `notes` say GSA leases are not market comps for every use.
- "Percent Building" and "Latest Action affecting Term" are GSA's own labels; the adapter maps the latter to `comp_type`
  (`New`, `New/Replacing` → new; `Renewal`, `Succeeding` → renewal; `Extension`; `Holdover`; `Superseding` → other)
  and does not interpret "Percent Building". The renewal option _term_ is not stored: the file does not say whether
  it is per option or in total.
- Property type is the largest of office, warehouse and special in GSA's split.
- A building ID needs a house number, a ZIP code and a county name found in the Census table; 237 leases lack one.

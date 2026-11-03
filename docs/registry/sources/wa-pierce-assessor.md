# wa-pierce-assessor: Pierce County, Washington (FIPS 53053)

Review record for the FactLot Registry (data policy §5). Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/wa/wa-pierce-assessor.json`](../../../registry/sources/wa/wa-pierce-assessor.json).
Adapter: `python/src/factlot/registry/adapters/wa_pierce.py` (account system `pierce_parcel`); tests:
`python/tests/test_adapter_wa_pierce.py`. Tier 2, west region ([`../tier2/west.md`](../tier2/west.md)).

## Publisher and URLs

- Publisher: Pierce County Assessor-Treasurer. Page: <https://www.piercecountywa.gov/736/Data-Downloads>
  ("We are pleased to offer you online access to the Assessor-Treasurer's Office property information ...
  Data downloads contain zipped, pipe ("|") delimited text files and are updated weekly.").
- The page frames the Data Mart, <https://online.co.pierce.wa.us/cfapps/atr/datamart/downloads.cfm>, which lists
  nine tables with the extract date (10/30/2026) and size, each with a "Data" link
  (`https://online.co.pierce.wa.us/datamart/<table>.zip`) and a "Description" PDF
  (`https://online.co.pierce.wa.us/cfapps/atr/datamart/metadata/<table>.pdf`):

  | Table               | Size (listed) | Read by the adapter                      |
  | ------------------- | ------------: | ---------------------------------------- |
  | tax_account         |        8.7 MB | yes (primary: use code, address, values) |
  | appraisal_account   |        6.1 MB | optional (land area)                     |
  | improvement         |        3.8 MB | optional (building area)                 |
  | improvement_builtas |        4.4 MB | optional (year built)                    |
  | improvement_detail  |        9.8 MB | no                                       |
  | land_attribute      |        2.0 MB | no                                       |
  | sale                |       19.9 MB | no                                       |
  | seg_merge           |        0.7 MB | no                                       |
  | tax_description     |        9.8 MB | no                                       |

## Terms, license, robots

- The only stated terms are the disclaimer on the Data Downloads page: "Neither Pierce County nor the
  Assessor-Treasurer's Office makes any warranty, express or implied, with regard to the accuracy, reliability or
  timeliness of this data, and shall not be held liable for losses caused by its use. Data is provided for
  informational purposes only, and may be incomplete for determination of value." No license, no
  redistribution or AI-use statement, no click-through, no acknowledgement of RCW 42.56.070 (compare
  [wa-king-assessor.md](wa-king-assessor.md)). The records are public under RCW 42.56.
- RCW 42.56.070(9) bars agencies from releasing lists of individuals for commercial purposes. The Data Mart
  tables carry **no owner or taxpayer names**, so they are not a list of individuals (the only name field is the
  parcel's Business Name, which is not read).
- The County's Copyright Notices page (<https://www.piercecountywa.gov/site/copyright>) draws its text with
  JavaScript and returned no readable text to the collector's client; its content is unknown (see Gates).
- robots.txt: `www.piercecountywa.gov` blocks Baiduspider and Yandex and disallows `/activedit`, `/admin`, `/search`
  and similar, not `/736/`; `online.co.pierce.wa.us/robots.txt` answers HTTP 404 (nothing disallowed).
- **Client note.** `curl` (HTTP/2) was answered `403` with a Cloudflare "Just a moment..." page on
  `www.piercecountywa.gov`; Python `urllib` with the collector's user agent got `200`. The collector is not blocked.
  The Data Mart host (`online.co.pierce.wa.us`) answered both.

## What the file contains

Pipe-delimited, Latin-1, **no header row**; fields are positional per the table description PDFs (reproduced in the
adapter docstring). `tax_account.txt` has 354,188 rows and 28 fields.

- Account type (field 1): REAL, STRUC (structures on leased land), PERS (personal property), MOBIL. Only REAL is read.
- Use Code (field 4) is the County's four-digit present highest-and-best-use code; Use Description is its text. 188
  distinct (code, description) pairs occur in the table. The leading two digits follow the State's standard land use
  code (WAC 458-53-030; read 2026-11-03 at <https://app.leg.wa.gov/WAC/default.aspx?cite=458-53-030>: 11 household single
  family, 12 household 2-4 units, 13 household multiunits (5 or more), 14 residential condominiums, 16 hotels/motels,
  21-39 manufacturing, 50 condominiums other than residential, 51-59 trade, 61-69 services, 71-79 cultural,
  entertainment, recreational ...).
- Values (fields 10-13 prior year, 18-21 current year) are the County's market and taxable values; "Tax Year -
  Current" is 2027 in the 2026-10-30 extract.

### Use-code table mapped

| Codes (REAL accounts)                                                                                                                                                                                                                                       | Category | Accounts kept |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------: |
| 1305 multi-family 5+ units (2,172), 1306 high-rise (103), 1307 subsidized (12), 1308 subsidized high-rise (1)                                                                                                                                               | B        |         2,288 |
| 1600 hotels/motels; 50xx non-residential condominiums (not 5030 detached-garage, 5050 marina-slip condos); 51xx-59xx trade; 61xx-66xx and 69xx services (not 6242 cemeteries, 6910 religious services); 72xx-75xx assembly, amusements, recreation, resorts | F1       |         9,745 |
| 21xx-35xx and 39xx manufacturing                                                                                                                                                                                                                            | F2       |           497 |

Everything else is out of scope: 11xx residential, 1202-1204 duplex to fourplex, 14xx condominium units, 15xx mobile home
and RV parks, 1300 boarding houses, 17xx-18xx institutional and other residential, 41xx-49xx transportation and utilities
(right of way, parking, wells), 67xx government, 68xx education, 71xx cultural, 76xx parks, 8xxx agriculture and resource,
9xxx undeveloped and water. Accounts with a current- or prior-year `Exemption Type` beginning "Municipal Corp", "Rehabilitative
Social", "Native American", "Non-Profit", "County Owned", "State of Washington", "Public School", "Tribal Lands", "Tax Title"
are dropped; tax-relief exemptions on private property ("Multi-Family Housing", "Partial Ex Land", "Historical
Designation", "Senior/Disabled") are kept.

## Gates

None for the download: no account, login, click-through, fee or CAPTCHA. For a person:

1. Read the County's Copyright Notices page in a browser (it renders with JavaScript) and confirm it does not restrict
   redistribution of Assessor-Treasurer data. This is the one document the review could not read.
2. Confirm the reading of RCW 42.56.070(9): the tables contain no individuals' names. The County's public Property
   Tax Search (<https://atip.piercecountywa.gov/app/parcelSearch/search>) shows owners; it is an interactive application
   and is not used.
3. Confirm the mapping of the commercial-leaning codes the County uses locally (6310 general warehousing/storage 971
   accounts, 6600 contractor services 732, 6199 miscellaneous office space 698) and the exclusion of 6700-6750
   government and 6810-6870 education, which are mostly exempt but include private schools and leased public land.

## Real run (2026-11-03)

All four tables were archived by the collector (`snapshot`, 2 s between requests) as
`collected/wa-pierce-assessor/<sha16>/<name>.zip`:

- `tax_account.zip` 9,134,574 bytes, `fl:document:sha256-2a5d532998f4b078dc6d0d475b8e16c908c91fa85b7826792480fe5069ad3514`
- `appraisal_account.zip` 6,369,100 bytes, `fl:document:sha256-d7a954726b54885bd2c211b6fba13ac0d3d6fe42d8877e01da175e1c8ca64223`
- `improvement.zip` 4,026,113 bytes, `fl:document:sha256-c76c917a195b78afc7bf2fc2aa7f83944a0a7c2a418ebf7bea0d7b06ecc70832`
- `improvement_builtas.zip` 4,621,943 bytes, `fl:document:sha256-807a8ea43c805c18c7163138530f5ebecf5ca30c3cdf12d85f2d34ac6c31fc05`

```
python -m factlot.registry.adapters.wa_pierce collected/wa-pierce-assessor/2a5d532998f4b078/tax_account.zip scratch.db \
  --as-of 2026-10-30 --appraisal .../appraisal_account.zip --improvement .../improvement.zip --builtas .../improvement_builtas.zip
```

(into a scratch registry outside the repository)

- Rows read 354,188; kept 12,530 (F1 9,745, B 2,288, F2 497); out of scope 341,658; invalid 0; facts written
  120,668; organisation owners 0 (the tables have no owners); 6 s.
- Of the kept parcels: situs address 12,530; market value 12,528; land area 12,525; building area 10,230; year built 10,229.
- No entity linking is possible from this source (no owner names).

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. Each asset's sha256 was checked against the manifest and its first 16 hex characters against the name. Loaded into the Tier 2 scratch registry (one SQLite file shared by every Tier 2 source, `ct-sos-entities` first).

Assets (document id from the manifest):

- `wa-pierce-assessor__2a5d532998f4b078__tax_account.zip` (9,134,574 bytes): `fl:document:sha256-2a5d532998f4b078dc6d0d475b8e16c908c91fa85b7826792480fe5069ad3514`
- `wa-pierce-assessor__d7a954726b54885b__appraisal_account.zip` (6,369,100 bytes): `fl:document:sha256-d7a954726b54885bd2c211b6fba13ac0d3d6fe42d8877e01da175e1c8ca64223`
- `wa-pierce-assessor__c76c917a195b78af__improvement.zip` (4,026,113 bytes): `fl:document:sha256-c76c917a195b78afc7bf2fc2aa7f83944a0a7c2a418ebf7bea0d7b06ecc70832`
- `wa-pierce-assessor__807a8ea43c805c18__improvement_builtas.zip` (4,621,943 bytes): `fl:document:sha256-807a8ea43c805c18c7163138530f5ebecf5ca30c3cdf12d85f2d34ac6c31fc05`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.wa_pierce <tax_account.zip> registry.db --as-of 2026-10-30 --appraisal <appraisal_account.zip> --improvement <improvement.zip> --builtas <improvement_builtas.zip> --retrieved-at <manifest checked_at>
```

- Rows read: 354,188 rows in `tax_account.zip` (the whole county); out of scope 341,658.
- Parcels kept: **12,530** distinct commercial parcels (`B` 2,288, `F1` 9,745, `F2` 497).
- Facts written: 120,668. Seconds: 10.3. Invalid ids, errors, retired: 0, 0, 0.
- Organisation owners stored (current owner-of-record facts): 0; natural persons or withheld owners not stored (names not kept): 0. The tables carry no owner.
- Ownership links to registered entities after `link_owners()`: 0 (the only entity registry in the scratch file is `ct-sos-entities`).

## Known gaps

- No owner of record, so Pierce parcels cannot be linked to Washington entities from this source. Owners are on the
  County's interactive property search only.
- Condominium units are separate accounts (1401-1410 are out of scope as residential; 50xx commercial condominium units
  are in).
- Building area is the sum of all buildings on the parcel; year built is the largest built-as segment's. Group accounts
  (several parcels valued as one economic unit) repeat nothing but are not merged.
- The statewide layer [wa-state-parcels.md](wa-state-parcels.md) (gated on terms) covers Pierce's land use and values too,
  without area or year.

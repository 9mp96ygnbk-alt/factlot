# ct-sos-entities: Connecticut Business Registry, Business Master

Review record for data policy §5. Reviewed 2026-11-03. Machine-readable copy:
[`registry/sources/ct/ct-sos-entities.json`](../../../registry/sources/ct/ct-sos-entities.json).
Adapter: `python/src/factlot/registry/adapters/ct_sos_entities.py`; tests:
`python/tests/test_adapter_ct_sos_entities.py`.

## Publisher and URLs

- Publisher: Connecticut Office of the Secretary of the State, Business Services Division, on Open
  Data CT (`data.ct.gov`, Socrata).
- Dataset: "Connecticut Business Registry - Business Master", id `n7gp-d28j`. Landing page:
  <https://data.ct.gov/Business/Connecticut-Business-Registry-Business-Master/n7gp-d28j>; metadata:
  <https://data.ct.gov/api/views/n7gp-d28j.json>. Update frequency (metadata): daily.
- Rows: 1,305,856 on 2026-11-03 (`$select=count(*)`): Active 464,123; Forfeited 359,318; Dissolved
  320,811; Withdrawn 54,114; Revoked 46,636; Cancelled 18,823; Merged 12,716; and 20 smaller statuses.
- File (confirmed by a real request): the SODA CSV
  `https://data.ct.gov/resource/n7gp-d28j.csv?$select=<17 columns>&$order=accountnumber,name&$limit=1500000`.
  The classic `/api/views/n7gp-d28j/rows.csv?accessType=DOWNLOAD` answers 200 with an empty body and a
  deprecation header, and the full export has 57 columns (about 900 MB), so the filtered resource URL
  is used. A 20,000-row sample of the same query is 4,175,745 bytes (209 bytes a row), so the full
  file is about 270 MB: over the 50 MB limit for a local run, to be loaded by the weekly workflow.
- Related datasets, not collected: Principals `ka36-64k6` and Agents `qh2m-n44y` (mostly natural
  persons), Filing History `ah3s-bes7`, Name Change History `enwv-52we`.

## Terms, license, robots

- License: the dataset's portal metadata states license "Public Domain" (`licenseId` PUBLIC_DOMAIN).
- Terms of Use (<https://data.ct.gov/terms>), operative sentences: publishable data "shall be provided
  as a public service on an 'as is' basis"; "The State of Connecticut shall reserve the right to
  discontinue availability of content on the Connecticut Open Data Portal at any time and for any
  reason." They are disclaimers; they grant no licence and restrict nothing. AI use is not addressed.
- robots.txt (`data.ct.gov`): `Crawl-delay: 1`; `/browse` search URLs with `q=`, `category=` and
  similar parameters are disallowed; `/resource/` and `/api/` are allowed. The collector's discover
  step read the dataset page and metadata API without a refusal.
- Same open item as the other Socrata portals (`ny-dos-entities`, `co-sos-entities`): the platform's
  own terms (socrata.com) were not read.

## What the file contains

One row per business ever registered, with the columns the collector selects (names as the SODA
API spells them; the portal export uses `Business_Street` for `billingstreet`, `Business_ZIP` for
`billingpostalcode`, and so on, which the adapter also accepts): `name`, `business_type` (LLC, Stock,
Non-Stock, Limited Partnership, Religious, LLP, Statutory Trust, Unauthorized, ...), `status`,
`sub_status`, `accountnumber`, `billingstreet`, `billing_unit`, `billingcity`, `billingcountry`,
`billingpostalcode`, `billingstate`, `citizenship` (Domestic or Foreign),
`state_or_territory_formation`, `formation_place`, `date_registration`, `dissolution_date`,
`mailing_address`.

- Registry number: `accountnumber`, seven digits with leading zeros (the Salesforce `id` is not
  used). Rows of type "Unauthorized" carry `0000000`; they are not registrations and the adapter
  gives them no registry number.
- Status: the Division's status as a lower-case token (`active`, `forfeited`, `dissolved`,
  `revoked`, `withdrawn`, `merged`, `converted_out`, ...), which the registry's owner-linking
  already classifies as live or ended.
- State of formation: from `state_or_territory_formation` or `formation_place`, written as "DE",
  "Delaware" or "NEW YORK"; blank for a Domestic business means Connecticut.
- Address: the business address (`billing*`); where the Division wrote a placeholder ("No
  information provided", "NONE") the one-line `mailing_address` is used.
- Not read: the business email address and the Salesforce id (not selected), the NAICS and
  ownership-diversity flags.

## Gates

None. The same Socrata platform-terms reading as the other Open Data portals is open.

## Real run

A 20,000-row sample (the first rows by account number, which are mostly old forfeited and dissolved
companies), archived with the collector: `fl:document:sha256-ef37a3bc3d4441739f6458f90109cf6cec1398cbc19c89c85ff537e0c0a2974d`,
4,175,745 bytes, retrieved 2026-11-03T07:42:19Z. Loaded with `python -m factlot.registry.adapters.ct_sos_entities ... --no-link`
in 2.9 seconds: 19,980 entities kept, 20 skipped (placeholder account number), 99,606 facts. Status:
forfeited 8,734, dissolved 6,961, active 1,366, revoked 1,127, withdrawn 968, merged 813; formed in CT
17,720, DE 864, NY 504, MA 220, NJ 120; 19,693 with an address. A full-file run was not made (about 270
MB).

## Full load (2026-11-03)

Release `data-2026-11-03-41603209834` (draft, maintainers only) of `9mp96ygnbk-alt/factlot`. The asset's sha256 was checked against the manifest and its first 16 hex characters against the name. This is the first source loaded into the Tier 2 scratch registry.

Asset (document id from the manifest):

- `ct-sos-entities__af36325e01b0e6b3__n7gp-d28j.csv` (295,208,099 bytes): `fl:document:sha256-af36325e01b0e6b3e32615d8ef7d6da4adc7e15d4d74b0085b0dee18b7771f90`

Command:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.ct_sos_entities <csv> registry.db --as-of 2026-11-03 --no-link --retrieved-at 2026-11-03T08:31:48+00:00
```

Owner linking was run once for the whole scratch registry afterwards (`purge_person_owners()` removed 0 facts; `link_owners()` result below), not per source.

- Rows read: 1,305,856 (the whole dataset, `$limit=1500000`).
- Entities kept: **1,305,836**; skipped 20 (placeholder account number); facts written 6,439,761; seconds 250.1. Errors and retired: 0, 0.
- Status (current facts): active 464,117, forfeited 359,318, dissolved 320,811, withdrawn 54,114, revoked 46,636, cancelled 18,823. Formed in: CT 1,096,449, DE 85,512, NY 26,002, MA 11,817, CA 6,767. 1,233,186 entities have a mailing address.
- Owner linking over the whole scratch registry (all 531,005 parcels of the 19 Tier 2 sources against these entities): `linked` 1,881, `linked_by_standing` 45, `ambiguous` 19, `cross_state` 10,435, `queued_for_review` 5,833, `unmatched` 193,757. 1,926 ownership links are current, all on parcels in other states whose owner of record is a Connecticut-registered entity (no Connecticut parcel source is loaded).

## Known gaps

- Only the registered legal name and addresses are kept; the Division's principals and agents are
  not collected because they are natural persons.
- The first rows by account number are old; the weekly full load is needed for the 464,123 active
  entities that matter for owner linking.
- Reserved and pending statuses ("Reserved", "Pending Filing", "Recorded") are slugged but have no
  live-or-ended classification in the registry.

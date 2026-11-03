# Source catalog: Tier 1 (reviewed 2026-11-02)

Tier 2 (61 more counties, reviewed 2026-11-03) has its own index: [../tier2/README.md](../tier2/README.md).

One review record per source lives in this folder; the machine-readable config for the collector
is under [`registry/sources/<state>/`](../../../registry/sources/). **Verified** means a person
can rely on the recorded terms, the file URLs were confirmed by a real download, and the licence
permits redistribution of the facts (data policy §5). **Gated** sources have an adapter where a
file layout was published, but nothing is collected until the gate is cleared by the founder.

Counts are from real runs on the publisher's full files (2026-11-02/03). Three ArcGIS Hub
exports (DC OTR, Hennepin, DC DLCP) were fetched by the weekly workflow from GitHub's network,
because the review machine's connection drops the Hub's long transfers; every other file was
archived by the collector here. Owner links follow the jurisdiction rule (registry README, stage 1). Quality pass of 2026-11-03: the Tier 1 file holds 105,581 exact links plus 556 chosen among same-name entities because the others have ended, 725 ambiguous, 6,482 owners whose exact match exists only in another state, and 60,636 unmatched; the Texas file (all five counties and the Comptroller's entities) holds 116,484 exact links plus 6 chosen by standing, 401 ambiguous and 35,160 unmatched. The audit, the fixes and what remains are in [../quality/tier1-2026-11-03.md](../quality/tier1-2026-11-03.md).

## Appraisal rolls (parcels)

| Source                                                      | Counties                                 | Status                               | Licence                                                              | Real run (commercial parcels; organisation owners)                                   |
| ----------------------------------------------------------- | ---------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [tx-harris-cad](../texas-sources.md)                        | Harris TX                                | verified                             | public record                                                        | 87,717; 56,792 (79.7% linked to the Comptroller)                                     |
| [tx-dallas-cad](../texas-sources.md)                        | Dallas TX                                | verified                             | public record                                                        | 59,645; 33,386 (71.6% linked)                                                        |
| [tx-tarrant-ad](../texas-sources.md)                        | Tarrant TX                               | verified                             | public record; robots signals no AI training                         | 45,976 (full set, with plain-B multifamily); 30,736 (71.6% linked)                   |
| [tx-travis-cad](tx-travis-cad.md)                           | Travis TX                                | verified                             | public record                                                        | 30,555 (supplement 3, 2026-10-06); 17,972 (78.4% linked)                             |
| [tx-collin-cad](tx-collin-cad.md)                           | Collin TX                                | verified                             | public record                                                        | 18,035; 13,165 (85.4% linked; needs `mdbtools`)                                      |
| [ny-nyc-dof](ny-nyc-dof.md)                                 | New York, Kings, Queens, Bronx, Richmond | verified                             | NYC Open Data: no restrictions                                       | 164,633; 116,184 (87,825 linked to NY DOS)                                           |
| [ca-los-angeles-assessor](ca-los-angeles-assessor.md)       | Los Angeles CA                           | verified                             | county licence: copy, distribute, commercial use                     | 203,179; **no owner names** in the public file                                       |
| [ca-san-francisco-assessor](ca-san-francisco-assessor.md)   | San Francisco CA                         | verified                             | PDDL                                                                 | 19,048 (2025 roll); no owner names in the public file                                |
| [ma-boston-assessing](ma-boston-assessing.md)               | Suffolk MA (Boston only)                 | verified                             | PDDL                                                                 | 13,296; 9,255 (full file)                                                            |
| [mn-hennepin-assessor](mn-hennepin-assessor.md)             | Hennepin MN                              | verified                             | public record (Data Practices Act)                                   | 19,840; 15,436 (no MN entity source; 159 linked out of state)                        |
| [nc-mecklenburg-assessor](nc-mecklenburg-assessor.md)       | Mecklenburg NC                           | verified                             | county: right to redistribute; robots signals no AI training         | 23,686; 19,676 (no NC entity source; 247 linked out of state)                        |
| [co-denver-assessor](co-denver-assessor.md)                 | Denver CO                                | verified                             | CC BY 3.0                                                            | 13,539; 11,112 (9,529 linked to CO SOS)                                              |
| [dc-otr-real-property](dc-otr-real-property.md)             | District of Columbia                     | verified                             | CC BY 4.0                                                            | 18,077; 11,572 (8,377 linked to DC DLCP)                                             |
| [fl-dor-nal](fl-dor-nal.md)                                 | all 67 FL counties (six targeted)        | gated: terms                         | public record (ch. 119) vs. website "non-commercial"                 | sample (Union County) 148; 80                                                        |
| [il-cook-assessor](il-cook-assessor.md)                     | Cook IL                                  | gated: terms                         | no licence stated; website copyright clause                          | sample 90,073 class-5 parcels; 77 owners (address sample only)                       |
| [pa-philadelphia-opa](pa-philadelphia-opa.md)               | Philadelphia PA                          | gated: terms                         | City "reserves all rights in the database"                           | 77,286; 27,090 (whole commercial scope via the API; persons purged, not re-ingested) |
| [ga-fulton-assessor](ga-fulton-assessor.md)                 | Fulton GA                                | gated: terms                         | CC BY-SA on the site, disclaimer only on the 2025 layer              | none; live count 17,847 expected                                                     |
| [az-maricopa-assessor](az-maricopa-assessor.md)             | Maricopa AZ                              | gated: law                           | A.R.S. § 39-121.03 commercial-purpose statement (form FOR-025)       | sample 3,863; 3,206                                                                  |
| [mi-wayne-parcels](mi-wayne-parcels.md)                     | Wayne MI                                 | gated: terms                         | portal: personal, non-commercial use only                            | sample (Belleville) 235; 138                                                         |
| [va-fairfax-assessor](va-fairfax-assessor.md)               | Fairfax VA                               | gated: terms                         | disclaimer grants internal/personal use only                         | none; **no owner names** in the tables                                               |
| [wa-king-assessor](wa-king-assessor.md)                     | King WA                                  | gated: click-through                 | RCW 42.56.070 acknowledgement; website terms restrict redistribution | none                                                                                 |
| [nv-clark-assessor](nv-clark-assessor.md)                   | Clark NV                                 | gated: purchase                      | $300/month subscription plus signed request letter                   | none                                                                                 |
| [ca-alameda-assessor](ca-alameda-assessor.md)               | Alameda CA                               | gated: terms                         | free roll on the county hub with no licence stated                   | none                                                                                 |
| [ca-riverside-assessor](ca-riverside-assessor.md)           | Riverside CA                             | gated: terms                         | free subset without owners; "Public Use" undefined                   | none                                                                                 |
| [ca-san-bernardino-assessor](ca-san-bernardino-assessor.md) | San Bernardino CA                        | gated: terms                         | free files; owner and situs fields withheld                          | none; adapter not written                                                            |
| [ca-orange-assessor](ca-orange-assessor.md)                 | Orange CA                                | gated: purchase                      | in person or by written request                                      | none; adapter not written                                                            |
| [ca-san-diego-assessor](ca-san-diego-assessor.md)           | San Diego CA                             | gated: purchase                      | no bulk product; SanGIS layer behind unread terms                    | none; adapter not written                                                            |
| [ca-santa-clara-assessor](ca-santa-clara-assessor.md)       | Santa Clara CA                           | gated: purchase                      | secured master file by order form                                    | none; adapter not written                                                            |
| tx-bexar-ad                                                 | Bexar TX                                 | gated: records request               | no bulk file                                                         | none                                                                                 |
| tx-txgio-parcels                                            | Texas parcel geometry                    | gated: host blocks automated clients | CC0                                                                  | none                                                                                 |

## Entity registries (owner resolution)

| Source                                  | Status                               | Licence                                               | Real run                                                       |
| --------------------------------------- | ------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------- |
| tx-comptroller-franchise                | verified                             | public domain                                         | 3,272,057 entities; 77% of Texas owners linked (five counties) |
| [ny-dos-entities](ny-dos-entities.md)   | verified                             | OPEN-NY terms: no restrictions                        | 3,631,216 entities; 76% of NYC owners linked                   |
| [co-sos-entities](co-sos-entities.md)   | verified                             | public domain                                         | 3,132,612 entities; 86% of Denver owners linked                |
| [dc-dlcp-entities](dc-dlcp-entities.md) | verified                             | CC BY 4.0                                             | 506,305 entities; 72% of DC owners linked                      |
| [pa-sos-entities](pa-sos-entities.md)   | verified                             | public domain                                         | 2,376,226 entities; no PA parcels loaded yet                   |
| [fl-dos-entities](fl-dos-entities.md)   | gated: terms unread                  | terms pages behind a bot challenge; public SFTP route | three daily files, 8,607 entities                              |
| [nc-sos-entities](nc-sos-entities.md)   | gated: purchase                      | $750 setup + $2,000/year                              | none                                                           |
| [va-scc-entities](va-scc-entities.md)   | gated: click-through                 | consent banner; possibly $1,000/month                 | none                                                           |
| [il-sos-entities](il-sos-entities.md)   | gated: host blocks automated clients | probably free                                         | none                                                           |
| [az-sos-entities](az-sos-entities.md)   | gated: purchase                      | $75–$1,000, use-only-as-stated declaration            | none                                                           |
| [ga-sos-entities](ga-sos-entities.md)   | gated: purchase                      | $100 + $500 per access or $1,000                      | none                                                           |
| [mn-sos-entities](mn-sos-entities.md)   | gated: purchase                      | $710; no bulk resale                                  | none                                                           |
| [ma-sos-entities](ma-sos-entities.md)   | gated: purchase                      | $4,800/year by regulation                             | none                                                           |
| [ca-sos-entities](ca-sos-entities.md)   | gated: purchase                      | bulk order through bizfile account                    | none                                                           |
| [nv-sos-entities](nv-sos-entities.md)   | gated: purchase                      | bot challenge; price unconfirmed                      | none                                                           |
| [wa-sos-entities](wa-sos-entities.md)   | none                                 | extract retired in 2024                               | none                                                           |
| [mi-sos-entities](mi-sos-entities.md)   | none                                 | no bulk file; host blocks automated clients           | none                                                           |

## What the founder decides

Every "gated: terms" row is a publisher whose files are open but whose website terms do not
grant redistribution in so many words (Florida, Cook County, Philadelphia, Fulton, Wayne, Fairfax,
Alameda, Riverside, San Bernardino). The data are public records in each state, and the registry
stores no natural-person names; the decision is whether that is enough, or whether to ask each
publisher for a statement first. The purchase and click-through gates need money or a signature.

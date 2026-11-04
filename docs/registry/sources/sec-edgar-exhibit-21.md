# sec-edgar-exhibit-21: SEC EDGAR, Exhibit 21 (subsidiaries of the registrant)

Review record for the sources `sec-edgar-ex21-<CIK>` (one source per registrant; data policy §5). Reviewed 2026-11-04.
Adapter: `python/src/factlot/registry/adapters/sec_exhibit21.py`; tests: `python/tests/test_adapter_sec_exhibit21.py`; download
script: `scripts/registry/sec_edgar.py` (`exhibit21`). There is no collector config under `registry/sources/`, for the reason given
in [sec-edgar-cmbs-abs-ee.md](sec-edgar-cmbs-abs-ee.md#terms-license-robots-fair-access), which also holds the SEC's terms, the
robots.txt reading and the fair-access rules; they apply unchanged here (`data.sec.gov` is a third SEC host with the same policy).

Predicate: `entity.parent` and a `controls` relationship from the registrant ([fact model](../../fact-model.md#predicates-from-sec-filings)).
It answers the persona asks for owner-to-parent-to-sponsor chains and tenant-parent resolution (B02-P05, B06-P03 in the
[live product review](../../research/2026-11-live-product-review/appendix.md)) for the registrants chosen below. It is not a
tenant resolver: it goes from a registrant to the registered entities it lists, not from a tenant's name on a lease to its parent.

## What is read

- **Exhibit 21** of the registrant's latest Form 10-K (Item 601(b)(21) of Regulation S-K: a list of the registrant's subsidiaries
  with their jurisdictions of organisation; subsidiaries that are not significant may be omitted, and some registrants list only
  significant ones). The exhibit is found through `https://data.sec.gov/submissions/CIK<10 digits>.json` (the registrant's
  name, SIC code, state of incorporation and recent filings: the newest form `10-K`), then the filing's index page
  (`…/<accession>-index.htm`, whose Type column marks the `EX-21`/`EX-21.1` document) and the exhibit itself. Three
  requests per registrant, plus `https://www.sec.gov/files/company_tickers.json` once. No crawling, no full-text search.
- Terms, rights, rate: as in the CMBS record. About 370 requests for this source (3 per registrant, plus the ticker file), 3.5 per second at most, one stream
  (the review's 1,146 logged requests in all are counted in the CMBS record). Exhibit files: 45 MB in all.
- Rights recorded on each fact: public SEC filing, redistribution `permitted`, AI use `unknown`, attribution the SEC (EDGAR)
  and the registrant. `verified: true` for use in the registry.

## Which registrants (bounded list, chosen by hand and documented)

125 registrants were chosen from the SEC's `company_tickers.json` by ticker; 122 gave an Exhibit 21 (filed 2026-01 to 2026-11, 90 of
them in February 2026; fiscal years ended 2025-12-27 to 2026-09-26):

- **61 REITs** (owners and sponsors of the commercial, multifamily, industrial, healthcare, hotel and net-lease property that
  fills CMBS pools): ADC AMH AMT APLE ARE BRX BXP CCI CPT CUBE CUZ DEI DLR DOC DRH EGP ELS EPRT EQIX ESS EXR FCPT FR FRT GLPI GOOD GTY
  HIW HST INVH IRM KIM KRC MAA MAC NHI NNN O OHI PEB PINE PK PLD PSA REG REXR RHP SBRA SHO SLG SPG STAG SUI TRNO UDR VICI VNO
  VTR WELL WPC XHR.
- **50 retailers and other large tenants**, picked from the tenant names that recur most in the CMBS loan data (Dollar General,
  Walgreens, FedEx, Dollar Tree, Ross, CVS, Tractor Supply, Dick's, TJX, Macy's, Burlington, Best Buy, Planet Fitness, Walmart, Target,
  banks, telecoms...) and mapped by hand to the SEC registrant: AAP AAPL ACI AMC AMZN ASO AZO BAC BBWI BBY BJ BOOT BURL CMG COST CVS
  DDS DG DKS DLTR FDX FIVE GAP GOOGL HD JPM KR KSS LOW M META NKE ORLY PLNT PNC RL ROST SFM SHW T TGT TJX TMUS TSCO ULTA UPS VZ WFC WMT WSM.
  Many frequent tenants have no entry in the SEC's ticker file and cannot be resolved this way (Hobby Lobby, PetSmart, Cabela's/Bass Pro,
  Save Mart, Harvey Building Products, LA Fitness); of the 100 most frequent tenant names in the CMBS data, 36 match an SEC registrant's name by a plain
  prefix test.
- **11 healthcare operators**: ACHC BKD CHE CYH DVA EHC ENSG HCA PNTG THC UHS.
- **Not obtained:** 3 chosen registrants whose latest 10-K index lists no Exhibit 21 (NTST, OLLI, WOOF); 10 more that are not in the
  SEC's ticker file (AVB, EQR, MPW, NSA, WBA, JWN, VSCO, ODP, SEM, AMED: taken private, acquired or delisted) and were not looked up
  by remembered CIK. The list is a sample for the persona asks, not a ranking of any kind.

## Reading the exhibits

`read_subsidiaries` reads the HTML (or plain text) into rows and takes, per row, a name and a jurisdiction: a name beside a jurisdiction
column; `Name [Ohio]`, `Name (MN)`, `Name, a Delaware limited liability company`, `Name - Texas`; names listed under jurisdiction
headings; an `Incorporated State:` line after a name; a statement that every subsidiary is of one state "except as noted"; dates after
the jurisdiction (`Maryland (6/28/2005)`) and `, U.S.` tags are removed; titles, headers, prose and trade-name (`Also Doing Business As`)
sections are skipped. Of the 122 files: **27,483 subsidiary lines**, 26,717 (97.2%) with a jurisdiction: 24,404 in a US state, 2,313 elsewhere,
766 with none (not linked). Four exhibits give no US state at all (KIM lists EINs, SHO and CHE give names only, JPM gives countries). 61% of the
lines are Delaware entities and 11% are foreign or unplaced.

## Matching rule and confidence

A subsidiary becomes `entity.parent` of a registry entity when the **normalized names are equal** (`normalize_name`: case, punctuation,
LLC/L.L.C. and similar suffix spellings, a trailing DBA name; nothing fuzzy) **and the exhibit's jurisdiction is the entity's registry state
(confidence 0.9: a state registry keeps legal names unique) or the state of formation the registry records for it (0.85: a
foreign registration)**. A legal entity registered in several states is one registry entity per state and is linked in each registry that
holds it. Skipped and counted: no same-name entity in a loaded registry, same name but another jurisdiction, two or more live same-name
entities in one registry (ambiguous), an entity that has ended (dissolved, revoked...), the registrant's own title line. The fact's
locator is the accession, file and row of the exhibit line; the document cited is the exhibit's snapshot (SHA-256).

**Natural persons.** Exhibit 21 lists legal entities. Only a name that equals the name of an entity already in a registry is used,
and the registry holds organisations only; no other subsidiary name is stored.

## Real run (2026-11-04)

Into a scratch registry holding five state entity registries from the collector's archives (12,918,460 entities: Texas Comptroller
3,272,073, New York DOS 3,631,216, Colorado SOS 3,132,612, Pennsylvania 2,376,248, DC DLCP 506,311; the owner-of-record linking
step was not run), one source per registrant, 4.5 minutes:

| Count                                                                      |                               |
| -------------------------------------------------------------------------- | ----------------------------: |
| registrants with an Exhibit 21 / with at least one linked subsidiary       |                     122 / 109 |
| subsidiary lines read / in a US state                                      |               27,483 / 24,404 |
| lines in a registry state loaded (TX, NY, CO, PA, DC)                      |                  1,272 (4.6%) |
| subsidiaries linked / links (one per registry entity)                      |                 2,714 / 2,996 |
| links by rule: registry state (0.9) / state of formation (0.85)            |                 1,130 / 1,866 |
| subsidiaries linked in two or more registries                              |                           275 |
| links by registry: Colorado / New York / Texas / Pennsylvania / DC         | 1,054 / 1,036 / 775 / 122 / 9 |
| links by group: REITs / healthcare operators / retailers and other tenants |           1,340 / 1,145 / 511 |
| no same-name entity in a loaded registry / name found, other jurisdiction  |                18,590 / 2,998 |
| ambiguous / entity ended / registrant's own title line                     |                  2 / 78 / 104 |
| subsidiaries with two registrants (joint ventures)                         |                             2 |

The 13 registrants with no link: AAPL, ARE, CPT, DEI, ESS, HIW, KRC, PNC, REXR (their subsidiaries are in states whose entity files are not loaded,
or in Delaware only) and KIM, SHO, JPM, CHE (no US jurisdiction in the exhibit). `registry_get` on a subsidiary shows `entity.parent` and the
`controls` link; on the registrant (`fl:entity:us-sec:<CIK>`, also found by name and through the `sec-cik` crosswalk) it lists the
subsidiaries it controls. 300 sampled `entity.parent` facts passed `fact_validate`.

## Known gaps

- The links are only as complete as the entity files loaded: the registry holds no Delaware entity file and no California,
  Florida or Nevada file, so 61% of the lines (Delaware) match only where the company is also registered in TX, NY, CO, PA or DC. A national
  run needs more state files.
- "Subsidiary" covers indirect subsidiaries and many registrants list only significant ones, so a missing link proves nothing, and the
  registrant is the _listed ultimate parent_, not necessarily the immediate one. Joint ventures can have two registrants.
- Exhibit layouts vary and the parser keeps only lines it can read with a name and a jurisdiction; 766 lines had none. Name changes after
  the filing, mergers and entities that merged away are not tracked beyond the entity's registry status.
- Only the latest 10-K of each registrant (no history); a later 10-K replaces the registrant's links.
- `fl:entity:us-sec:<CIK>` is a new entity-ID jurisdiction (the SEC's Central Index Key). A registrant's LEI or state file number is not
  used; `docs/id-spec.md` does not yet list `us-sec`.

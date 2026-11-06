# wi-statewide-parcels audit, 2026-11-06

Wisconsin Statewide Parcel Map Initiative V12, commercial and manufacturing parcels
(PROPCLASS containing class 2 or class 3), all 72 counties. Audited per county from a
scratch registry built with the existing `wi_statewide` adapter. As-of date 2026-06-30.

**70 counties pass and 2 fail.** Failures: Outagamie (55087) and Racine (55101).
Both match the record's parcel count when a county's pages are re-read together. They fail
because a parcel id that appears on two pages is kept once at ingest and yielded again when
the later page is re-read by itself. Milwaukee (55079) passes: 16,580 parcels, and its nine
archived pages are byte-identical to the 2026-11-03 record.

Statewide distinct parcels: **185,754** (record 185,754). Features read: **185,994**.
F1 175,835, F2 9,919. The 71 counties other than Milwaukee: 169,174 distinct parcels
(record 169,174). Person-like owner facts: **0**. Audit-tool violations: **0**, with the
re-read gap in Blockers. Audit warnings: 17 implausible land areas, all Milwaukee, and
26,301 parcels with no situs address.

## Result by county

Re-read count is the distinct parcels `read_roll` yields from that county's pages together
(the same de-duplication the ingest uses). As-of is the V12 release date on every snapshot.
`date(2026-11-04) - date(2026-06-30)` is 127 days, under the 400-day bar. The audit's own
age against 2026-11-06 is 129 days.

| FIPS  | County          |      Record |     Scratch |     Re-read | As of      | Result              |
| ----- | --------------- | ----------: | ----------: | ----------: | ---------- | ------------------- |
| 55001 | Adams           |         721 |         721 |         721 | 2026-06-30 | PASS                |
| 55003 | Ashland         |         834 |         834 |         834 | 2026-06-30 | PASS                |
| 55005 | Barron          |       2,331 |       2,331 |       2,331 | 2026-06-30 | PASS                |
| 55007 | Bayfield        |       1,072 |       1,072 |       1,072 | 2026-06-30 | PASS                |
| 55009 | Brown           |       7,212 |       7,212 |       7,212 | 2026-06-30 | PASS                |
| 55011 | Buffalo         |         765 |         765 |         765 | 2026-06-30 | PASS                |
| 55013 | Burnett         |         799 |         799 |         799 | 2026-06-30 | PASS                |
| 55015 | Calumet         |       1,547 |       1,547 |       1,547 | 2026-06-30 | PASS                |
| 55017 | Chippewa        |       2,712 |       2,712 |       2,712 | 2026-06-30 | PASS                |
| 55019 | Clark           |       1,561 |       1,561 |       1,561 | 2026-06-30 | PASS                |
| 55021 | Columbia        |       2,485 |       2,485 |       2,485 | 2026-06-30 | PASS                |
| 55023 | Crawford        |         916 |         916 |         916 | 2026-06-30 | PASS                |
| 55025 | Dane            |      14,137 |      14,137 |      14,137 | 2026-06-30 | PASS                |
| 55027 | Dodge           |       2,940 |       2,940 |       2,940 | 2026-06-30 | PASS                |
| 55029 | Door            |       2,929 |       2,929 |       2,929 | 2026-06-30 | PASS                |
| 55031 | Douglas         |       2,432 |       2,432 |       2,432 | 2026-06-30 | PASS                |
| 55033 | Dunn            |       1,504 |       1,504 |       1,504 | 2026-06-30 | PASS                |
| 55035 | Eau Claire      |       3,474 |       3,474 |       3,474 | 2026-06-30 | PASS                |
| 55037 | Florence        |         272 |         272 |         272 | 2026-06-30 | PASS                |
| 55039 | Fond du Lac     |       3,705 |       3,705 |       3,705 | 2026-06-30 | PASS                |
| 55041 | Forest          |         631 |         631 |         631 | 2026-06-30 | PASS                |
| 55043 | Grant           |       2,367 |       2,367 |       2,367 | 2026-06-30 | PASS                |
| 55045 | Green           |       1,482 |       1,482 |       1,482 | 2026-06-30 | PASS                |
| 55047 | Green Lake      |       1,109 |       1,109 |       1,109 | 2026-06-30 | PASS                |
| 55049 | Iowa            |       1,195 |       1,195 |       1,195 | 2026-06-30 | PASS                |
| 55051 | Iron            |         547 |         547 |         547 | 2026-06-30 | PASS                |
| 55053 | Jackson         |         969 |         969 |         969 | 2026-06-30 | PASS                |
| 55055 | Jefferson       |       3,013 |       3,013 |       3,013 | 2026-06-30 | PASS                |
| 55057 | Juneau          |       1,082 |       1,082 |       1,082 | 2026-06-30 | PASS                |
| 55059 | Kenosha         |       4,031 |       4,031 |       4,031 | 2026-06-30 | PASS                |
| 55061 | Kewaunee        |         839 |         839 |         839 | 2026-06-30 | PASS                |
| 55063 | La Crosse       |       4,068 |       4,068 |       4,068 | 2026-06-30 | PASS                |
| 55065 | Lafayette       |         903 |         903 |         903 | 2026-06-30 | PASS                |
| 55067 | Langlade        |         962 |         962 |         962 | 2026-06-30 | PASS                |
| 55069 | Lincoln         |       1,169 |       1,169 |       1,169 | 2026-06-30 | PASS                |
| 55071 | Manitowoc       |       2,917 |       2,917 |       2,917 | 2026-06-30 | PASS                |
| 55073 | Marathon        |       4,711 |       4,711 |       4,711 | 2026-06-30 | PASS                |
| 55075 | Marinette       |       1,980 |       1,980 |       1,980 | 2026-06-30 | PASS                |
| 55077 | Marquette       |         610 |         610 |         610 | 2026-06-30 | PASS                |
| 55078 | Menominee       |          15 |          15 |          15 | 2026-06-30 | PASS                |
| 55079 | Milwaukee       |      16,580 |      16,580 |      16,580 | 2026-06-30 | PASS                |
| 55081 | Monroe          |       1,762 |       1,762 |       1,762 | 2026-06-30 | PASS                |
| 55083 | Oconto          |       1,700 |       1,700 |       1,700 | 2026-06-30 | PASS                |
| 55085 | Oneida          |       2,393 |       2,393 |       2,393 | 2026-06-30 | PASS                |
| 55087 | Outagamie       |       5,734 |       5,734 |       5,734 | 2026-06-30 | FAIL                |
| 55089 | Ozaukee         |       2,673 |       2,673 |       2,673 | 2026-06-30 | PASS                |
| 55091 | Pepin           |         426 |         426 |         426 | 2026-06-30 | PASS                |
| 55093 | Pierce          |       1,260 |       1,260 |       1,260 | 2026-06-30 | PASS                |
| 55095 | Polk            |       1,836 |       1,836 |       1,836 | 2026-06-30 | PASS                |
| 55097 | Portage         |       2,380 |       2,380 |       2,380 | 2026-06-30 | PASS                |
| 55099 | Price           |         977 |         977 |         977 | 2026-06-30 | PASS                |
| 55101 | Racine          |       5,095 |       5,095 |       5,095 | 2026-06-30 | FAIL                |
| 55103 | Richland        |         657 |         657 |         657 | 2026-06-30 | PASS                |
| 55105 | Rock            |       4,324 |       4,324 |       4,324 | 2026-06-30 | PASS                |
| 55107 | Rusk            |         860 |         860 |         860 | 2026-06-30 | PASS                |
| 55109 | St. Croix       |       3,057 |       3,057 |       3,057 | 2026-06-30 | PASS                |
| 55111 | Sauk            |       4,305 |       4,305 |       4,305 | 2026-06-30 | PASS                |
| 55113 | Sawyer          |       1,721 |       1,721 |       1,721 | 2026-06-30 | PASS                |
| 55115 | Shawano         |       1,696 |       1,696 |       1,696 | 2026-06-30 | PASS                |
| 55117 | Sheboygan       |       3,669 |       3,669 |       3,669 | 2026-06-30 | PASS                |
| 55119 | Taylor          |         887 |         887 |         887 | 2026-06-30 | PASS                |
| 55121 | Trempealeau     |       1,607 |       1,607 |       1,607 | 2026-06-30 | PASS                |
| 55123 | Vernon          |       1,153 |       1,153 |       1,153 | 2026-06-30 | PASS                |
| 55125 | Vilas           |       1,726 |       1,726 |       1,726 | 2026-06-30 | PASS                |
| 55127 | Walworth        |       3,772 |       3,772 |       3,772 | 2026-06-30 | PASS                |
| 55129 | Washburn        |         930 |         930 |         930 | 2026-06-30 | PASS                |
| 55131 | Washington      |       3,482 |       3,482 |       3,482 | 2026-06-30 | PASS                |
| 55133 | Waukesha        |       8,981 |       8,981 |       8,981 | 2026-06-30 | PASS                |
| 55135 | Waupaca         |       2,095 |       2,095 |       2,095 | 2026-06-30 | PASS                |
| 55137 | Waushara        |       1,107 |       1,107 |       1,107 | 2026-06-30 | PASS                |
| 55139 | Winnebago       |       5,286 |       5,286 |       5,286 | 2026-06-30 | PASS                |
| 55141 | Wood            |       2,675 |       2,675 |       2,675 | 2026-06-30 | PASS                |
|       | **72 counties** | **185,754** | **185,754** | **185,754** |            | **70 pass, 2 fail** |

Pass means: the record count, the scratch count, and the county-level re-read are equal;
every snapshot file for that county re-reads to the parcels that snapshot holds; as-of is
inside 400 days before 2026-11-04; person-like owner facts are 0.

### Failing counties

- **Outagamie (55087).** County-level re-read is 5734 and matches the scratch count and the 2026-11-03 record, but the per-file re-read does not. Snapshot index 82 holds 1996 parcels and re-reads to 1997; index 83 holds 1738 and re-reads to 1779. Those extra ids repeat a parcel id from an earlier Outagamie page. The adapter keeps the first row; audit re-read runs each file alone. One repeated id is classed F2 on the kept row and F1 on the later row. The same re-read flags APNs rail (3 in-scope rows, 1 kept) and building (28 in-scope rows, 1 kept) because they are only letters, which the audit treats as a column heading. Both are inside the record's 5734. Adapter not modified.
- **Racine (55101).** County-level re-read is 5095 and matches the scratch count and the 2026-11-03 record, but the per-file re-read does not. Snapshot index 93 holds 1977 parcels and re-reads to 1980; index 94 holds 1150 and re-reads to 1158. Those extra ids repeat a parcel id from an earlier Racine page. The adapter keeps the first row; audit re-read runs each file alone. Adapter not modified.

### Milwaukee

Record, scratch, and county-level re-read are 16580. All 9 snapshot files re-read to the parcels that snapshot holds (2 repeated parcel ids sit inside one page and are dropped on both sides). The 9 file sha256 values match the 2026-11-03 source record. as-of 2026-06-30 is 127 days before 2026-11-04. Person-like owner facts: 0. Seventeen land areas over 500,000,000 square feet are an audit warning, not a violation.

Calumet (55015) has 11 repeated rows and Shawano (55115) has 25, each inside a single page.
Ingest and the per-file re-read both drop them, so those counties pass. Their distinct counts
are the record's counts (Calumet 1,547 from 1,558 features; Shawano 1,696 from 1,721).

## What was loaded

The collector snapshot refused the host. From `snapshot.log` and
`collector-refused-manifest.jsonl` (130 lines, 2026-11-06):

```
refused: refusing services3.arcgis.com: resolves to non-public address 198.18.0.1
```

`socket.getaddrinfo("services3.arcgis.com", 443)` returned only `198.18.0.1`. The collector
refuses any address that `ipaddress.is_global` rejects. Direct HTTPS to the same public URLs
returned HTTP 200. The 130 configured file URLs were then saved with User-Agent
`FactLotRegistryBot/0.4 (+https://factlot.com/registry; contact@factlot.com)` and at least 2
seconds between request starts, which is the config `min_interval`. A 403, 401, or 429 would
have stopped the download. None occurred. The download ran from
`2026-11-06T23:04:47.617290+00:00` through `2026-11-06T23:16:23.611800+00:00`.

Every page's `Last-Modified` header was `Tue, 30 Jun 2026 21:21:29 GMT`. Manifest sha256
matched the file bytes on 130 of 130 pages. Feature count 185,994. No county's last page was
2,000 features with `exceededTransferLimit` true, so the configured offsets did not drop a tail.
Milwaukee's nine sha256 values match the document ids in
`docs/registry/sources/wi-statewide-parcels.md` (full load, 2026-11-03), including the first page
`34c856ac2bda2291cba9496d81d613d3b07cccfc1b4f85eeb12bdc58565ef740` at 1,098,087 bytes.

Build, pages in manifest order, one `--retrieved-at` because the adapter CLI takes one:

```
PYTHONPATH=python/src python3 -m factlot.registry.adapters.wi_statewide <130 files in manifest index order> /workspace/surge/_data/a2-wi-statewide/scratch.db --as-of 2026-06-30 --retrieved-at 2026-11-06T23:04:47.617290+00:00
```

```
{
  "seen": 185754,
  "kept": 185754,
  "skipped_out_of_scope": 0,
  "skipped_invalid": 0,
  "owners_person_or_withheld": 60492,
  "facts_written": 1685811,
  "retired": 0,
  "errors": []
}
```

`maintain --all` then reported 185,754 parcels, 72 counties, 130 snapshots, 1,685,811 facts,
0 person-owner facts removed, 159,453 address-index rows, and 0 ownership links
(`unmatched` 125,238). `rollup_buildings` grouped 7,339 parcels into 1,763 buildings.

The 2026-11-03 record's fact total for the two loads is 155,893 + 1,528,624 = 1,684,517, and
its organisation-owner total is 124,561 (Milwaukee 11,764). This load stored 1,685,811 facts
and 125,238 organisation owners (Milwaukee 11,808). Milwaukee's pages are the same bytes, so
the gap is in owner classification under the current `is_organization` rule, not in the parcel
set. Parcel counts were not corrected.

## Commercial code mapping

Publisher code list: V12 schema, PROPCLASS section,
<https://www.sco.wisc.edu/parcels/data/assets/V12/V12_Wisconsin_Statewide_Parcels_Schema_Documentation.pdf>
(HTTP 200, Last-Modified Thu, 10 Sep 2026, read 2026-11-06). The schema says:

> The General class of property for taxable real estate, as specified in Wisconsin s. 70.32(2)(a).
> Wisconsin law requires assessors to classify land on the basis of use. Sometimes this involves a judgment of the
> predominant use. There are eight statutory classifications for real property.

Accepted domains in that PDF:

| Code | Schema meaning         | Adapter      |
| ---- | ---------------------- | ------------ |
| 1    | Residential            | out of scope |
| 2    | Commercial             | F1           |
| 3    | Manufacturing          | F2           |
| 4    | Agricultural           | out of scope |
| 5    | Undeveloped            | out of scope |
| 5M   | Agricultural forest    | out of scope |
| 6    | Productive Forest Land | out of scope |
| 7    | Other                  | out of scope |

Wis. Stat. 70.32(2)(a), <https://docs.legis.wisconsin.gov/statutes/statutes/70/32>, read 2026-11-06:

> The assessor shall segregate into the following classes on the basis of use ... 1. Residential. 2. Commercial. 3. Manufacturing. 4. Agricultural. 5. Undeveloped. 5m. Agricultural forest. 6. Productive forest land. 7. Other.

The statute does not define an apartment class. Manufacturing property is assessed under s. 70.995.

Wisconsin Property Assessment Manual, <https://www.revenue.wi.gov/Documents/wpam26.pdf>
(HTTP 200, 12,391,820 bytes, Last-Modified Wed, 17 Dec 2025, read 2026-11-06), Chapter 7:

> Apartment buildings of up to three units are also classified as residential.

> Apartment buildings of four or more units, hotels, summer resorts, and mobile home courts should be classified as commercial property.

Chapter 7 also lists "Apartments of four or more units" and "Stores with apartments above the store(s)"
as commercial. Chapter 13:

> Apartment houses of four or more units and office buildings are also included in this category. Apartment houses of less than four units are classified as residential since they are not normally purchased as an investment. This classification will also include vacant land, and parcels with improvements, for which the most likely use is commercial.

The adapter maps a PROPCLASS value to F1 when `2` is among the comma-separated classes, otherwise
to F2 when `3` is among them. This load's filter is `PROPCLASS LIKE '%2%' OR PROPCLASS LIKE '%3%'`,
so a blank PROPCLASS with only an AUXCLASS never arrives. Observed values in the 185,994 features
(49 distinct strings):

| PROPCLASS      | Features | Kept as |
| -------------- | -------: | ------- |
| `2`            |  164,305 | F1      |
| `3`            |    9,929 | F2      |
| `2,4`          |    1,996 | F1      |
| `1,2`          |    1,724 | F1      |
| `2,5`          |    1,508 | F1      |
| `2,6`          |    1,207 | F1      |
| `2,4,5`        |    1,121 | F1      |
| `2,5,6`        |      766 | F1      |
| `2,4,5,5M`     |      611 | F1      |
| `2,4,5M`       |      513 | F1      |
| `2,4,5,7`      |      309 | F1      |
| `1,2,4`        |      263 | F1      |
| `1,2,4,5`      |      238 | F1      |
| `1,2,6`        |      230 | F1      |
| `1,2,4,5,5M`   |      184 | F1      |
| `2,4,7`        |      177 | F1      |
| `1,2,5`        |      173 | F1      |
| `1,2,5,6`      |      163 | F1      |
| `2,4,5,5M,7`   |      126 | F1      |
| `1,2,4,5M`     |      118 | F1      |
| `2,4,6`        |       50 | F1      |
| `2,4,5M,7`     |       48 | F1      |
| `2,4,5,6`      |       39 | F1      |
| `2,5M`         |       32 | F1      |
| `2,5,5M`       |       30 | F1      |
| `1,2,4,5,6`    |       26 | F1      |
| `2,7`          |       17 | F1      |
| `2,3`          |       14 | F1      |
| `2,5,7`        |       13 | F1      |
| `1,2,5,5M`     |       12 | F1      |
| `1,2,4,6`      |        7 | F1      |
| `1,2,4,7`      |        6 | F1      |
| `2,4,6,7`      |        5 | F1      |
| `1,2,4,5,7`    |        5 | F1      |
| `2,4,5,6,7`    |        4 | F1      |
| `3,5`          |        3 | F2      |
| `1,2,4,5M,7`   |        3 | F1      |
| `2,5M,6`       |        3 | F1      |
| `2,5,6,7`      |        3 | F1      |
| `3,4,5`        |        2 | F2      |
| `1,2,5M`       |        2 | F1      |
| `2,6,7`        |        2 | F1      |
| `1,2,7`        |        1 | F1      |
| `2,4,5M,6`     |        1 | F1      |
| `2,5M,7`       |        1 | F1      |
| `2,3,4`        |        1 | F1      |
| `1,2,4,5,5M,7` |        1 | F1      |
| `1,3`          |        1 | F2      |
| `1,2,4,5,5M,6` |        1 | F1      |

Ambiguous codes, flagged and still loaded when they contain 2 or 3:

- **Mixed-use.** 11,760 features have a comma-separated PROPCLASS. The schema says each class is listed once, with no spaces, and that classification can be a judgment of predominant use. The adapter does not split the parcel.
- **Both commercial and manufacturing.** 15 features contain both `2` and `3` (`2,3` is 14 and `2,3,4` is 1). The adapter maps them to F1 because `2` is present.
- **Apartments.** There is no apartment code. Buildings of up to three units are class 1 and are outside this load. Buildings of four or more units are class 2 and cannot be separated from other commercial parcels. The layer has no unit count.
- **Vacant commercial land.** Class 2 includes vacant land whose most likely use is commercial (WPAM Chapter 13). The schema has no vacant-commercial code, so vacant and improved commercial parcels are the same F1 class.
- **AUXCLASS on an in-scope row.** 1,548 in-scope features, in 71 of the 72 counties, also have an auxiliary class: X4 558, AW 338, AWO 302, W6 176, W8 74, X2 31, X3 29, X1 12, W5 11, W7 5, W4 2, and 10 features with a comma-joined auxiliary code (W6,W8 2; W6,X4 2; X4,W6; W5,X4; X2,W5; X2,X4; X3,X4; W6,X3,X4). Schema meanings: X1 Federal, X2 State, X3 County, X4 Other exempt; W1–W9 forest programs; AW/AWO assessed with another parcel under s. 70.23(2). These rows are in the load because PROPCLASS still contains 2 or 3.
- **Outagamie class conflict.** One repeated parcel id is F2 on the row the adapter keeps and F1 on a later page. The kept category is F2. The parcel id is not printed.

`PARCELFIPS` is the contributing county and is not the county the adapter uses. In-scope features
where it differs from `CONAME`: Calumet 162 with PARCELFIPS 087 and 58 with 139; Winnebago 74 with
PARCELFIPS 087. They stay in the CONAME county (Table B-1).

Texas class codes B, F1, and F2 are not a crosswalk for these values. F1 and F2 above are only the
adapter's names for Wisconsin class 2 and class 3.

## Commercial-universe denominator

Wisconsin DOR publishes a Statement of Assessment per municipality, not a single county parcel roll.
Page <https://www.revenue.wi.gov/Pages/SLF/SOA.aspx> (HTTP 200, Last-Modified Fri, 06 Nov 2026 23:01:08 GMT,
read 2026-11-06). `robots.txt` disallows `/_layouts/`, `/_vti_bin/`, and `/_catalogs/`. The page and the
PDF paths below are outside those prefixes. The page says:

> SOA summarizes the following information for each tax district: Aggregate assessed value for each statutory class of real and personal property. Parcel counts for each of the statutory classes of real and personal property. Acreage of each type of exempt real property. ... The final SOAs are listed below. Note: If you submit an amended SOA to DOR, we will process it and you may use the corrected values to calculate tax rates. However, we will not update the final SOAs listed below.

The 2025 county PDFs are `https://www.revenue.wi.gov/SLFReportscotvc/2025SOA{COUNTY}.PDF`. All 72 were
downloaded (HTTP 200, `%PDF`). Each municipal "STATEMENT OF ASSESSMENT FOR 2025" block contributes
one Line 2 `COMMERCIAL - Class 2` and one Line 3 `MANUFACTURING - Class 3`. Col A is the first integer
on that line (the form's total parcel count). Col B is a second parcel-like count. Col C moves like
acres and is not used as the denominator. There is no county recapitulation page in these files, so
the municipal lines are the whole county. Parser problems: 0. The same page also links 72 `2026SOA`
PDFs. Those were not downloaded. V12's schema says TAXROLLYEAR should be 2025, so the 2025 SOA is the
assessment year this layer points at.

Statewide Col A: commercial **183,173**, manufacturing **9,823**.
GIS distinct parcels are F1 175,835 and F2 9,919. The two series count different things (tax-roll
parcels on the SOA versus GIS features whose PROPCLASS contains 2 or 3, after within-county
de-duplication). They are not forced to match. Marinette (55075) and Menominee (55078) are the only
counties where both columns match F1 and F2. Manufacturing Col A equals F2 in 25 counties.
Milwaukee is the large commercial gap: SOA Col A 21,092 versus GIS F1 15,726, while manufacturing
is 853 versus F2 854.

| FIPS  | County        | Statements | Class 2 Col A | Class 3 Col A |      GIS F1 |    GIS F2 |
| ----- | ------------- | ---------: | ------------: | ------------: | ----------: | --------: |
| 55001 | Adams         |         20 |         1,047 |            22 |         699 |        22 |
| 55003 | Ashland       |         16 |           796 |            37 |         796 |        38 |
| 55005 | Barron        |         36 |         2,220 |           112 |       2,217 |       114 |
| 55007 | Bayfield      |         29 |         1,021 |            10 |       1,060 |        12 |
| 55009 | Brown         |         25 |         6,812 |           477 |       6,745 |       467 |
| 55011 | Buffalo       |         23 |           741 |            26 |         731 |        34 |
| 55013 | Burnett       |         24 |           783 |            27 |         772 |        27 |
| 55015 | Calumet       |         21 |         1,474 |            82 |       1,450 |        97 |
| 55017 | Chippewa      |         32 |         2,572 |           181 |       2,538 |       174 |
| 55019 | Clark         |         46 |         1,458 |           138 |       1,420 |       141 |
| 55021 | Columbia      |         35 |         2,392 |           132 |       2,362 |       123 |
| 55023 | Crawford      |         22 |           868 |            45 |         867 |        49 |
| 55025 | Dane          |         60 |        13,828 |           448 |      13,693 |       444 |
| 55027 | Dodge         |         43 |         2,749 |           181 |       2,764 |       176 |
| 55029 | Door          |         19 |         2,977 |            37 |       2,893 |        36 |
| 55031 | Douglas       |         22 |         2,369 |            74 |       2,326 |       106 |
| 55033 | Dunn          |         30 |         1,452 |            83 |       1,427 |        77 |
| 55035 | Eau Claire    |         19 |         3,403 |           113 |       3,361 |       113 |
| 55037 | Florence      |          8 |           261 |            11 |         260 |        12 |
| 55039 | Fond du Lac   |         34 |         3,516 |           232 |       3,478 |       227 |
| 55041 | Forest        |         15 |           606 |            26 |         605 |        26 |
| 55043 | Grant         |         52 |         2,306 |            76 |       2,294 |        73 |
| 55045 | Green         |         24 |         1,415 |            70 |       1,412 |        70 |
| 55047 | Green Lake    |         16 |         1,063 |            54 |       1,055 |        54 |
| 55049 | Iowa          |         29 |         1,170 |            60 |       1,143 |        52 |
| 55051 | Iron          |         12 |           583 |            19 |         529 |        18 |
| 55053 | Jackson       |         27 |           908 |            59 |         911 |        58 |
| 55055 | Jefferson     |         27 |         2,874 |           157 |       2,856 |       157 |
| 55057 | Juneau        |         29 |         1,036 |            51 |       1,032 |        50 |
| 55059 | Kenosha       |         13 |         3,913 |           155 |       3,878 |       153 |
| 55061 | Kewaunee      |         14 |           809 |            42 |         796 |        43 |
| 55063 | La Crosse     |         18 |         3,926 |           183 |       3,885 |       183 |
| 55065 | Lafayette     |         28 |           877 |            36 |         867 |        36 |
| 55067 | Langlade      |         19 |           924 |            49 |         913 |        49 |
| 55069 | Lincoln       |         18 |         1,141 |            55 |       1,114 |        55 |
| 55071 | Manitowoc     |         30 |         2,715 |           237 |       2,680 |       237 |
| 55073 | Marathon      |         61 |         4,359 |           426 |       4,292 |       419 |
| 55075 | Marinette     |         25 |         1,877 |           103 |       1,877 |       103 |
| 55077 | Marquette     |         19 |           592 |            13 |         597 |        13 |
| 55078 | Menominee     |          1 |            15 |             0 |          15 |         0 |
| 55079 | Milwaukee     |         19 |        21,092 |           853 |      15,726 |       854 |
| 55081 | Monroe        |         36 |         1,662 |           112 |       1,650 |       112 |
| 55083 | Oconto        |         29 |         1,615 |            70 |       1,596 |       104 |
| 55085 | Oneida        |         21 |         2,349 |            51 |       2,342 |        51 |
| 55087 | Outagamie     |         36 |         5,437 |           435 |       5,286 |       448 |
| 55089 | Ozaukee       |         16 |         2,535 |           154 |       2,519 |       154 |
| 55091 | Pepin         |         11 |           413 |            22 |         405 |        21 |
| 55093 | Pierce        |         25 |         1,228 |            33 |       1,227 |        33 |
| 55095 | Polk          |         36 |         1,706 |           106 |       1,710 |       126 |
| 55097 | Portage       |         28 |         2,289 |           127 |       2,259 |       121 |
| 55099 | Price         |         22 |           878 |            56 |         921 |        56 |
| 55101 | Racine        |         17 |         4,869 |           285 |       4,811 |       284 |
| 55103 | Richland      |         22 |           625 |            30 |         627 |        30 |
| 55105 | Rock          |         29 |         4,086 |           228 |       4,099 |       225 |
| 55107 | Rusk          |         33 |           824 |            42 |         818 |        42 |
| 55109 | St. Croix     |         35 |         2,934 |           150 |       2,908 |       149 |
| 55111 | Sauk          |         39 |         4,265 |           125 |       4,178 |       127 |
| 55113 | Sawyer        |         21 |         1,625 |            24 |       1,697 |        24 |
| 55115 | Shawano       |         38 |         1,617 |            82 |       1,615 |        81 |
| 55117 | Sheboygan     |         28 |         3,451 |           257 |       3,419 |       250 |
| 55119 | Taylor        |         27 |           845 |            43 |         844 |        43 |
| 55121 | Trempealeau   |         26 |         1,455 |           132 |       1,458 |       149 |
| 55123 | Vernon        |         33 |         1,096 |            52 |       1,103 |        50 |
| 55125 | Vilas         |         15 |         1,724 |            19 |       1,690 |        36 |
| 55127 | Walworth      |         30 |         3,673 |           188 |       3,579 |       193 |
| 55129 | Washburn      |         25 |           894 |            33 |         895 |        35 |
| 55131 | Washington    |         21 |         3,174 |           314 |       3,167 |       315 |
| 55133 | Waukesha      |         38 |         8,398 |           795 |       8,195 |       786 |
| 55135 | Waupaca       |         34 |         1,998 |           114 |       1,983 |       112 |
| 55137 | Waushara      |         26 |         1,101 |            27 |       1,080 |        27 |
| 55139 | Winnebago     |         22 |         4,941 |           351 |       4,912 |       374 |
| 55141 | Wood          |         34 |         2,526 |           174 |       2,506 |       169 |
|       | **Statewide** |            |   **183,173** |     **9,823** | **175,835** | **9,919** |

## Freshness evidence

Layer freshness: every archived page returned `Last-Modified: Tue, 30 Jun 2026 21:21:29 GMT`.
The ArcGIS item `licenseInfo` (read 2026-11-06) says "This data free for public consumption as of: 06/30/2026".
The V12 changelog, <https://www.sco.wisc.edu/parcels/data/assets/Wisconsin_Statewide_Parcels_Change_Log.pdf>
(read 2026-11-06), says `Release Date: 06/30/26` and "The V12 layer totals 3,574,646". A
`returnCountOnly` response saved the same day is `{"count": 3574646}`.

`LOADDATE` is in the configured outFields. The schema defines it as "The date (MM/DD/YYYY) when a
parcel feature is submitted to the Parcel Initiative from the data contributor." Every in-scope
feature has one. The earliest is 1/16/2026 (Portage 2,380) and the latest is 4/20/2026 (Price 977, Trempealeau 1,607).
Most counties have a single LOADDATE. Exceptions with more than one: Calumet 3/11/2026 (1,338),
3/03/2026 (162), 3/13/2026 (58); Winnebago 3/13/2026 (5,212) and 3/03/2026 (74).

`TAXROLLYEAR` is 2025 on 185,955 of 185,994 in-scope features. The others: Milwaukee LOADDATE
2/19/2026 has 2025 (16,544), 2024 (36), 2023 (1), 2021 (1); Trempealeau 4/20/2026 has 2025 (1,606)
and 2024 (1).

`PARCELDATE` is not in the configured outFields, so the archived pages cannot answer it. Two
follow-up statistics queries (same User-Agent, 2 seconds apart, HTTP 200, `exceededTransferLimit`
not set), grouped by CONAME:

```
where=(PROPCLASS LIKE '%2%' OR PROPCLASS LIKE '%3%') AND PARCELDATE IS NULL
where=(PROPCLASS LIKE '%2%' OR PROPCLASS LIKE '%3%') AND PARCELDATE IS NOT NULL
```

Null **144,310** plus present **41,684** equals 185,994 feature rows. 42 counties have at least one
present PARCELDATE. These counts are feature rows, including the 240 repeated rows, not distinct
parcels. An earlier grouped query that also grouped by the date value itself stopped at 2,000 groups
with `exceededTransferLimit` true and is not used.

| FIPS  | County        | LOADDATE                                           | Tax roll year                                | PARCELDATE present | PARCELDATE null |
| ----- | ------------- | -------------------------------------------------- | -------------------------------------------- | -----------------: | --------------: |
| 55001 | Adams         | 3/04/2026 (721)                                    | 2025 (721)                                   |                  0 |             721 |
| 55003 | Ashland       | 3/12/2026 (834)                                    | 2025 (834)                                   |                  0 |             834 |
| 55005 | Barron        | 1/28/2026 (2,331)                                  | 2025 (2,331)                                 |                  0 |           2,331 |
| 55007 | Bayfield      | 3/12/2026 (1,072)                                  | 2025 (1,072)                                 |                  0 |           1,072 |
| 55009 | Brown         | 2/05/2026 (7,212)                                  | 2025 (7,212)                                 |                  0 |           7,212 |
| 55011 | Buffalo       | 3/13/2026 (765)                                    | 2025 (765)                                   |                  0 |             765 |
| 55013 | Burnett       | 2/10/2026 (799)                                    | 2025 (799)                                   |                  0 |             799 |
| 55015 | Calumet       | 3/03/2026 (162), 3/11/2026 (1,338), 3/13/2026 (58) | 2025 (1,558)                                 |                501 |           1,057 |
| 55017 | Chippewa      | 2/10/2026 (2,712)                                  | 2025 (2,712)                                 |                  0 |           2,712 |
| 55019 | Clark         | 2/17/2026 (1,561)                                  | 2025 (1,561)                                 |                  1 |           1,560 |
| 55021 | Columbia      | 3/03/2026 (2,485)                                  | 2025 (2,485)                                 |              1,618 |             867 |
| 55023 | Crawford      | 3/23/2026 (916)                                    | 2025 (916)                                   |                  0 |             916 |
| 55025 | Dane          | 3/09/2026 (14,137)                                 | 2025 (14,137)                                |             14,137 |               0 |
| 55027 | Dodge         | 3/10/2026 (2,940)                                  | 2025 (2,940)                                 |              1,280 |           1,660 |
| 55029 | Door          | 3/10/2026 (2,929)                                  | 2025 (2,929)                                 |                  0 |           2,929 |
| 55031 | Douglas       | 3/10/2026 (2,432)                                  | 2025 (2,432)                                 |                389 |           2,043 |
| 55033 | Dunn          | 3/13/2026 (1,504)                                  | 2025 (1,504)                                 |                137 |           1,367 |
| 55035 | Eau Claire    | 3/03/2026 (3,474)                                  | 2025 (3,474)                                 |                 15 |           3,459 |
| 55037 | Florence      | 2/28/2026 (272)                                    | 2025 (272)                                   |                  0 |             272 |
| 55039 | Fond du Lac   | 2/11/2026 (3,705)                                  | 2025 (3,705)                                 |                  0 |           3,705 |
| 55041 | Forest        | 2/04/2026 (631)                                    | 2025 (631)                                   |                  0 |             631 |
| 55043 | Grant         | 3/12/2026 (2,367)                                  | 2025 (2,367)                                 |                543 |           1,824 |
| 55045 | Green         | 3/13/2026 (1,482)                                  | 2025 (1,482)                                 |                849 |             633 |
| 55047 | Green Lake    | 3/04/2026 (1,109)                                  | 2025 (1,109)                                 |                  1 |           1,108 |
| 55049 | Iowa          | 3/11/2026 (1,195)                                  | 2025 (1,195)                                 |                300 |             895 |
| 55051 | Iron          | 3/2/2026 (547)                                     | 2025 (547)                                   |                547 |               0 |
| 55053 | Jackson       | 3/12/2026 (969)                                    | 2025 (969)                                   |                  0 |             969 |
| 55055 | Jefferson     | 2/09/2026 (3,013)                                  | 2025 (3,013)                                 |                191 |           2,822 |
| 55057 | Juneau        | 1/26/2026 (1,082)                                  | 2025 (1,082)                                 |                  0 |           1,082 |
| 55059 | Kenosha       | 3/09/2026 (4,031)                                  | 2025 (4,031)                                 |                  0 |           4,031 |
| 55061 | Kewaunee      | 3/02/2026 (839)                                    | 2025 (839)                                   |                  0 |             839 |
| 55063 | La Crosse     | 3/03/2026 (4,068)                                  | 2025 (4,068)                                 |                258 |           3,810 |
| 55065 | Lafayette     | 3/10/2026 (903)                                    | 2025 (903)                                   |                120 |             783 |
| 55067 | Langlade      | 3/09/2026 (962)                                    | 2025 (962)                                   |                  8 |             954 |
| 55069 | Lincoln       | 2/16/2026 (1,169)                                  | 2025 (1,169)                                 |                  2 |           1,167 |
| 55071 | Manitowoc     | 1/21/2026 (2,917)                                  | 2025 (2,917)                                 |                  4 |           2,913 |
| 55073 | Marathon      | 3/04/2026 (4,711)                                  | 2025 (4,711)                                 |                 13 |           4,698 |
| 55075 | Marinette     | 3/05/2026 (1,980)                                  | 2025 (1,980)                                 |              1,979 |               1 |
| 55077 | Marquette     | 3/02/2026 (610)                                    | 2025 (610)                                   |                  0 |             610 |
| 55078 | Menominee     | 3/12/2026 (15)                                     | 2025 (15)                                    |                  8 |               7 |
| 55079 | Milwaukee     | 2/19/2026 (16,582)                                 | 2021 (1), 2023 (1), 2024 (36), 2025 (16,544) |              2,330 |          14,252 |
| 55081 | Monroe        | 3/10/2026 (1,762)                                  | 2025 (1,762)                                 |                  0 |           1,762 |
| 55083 | Oconto        | 3/12/2026 (1,700)                                  | 2025 (1,700)                                 |                  0 |           1,700 |
| 55085 | Oneida        | 3/03/2026 (2,393)                                  | 2025 (2,393)                                 |                944 |           1,449 |
| 55087 | Outagamie     | 3/03/2026 (5,867)                                  | 2025 (5,867)                                 |                  9 |           5,858 |
| 55089 | Ozaukee       | 2/20/2026 (2,673)                                  | 2025 (2,673)                                 |              2,336 |             337 |
| 55091 | Pepin         | 2/02/2026 (426)                                    | 2025 (426)                                   |                  0 |             426 |
| 55093 | Pierce        | 3/04/2026 (1,260)                                  | 2025 (1,260)                                 |                799 |             461 |
| 55095 | Polk          | 2/16/2026 (1,836)                                  | 2025 (1,836)                                 |                  0 |           1,836 |
| 55097 | Portage       | 1/16/2026 (2,380)                                  | 2025 (2,380)                                 |                262 |           2,118 |
| 55099 | Price         | 4/20/2026 (977)                                    | 2025 (977)                                   |                977 |               0 |
| 55101 | Racine        | 3/12/2026 (5,164)                                  | 2025 (5,164)                                 |                742 |           4,422 |
| 55103 | Richland      | 3/10/2026 (657)                                    | 2025 (657)                                   |                120 |             537 |
| 55105 | Rock          | 3/05/2026 (4,324)                                  | 2025 (4,324)                                 |                  0 |           4,324 |
| 55107 | Rusk          | 3/19/2026 (860)                                    | 2025 (860)                                   |                  0 |             860 |
| 55109 | St. Croix     | 3/13/2026 (3,057)                                  | 2025 (3,057)                                 |                  0 |           3,057 |
| 55111 | Sauk          | 2/20/2026 (4,305)                                  | 2025 (4,305)                                 |                  3 |           4,302 |
| 55113 | Sawyer        | 3/19/2026 (1,721)                                  | 2025 (1,721)                                 |                  0 |           1,721 |
| 55115 | Shawano       | 3/03/2026 (1,721)                                  | 2025 (1,721)                                 |                 23 |           1,698 |
| 55117 | Sheboygan     | 3/03/2026 (3,669)                                  | 2025 (3,669)                                 |                  0 |           3,669 |
| 55119 | Taylor        | 2/12/2026 (887)                                    | 2025 (887)                                   |                  0 |             887 |
| 55121 | Trempealeau   | 4/20/2026 (1,607)                                  | 2024 (1), 2025 (1,606)                       |                  1 |           1,606 |
| 55123 | Vernon        | 3/13/2026 (1,153)                                  | 2025 (1,153)                                 |              1,147 |               6 |
| 55125 | Vilas         | 2/19/2026 (1,726)                                  | 2025 (1,726)                                 |              1,726 |               0 |
| 55127 | Walworth      | 3/09/2026 (3,772)                                  | 2025 (3,772)                                 |                266 |           3,506 |
| 55129 | Washburn      | 1/28/2026 (930)                                    | 2025 (930)                                   |                930 |               0 |
| 55131 | Washington    | 3/06/2026 (3,482)                                  | 2025 (3,482)                                 |              3,476 |               6 |
| 55133 | Waukesha      | 3/10/2026 (8,981)                                  | 2025 (8,981)                                 |                  0 |           8,981 |
| 55135 | Waupaca       | 3/11/2026 (2,095)                                  | 2025 (2,095)                                 |                  6 |           2,089 |
| 55137 | Waushara      | 3/11/2026 (1,107)                                  | 2025 (1,107)                                 |                  0 |           1,107 |
| 55139 | Winnebago     | 3/03/2026 (74), 3/13/2026 (5,212)                  | 2025 (5,286)                                 |                 11 |           5,275 |
| 55141 | Wood          | 3/6/2026 (2,675)                                   | 2025 (2,675)                                 |              2,675 |               0 |
|       | **Statewide** | 1/16/2026–4/20/2026                                |                                              |         **41,684** |     **144,310** |

## Fill rates

Current facts in the scratch registry, after `maintain --all`. Year built and improvement area are
absent from the layer (the adapter writes neither). Local use code and tax year are present on every
parcel. Counts are parcels, not features.

| Field                          | Parcels | Of 185,754 |
| ------------------------------ | ------: | ---------: |
| APN                            | 185,754 |     1.0000 |
| State category                 | 185,754 |     1.0000 |
| Local use code (PROPCLASS)     | 185,754 |     1.0000 |
| Tax year                       | 185,754 |     1.0000 |
| Situs address                  | 159,453 |     0.8584 |
| Land area                      | 178,962 |     0.9634 |
| Market value (ESTFMKVALUE)     | 174,134 |     0.9374 |
| Appraised value (CNTASSDVALUE) | 183,544 |     0.9881 |
| Organisation owner             | 125,238 |     0.6742 |
| Year built                     |       0 |          0 |
| Improvement area               |       0 |          0 |

The audit warns when more than 5% of parcels have no situs. 26,301 / 185,754 have none
(0.1416). That is a warning. Seventeen Milwaukee land areas exceed 500,000,000 square feet
(the audit's implausible-area bound, about 11,478 acres). The smallest of the seventeen is
663,854,400 square feet (15,240 acres) and the largest is 19,070,568,000 square feet (438,030 acres).
The largest is bigger than Milwaukee County, so at least that value is not a plausible parcel area.
The audit records this as a warning, not a violation, and Milwaukee's parcel count still matches.

| FIPS  | County        |     Parcels |       Situs |       Owner |   Land area |      Market |   Appraised |
| ----- | ------------- | ----------: | ----------: | ----------: | ----------: | ----------: | ----------: |
| 55001 | Adams         |         721 |         478 |         458 |         721 |         667 |         721 |
| 55003 | Ashland       |         834 |         625 |         503 |         808 |         776 |         831 |
| 55005 | Barron        |       2,331 |       1,837 |       1,404 |       2,255 |       2,140 |       2,329 |
| 55007 | Bayfield      |       1,072 |         759 |         501 |       1,039 |       1,013 |       1,071 |
| 55009 | Brown         |       7,212 |       7,212 |       5,678 |       7,036 |       6,866 |       7,212 |
| 55011 | Buffalo       |         765 |         517 |         378 |         764 |         663 |         762 |
| 55013 | Burnett       |         799 |         559 |         394 |         769 |         752 |         798 |
| 55015 | Calumet       |       1,547 |       1,489 |       1,156 |       1,507 |       1,387 |       1,494 |
| 55017 | Chippewa      |       2,712 |       1,997 |       1,801 |       2,706 |       2,530 |       2,712 |
| 55019 | Clark         |       1,561 |       1,136 |         830 |       1,561 |       1,347 |       1,552 |
| 55021 | Columbia      |       2,485 |       1,827 |       1,698 |       2,474 |       2,332 |       2,485 |
| 55023 | Crawford      |         916 |         683 |         571 |         916 |         806 |         909 |
| 55025 | Dane          |      14,137 |      13,400 |      11,076 |      12,405 |      12,285 |      12,909 |
| 55027 | Dodge         |       2,940 |       2,632 |       1,959 |       2,861 |       2,697 |       2,934 |
| 55029 | Door          |       2,929 |       2,528 |       1,611 |       1,956 |       2,796 |       2,898 |
| 55031 | Douglas       |       2,432 |       1,437 |       1,683 |       2,430 |       2,314 |       2,395 |
| 55033 | Dunn          |       1,504 |       1,226 |         967 |       1,384 |       1,415 |       1,504 |
| 55035 | Eau Claire    |       3,474 |       3,008 |       2,627 |       3,330 |       3,361 |       3,470 |
| 55037 | Florence      |         272 |         199 |         153 |         272 |         256 |         271 |
| 55039 | Fond du Lac   |       3,705 |       3,035 |       2,568 |       3,534 |       3,333 |       3,705 |
| 55041 | Forest        |         631 |         379 |         278 |         459 |         585 |         631 |
| 55043 | Grant         |       2,367 |       1,724 |       1,388 |       2,366 |       2,157 |       2,358 |
| 55045 | Green         |       1,482 |       1,203 |         878 |       1,482 |       1,350 |       1,475 |
| 55047 | Green Lake    |       1,109 |         858 |         696 |       1,109 |       1,023 |       1,109 |
| 55049 | Iowa          |       1,195 |         853 |         734 |       1,195 |       1,069 |       1,195 |
| 55051 | Iron          |         547 |         376 |         256 |         547 |         532 |         542 |
| 55053 | Jackson       |         969 |         669 |         573 |         968 |         860 |         969 |
| 55055 | Jefferson     |       3,013 |       2,539 |       2,110 |       2,833 |       2,793 |       3,002 |
| 55057 | Juneau        |       1,082 |         854 |         663 |       1,082 |         957 |       1,080 |
| 55059 | Kenosha       |       4,031 |       3,558 |          15 |       3,835 |       3,877 |       4,031 |
| 55061 | Kewaunee      |         839 |         651 |         522 |         814 |         749 |         837 |
| 55063 | La Crosse     |       4,068 |       4,003 |       3,236 |       4,067 |       3,954 |       4,064 |
| 55065 | Lafayette     |         903 |         708 |         438 |         903 |         743 |         895 |
| 55067 | Langlade      |         962 |         808 |         510 |         962 |         908 |         960 |
| 55069 | Lincoln       |       1,169 |         961 |         710 |         981 |       1,098 |       1,169 |
| 55071 | Manitowoc     |       2,917 |       2,534 |       1,933 |       2,883 |       2,723 |       2,916 |
| 55073 | Marathon      |       4,711 |       4,070 |       3,391 |       4,615 |       4,468 |       4,711 |
| 55075 | Marinette     |       1,980 |       1,480 |       1,137 |       1,980 |       1,830 |       1,979 |
| 55077 | Marquette     |         610 |         504 |         320 |         519 |         546 |         610 |
| 55078 | Menominee     |          15 |          14 |           9 |          15 |          15 |          15 |
| 55079 | Milwaukee     |      16,580 |      16,551 |      11,808 |      16,574 |      16,536 |      16,465 |
| 55081 | Monroe        |       1,762 |       1,350 |       1,126 |       1,759 |       1,586 |       1,756 |
| 55083 | Oconto        |       1,700 |       1,507 |         855 |       1,565 |       1,497 |       1,659 |
| 55085 | Oneida        |       2,393 |       1,899 |       1,418 |       2,392 |       2,300 |       2,392 |
| 55087 | Outagamie     |       5,734 |       4,960 |       4,264 |       5,732 |       5,531 |       5,699 |
| 55089 | Ozaukee       |       2,673 |       2,387 |       2,063 |       2,056 |       2,607 |       2,671 |
| 55091 | Pepin         |         426 |         338 |         237 |         220 |         387 |         426 |
| 55093 | Pierce        |       1,260 |       1,055 |         750 |       1,260 |       1,175 |       1,260 |
| 55095 | Polk          |       1,836 |       1,358 |       1,084 |       1,836 |       1,651 |       1,813 |
| 55097 | Portage       |       2,380 |       1,787 |       1,744 |       2,380 |       2,303 |       2,380 |
| 55099 | Price         |         977 |         794 |         590 |         969 |         873 |         970 |
| 55101 | Racine        |       5,095 |       5,093 |       3,636 |       5,093 |       4,961 |       5,074 |
| 55103 | Richland      |         657 |         505 |         367 |         655 |         572 |         654 |
| 55105 | Rock          |       4,324 |       4,029 |       3,106 |       4,245 |       4,146 |       4,323 |
| 55107 | Rusk          |         860 |         519 |         415 |         852 |         776 |         860 |
| 55109 | St. Croix     |       3,057 |       2,631 |       2,227 |       3,057 |       2,896 |       3,057 |
| 55111 | Sauk          |       4,305 |       3,567 |       2,932 |       4,304 |       4,026 |       4,255 |
| 55113 | Sawyer        |       1,721 |         950 |         920 |       1,634 |       1,650 |       1,713 |
| 55115 | Shawano       |       1,696 |       1,351 |         921 |       1,581 |       1,567 |       1,696 |
| 55117 | Sheboygan     |       3,669 |       3,220 |       2,690 |       3,522 |       3,477 |       3,644 |
| 55119 | Taylor        |         887 |         694 |         524 |         831 |         771 |         887 |
| 55121 | Trempealeau   |       1,607 |       1,048 |       1,002 |       1,600 |       1,444 |       1,568 |
| 55123 | Vernon        |       1,153 |         869 |         657 |       1,153 |       1,024 |       1,153 |
| 55125 | Vilas         |       1,726 |       1,313 |         975 |       1,725 |       1,476 |       1,511 |
| 55127 | Walworth      |       3,772 |       2,713 |       2,753 |       3,485 |       3,468 |       3,647 |
| 55129 | Washburn      |         930 |         687 |         474 |         899 |         808 |         916 |
| 55131 | Washington    |       3,482 |       3,428 |       2,641 |       3,476 |       3,309 |       3,473 |
| 55133 | Waukesha      |       8,981 |       8,098 |       7,392 |       8,981 |       8,758 |       8,980 |
| 55135 | Waupaca       |       2,095 |       1,777 |       1,291 |       1,810 |       1,946 |       2,094 |
| 55137 | Waushara      |       1,107 |         802 |         593 |       1,019 |       1,003 |       1,106 |
| 55139 | Winnebago     |       5,286 |       4,807 |       4,136 |       5,279 |       5,120 |       5,258 |
| 55141 | Wood          |       2,675 |       2,036 |       1,834 |       2,675 |       2,517 |       2,674 |
|       | **Statewide** | **185,754** | **159,453** | **125,238** | **178,962** | **174,134** | **183,544** |

## Re-read

Command (exit 0; the tool does not treat a missing adapter as a violation):

```
PYTHONPATH=python/src python3 -m factlot.registry.audit /workspace/surge/_data/a2-wi-statewide/scratch.db --collected /workspace/surge/_data/a2-wi-statewide/collected --reread --entity-names --today 2026-11-06 --out docs/registry/quality/surge-2026-11/wi-statewide-parcels-audit.json
```

The JSON is 80,857 bytes. `violations` is empty. `warnings` are the 17 areas and the 26,301 missing
situs addresses. `owners.person_like` is 0. `owners.owner_facts` is 125,238. Link rate is null, with
the note that no entity registry is loaded for this state. Every `source_file` entry has
`error: no adapter registered for this source`.

The comparison the audit would have made was run by calling `reread_source_file` on
`factlot.registry.adapters.wi_statewide` for each archived file, and `read_roll` on each county's
files together. Per file: 126 match, 4 do not. The four are Outagamie indexes 82 and 83 and Racine
indexes 93 and 94. Sum of per-file distinct ids is 185,807, which is 53 above the registry: Outagamie
+42 and Racine +11. County-level distinct ids sum to 185,754 and match every county. Invalid APNs: 0.
Header-like APNs, the audit's all-letter check: Outagamie `rail` on indexes 82 and 83, and `building`
on index 83. A full scan of PARCELID values found only those two: `rail` on 3 in-scope rows and
`building` on 28, each kept once. No other county has an all-letter APN.

## Terms read 2026-11-06

No new restriction. Loading continued. Differences from the 2026-11-03 record are quoted here and
are not use bans.

Data page <https://www.sco.wisc.edu/parcels/data/> (HTTP 200, Last-Modified Mon, 02 Nov 2026):

> This data is provided free of charge, however, if you use Wisconsin's parcel data, we ask that you please complete the parcel feedback form, to tell us how/why you use the data, so that we can continue to justify offering this service.

The 2026-11-03 record stopped before "so that we can continue to justify offering this service."
It is still "we ask," not a condition of use.

Access and Use Constraints modal on that page:

> The information shown on this map was obtained from Wisconsin counties in the first half of 2026 and thus may not be the most current, comprehensive data available. Source data for parcel polygons was collected between January–May of 2026. However, the tax roll year for most records is 2025, as the assessment cycle lags a year behind. ... The next release of the statewide parcel layer, V13, is tentatively scheduled for June 30, 2027. No warranty, expressed or implied, is made regarding accuracy, completeness, or legality of the information herein. The boundaries depicted on this map do not represent the legal ownership boundaries of any property. The delineation of legal boundaries may only be conducted by a licensed surveyor. This map is not a survey of the actual boundary of any property this map depicts.

The record quoted only the warranty sentence. The added sentences are currency and survey
disclaimers. They do not restrict redistribution, commercial use, or AI use, and there is no
click-through. "Statewide downloads temporarily unavailable" appears only inside HTML comments.

ArcGIS item `2386813b23ea4e51a009f7d1d6b76e02` (HTTP 200, `access` public), `licenseInfo`:

> This data free for public consumption as of: 06/30/2026

Robots, read 2026-11-06:

- `https://www.sco.wisc.edu/robots.txt` HTTP 200, Last-Modified Mon, 09 Oct 2017: `User-agent: *`, `Disallow: /wp-admin/`, `Disallow: /wp-login.php`.
- `https://services3.arcgis.com/robots.txt` HTTP 403 with body `Invalid URL`. The collector treats an HTTP 4xx on robots.txt as no rules. This was not a refusal of the data URL.
- `https://web.s3.wisc.edu/robots.txt` HTTP 404, S3 `NoSuchBucket`.
- `https://www.revenue.wi.gov/robots.txt`: `Disallow: /_layouts/`, `/_vti_bin/`, `/_catalogs/`, and one employment page. The SOA PDFs and the manual are not under those paths.

The 2026-11-03 record already says an express redistribution statement would be a question for WLIP
(`wlip@wisconsin.gov`), not a gate. This re-read did not add one.

## Commands

```
PYTHONPATH=python/src python3 -m factlot.collector snapshot --config registry/sources --out /workspace/surge/_data/a2-wi-statewide/collected --source wi-statewide-parcels
PYTHONPATH=python/src python3 -m factlot.registry.adapters.wi_statewide <130 files in manifest index order> /workspace/surge/_data/a2-wi-statewide/scratch.db --as-of 2026-06-30 --retrieved-at 2026-11-06T23:04:47.617290+00:00
PYTHONPATH=python/src python3 -m factlot.registry.maintain /workspace/surge/_data/a2-wi-statewide/scratch.db --all
PYTHONPATH=python/src python3 -m factlot.registry.audit /workspace/surge/_data/a2-wi-statewide/scratch.db --collected /workspace/surge/_data/a2-wi-statewide/collected --reread --entity-names --today 2026-11-06 --out docs/registry/quality/surge-2026-11/wi-statewide-parcels-audit.json
```

The collector command archived nothing (the refusal above). The page archive, the SOA parse, the
PARCELDATE counts, and `reread_source_file` were run outside the collector, as described in the
sections above. Scratch output stayed in `/workspace/surge/_data/a2-wi-statewide` and is not committed.

## Blockers

- factlot.collector snapshot refused every services3.arcgis.com URL: getaddrinfo returned 198.18.0.1, which the collector treats as a non-public address. That is this environment's DNS result, not a publisher 403. The 130 configured URLs were then archived with the same User-Agent and a 2 second gap. robots.txt was not bypassed.
- python -m factlot.registry.audit --reread does not import factlot.registry.adapters.wi_statewide. adapter_for only loads _READER_MODULES, and wi_statewide is not in that tuple, so all 130 source_file entries say 'no adapter registered for this source' and matches_registry is absent. audit.py and the adapter were not modified. The per-file comparison below calls audit.reread_source_file on the adapter module directly.
- Outagamie (55087) and Racine (55101) fail the per-file re-read. Repeated PARCELIDs span pages. The adapter keeps the first row; a single-file re-read of a later page still yields the repeat. County-level re-read matches the registry. Not fixed.
- No Wisconsin entity registry is in the scratch file. link_owners matched 0 of 125,238 organisation owners. wi-dfi-entities is a paid file and was not purchased. Link rate is n/a, not a parcel-count failure.

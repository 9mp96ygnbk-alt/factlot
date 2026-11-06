# or-metro-rlis-taxlots surge audit, 2026-11-06

Lane A5 on branch `surge/a5-or-rlis`. Source `or-metro-rlis-taxlots`. Counties on the record: Clackamas (41005), Multnomah (41051), Washington (41067).

**Result: FAIL for all three counties. The parcel file was not collected and no scratch registry was built.**

The license page was read on 2026-11-06. Its text is Metro's own RLIS Open Database End User License Agreement (revised February 2023). It is not the Open Database License (ODbL) v1.0 that the 2026-11-03 record inferred from search results. The new text prohibits sublicensing, does not license the individual contents of the database, and is a limited revocable license accepted by accessing or using the data. That differs from the record, so the load stopped here. A person has to decide whether derived registry facts can be carried under this agreement.

No subscription wall and no click-through interstitial appeared on the public item or the license page. Both answered HTTP 200. The words "RLIS Lite", "subscription", and "ODbL" do not appear in the license page, the Open EULA, the Limited Use License, or the Taxlots (Public) item read today.

## Per-county result

Record counts below are the figures already printed in the source record's Full load (2026-11-03) section. They were located with `rg` on 2026-11-06. They were not remeasured. Scratch and re-read counts were not produced.

| FIPS  | County     | Record count | Scratch count | Re-read count | As-of                                                                         | Result | Reason                                                                |
| ----- | ---------- | -----------: | ------------- | ------------- | ----------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| 41005 | Clackamas  |        6,085 | not run       | not run       | publisher states 2026-11-02; record says 2026-07-17; neither was loaded today | FAIL   | License text differs from the record. Collect and audit were not run. |
| 41051 | Multnomah  |       20,618 | not run       | not run       | publisher states 2026-11-02; record says 2026-07-17; neither was loaded today | FAIL   | License text differs from the record. Collect and audit were not run. |
| 41067 | Washington |        7,425 | not run       | not run       | publisher states 2026-11-02; record says 2026-07-17; neither was loaded today | FAIL   | License text differs from the record. Collect and audit were not run. |

The record's tri-county total on that same section is 34,128 (`B` 6,388, `F1` 26,087, `F2` 1,653). Age of the publisher's stated content date: 2026-11-02 is 2 days before 2026-11-04, inside the 400-day window. The record's 2026-07-17 is also inside that window (110 days before 2026-11-04). The age bar is not the failure. The failure is that the re-read, the violation count, and the person-like owner count were never measured, because the license stop came first.

`python -m factlot.registry.audit` was not run. There is no `or-metro-rlis-taxlots-audit.json`.

## Terms read on 2026-11-06

### Where the text is

- Human page, HTTP 200, `Content-Type: text/html`, 178,596 bytes, fetched 2026-11-06 22:57:12 GMT: <https://rlisdiscovery.oregonmetro.gov/pages/open-database-license>. The HTML title is `open-database-license`. The meta description is "Text of the RLIS Open Database End User License Agreement." The body is the ArcGIS Hub application shell. It does not contain the agreement.
- The agreement is the Hub Page item `43a73dbe46e644a9a8204afc4cbeb525`, public, fetched the same day from <https://www.arcgis.com/sharing/rest/content/items/43a73dbe46e644a9a8204afc4cbeb525/data>. The page JSON field `values.updatedAt` is `2023-02-02T03:08:17.590Z`. The item's `modified` timestamp is 2026-05-18T23:34:12Z. The agreement itself ends "Revised February 2023".
- Taxlots (Public) item `b3cabe5845ec47eab61c54e0c631313c`, `access` `public`, `licenseInfo` verbatim: "This database and GIS data are made available under the RLIS Open Database End User License Agreement. See https://rlisdiscovery.oregonmetro.gov/pages/open-database-license." URL: <https://www.arcgis.com/sharing/rest/content/items/b3cabe5845ec47eab61c54e0c631313c?f=json>.
- FGDC `use-constraints` on metadata id 3733, same sentence: "This database and GIS data are made available under the RLIS Open Database End User License Agreement. See https://rlisdiscovery.oregonmetro.gov/pages/open-database-license."
- FGDC `distribution-liability`, same record: "The information in this file was derived from digital databases on Metro's GIS. Care was taken in the creation of this file. Metro cannot accept any responsibility for errors, omissions, or positional accuracy. There are no warranties, expressed or implied."

The quotes below are the Hub Page markdown with tags removed and runs of spaces collapsed. List items are the page's list items. Where an anchor's href and its visible text were the same URL, the URL is written once. The Open EULA attribution sentence is: Regional Land Information System data are a product of Metro and made publicly available according to the license agreement found in https://rlisdiscovery.oregonmetro.gov/pages/open-database-license.

### RLIS Open Database End User License Agreement (verbatim)

```
RLIS Open Database End User License Agreement

Using Data under this License:

Metro's Regional Land Information System (“RLIS”) database, content, and materials (“Data”) were developed to support Metro's functions and services. This Data is made available through Metro's Data Resource Center and through this RLIS Open Database End User License Agreement (“License” or “Agreement”).

By accessing or using the Data, you (whether a person or entity) and Metro agree that the following terms and conditions govern your use.

Permission:

Metro grants you a limited, worldwide, royalty-free, non-exclusive, revocable license to:

- Copy, publish, distribute, and share the Data;

- Extract, modify, and adapt the Data; and

- Combine it with other data, or include it in your own product or application.

When you do any of the above, you must:

- Do so only under the terms of this License; and

- Acknowledge the source of the Data by including any attribution statement specified by Metro and, where possible, provide a hyperlink to this License as such:

"Regional Land Information System data are a product of Metro and made publicly available according to the license agreement found in https://rlisdiscovery.oregonmetro.gov/pages/open-database-license."

If you are using information from several information providers and listing multiple attributions is not practical in your product or application, you may include a URI or hyperlink to a resource that contains the required attribution statements.

This license does not cover:

- Any personal data in the Data, unless otherwise agreed to in writing by Metro;

- Third-party rights Metro is not authorized to license;

- Other intellectual property rights, including copyrights, trademarks, patents, privacy, or personality rights; and

- Rights to individual contents contained in the database.

You agree that Metro retains all rights to its intellectual property, including Metro's Data, copyrights, patents, trademarks, and service marks.

Terms and limitations on use of Data:

Each time you communicate the Data, in whole or in part, Metro offers the recipient a license to the Data on the same terms and conditions as this License.

You are solely responsible for any modifications of derivative works you or others make at your direction.

You agree that you will not attempt to restrict or interfere with use of the Data by Metro or others. You may not impose any further restrictions on the exercise of rights granted or affirmed under this License with respect to the Data. Sublicensing the Data is prohibited. You may impose your own license terms with respect to your derivative works.

This License does not affect any rights you may have under other copyright or database right exceptions and limitations.

This License does not grant you any right to use the Data in a way that suggests any official status or that Metro endorses you or your use of the Data.

If you fail to comply with the terms and conditions of this License, your rights under it automatically and immediately terminate without notice to you. All terms and conditions limiting Metro's responsibility, protecting Metro's rights and property, and imposing obligations on you survive termination of this License.

Unless terminated, this License is granted to you for the duration of any applicable copyright or database rights.

Metro reserves the right to release the Data under different license terms or to stop distributing or making the Data available.

Non-warranty:

The Data is licensed “AS IS” and “AS AVAILABLE.” Metro accepts no responsibility for errors, omissions, or accuracy in the Data or the underlying related information.

Metro disclaims all representations and warranties of any kind, express or implied, including without limitation the implied warranties of merchantability, fitness for a particular purpose, accuracy or completeness, the presence or absence of errors, non-infringement, or otherwise.

Metro is not and cannot be held liable for any losses or damages, direct or indirect, including without limitation, loss of profits and special, consequential, or incidental damages, no matter how caused and regardless of any legal theory, arising out of or related to your use or distribution of the Data or use under this License, whether by you or anyone else, and whether or not caused by any fault on your part. In addition, you must also defend, save, and hold harmless the officials, officers, agents, and employees of Metro and any party providing Metro with any source data or information that is contained in the Data from all claims, demands, suits, actions, losses, damages, liabilities, costs, and expenses of whatsoever nature (including all attorneys' fees and costs at trial and on appeal), arising out of or resulting from the your receipt and use of the Data.

Governing law:

This License is construed and interpreted pursuant to the laws of the State of Oregon. Venue for any action or claim arising out of or in connection with this License is in the Circuit Court for Multnomah County, Oregon.

If any term of this license is found illegal, invalid, or unenforceable by a Court, it will not affect the remainder of this License.

These terms and conditions constitute the entire agreement between you and Metro as to the above subject matter.

These terms are compatible with the Creative Commons Attribution License 4.0 and the Open Data Commons Attribution License, both of which license copyright and database rights. This means that when the Information is adapted and licensed under either of those licenses, you automatically satisfy the conditions of this RLIS OPEN DATABASE END USER LICENSE AGREEMENT when you comply with the other license.

Revised February 2023
```

### How this differs from the 2026-11-03 record

The record said the page could not be read and that search results described it as ODbL v1.0, with share-alike, and that a person should confirm. The page can be read by taking the public Hub Page item. The agreement:

- grants a limited, worldwide, royalty-free, non-exclusive, revocable license to copy, publish, distribute, and share the data; to extract, modify, and adapt it; and to combine it with other data or include it in a product or application
- requires doing so only under this license, plus Metro's attribution sentence and a link to the license page
- says "Sublicensing the Data is prohibited" and "You may impose your own license terms with respect to your derivative works"
- does not cover personal data, third-party rights Metro is not authorized to license, other intellectual-property rights, or "Rights to individual contents contained in the database"
- says the terms are compatible with the Creative Commons Attribution License 4.0 and the Open Data Commons Attribution License (the attribution license, not ODbL), and that adapting the information and licensing it under either of those satisfies this agreement
- is accepted by "accessing or using the Data" (the page's words). That is not a click-through button. It is an agreement formed by access or use
- does not mention AI use or a subscription. The only "fee" in the agreement is "attorneys' fees" in the hold-harmless sentence. There is no charge for access.

The FGDC supplemental information adds a third-party copyright on the same product: "This Product contains information retrieved from and copyrighted by County of Clackamas."

`registry/sources/or/or-metro-rlis-taxlots.json` still describes the license as ODbL v1.0 and still has `"verified": true`. This lane is not allowed to edit that file. A person has to change it after reading the agreement.

### RLIS Limited Use License (a different page)

Footer link on the Hub site: <https://rlisdiscovery.oregonmetro.gov/pages/terms-of-use>, labeled "RLIS Limited Use License". Hub Page item `e41d74824dc548189d543bf2e58f439c`, public. Item `modified` and the page `updatedAt` are both 2026-05-18T22:27Z. The text ends "Revised September 2021".

Taxlots (Public) `licenseInfo` and the FGDC `use-constraints` point at the Open Database EULA, not at this page. This is the account and sold-product agreement. It was read so it would not be confused with the public layer. Verbatim, tags removed, same whitespace treatment. The attribution line's visible text is "© Oregon Metro www.oregonmetro.gov/rlis" and the anchor href is `https://www.oregonmetro.gov/rlis`.

```
RLIS Limited Use License

This Regional Land Information System (“RLIS”) Limited Use License (“Agreement”) is by and between Metro, and the party that is accessing or otherwise using the Product ("User"). This Agreement may refer to Metro and User individually as a “Party” or jointly as the “Parties.”

RECITALS

- Metro is the designer and developer of the certain aggregated and copyrighted information and Source Data ( “Product”), which it has the right to sell and distribute; and

- User is an individual, organization, business entity, government, or educational institution that will make use of the Product as part of its business or organizational activity.

AGREEMENT

- 1. METRO'S GRANT

In exchange for User’s promises set forth herein, Metro grants the User a limited, non-exclusive, revocable license to use the Product for the business, educational or organizational activity of the User, subject to the terms and conditions provided in this Agreement. Metro retains all rights, title and interest in the Product, including, but not limited to, the right to sell the Product to any other third party.

- 2. USER'S AGREEMENT

As consideration for Metro’s grant of the License to use the Product, User agrees to the following terms, conditions and restrictions:

- 2.1 Permitted Use

User agrees that its use of the Product must be solely for the business, educational or organizational activity of the User.

- 2.2 Maintenance of Confidentiality

- User must maintain the confidentiality of the source data delivered by Metro and protect the interests of Metro in its data incorporated into the RLIS database. For the purpose of this Agreement, “Source Data” refers to the core Geographic Information System data contained in the Product. “Source Data” does not include any value-added derivative products or services that the User creates using the License of the Product granted by this Agreement.

In the event that User is subject to the provisions of Oregon Public Records Laws, as set forth in ORS 192.414 to ORS 192.505, and receives any request for disclosure of the Product, User must immediately inform Metro of such request and direct the requestor to contact Metro.

- User must maintain the confidentiality of the account username and password within their organization.

- Educational Institutions must maintain the privacy of the online account access and must not distribute the account login and password to students.

- 2.3 Restrictions on Use

- Unauthorized Use. User must not disclose, lease, sell, make, transfer or assign Source Data contained in the Product or engage in any other transaction which has the effect of transferring the right of use of part of the Product without prior written consent of Metro. The Product may only be acquired directly from Metro to ensure that current Source Data is being used and to maintain quality and responsive communication with all Users. User must direct any third party seeking to make use of the Product to Metro in order for that party to obtain the most current Source Data.

- User must not use the Product in any way that will reveal to any third party the names of individuals who are referenced in the Product, including, without limitation, tax lot owner names.

- Copies. After User receives the Product from Metro, whether by online download or any other means, User is prohibited from duplicating the Product except as follows:

- User may backup the Product provided that the User agrees not to use the backup copy for any purpose other than to replace original data if lost or damaged.

- User may translate the Product into other formats or media, which translations (the "reformats") are subject to the same restrictions as the Product under this Agreement.

- Educational Institutions may copy the Product for use by enrolled students for current coursework.

- User may distribute the Product within their network and multiple CPU environment.

- Any value-added derivative products or services that the User creates using the Product must contain the date that the Product was received from Metro together with the following prominently displayed attribution:

"© Oregon Metro www.oregonmetro.gov/rlis"

- Metro retains all rights to its intellectual property, including Metro’s data, copyrights, patents, trademarks, and service marks.

- User is solely responsible for its use of the Product.

- This License does not grant User any right to use the Product in a way that suggests Metro endorses their use of the Product.

- 2.4 Violation of Restrictions on Use

If User fails to comply with any Agreement terms and conditions, this license is terminated, and User must immediately discontinue all use of the Product.

- 3. NON-WARRANTY

Information and data contained in the Product are collected by Metro from local governments and districts within the region. Metro attempts to maintain the Product to meet the accuracy requirements of Metro’s broad-scale land information system. User acknowledges that Metro does not warrant the accuracy of data originated by these jurisdictions.

- 3.1 The Product is licensed “AS IS” and “AS AVAILABLE.” Metro accepts no responsibility for errors, omissions, or accuracy in the Product or the underlying related information.

- 3.2 Metro and any third party providing Metro with any data or information contained in the Product disclaim all representations and warranties of any kind, express or implied, including, without limitation, the implied warranties of merchantability, fitness for a particular purpose, accuracy or completeness, timeliness, the presence or absence of errors, non-infringement, or otherwise.

- 4. LIABILITY LIMITATION

Metro is not and cannot be held liable for any loss or damages, direct or indirect, including without limitation, loss of profits and special, consequential, or incidental damages, no matter how caused and regardless of any legal theory, arising out of or related to User’s use or distribution of the Product or use under this Agreement, whether by User or anyone else, and whether or not caused by any fault on User’s part.

- 5. INDEMNITY

To the fullest extent permitted by law, User must defend, save and hold harmless Metro, and its elected officials, officers, agents and employees from any and all claims, demands, suits, actions, losses, damages, liabilities, costs and expenses of whatsoever nature (including all attorneys’ fees and costs at trial and on appeal), arising out of or resulting from the User’s receipt and use of the Product. In addition, User must also defend, save and hold harmless the officials, officers, agents and employees of any party providing Metro with any Source Data or information that is contained in the Product from all claims, demands, suits, actions, losses, damages, liabilities, costs and expenses of whatsoever nature (including all attorneys’ fees and costs at trial and on appeal), arising out of or resulting from the User’s receipt and use of the Product.

- 6. MISCELLANEOUS PROVISIONS

- 6.1 Availability Not Guaranteed

Metro reserves the right at any time, and from time to time, to modify or discontinue the availability of the Product (or any part thereof), either temporarily or permanently, to any User or group of Users, with or without prior notice. User agrees that Metro is not liable to any User for any modification, suspension or discontinuation of the Product.

- 6.2 Applicable Law: Venue

This Agreement is construed and interpreted pursuant to the laws of the state of Oregon. Venue for any action or claim arising out of or in connection with this Agreement is in the Circuit Court for the State of Oregon for Multnomah County.

- 6.3 Entire Agreement; Finding of Invalidity

This Agreement contains the entire agreement of the Parties as to the above subject matter. Any agreement, statement or promise, by any Party, not contained in this Agreement, is not binding or valid. In addition, if any term of this Agreement is held to be illegal, invalid or unenforceable by a Court, it does not affect the remainder of this Agreement, and each term will be valid and enforced as written to the fullest extent permitted by law.

Revised September 2021
```

Nothing in this Limited Use License was treated as the license of Taxlots (Public). It does show that Metro also publishes a product that requires an account password, forbids disclosing or selling source data without written consent, and forbids revealing names of individuals, including tax lot owner names. The public tax-lot layer's own description still says ownership information is excluded.

### robots.txt, read 2026-11-06

`https://rlisdiscovery.oregonmetro.gov/robots.txt` and `https://hub.arcgis.com/robots.txt`, both HTTP 200:

```
User-agent: *
Crawl-delay: 60
Disallow: /sites/
Disallow: /admin/
Disallow: /sessions/
Disallow: /groups/
Disallow: /people/
Disallow: /workspace/
```

The download API path is not in the disallow list. The license page fetch waited until 60 seconds after the robots fetch on `rlisdiscovery.oregonmetro.gov` (robots at 22:56:00 GMT, license page at 22:57:12 GMT).

`https://services2.arcgis.com/robots.txt` returned HTTP 403 with body `Invalid URL` (11 bytes). The feature-layer document at `Taxlots_(Public)/FeatureServer/3?f=json` returned HTTP 200. The 2026-11-03 record said this host had no robots file. A 403 on `/robots.txt` is what the collector treats as no rules; that behavior was not changed and was not used, because the CSV was not downloaded.

`https://www.arcgis.com/robots.txt` is `User-agent: *` plus a sitemap line.

`https://gis.oregonmetro.gov/robots.txt` is a Cloudflare-managed file. For `User-agent: *` it says `Content-Signal: search=yes,ai-train=no,use=reference` and `Allow: /`. Named training crawlers are `Disallow: /`. `FactLotRegistryBot` is not one of those names. The signal is on the metadata host, not on the tax-lot download host, and the Open EULA does not mention AI. The metadata API was read once as a reference for the code list and the FGDC dates. The tax-lot file was not downloaded.

## Commercial and industrial codes

Publisher code list, read 2026-11-06 from the RLIS metadata API (the viewer at <https://gis.oregonmetro.gov/rlis-metadata/#/details/3733> loads this URL):

<https://gis.oregonmetro.gov/rlis-metadata-api/details/3733?include=processsteps,entitytypes,entitytypes.attributes,agolitems>

`PROP_CODE` (attribute id 8899), definition verbatim: "Oregon Department of Revenue property classification for assessment codes. Populated from attributes LANDCLASS (Clackamas County), PROPCLASS (Multnomah County) and PCA3 (Washington County)."

The domain has 196 values. The adapter's `category()` rule keeps 36 of them: last digit 1 or 2, and first digit 2 (`F1`), 3 (`F2`), or 7 (`B`), plus `303` (`F2`) regardless of its last digit. That count is the domain list run through the same rule as the adapter. It is not a parcel count.

`LANDUSE` (attribute id 8900), definition verbatim: "Land use category, derived from PROP_CODE". The adapter does not read `LANDUSE`. The publisher's nine values are below. `MFR` means "Multifamily residential", which is why a residential condominium can carry `MFR`.

A blank Flag cell means the publisher's definition is improved commercial or industrial land without the phrases called out in the other rows. Definitions are quoted as stored, including ones that end mid-word.

| Code | Adapter category | Publisher definition                                                | Flag                                                                                                                                         |
| ---- | ---------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 201  | F1               | Commercial land, improved                                           |                                                                                                                                              |
| 202  | F1               | Commercial, vacant, condominium                                     | publisher definition says vacant; condominium; adapter keeps last digit 2 as in-scope F1                                                     |
| 211  | F1               | Commercial land, residential zone, improved                         | commercial or industrial class in a residential zone                                                                                         |
| 221  | F1               | Commercial land, commercial zone, improved                          |                                                                                                                                              |
| 231  | F1               | Commercial land, industrial zone, improved                          | commercial class in an industrial zone                                                                                                       |
| 232  | F1               | Commercial land, industrial zone, condominium                       | condominium; commercial class in an industrial zone                                                                                          |
| 241  | F1               | Commercial land, unzoned farm land, improved                        | farm land or farm-use wording; 241 and 251 carry this same definition text                                                                   |
| 251  | F1               | Commercial land, unzoned farm land, improved                        | farm land or farm-use wording; 241 and 251 carry this same definition text                                                                   |
| 261  | F1               | Commercial land, misc, improved                                     | miscellaneous assignment                                                                                                                     |
| 271  | F1               | Commercial land, permanent farm use disqualification, improved      | farm land or farm-use wording                                                                                                                |
| 281  | F1               | Commercial land, multiple special assignments, vacant               | publisher definition says vacant; last digit 1, so the adapter keeps it as F1                                                                |
| 291  | F1               | Commercial land, potential development, improved                    | potential development                                                                                                                        |
| 292  | F1               | Commercial land, potential development, condominium                 | potential development; condominium                                                                                                           |
| 301  | F2               | Industrial land, improved                                           |                                                                                                                                              |
| 303  | F2               | Department of Revenue appraised industrial                          | special case: last digit 3; the adapter keeps 303 and no other code ending in 3                                                              |
| 311  | F2               | Industrial land, residential zone, improved                         | commercial or industrial class in a residential zone                                                                                         |
| 321  | F2               | Industrial land, commercial zone, improved                          | industrial class in a commercial zone                                                                                                        |
| 331  | F2               | Industrial land, industrial zone, improved                          |                                                                                                                                              |
| 341  | F2               | Industrial land, unzoned farm land, improved                        | farm land or farm-use wording                                                                                                                |
| 351  | F2               | Industrial land, EFU, improved                                      | farm land or farm-use wording                                                                                                                |
| 361  | F2               | Industrial land, misc, improved                                     | miscellaneous assignment                                                                                                                     |
| 371  | F2               | Industrial land, permanent farm use disqualification, improved      | farm land or farm-use wording                                                                                                                |
| 381  | F2               | Industrial land, multiple special assignments, improved             |                                                                                                                                              |
| 382  | F2               | Industrial land, multiple special assignments, condominium          | condominium                                                                                                                                  |
| 391  | F2               | Industrial land, potential development, improved                    | potential development                                                                                                                        |
| 392  | F2               | Industrial land, potential development, condominium                 | potential development; condominium                                                                                                           |
| 701  | B                | Multiple housing, improved                                          | multiple-family / apartments, mapped to B                                                                                                    |
| 711  | B                | Multiple-family land, residential zone, improved                    | multiple-family / apartments, mapped to B                                                                                                    |
| 721  | B                | Multiple-family land, commercial zone, improved                     | multiple-family / apartments, mapped to B; multiple-family class in a commercial zone                                                        |
| 731  | B                | Multiple-family land, industrial zone, improved                     | multiple-family / apartments, mapped to B; multiple-family class in an industrial zone                                                       |
| 741  | B                | Multiple-family land, unzoned farm land, improved                   | multiple-family / apartments, mapped to B; farm land or farm-use wording                                                                     |
| 751  | B                | Multiple-family land, EFU, condominium                              | multiple-family / apartments, mapped to B; condominium; farm land or farm-use wording; definition says condominium while the last digit is 1 |
| 761  | B                | Multiple-family land, misc, improved                                | multiple-family / apartments, mapped to B; miscellaneous assignment                                                                          |
| 771  | B                | Multiple-family land, permanent farm use disqualification, improved | multiple-family / apartments, mapped to B; farm land or farm-use wording                                                                     |
| 781  | B                | Multiple-family land, multiple special assignments, improved        | multiple-family / apartments, mapped to B                                                                                                    |
| 792  | B                | Multiple-family land, potential development, condominium            | multiple-family / apartments, mapped to B; potential development; condominium                                                                |

### Ambiguous codes the adapter keeps

- **202** "Commercial, vacant, condominium". The definition says vacant. The adapter treats last digit 2 as a condominium and keeps it as `F1`. The 2026-11-03 record already asked a person to confirm this. Still open. No parcel count for 202 was taken today.
- **281** "Commercial land, multiple special assignments, vacant". The definition says vacant. The last digit is 1, so the adapter keeps it as `F1`.
- **751** "Multiple-family land, EFU, condominium". The definition says condominium and exclusive-farm-use land. The last digit is 1, so the adapter keeps it as `B`.
- **Every in-scope 7xx code** is multiple housing or multiple-family land. The adapter maps them to `B`. They are apartments or other multi-family housing, not a commercial or industrial building class.
- **Potential development:** 291, 292, 391, 392, 792.
- **Farm land, unzoned farm land, EFU, or permanent farm-use disqualification:** 241, 251, 271, 341, 351, 371, 741, 751, 771. The domain gives 241 and 251 the same definition text, "Commercial land, unzoned farm land, improved". 250, which the adapter drops, is "Commercial land, EFU zone".
- **Class and zone do not match:** 211 (commercial class, residential zone), 231 and 232 (commercial class, industrial zone), 311 (industrial class, residential zone), 321 (industrial class, commercial zone), 721 (multiple-family, commercial zone), 731 (multiple-family, industrial zone).
- **Miscellaneous assignment:** 261, 361, 761.
- **303** "Department of Revenue appraised industrial" is a special case. The last digit is 3. The adapter keeps this one code and drops every other code ending in 3. The definition is industrial, not vacant.
- **Condominium units** (202, 232, 292, 382, 392, 751, 792) are separate tax lots. The record already notes that one building can be many records.

### Codes the adapter drops that are easy to misread

Vacant commercial land is out of scope. So are exempt classes, miscellaneous classes on a commercial or industrial zone, and residential classes on a commercial or industrial zone. The adapter was not changed.

| Code | Publisher definition                                                | Why the adapter drops it                                                  |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 021  | Misc, commercial zone, improved                                     | miscellaneous class (first digit 0), not 2, 3, or 7                       |
| 024  | Misc, commercial zone, historical                                   | miscellaneous class (first digit 0), not 2, 3, or 7                       |
| 025  | Misc, commercial zone, open space                                   | miscellaneous class (first digit 0), not 2, 3, or 7                       |
| 031  | Misc., industrial zone, improved                                    | miscellaneous class (first digit 0), not 2, 3, or 7                       |
| 033  | Misc., industrial zone, state responsibility                        | miscellaneous class (first digit 0), not 2, 3, or 7                       |
| 121  | Residential land, commercial zone, improved                         | residential class (first digit 1) on a commercial or industrial zone      |
| 122  | Residential land, commercial zone, condominium                      | residential class (first digit 1) on a commercial or industrial zone      |
| 128  | Residential land, commercial zone                                   | residential class (first digit 1) on a commercial or industrial zone      |
| 132  | Residential land, industrial zone, improved                         | residential class (first digit 1) on a commercial or industrial zone      |
| 200  | Commercial land, vacant                                             | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 206  | Commercial, vacant, waterfront                                      | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 213  | Commercial land, residential zone, state responsibility             | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 228  | Commercial land, commercial zone                                    | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 230  | Commercial land, industrial zone                                    | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 238  | Commercial land, industrial zone                                    | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 240  | Commercial land, unzoned farm land, vacant                          | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 250  | Commercial land, EFU zone                                           | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 260  | Commercial land, misc, vacant                                       | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 270  | Commercial land, permanent farm use disqualification, vacant        | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 279  | Commercial land, permanent farm use disqualification, manufactured  | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 290  | Commercial land, potential development, vacant                      | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 300  | Industrial land, vacant                                             | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 313  | Industrial land, residential zone, state responsibility             | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 323  | Industrial land, commercial zone, state responsibility              | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 340  | Industrial land, unzoned farm land, vacant                          | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 343  | Industrial land, unzoned farm land, state responsibility            | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 348  | Industrial land, unzoned farm land                                  | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 360  | Industrial land, misc, vacant                                       | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 370  | Industrial land, permanent farm use disqualification, vacant        | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 379  | Industrial land, permanent farm use disqualification, manufactured  | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 390  | Industrial land, potential development, vacant                      | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 399  | Industrial land, potential development, manufactured structure      | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 700  | Multiple housing land, vacant                                       | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 707  | Manufactured structure park                                         | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 728  | Multiple-family land, commercial zone                               | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 740  | Multiple-family land, unzoned farm land, vacant                     | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 760  | Multiple-family land, misc, vacant                                  | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 768  | Multiple-family land, misc                                          | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 770  | Multiple-family land, permanent farm use disqualification, vacant   | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |
| 779  | Multiple-family land, permanent farm use disqualification, manufact | outside the adapter rule (last digit not 1 or 2, and the code is not 303) |

Exempt codes, first digit 9, all dropped, 32 values on this domain: 900 Exempt, student housing, vacant; 901 Exempt, student housing, improved; 905 Exempt, student housing, temporarily exempt; 910 Exempt, church, vacant; 915 Exempt, church, temporarily exempt; 920 Exempt, school, vacant; 921 Exempt, school, improved; 925 Exempt, school, temporarily exempt; 935 Exempt, cemetery, temporarily exempt; 940 Exempt, city, vacant; 945 Exempt, city, temporarily exempt; 946 Exempt, city, Native American holdings; 947 Exempt, city, misc; 949 Exempt, city, manufactured structure; 950 Exempt, county, vacant; 951 Exempt, county, improved; 952 Exempt, county, partially exempt; 953 Exempt, county, taxable leased property; 954 Exempt, county, in lieu of value; 955 Exempt, county, temporarily exempt; 960 Exempt, state, vacant; 965 Exempt, state, temporarily exempt; 970 Exempt, federal, vacant; 971 Exempt, federal, improved; 972 Exempt, federal, partially exempt; 981 Exempt, fraternal org, improved; 982 Exempt, fraternal org, partially exempt; 983 Exempt, fraternal org, taxable leased property; 984 Exempt, fraternal org, in lieu of value; 985 Exempt, fraternal org, temporarily exempt; 990 Exempt, port or municipal property, vacant; 999 Exempt, port or municipal property, manufactured structure.

| LANDUSE | Publisher definition      |
| ------- | ------------------------- |
| AGR     | Agriculture               |
| COM     | Commercial                |
| FOR     | Forest                    |
| IND     | Industrial                |
| MFR     | Multifamily residential   |
| PUB     | Public/semipublic         |
| RUR     | Rural                     |
| SFR     | Single family residential |
| VAC     | Undeveloped               |

The FGDC supplemental information says the columns are not parcel-reliable: "For example, the land use and prop_code columns are useful for producing generalized land-use maps, but are not considered reliable for parcel specific applications. Field verification has not been done."

## Commercial-universe denominator

Unavailable. Metro does not publish a commercial-plus-industrial parcel count for these counties. The Taxlots (Public) item description and the FGDC details record publish one tri-county tax-lot layer, a content date, and a quarterly update frequency. The FGDC field `pt-and-vector-object-count` is empty. No feature-service count query was run, because the load stopped at the license.

## Freshness evidence

One date covers all three counties. There is no per-county as-of field in the item or the FGDC record.

| Source                                         | Field                            | Value                            | URL                                                                                                          |
| ---------------------------------------------- | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Taxlots (Public) item description              | "Date of last data update"       | 2026-11-02                       | <https://www.arcgis.com/sharing/rest/content/items/b3cabe5845ec47eab61c54e0c631313c?f=json>                  |
| FGDC details id 3733                           | `time-period-of-content`         | 20261102                         | <https://gis.oregonmetro.gov/rlis-metadata-api/details/3733>                                                 |
| FGDC details id 3733                           | `metadata-date`                  | 20261102                         | same                                                                                                         |
| FGDC details id 3733                           | `maint-update-frequency`         | Quarterly                        | same                                                                                                         |
| Feature layer 3 `editingInfo.dataLastEditDate` | epoch milliseconds 1793843165868 | 2026-11-05T01:46:05.868000+00:00 | <https://services2.arcgis.com/McQ0OlIABe29rJJy/arcgis/rest/services/Taxlots_(Public)/FeatureServer/3?f=json> |
| Feature layer 3 `editingInfo.lastEditDate`     | epoch milliseconds 1793899237461 | 2026-11-05T17:20:37.461000+00:00 | same                                                                                                         |
| Item `modified`                                | epoch milliseconds 1793899228000 | 2026-11-05T17:20:28+00:00        | item JSON above                                                                                              |

The supplemental information says: "Certified tax roll data for the coming year is included in the November update to the RLIS taxlots. Certain property changes can trigger re-assessment of individual properties at other points in the year."

The 2026-11-03 record used as-of 2026-07-17 and warned that the Hub CSV `Last-Modified` was 2026-02-19. That header was not requested again. Whether the cached CSV has caught up to the 2026-11-02 layer is unknown.

Per-county publisher as-of: unavailable. The dates above are for the one tri-county layer.

## Fill rates

Unavailable. The audit was not run, so no field fill rate was measured. The layer field list, read from the feature service on 2026-11-06, has no owner-name column. `PUBLIC_OWN` is an integer and `OWNERTYPE` is a string. The item description still says "excluding ownership information". No owner values were downloaded.

## Findings

1. Stop. The controlling text for Taxlots (Public) is the RLIS Open Database End User License Agreement, revised February 2023, not ODbL. A person reads the quote above and decides before any collect. Points that need that decision: sublicensing is prohibited; individual contents are not licensed; the license is limited and revocable; acceptance is by access or use; Clackamas County copyright is asserted in the FGDC supplemental information; compatibility is with CC BY 4.0 and the Open Data Commons Attribution License, not with ODbL share-alike.
2. The machine-readable config is still `verified: true` and still says ODbL. This lane did not edit it.
3. The publisher's stated content date is 2026-11-02. The record's counts and 2026-07-17 as-of were not checked against a new file.
4. No subscription and no click-through gate was encountered for the public item. The Limited Use License is a separate, stricter agreement and is not the `licenseInfo` of this layer.
5. Code-list conflicts to leave for a person, without an adapter change: 202 and 281 are defined as vacant and the adapter keeps them; 751 is defined as a condominium and the adapter keeps it; all in-scope 7xx codes are multiple-family; vacant commercial codes such as 200 are dropped; exempt 9xx codes are dropped.
6. The metadata host's robots file carries `ai-train=no` and `use=reference`. The Open EULA does not mention AI. The 2026-11-03 record's "Not addressed by the publisher" still matches the agreement. The robots signal is an extra fact for a person, on a different host.

## Commands

User-Agent on every request: `FactLotRegistryBot/0.4 (+https://factlot.com/registry; contact@factlot.com)`.

Responses saved under `/workspace/surge/_data/a5-or-rlis/terms/` (outside the repo).

```
UA='FactLotRegistryBot/0.4 (+https://factlot.com/registry; contact@factlot.com)'
curl -sS -A "$UA" -D rlisdiscovery-robots.headers -o rlisdiscovery-robots.txt --max-time 60 \
  "https://rlisdiscovery.oregonmetro.gov/robots.txt"
curl -sS -A "$UA" -D hub-robots.headers -o hub-robots.txt --max-time 60 \
  "https://hub.arcgis.com/robots.txt"
curl -sS -A "$UA" -D services2-robots.headers -o services2-robots.txt --max-time 60 \
  "https://services2.arcgis.com/robots.txt"
curl -sS -A "$UA" -D arcgis-robots.headers -o arcgis-robots.txt --max-time 60 \
  "https://www.arcgis.com/robots.txt"
curl -sS -A "$UA" -D gis-robots.headers -o gis-robots.txt --max-time 60 \
  "https://gis.oregonmetro.gov/robots.txt"
curl -sS -A "$UA" -D item.headers -o item.json --max-time 90 \
  "https://www.arcgis.com/sharing/rest/content/items/b3cabe5845ec47eab61c54e0c631313c?f=json"
curl -sS -A "$UA" -D layer.headers -o layer.json --max-time 90 \
  "https://services2.arcgis.com/McQ0OlIABe29rJJy/arcgis/rest/services/Taxlots_(Public)/FeatureServer/3?f=json"
curl -sS -A "$UA" -D license.headers -o license.html --max-time 90 -L --max-redirs 5 \
  "https://rlisdiscovery.oregonmetro.gov/pages/open-database-license"
curl -sS -A "$UA" -D odbl-item.headers -o odbl-item.json --max-time 90 \
  "https://www.arcgis.com/sharing/rest/content/items/43a73dbe46e644a9a8204afc4cbeb525?f=json"
curl -sS -A "$UA" -D odbl-data.headers -o odbl-data.json --max-time 120 \
  "https://www.arcgis.com/sharing/rest/content/items/43a73dbe46e644a9a8204afc4cbeb525/data"
curl -sS -A "$UA" -D limited-item.headers -o limited-item.json --max-time 90 \
  "https://www.arcgis.com/sharing/rest/content/items/e41d74824dc548189d543bf2e58f439c?f=json"
curl -sS -A "$UA" -D limited-data.headers -o limited-data.json --max-time 120 \
  "https://www.arcgis.com/sharing/rest/content/items/e41d74824dc548189d543bf2e58f439c/data"
curl -sS -A "$UA" -H "Accept: application/vnd.api+json" -H "Content-Type: application/vnd.api+json" \
  -D details3733.headers -o details3733.json --max-time 90 \
  "https://gis.oregonmetro.gov/rlis-metadata-api/details/3733"
curl -sS -A "$UA" -H "Accept: application/vnd.api+json" -H "Content-Type: application/vnd.api+json" \
  -D details3733-full.headers -o details3733-full.json --max-time 120 \
  "https://gis.oregonmetro.gov/rlis-metadata-api/details/3733?include=processsteps,entitytypes,entitytypes.attributes,agolitems"
```

The first metadata GET without `Content-Type: application/vnd.api+json` returned HTTP 415 and the body "Content-Type must be 'application/vnd.api+json'". The retry sent that header. The layer and item requests did not need it.

Timestamp conversion, run against the integers in those JSON files:

```
python3 -c 'from datetime import datetime, timezone
for name, ms in [("modified", 1793899228000), ("lastEdit", 1793899237461), ("dataLastEdit", 1793843165868)]:
    print(name, datetime.fromtimestamp(ms/1000, timezone.utc).isoformat())'
```

Output:

```
modified 2026-11-05T17:20:28+00:00
lastEdit 2026-11-05T17:20:37.461000+00:00
dataLastEdit 2026-11-05T01:46:05.868000+00:00
```

Days from each as-of to 2026-11-04:

```
python3 -c 'from datetime import date
print((date(2026,11,4)-date(2026,11,2)).days)
print((date(2026,11,4)-date(2026,7,17)).days)'
```

Output: `2` and `110`.

Record counts, located and not recomputed:

```
rg -n "20,618|6,085|7,425|34,128|2026-07-17" docs/registry/sources/or-metro-rlis-taxlots.md
```

Domain size: 196 `PROP_CODE` values, 36 kept by the adapter rule, 32 exempt `9xx` values. Counted from `details3733-full.json` with the same `category` rule as `python/src/factlot/registry/adapters/or_metro_rlis.py`.

### Not run

```
PYTHONPATH=python/src python3 -m factlot.collector snapshot --config registry/sources --out /workspace/surge/_data/a5-or-rlis/collected --source or-metro-rlis-taxlots
PYTHONPATH=python/src python3 -m factlot.registry.adapters.or_metro_rlis <csv> /workspace/surge/_data/a5-or-rlis/scratch.db --as-of <date>
PYTHONPATH=python/src python3 -m factlot.registry.maintain /workspace/surge/_data/a5-or-rlis/scratch.db --all
PYTHONPATH=python/src python3 -m factlot.registry.audit /workspace/surge/_data/a5-or-rlis/scratch.db --collected /workspace/surge/_data/a5-or-rlis/collected --reread --entity-names --out docs/registry/quality/surge-2026-11/or-metro-rlis-taxlots-audit.json
```

No `scratch.db` and no `collected/` archive were created.
